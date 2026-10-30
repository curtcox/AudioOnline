(() => {
/** HashBin persistence, adapted from ManimOnline. */
const AudioFiles = typeof module !== 'undefined' ? require('./audio-files.js') : globalThis.AudioFiles;
const AudioCore = typeof module !== 'undefined' ? require('./audio-core.js') : globalThis.AudioCore;
const HashBinDocuments = {
  MAX_BYTES: 5 * 1024 * 1024,
  bytes(value) { return new TextEncoder().encode(value); },
  decode64(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); },
  cidLength(cid) { return this.decode64(cid.slice(0, 8)).reduce((n, b) => n * 256 + b, 0); },
  isCID(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,94}$/.test(value)) return false;
    const length = this.cidLength(value);
    if (value.length !== 8 + (length <= 64 ? Math.ceil(length * 4 / 3) : 86)) return false;
    // Reject noncanonical base64 trailing bits, so ordinary source hashes stay source.
    return this.encode64(this.decode64(value.slice(8))) === value.slice(8);
  },
  encode64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  /** A CID is a six-byte length plus the inline bytes (≤64) or their SHA-512, so content servers cannot substitute documents. */
  async verify(cid, bytes) {
    if (!this.isCID(cid) || this.cidLength(cid) !== bytes.length) throw new Error('HashBin content does not match its CID.');
    const content = bytes.length <= 64 ? bytes : new Uint8Array(await crypto.subtle.digest('SHA-512', bytes));
    if (this.encode64(content) !== cid.slice(8)) throw new Error('HashBin content does not match its CID.');
  },
  cid(input) {
    const text = input.trim().replace(/^#/, '');
    if (this.isCID(text)) return text;
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || !['hashbin.org', '256t.us', 'curtcox.github.io', 'audio.hashbin.page'].includes(url.hostname)) return null;
      const candidate = url.hash.slice(1) || url.pathname.split('/').pop();
      return this.isCID(candidate) ? candidate : null;
    } catch (_) { return null; }
  },
  get TYPES() { return AudioCore.TYPES; },
  serialize({ src, type = 'python', settings = {}, files = {} }) {
    if (typeof src !== 'string') throw new Error('Source must be text.');
    if (!this.TYPES.includes(type)) throw new Error('Unknown source type.');
    AudioFiles.validate(files, src);
    const doc = { format: 'hashbin-audio', version: 1, src, type, settings: AudioCore.options(settings), files };
    const payload = JSON.stringify(doc);
    if (this.bytes(payload).length > this.MAX_BYTES) throw new Error('Source and files exceed the 5 MiB HashBin limit.');
    return payload;
  },
  /** Saved documents, or plain source (which loads as Python). */
  parse(text) {
    if (this.bytes(text).length > this.MAX_BYTES) throw new Error('Saved source exceeds the 5 MiB limit.');
    let doc;
    try { doc = JSON.parse(text); } catch (_) { /* Plain source also loads. */ }
    if (!doc || doc.format !== 'hashbin-audio' || typeof doc.src !== 'string') return { src: text, type: 'python', files: {}, settings: AudioCore.options() };
    if (doc.version !== 1) throw new Error('Unsupported saved document version.');
    if (!this.TYPES.includes(doc.type)) throw new Error('This document needs a newer version of Audio Online.');
    AudioFiles.validate(doc.files || {}, doc.src);
    return { src: doc.src, type: doc.type, files: doc.files || {}, settings: AudioCore.options(doc.settings) };
  },
  link(url, cid) {
    if (!this.isCID(cid)) throw new Error('HashBin returned an invalid CID.');
    const link = new URL(url);
    for (const key of ['doc', 'rate', 'ch', 'scene', 'example', 'raw', 'compressed', 'url', 'code', 'state', 'error', 'error_description']) link.searchParams.delete(key);
    link.hash = cid;
    return link.href;
  }
};

/** Pinned to the immutable v0.4.0 release so a later SDK change cannot reach this app; upgrade deliberately. */
const HASHBIN_SDK_URL = 'https://hashbin.org/sdk/v0.4.0/hashbin.js';

/** Saves go through HashBin Publish, so this origin never holds a HashBin credential. */
class HashBinStore {
  constructor({ clientId, redirectUri, storage, transactionStorage, fetchSource = (...args) => fetch(...args),
    loadSDK = () => import(HASHBIN_SDK_URL), timeout = 20000, timers = globalThis } = {}) {
    Object.assign(this, { clientId, redirectUri, storage, transactionStorage, fetchSource, loadSDK, timeout, timers });
  }
  async bounded(work) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise((_, reject) => {
        timer = this.timers.setTimeout(() => { controller.abort(); reject(new Error('HashBin request timed out. Try again.')); }, this.timeout);
      })]);
    } finally { this.timers.clearTimeout(timer); }
  }
  async load(cid) {
    if (!HashBinDocuments.isCID(cid)) throw new Error('Enter a valid HashBin CID or saved link.');
    if (HashBinDocuments.cidLength(cid) > HashBinDocuments.MAX_BYTES) throw new Error('Saved source exceeds the 5 MiB limit.');
    return this.bounded(async signal => {
      if (HashBinDocuments.cidLength(cid) <= 64) return HashBinDocuments.parse(new TextDecoder('utf-8', { fatal: true }).decode(HashBinDocuments.decode64(cid.slice(8))));
      const response = await this.fetchSource(`https://256t.us/${cid}`, { signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'Saved source was not found. It may have expired or been deleted.' : `HashBin load failed (HTTP ${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await HashBinDocuments.verify(cid, bytes);
      return HashBinDocuments.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    });
  }
  async init() {
    if (this.client) return this.client;
    if (!this.clientId) throw new Error('HashBin saving needs a registered client ID.');
    if (!this.initializing) this.initializing = this.bounded(async () => {
      const { HashBinClient } = await this.loadSDK();
      this.client = new HashBinClient({ clientId: this.clientId, redirectUri: this.redirectUri,
        baseUrl: 'https://hashbin.org', contentBaseUrl: 'https://256t.us', storage: this.storage, transactionStorage: this.transactionStorage,
        fetch: this.fetchSource });
      return this.client;
    }).finally(() => { this.initializing = null; });
    return this.initializing;
  }
  /** Call synchronously from a click after init(), so the approval popup is allowed. A blocked popup redirects. */
  publish(payload, snapshot) {
    if (!this.client) return Promise.reject(new Error('HashBin is still loading. Try again.'));
    return this.client.publish(payload, { contentType: 'application/json', clientState: { snapshot } }).then(async result => {
      if (result.redirected) return result;
      if (!HashBinDocuments.isCID(result.cid)) throw new Error('HashBin returned an invalid CID.');
      await HashBinDocuments.verify(result.cid, HashBinDocuments.bytes(payload));
      return result;
    }, error => { throw new Error(this.message(error)); });
  }
  message(error) {
    if (error.message === 'access_denied') return 'The save was cancelled on HashBin.';
    if (error.message === 'Publish window closed.') return 'The HashBin window was closed before the save was approved.';
    return error.message;
  }
  /** Completes a redirect save; the SDK verifies the CID. Cancelled and failed saves still return the snapshot (SDK v0.3.0). */
  async published(hash) {
    if (!new URLSearchParams(hash.replace(/^#/, '')).has('hashbin_publish')) return null;
    try {
      const { cid, clientState } = await (await this.init()).handlePublishCallback({ hash });
      return { cid, snapshot: clientState?.snapshot };
    } catch (error) { return { error: this.message(error), snapshot: error.clientState?.snapshot || null }; }
  }
  /** Earlier versions kept OAuth tokens on this shared origin. Revoke them server-side; clearing alone leaves copies valid. */
  async retireLegacyTokens() {
    if (!this.clientId || !this.storage?.getItem(`hashbin:tokens:${this.clientId}`)) return false;
    await this.bounded(async () => (await this.init()).disconnect());
    return true;
  }
}
if (typeof module !== 'undefined') module.exports = { HashBinDocuments, HashBinStore };
else Object.assign(globalThis, { HashBinDocuments, HashBinStore });

})();

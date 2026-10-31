/* Editor-only: consent, integrity checking and the separate on-demand neural cache. */
(() => {
const pins = typeof module !== 'undefined' ? require('./neural-manifest.js') : globalThis.AudioNeuralManifest;
class VoiceAssets {
  constructor({ fetch: fetchFile = globalThis.fetch.bind(globalThis), storage = globalThis.caches,
    confirm = message => globalThis.confirm(message), digest = data => crypto.subtle.digest('SHA-256', data) } = {}) {
    Object.assign(this, { fetchFile, storage, confirm, digest });
    this.memory = new Map(); this.allowed = new Set();
  }
  async verify(response, asset) {
    if (!response?.ok || response.type === 'opaque') return null;
    const data = await response.arrayBuffer();
    if (data.byteLength !== asset.bytes) return null;
    const hash = [...new Uint8Array(await this.digest(data))].map(b => b.toString(16).padStart(2, '0')).join('');
    return hash === asset.sha256 ? data : null;
  }
  async cached(asset) {
    if (this.memory.has(asset.url)) return this.memory.get(asset.url);
    try {
      const cache = await this.storage?.open(pins.CACHE);
      const bytes = await this.verify(await cache?.match(asset.url), asset);
      if (bytes) { this.memory.set(asset.url, bytes); return bytes; }
      await cache?.delete(asset.url);
    } catch (_) { /* Private browsing and storage failure do not prevent synthesis. */ }
    return null;
  }
  async ensure(name, { signal } = {}) {
    const files = pins.files(name), missing = [];
    const check = () => { if (signal?.aborted) throw new Error('Cancelled'); };
    for (const asset of files) { check(); if (!await this.cached(asset)) missing.push(asset); }
    check();
    if (missing.length) {
      const size = (missing.reduce((n, asset) => n + asset.bytes, 0) / 1000000).toFixed(1);
      if (!await this.confirm(`Download ${name} (${size} MB)?\n\nNeural voices are stored separately and are not part of “Available offline”. Text stays in your browser.`, { signal })) throw new Error('Neural voice download cancelled.');
      check();
      // Sequential downloads bound peak memory; verify before caching or sending anything to the sandbox.
      for (const asset of missing) {
        check();
        const response = await this.fetchFile(asset.url, { signal, credentials: 'omit' });
        const bytes = await this.verify(response, asset);
        check();
        if (!bytes) throw new Error('Neural voice file failed its pinned SHA-256 check: ' + asset.url);
        this.memory.set(asset.url, bytes);
        try { await (await this.storage?.open(pins.CACHE))?.put(asset.url, new Response(bytes)); } catch (_) { /* Memory is enough for this visit. */ }
      }
    }
    check();
    for (const asset of files) this.allowed.add(asset.url);
  }
  async fetch(url, init) {
    const asset = Object.values(pins.assets).find(asset => asset.url === String(url));
    if (!asset || !this.allowed.has(asset.url)) throw new Error('Neural voice download needs confirmation.');
    const bytes = await this.cached(asset);
    if (!bytes) throw new Error('The verified neural voice file is unavailable. Render again to download it.');
    return new Response(bytes, { headers: { 'Content-Type': /\.mjs$/.test(asset.url) ? 'text/javascript' : 'application/octet-stream' } });
  }
}
if (typeof module !== 'undefined') module.exports = VoiceAssets; else globalThis.AudioVoiceAssets = VoiceAssets;
})();

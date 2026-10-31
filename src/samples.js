/* Sample("kick.wav") and Sample(cid="…"): uploaded WAV files and audio by HashBin CID. Runs in the sandbox
   worker and in Node. Decoding is our own WAV reader, so the same bytes give the same samples in every engine.
   Inline CIDs (≤ 64 bytes) carry their content and decode here. Larger CIDs are fetched and SHA-512-verified on
   the editor origin (Chromium's sandbox worker has no crypto.subtle) and handed in with add(). */
(() => {
const Wav = typeof module !== 'undefined' ? require('./wav.js') : globalThis.Wav;
const AudioFiles = typeof module !== 'undefined' ? require('./audio-files.js') : globalThis.AudioFiles;
const { HashBinDocuments } = typeof module !== 'undefined' ? require('./hashbin.js') : globalThis;

const MISSING = 'SAMPLE_NOT_LOADED:';
const MAX_CID_BYTES = HashBinDocuments.MAX_SAMPLE_BYTES, MAX_CIDS = 32;
class SampleError extends Error {}

const base64Bytes = text => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(text, 'base64')) : Uint8Array.from(atob(text), c => c.charCodeAt(0));
function decode(bytes, what) {
  try {
    const { sampleRate, channels } = Wav.decode(bytes);
    return { rate: sampleRate, frames: channels[0].length, channels };
  } catch (error) { throw new SampleError(`${what}: ${error.message}`); }
}

class Samples {
  constructor() { this.files = {}; this.decodedFiles = new Map(); this.cids = new Map(); }
  /** The document's files for this run; decoded lazily and kept while the files are unchanged. */
  setFiles(files = {}) {
    AudioFiles.validate(files);
    for (const [name, data] of this.decodedFiles) if (files[name] !== data.base64) this.decodedFiles.delete(name);
    this.files = files;
  }
  /** Verified bytes for a CID (from the editor); throws if they cannot be audio. */
  add(cid, bytes) {
    if (!HashBinDocuments.isCID(cid) || HashBinDocuments.cidLength(cid) !== bytes.length) throw new SampleError('The sample does not match its CID.');
    if (!this.cids.has(cid) && this.cids.size >= MAX_CIDS) throw new SampleError(`Scenes can load up to ${MAX_CIDS} CID samples.`);
    this.cids.set(cid, decode(bytes, `Sample(cid="${cid.slice(0, 16)}…")`));
  }
  static checkCid(cid) {
    if (!HashBinDocuments.isCID(cid)) throw new SampleError('Sample(cid=...) needs a valid HashBin CID.');
    if (HashBinDocuments.cidLength(cid) > MAX_CID_BYTES) throw new SampleError('CID samples are limited to 16 MiB.');
    return cid;
  }
  buffer(node) {
    if (typeof node.file === 'string') {
      const name = node.file;
      if (!Object.hasOwn(this.files, name)) throw new SampleError(`No audio file named "${name.slice(0, 64)}". Add it under Audio files.`);
      const data = this.files[name];
      if (this.decodedFiles.get(name)?.base64 !== data) this.decodedFiles.set(name, { base64: data, buffer: decode(base64Bytes(data), name) });
      return this.decodedFiles.get(name).buffer;
    }
    const cid = Samples.checkCid(node.cid);
    if (!this.cids.has(cid)) {
      // Inline CIDs need no network or hashing: the CID is the content.
      if (HashBinDocuments.cidLength(cid) <= 64) this.add(cid, HashBinDocuments.decode64(cid.slice(8)));
      else throw new SampleError(MISSING + cid);
    }
    return this.cids.get(cid);
  }
  measure(node) { const b = this.buffer(node); return b.frames / b.rate; }
}
/** A scene asked for a CID sample that the editor has not fetched yet. */
const missingCid = message => new RegExp(MISSING + '([A-Za-z0-9_-]{8,94})').exec(String(message || ''))?.[1] || null;
const AudioSamples = { Samples, SampleError, MISSING, MAX_CID_BYTES, missingCid };
if (typeof module !== 'undefined') module.exports = AudioSamples;
else globalThis.AudioSamples = AudioSamples;
})();

/** Terminating the worker also interrupts runaway Python and synchronous WASM. */
(() => {
const AudioCore = typeof module !== 'undefined' ? require('./audio-core.js') : globalThis.AudioCore;
class AudioClient {
  constructor({ workerFactory = () => AudioSandbox.factory()(), timeout = 20000, startupTimeout = 120000,
    onStatus = () => {}, onSlow = () => {}, onVoice = async () => { throw new Error('Neural voice download needs confirmation.'); },
    onSample = async () => { throw new Error('CID samples need HashBin.'); }, timers = globalThis } = {}) {
    Object.assign(this, { workerFactory, timeout, startupTimeout, onStatus, onSlow, onVoice, onSample, timers });
    this.sequence = 0;
  }
  cancel(reason = 'Cancelled') {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    pending.controller.abort();
    this.timers.clearTimeout(pending.timer); this.timers.clearTimeout(pending.slow);
    this.worker?.terminate(); this.worker = null;
    pending.reject(new Error(reason));
  }
  run(src, settings = {}, kind = 'python', files = {}) {
    this.cancel();
    if (!this.worker) this.worker = this.workerFactory();
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        if (this.pending?.id !== id) return;
        this.timers.clearTimeout(this.pending.timer); this.timers.clearTimeout(this.pending.slow);
        this.pending.controller.abort();
        this.pending = null;
        if (error && !error.scene) { worker.terminate(); this.worker = null; }
        if (error) reject(error); else resolve(result);
      };
      const deadline = (ms, message) => {
        this.timers.clearTimeout(this.pending.timer);
        this.pending.timer = this.timers.setTimeout(() => this.cancel(message), ms);
      };
      this.pending = { id, reject, slow: null, timer: null, controller: new AbortController() };
      deadline(this.startupTimeout, 'Loading the audio engine took too long. Check your connection and try again.');
      worker.onmessage = ({ data }) => {
        if (!data || data.id !== id || this.pending?.id !== id) return;
        if (data.type === 'status') { this.onStatus(String(data.text).slice(0, 200)); return; }
        if (data.type === 'sample-request') {
          // The editor fetches and verifies CID samples; the sandbox gets only bytes that match their CID.
          const { HashBinDocuments } = typeof module !== 'undefined' ? require('./sample-cid.js') : globalThis;
          if (!HashBinDocuments.isCID(data.cid) || this.pending.sample) { finish(new Error('Invalid sample request.')); return; }
          this.timers.clearTimeout(this.pending.slow);
          deadline(this.startupTimeout, 'Loading the sample took too long. Check your connection and try again.');
          const pending = this.pending, cid = data.cid; pending.sample = true;
          Promise.resolve().then(() => this.onSample(cid, { signal: pending.controller.signal })).then(bytes => {
            if (this.pending !== pending) return;
            pending.sample = false;
            const copy = bytes.slice().buffer;
            worker.postMessage({ kind: 'sample-ready', id, cid, bytes: copy }, [copy]);
          }, error => {
            if (this.pending !== pending) return;
            pending.sample = false;
            worker.postMessage({ kind: 'sample-ready', id, cid, error: String(error?.message || error) });
          });
          return;
        }
        if (data.type === 'loading' || data.type === 'voice-request') {
          this.timers.clearTimeout(this.pending.slow);
          deadline(this.startupTimeout, 'Loading the neural voice took too long. Check your connection and try again.');
          if (data.type === 'voice-request') {
            const pins = typeof module !== 'undefined' ? require('./neural-manifest.js') : globalThis.AudioNeuralManifest;
            if (!pins.voices.includes(data.voice) || this.pending.voice) { finish(new Error('Invalid neural voice request.')); return; }
            const pending = this.pending; pending.voice = true;
            Promise.resolve().then(() => this.onVoice(data.voice, { signal: pending.controller.signal })).then(() => {
              if (this.pending !== pending) return;
              pending.voice = false; worker.postMessage({ kind: 'voice-ready', id, voice: data.voice });
            }).catch(error => { if (this.pending === pending) finish(error); });
          }
          return;
        }
        if (data.type === 'started') {
          deadline(this.timeout, `Rendering timed out after ${this.timeout / 1000} seconds. Simplify the scene and try again.`);
          this.timers.clearTimeout(this.pending.slow);
          this.pending.slow = this.timers.setTimeout(() => { if (this.pending?.id === id) this.onSlow(); }, 1500);
          return;
        }
        try {
          const result = AudioClient.validate(data);
          if (result.error) finish(Object.assign(new Error(result.error.message), result.error, { scene: true, scenes: result.scenes, output: result.output }));
          else finish(null, result);
        } catch (error) { finish(error); }
      };
      worker.onerror = event => finish(new Error(event.message || 'Could not start the audio engine. Reload and try again.'));
      worker.postMessage({ id, kind: AudioCore.TYPES.includes(kind) ? kind : 'python', src, settings: AudioCore.options(settings), files });
    });
  }
  /** Re-mixes the last render's stems (mute/solo) or returns them; the worker keeps them between calls. */
  request(kind, payload = {}) {
    if (!this.worker || this.pending) return Promise.reject(new Error('Render the scene first.'));
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => { worker.onmessage = null; reject(new Error('The audio engine did not answer.')); }, this.timeout);
      worker.onmessage = ({ data }) => {
        if (!data || data.id !== id) return;
        this.timers.clearTimeout(timer); worker.onmessage = null;
        try { if (data.error) throw new Error(String(data.error.message).slice(0, 4000)); resolve(AudioClient.validateExtra(data, kind)); } catch (error) { reject(error); }
      };
      worker.postMessage({ id, kind, ...payload });
    });
  }
  mix(enabled) { return this.request('mix', { enabled: enabled.slice(0, 200).map(String) }); }
  stems() { return this.request('stems'); }
  static validateExtra(data, kind) {
    const { sampleRate, length } = data;
    if (!AudioCore.SAMPLE_RATES.includes(sampleRate) || !Number.isInteger(length) || length < 0 || length > AudioCore.MAX_SECONDS * sampleRate) throw new Error('The sandbox returned invalid audio.');
    const channels = list => Array.isArray(list) && list.length >= 1 && list.length <= 2 && list.every(c => c instanceof Float32Array && c.length === length);
    if (kind === 'mix') { if (!channels(data.channels)) throw new Error('The sandbox returned an invalid mix.'); return { sampleRate, length, channels: data.channels }; }
    if (!Array.isArray(data.stems) || data.stems.length > 200 || !data.stems.every(s => s && typeof s.name === 'string' && channels(s.channels))) throw new Error('The sandbox returned invalid stems.');
    return { sampleRate, length, stems: data.stems.map(s => ({ name: s.name.slice(0, 64), channels: s.channels })) };
  }
  /** Results cross from the sandbox: check types, bounds and lengths before the editor uses them. */
  static validate(data) {
    const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
    const scenes = Array.isArray(data.scenes) ? data.scenes.slice(0, 100).map(name => text(name, 100)) : [];
    const output = text(data.output, AudioCore.MAX_OUTPUT_TEXT);
    if (data.error) {
      const line = Number.isInteger(data.error.line) && data.error.line > 0 ? data.error.line : null;
      return { error: { message: text(data.error.message, 4000) || 'The scene failed.', line, traceback: text(data.error.traceback, 20000) }, scenes, output };
    }
    const { sampleRate, length, channels } = data;
    if (!AudioCore.SAMPLE_RATES.includes(sampleRate)) throw new Error('The sandbox returned an invalid sample rate.');
    if (!Number.isInteger(length) || length < 0 || length > AudioCore.MAX_SECONDS * sampleRate) throw new Error('The sandbox returned an invalid length.');
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || !channels.every(c => c instanceof Float32Array && c.length === length)) throw new Error('The sandbox returned invalid audio channels.');
    const tracks = Array.isArray(data.tracks) ? data.tracks.slice(0, 200).map(name => text(name, 64)) : [];
    const clips = (Array.isArray(data.clips) ? data.clips.slice(0, AudioCore.MAX_CLIPS) : []).filter(c => c && typeof c === 'object').map(c => ({
      track: text(c.track, 64), label: text(c.label, 80), line: Number.isInteger(c.line) && c.line > 0 ? c.line : null,
      start: Number.isFinite(c.start) ? Math.max(0, c.start) : 0, end: Number.isFinite(c.end) ? Math.max(0, c.end) : 0 }));
    return { sampleRate, length, channels, tracks, clips, scenes, scene: text(data.scene, 100), output, ms: Number.isFinite(data.ms) ? data.ms : 0 };
  }
}
if (typeof module !== 'undefined') module.exports = AudioClient;
else globalThis.AudioClient = AudioClient;
})();

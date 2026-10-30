/** Terminating the worker also interrupts runaway Python and synchronous WASM. */
(() => {
const AudioCore = typeof module !== 'undefined' ? require('./audio-core.js') : globalThis.AudioCore;
class AudioClient {
  constructor({ workerFactory = () => AudioSandbox.factory()(), timeout = 20000, startupTimeout = 120000,
    onStatus = () => {}, onSlow = () => {}, timers = globalThis } = {}) {
    Object.assign(this, { workerFactory, timeout, startupTimeout, onStatus, onSlow, timers });
    this.sequence = 0;
  }
  cancel(reason = 'Cancelled') {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    this.timers.clearTimeout(pending.timer); this.timers.clearTimeout(pending.slow);
    this.worker?.terminate(); this.worker = null;
    pending.reject(new Error(reason));
  }
  run(src, settings = {}) {
    this.cancel();
    if (!this.worker) this.worker = this.workerFactory();
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        if (this.pending?.id !== id) return;
        this.timers.clearTimeout(this.pending.timer); this.timers.clearTimeout(this.pending.slow);
        this.pending = null;
        if (error && !error.scene) { worker.terminate(); this.worker = null; }
        if (error) reject(error); else resolve(result);
      };
      const deadline = (ms, message) => {
        this.timers.clearTimeout(this.pending.timer);
        this.pending.timer = this.timers.setTimeout(() => this.cancel(message), ms);
      };
      this.pending = { id, reject, slow: null, timer: null };
      deadline(this.startupTimeout, 'Loading the audio engine took too long. Check your connection and try again.');
      worker.onmessage = ({ data }) => {
        if (!data || data.id !== id) return;
        if (data.type === 'status') { this.onStatus(String(data.text).slice(0, 200)); return; }
        if (data.type === 'started') {
          deadline(this.timeout, `Rendering timed out after ${this.timeout / 1000} seconds. Simplify the scene and try again.`);
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
      worker.postMessage({ id, kind: 'python', src, settings: AudioCore.options(settings) });
    });
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

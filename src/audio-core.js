/* Shared constants and settings for the editor, the sandbox worker and Node tests. */
(() => {
const AudioCore = {
  // Same pin as PythonOnline. Changing it also changes scripts/remote-hashes.json and the golden hashes.
  PYODIDE_URL: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/',
  NUMPY_WHEEL: 'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl',
  SAMPLE_RATES: [22050, 32000, 44100, 48000],
  MAX_SECONDS: 300,
  MAX_CLIPS: 5000,
  MAX_OUTPUT_TEXT: 200000,
  options(value = {}) {
    const rate = Number(value.sampleRate);
    const channels = Number(value.channels);
    return {
      sampleRate: this.SAMPLE_RATES.includes(rate) ? rate : 48000,
      channels: channels === 1 ? 1 : 2,
      scene: typeof value.scene === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(value.scene) ? value.scene : ''
    };
  }
};
if (typeof module !== 'undefined') module.exports = AudioCore;
else globalThis.AudioCore = AudioCore;
})();

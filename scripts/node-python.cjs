/* Node runs the same Pyodide release, audio.py and renderer as the sandbox worker (tests and golden hashes). */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadPyodide } = require('pyodide');
const AudioPython = require('../src/audio-python.js');
const AudioRenderer = require('../src/audio-renderer.js');
const AudioCore = require('../src/audio-core.js');
const Wav = require('../src/wav.js');
const root = path.join(__dirname, '..');

let ready;
function python() {
  ready ||= (async () => {
    const cache = path.join(root, '.pyodide-cache');
    fs.mkdirSync(cache, { recursive: true });
    const py = await loadPyodide({ packageCacheDir: cache, stdout: () => {}, stderr: () => {} });
    AudioPython.install(py, fs.readFileSync(path.join(root, 'src/py/audio.py'), 'utf8'));
    return py;
  })();
  return ready;
}
/** Renders source as the worker does and returns the result plus the SHA-256 of its float32 WAV. */
async function render(source, settings = {}) {
  const py = await python();
  if (/^\s*(?:import|from)\s+numpy\b/m.test(source)) await py.loadPackage('numpy', { messageCallback: () => {} });
  const scene = AudioPython.run(py, source, AudioCore.options(settings));
  const result = AudioRenderer.render(scene.timeline, scene.buffers);
  return { ...scene, result, hash: hash(result) };
}
const hash = result => crypto.createHash('sha256').update(Wav.encode(result.channels, result.sampleRate, 'float32')).digest('hex');
module.exports = { python, render, hash };

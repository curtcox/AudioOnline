/* Scenes run only here: a classic worker inside the HashBin SDK's opaque sandbox (src/audio-sandbox.js).
   It runs after audio-core.js, dmath.js, audio-renderer.js, audio-python.js and the SDK prelude. */
const send = self.postMessage.bind(self);
let python = null, output = [], outputSize = 0;
const capture = text => {
  if (outputSize > AudioCore.MAX_OUTPUT_TEXT) return;
  output.push(text); outputSize += text.length + 1;
};
// Nested workers and storage would give user code a realm without these restrictions (as in PythonOnline).
function harden(scope = self) {
  for (const key of ['caches', 'indexedDB', 'importScripts', 'Worker', 'SharedWorker']) {
    for (let prototype = Object.getPrototypeOf(scope); prototype; prototype = Object.getPrototypeOf(prototype)) {
      if (Object.getOwnPropertyDescriptor(prototype, key)?.configurable) delete prototype[key];
    }
    Object.defineProperty(scope, key, { value: undefined, configurable: false, writable: false });
  }
}
function loadPython(id) {
  if (!python) {
    send({ type: 'status', id, text: 'Loading Python… (~13 MB on first visit)' });
    python = (async () => {
      // Runtime bytes arrive through the editor's verified offline cache (the SDK proxy), not direct fetches.
      const [{ loadPyodide }, asm] = await Promise.all(['pyodide.mjs', 'pyodide.asm.mjs'].map(file => hashbinSandbox.import(AudioCore.PYODIDE_URL + file)));
      const [py, module] = await Promise.all([
        loadPyodide({ indexURL: AudioCore.PYODIDE_URL, createPyodideModule: asm.default }),
        fetch('py/audio.py').then(response => { if (!response.ok) throw new Error('audio.py download failed'); return response.text(); })
      ]);
      py.setStdout({ batched: capture }); py.setStderr({ batched: capture });
      AudioPython.install(py, module);
      harden();
      return py;
    })();
    python.catch(() => { python = null; });
  }
  return python;
}
async function run({ id, kind, src, settings }) {
  output = []; outputSize = 0;
  if (kind !== 'python') throw new Error('Unknown source type.');
  const py = await loadPython(id);
  if (/^\s*(?:import|from)\s+numpy\b/m.test(src)) {
    send({ type: 'status', id, text: 'Loading numpy…' });
    // By name, so Pyodide checks the wheel against the pinned lockfile's SHA-256.
    await py.loadPackage('numpy', { messageCallback: () => {}, errorCallback: capture });
  }
  // The client's render deadline starts now; runtime downloads above have their own limit.
  send({ type: 'started', id });
  const started = performance.now();
  let scene;
  try { scene = AudioPython.run(py, src, AudioCore.options(settings)); }
  catch (error) {
    if (error instanceof AudioPython.SceneError) return send({ id, error: { message: error.message, line: error.line, traceback: error.traceback }, scenes: error.scenes, output: output.join('\n') });
    throw error;
  }
  let result;
  try { result = AudioRenderer.render(scene.timeline, scene.buffers); }
  catch (error) {
    if (error instanceof AudioRenderer.TimelineError) return send({ id, error: { message: error.message, line: error.line ?? null, traceback: '' }, scenes: scene.scenes, output: output.join('\n') });
    throw error;
  }
  const { channels, ...rest } = result;
  send({ id, ...rest, channels, scenes: scene.scenes, scene: scene.scene, output: output.join('\n'), ms: performance.now() - started }, channels.map(channel => channel.buffer));
}
self.onmessage = ({ data }) => {
  run(data).catch(error => send({ id: data.id, error: { message: String(error?.message || error), line: null, traceback: '' }, output: output.join('\n') }));
};

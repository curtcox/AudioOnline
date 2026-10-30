/* Runs a scene with Pyodide and returns its timeline. Shared by the sandbox worker and Node tests. */
(() => {
class SceneError extends Error {
  constructor({ message, line, traceback }) { super(message); this.line = Number.isInteger(line) ? line : null; this.traceback = traceback || ''; }
}
const AudioPython = {
  SceneError,
  /** Installs audio.py beside the user's code; source is the module text. */
  install(py, source) {
    py.FS.mkdirTree('/opt/audio');
    py.FS.writeFile('/opt/audio/audio.py', source);
    py.runPython("import sys\nif '/opt/audio' not in sys.path: sys.path.insert(0, '/opt/audio')\nimport audio");
  },
  /** engines.measure(node) → seconds, called synchronously from audio.py for notation and voice clips. */
  run(py, source, settings, engines = null) {
    py.registerJsModule('_audio_js', { measure: json => {
      if (!engines) throw new Error('This clip needs an engine that is not loaded.');
      return engines.measure(JSON.parse(json));
    } });
    const proxy = py.pyimport('audio').run_scene(source, JSON.stringify(settings));
    let result;
    try { result = proxy.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false }); } finally { proxy.destroy(); }
    if (result.error) throw Object.assign(new SceneError(result.error), { scenes: result.scenes || [] });
    const buffers = result.buffers.map(b => ({ rate: b.rate, frames: b.frames,
      channels: b.channels.map(bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) }));
    return { timeline: JSON.parse(result.timeline), buffers, scenes: result.scenes, scene: result.scene };
  }
};
if (typeof module !== 'undefined') module.exports = AudioPython;
else globalThis.AudioPython = AudioPython;
})();

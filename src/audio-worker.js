/* Scenes run only here: a classic worker inside the HashBin SDK's opaque sandbox (src/audio-sandbox.js).
   It runs after audio-core.js, dmath.js, audio-renderer.js, audio-python.js and the SDK prelude. */
const send = self.postMessage.bind(self);
let python = null, output = [], outputSize = 0;
// Notation engines are vendored files fetched through the sandbox proxy and run as blob modules.
const notation = new AudioNotation.Notation({
  read: file => fetch('../vendor/' + file).then(response => { if (!response.ok) throw new Error(`${file} download failed`); return response.text(); }),
  importSource: source => import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
});
const fetchVendor = (file, as) => fetch('../vendor/' + file).then(response => { if (!response.ok) throw new Error(`${file} download failed`); return response[as](); });
const voices = new AudioVoice.Voices({ read: file => fetchVendor(file, 'arrayBuffer'), readText: file => fetchVendor(file, 'text'),
  importSource: source => import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))) });
let voiceRequest = null;
const neural = new AudioNeuralVoice.NeuralVoices({
  read: url => fetch(url).then(response => { if (!response.ok) throw new Error('Neural voice download failed.'); return response.arrayBuffer(); }),
  importModule: url => hashbinSandbox.import(url),
  consent: name => new Promise(resolve => {
    voiceRequest = { name, resolve };
    send({ type: 'voice-request', id: activeId, voice: name });
  })
});
let activeId = null;
// Uploaded WAV files arrive with each run; CID samples beyond inline size come verified from the editor.
const samples = new AudioSamples.Samples();
let sampleRequest = null;
const requestSample = cid => new Promise((resolve, reject) => {
  sampleRequest = { cid, resolve, reject };
  send({ type: 'sample-request', id: activeId, cid });
});
const engines = AudioVoice.providers(notation, voices, neural, samples);
const ENGINE_CALL = /\b(?:abc|zzfx|sfxr)\s*\(/;
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
async function run({ id, kind, src, settings, files }) {
  activeId = id; output = []; outputSize = 0;
  samples.setFiles(files || {});
  const options = AudioCore.options(settings);
  if (kind !== 'python' && !AudioNotation.KINDS.includes(kind)) throw new Error('Unknown source type.');
  if (kind !== 'python' && kind !== 'pattern' || ENGINE_CALL.test(src)) {
    send({ type: 'status', id, text: 'Loading notation engines…' });
    await notation.load();
  }
  if (kind !== 'python') {
    // Notation documents never load Python.
    send({ type: 'started', id });
    const started = performance.now();
    let result;
    let timeline;
    try { timeline = notation.timeline(kind, src, options); result = AudioRenderer.render(timeline, [], engines); }
    catch (error) {
      if (error instanceof AudioRenderer.TimelineError || error instanceof AudioNotation.NotationError) return send({ id, error: { message: error.message, line: error.line ?? null, traceback: '' }, scenes: [], output: '' });
      throw error;
    }
    remember(result, timeline);
    const { channels, ...rest } = result;
    return send({ id, ...rest, channels, scenes: [], scene: '', output: '', ms: performance.now() - started }, channels.map(channel => channel.buffer));
  }
  const py = await loadPython(id);
  const speaking = AudioVoice.Voices.mentioned(src).filter(name => !voices.loaded(name.slice(5)));
  if (speaking.length) { send({ type: 'status', id, text: 'Loading voice…' }); await voices.load(speaking); }
  if (/^\s*(?:import|from)\s+numpy\b/m.test(src)) {
    send({ type: 'status', id, text: 'Loading numpy…' });
    // By name, so Pyodide checks the wheel against the pinned lockfile's SHA-256.
    await py.loadPackage('numpy', { messageCallback: () => {}, errorCallback: capture });
  }
  // The client's render deadline starts now; runtime downloads above have their own limit.
  send({ type: 'started', id });
  const started = performance.now();
  let scene, cidLoads = 0;
  for (let attempt = 0; ; attempt++) {
    try { neural.requested = null; scene = AudioPython.run(py, src, options, engines); break; }
    catch (error) {
      if (error instanceof AudioPython.SceneError && neural.requested && (error.message.includes(AudioNeuralVoice.MISSING) || error.message.includes(AudioVoice.MISSING + neural.requested.voice))) {
        if (attempt >= 200) return send({ id, error: { message: 'Scenes are limited to 200 neural utterances.', line: error.line, traceback: '' }, scenes: error.scenes, output: output.join('\n') });
        send({ type: 'loading', id });
        send({ type: 'status', id, text: 'Preparing neural speech…' });
        try { await neural.prepare(neural.requested); }
        catch (failure) { return send({ id, error: { message: String(failure.message || failure), line: error.line, traceback: '' }, scenes: error.scenes, output: output.join('\n') }); }
        output = []; outputSize = 0; send({ type: 'started', id }); continue;
      }
      // A CID sample is fetched and verified by the editor, then the deterministic scene runs again.
      const cid = error instanceof AudioPython.SceneError && AudioSamples.missingCid(error.message);
      if (cid) {
        if (++cidLoads > 32) return send({ id, error: { message: 'Scenes can load up to 32 CID samples.', line: error.line, traceback: '' }, scenes: error.scenes, output: output.join('\n') });
        send({ type: 'loading', id });
        send({ type: 'status', id, text: 'Loading sample from HashBin…' });
        try { samples.add(cid, new Uint8Array(await requestSample(cid))); }
        catch (failure) { return send({ id, error: { message: String(failure.message || failure), line: error.line, traceback: '' }, scenes: error.scenes, output: output.join('\n') }); }
        output = []; outputSize = 0; send({ type: 'started', id }); continue;
      }
      // A voice named at run time (not literally in the source) loads, then the deterministic scene runs again.
      const voice = error instanceof AudioPython.SceneError && AudioVoice.missingVoice(error.message);
      if (voice && !voices.loaded(voice.slice(5))) { await voices.load([voice]); output = []; outputSize = 0; continue; }
      if (error instanceof AudioPython.SceneError) return send({ id, error: { message: error.message, line: error.line, traceback: error.traceback }, scenes: error.scenes, output: output.join('\n') });
      throw error;
    }
  }
  let result;
  try { result = AudioRenderer.render(scene.timeline, scene.buffers, engines); }
  catch (error) {
    if (error instanceof AudioRenderer.TimelineError) return send({ id, error: { message: error.message, line: error.line ?? null, traceback: '' }, scenes: scene.scenes, output: output.join('\n') });
    throw error;
  }
  remember(result, scene.timeline);
  const { channels, ...rest } = result;
  send({ id, ...rest, channels, scenes: scene.scenes, scene: scene.scene, output: output.join('\n'), ms: performance.now() - started }, channels.map(channel => channel.buffer));
}
// The last render's stems stay here for mute/solo re-mixes and stem export; the editor asks for them.
let last = null;
function remember(result, timeline) {
  const muted = new Set(Object.entries(timeline.tracks || {}).filter(([, t]) => t?.mute).map(([name]) => name));
  last = { stems: result.stems, master: timeline.master || {}, rate: result.sampleRate, channels: result.channels.length, length: result.length, muted };
}
function mix({ id, enabled }) {
  if (!last) throw new Error('Render the scene first.');
  const names = (Array.isArray(enabled) ? enabled : []).filter(name => last.stems.has(name) && !last.muted.has(name));
  const channels = AudioRenderer.mix(last.stems, names, last.master, last.rate, last.channels, last.length);
  send({ id, kind: 'mix', sampleRate: last.rate, length: last.length, channels }, channels.map(channel => channel.buffer));
}
function stems({ id }) {
  if (!last) throw new Error('Render the scene first.');
  const list = [...last.stems].map(([name, channels]) => ({ name, channels: channels.map(ch => Float32Array.from(ch)) }));
  send({ id, kind: 'stems', sampleRate: last.rate, length: last.length, stems: list }, list.flatMap(stem => stem.channels.map(channel => channel.buffer)));
}
self.onmessage = ({ data }) => {
  if (data?.kind === 'sample-ready') {
    if (data.id === activeId && sampleRequest?.cid === data.cid) {
      const request = sampleRequest; sampleRequest = null;
      if (data.bytes instanceof ArrayBuffer) request.resolve(data.bytes); else request.reject(new Error(String(data.error || 'The sample could not be loaded.').slice(0, 400)));
    }
    return;
  }
  if (data?.kind === 'voice-ready') {
    if (data.id === activeId && voiceRequest?.name === data.voice) { voiceRequest.resolve(); voiceRequest = null; }
    return;
  }
  const task = data?.kind === 'mix' ? async () => mix(data) : data?.kind === 'stems' ? async () => stems(data) : () => run(data);
  task().catch(error => send({ id: data.id, error: { message: String(error?.message || error), line: null, traceback: '' }, output: output.join('\n') }));
};

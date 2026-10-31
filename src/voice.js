/* The bundled SVOX Pico voice (Apache-2.0). Speech synthesizes synchronously once a language's files are
   loaded, so audio.py can measure an utterance while construct() runs. Output is 16 kHz mono; the
   renderer resamples it. Pico is WASM, so the bytes are identical in every engine (Step 1 spike). */
(() => {
class VoiceError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}
const LANGUAGES = {
  'en-US': ['en-US_ta.bin', 'en-US_lh0_sg.bin'], 'en-GB': ['en-GB_ta.bin', 'en-GB_kh0_sg.bin'],
  'de-DE': ['de-DE_ta.bin', 'de-DE_gl0_sg.bin'], 'es-ES': ['es-ES_ta.bin', 'es-ES_zl0_sg.bin'],
  'fr-FR': ['fr-FR_ta.bin', 'fr-FR_nk0_sg.bin'], 'it-IT': ['it-IT_ta.bin', 'it-IT_cm0_sg.bin']
};
const VOICES = Object.keys(LANGUAGES).map(language => `pico:${language}`);
const MISSING = 'VOICE_NOT_LOADED:';
const PICO_STEP_BUSY = 201, MAX_TEXT = 5000;

class Voices {
  /** read(path) → ArrayBuffer of a vendored file; readText(path) → text; importSource(source) → module. */
  constructor({ read, readText, importSource }) { Object.assign(this, { read, readText, importSource }); this.engines = new Map(); this.loading = new Map(); this.cache = new Map(); }
  static voiceFor(name = 'pico:en-US') {
    if (typeof name !== 'string' || !VOICES.includes(name)) throw new VoiceError(`Unknown voice "${String(name).slice(0, 40)}". Bundled voices: ${VOICES.join(', ')}.`);
    return name.slice(5);
  }
  /** Voice names mentioned in source, plus the default when the source speaks at all. */
  static mentioned(source) {
    const found = new Set(source.match(/pico:[a-z]{2}-[A-Z]{2}/g) || []);
    if (/\b(?:say|Speech)\s*\(/.test(source)) found.add('pico:en-US');
    return [...found].filter(name => VOICES.includes(name));
  }
  loaded(language) { return this.engines.has(language); }
  async module() {
    this.factory ||= (async () => {
      const [source, wasm] = await Promise.all([this.readText('svoxpico/svoxpico.js'), this.read('svoxpico/svoxpico.wasm')]);
      // Emscripten recognizes a worker by importScripts, which the sandbox removes before user code runs;
      // a module-scope stub restores the detection (the loader never calls it: the wasm bytes are passed in).
      const prelude = "const importScripts = () => { throw new Error('importScripts is unavailable in the audio sandbox.'); };\n";
      return { create: (await this.importSource(prelude + source)).default, wasm };
    })();
    return this.factory;
  }
  async load(names) {
    for (const name of names) {
      const language = Voices.voiceFor(name);
      if (this.engines.has(language)) continue;
      if (!this.loading.has(language)) this.loading.set(language, this.start(language));
      await this.loading.get(language);
    }
  }
  async start(language) {
    const { create, wasm } = await this.module();
    const files = await Promise.all(LANGUAGES[language].map(file => this.read('svoxpico/lang/' + file)));
    const m = await create({ wasmBinary: wasm, locateFile: file => file, print: () => {}, printErr: () => {} });
    const check = (code, what) => { if (code < 0) throw new VoiceError(`Pico ${what} failed (${code}).`); return code; };
    const string = text => { const bytes = new TextEncoder().encode(text + '\0'), at = m._malloc(bytes.length); m.HEAPU8.set(bytes, at); return at; };
    const memory = m._malloc(2500000), systemOut = m._malloc(4);
    check(m._pico_initialize(memory, 2500000, systemOut), 'start');
    const system = m.HEAPU32[systemOut >> 2], voice = string('voice'), names = [];
    LANGUAGES[language].forEach((file, i) => {
      m.FS.writeFile('/' + file, new Uint8Array(files[i]));
      const resource = m._malloc(4), name = m._malloc(32);
      check(m._pico_loadResource(system, string('/' + file), resource), 'resource');
      check(m._pico_getResourceName(system, m.HEAPU32[resource >> 2], name), 'resource name');
      names.push(name);
    });
    check(m._pico_createVoiceDefinition(system, voice), 'voice');
    for (const name of names) check(m._pico_addResourceToVoiceDefinition(system, voice, name), 'voice resource');
    const engineOut = m._malloc(4);
    check(m._pico_newEngine(system, voice, engineOut), 'engine');
    const e = { m, engine: m.HEAPU32[engineOut >> 2], buffer: m._malloc(4096), count: m._malloc(4), type: m._malloc(4), written: m._malloc(4) };
    e.snapshot = m.HEAPU8.slice();
    this.engines.set(language, e);
  }
  /** Renderer provider: { rate: 16000, frames, channels: [Float32Array] } for a speech node. */
  buffer(node) {
    const key = JSON.stringify([node.voice, node.text, node.speed, node.pitch]);
    if (!this.cache.has(key)) this.cache.set(key, this.synthesize(node));
    return this.cache.get(key);
  }
  measure(node) { const b = this.buffer(node); return b.frames / b.rate; }
  synthesize(node) {
    const language = Voices.voiceFor(node.voice), e = this.engines.get(language);
    if (!e) throw new VoiceError(MISSING + node.voice, node.line);
    if (typeof node.text !== 'string' || !node.text.trim()) throw new VoiceError('say() needs some text.', node.line);
    if (node.text.length > MAX_TEXT) throw new VoiceError(`Utterances are limited to ${MAX_TEXT} characters.`, node.line);
    const level = (value, name) => { if (!(value >= 0.5 && value <= 2)) throw new VoiceError(`${name} must be from 0.5 to 2.`, node.line); return Math.round(value * 100); };
    // Pico's own markup sets speed and pitch; angle brackets in the text are removed so text cannot add markup.
    const text = `<speed level="${level(node.speed ?? 1, 'speed')}"><pitch level="${level(node.pitch ?? 1, 'pitch')}">${node.text.replace(/[<>]/g, ' ')}</pitch></speed>`;
    const { m } = e;
    // Pico keeps state in C globals that even pico_resetEngine leaves behind, so the whole heap returns to its
    // just-loaded snapshot before every utterance (as Gnuplot Online does around each run).
    const heap = m.HEAPU8; heap.set(e.snapshot); if (heap.length > e.snapshot.length) heap.fill(0, e.snapshot.length);
    const bytes = new TextEncoder().encode(text + '\0'), at = m._malloc(bytes.length), parts = [];
    m.HEAPU8.set(bytes, at);
    try {
      for (let offset = 0; offset < bytes.length;) {
        m.HEAP32[e.written >> 2] = 0;
        if (m._pico_putTextUtf8(e.engine, at + offset, bytes.length - offset, e.written) < 0) throw new VoiceError('Pico could not read the text.', node.line);
        offset += m.HEAP32[e.written >> 2];
        let status;
        do {
          status = m._pico_getData(e.engine, e.buffer, 4096, e.count, e.type);
          if (status < 0) throw new VoiceError('Pico synthesis failed.', node.line);
          const count = m.HEAP16[e.count >> 1];
          if (count > 0) parts.push(m.HEAPU8.slice(e.buffer, e.buffer + count));
        } while (status === PICO_STEP_BUSY);
      }
    } finally { m._free(at); }  // (the next restore discards this allocation anyway)
    const total = parts.reduce((sum, p) => sum + p.length, 0), pcm = new Uint8Array(total);
    let offset = 0; for (const p of parts) { pcm.set(p, offset); offset += p.length; }
    const samples = new Int16Array(pcm.buffer, 0, total >> 1), out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
    return { rate: 16000, frames: out.length, channels: [out] };
  }
}
/** One provider object for the renderer and the Python bridge: speech goes to the voices, samples to the sample loader, the rest to notation. */
const effects = () => typeof module !== 'undefined' ? require('./effects.js') : globalThis.AudioEffects;
function providers(notation, voices, neural, samples) {
  const speech = node => node.voice?.startsWith('kitten:') || node.voice?.startsWith('kokoro:') ? neural || voices : voices;
  const sampler = () => { if (!samples) throw new Error('Sample clips need the sample loader.'); return samples; };
  return {
    buffer: node => node.op === 'speech' ? speech(node).buffer(node) : node.op === 'sample' ? sampler().buffer(node) : notation.buffer(node),
    expand: node => notation.expand(node),
    measure: node => node.op === 'speech' ? speech(node).measure(node) : node.op === 'sample' ? sampler().measure(node) : node.op === 'fx-tail' ? effects().tail(node.chain) : notation.measure(node)
  };
}
/** A scene asked for a voice that is not loaded yet (the worker loads it and runs the scene again). */
const missingVoice = message => new RegExp(MISSING + '(pico:[a-z]{2}-[A-Z]{2})').exec(String(message || ''))?.[1] || null;
const AudioVoice = { Voices, VoiceError, VOICES, LANGUAGES, MISSING, providers, missingVoice };
if (typeof module !== 'undefined') module.exports = AudioVoice;
else globalThis.AudioVoice = AudioVoice;
})();

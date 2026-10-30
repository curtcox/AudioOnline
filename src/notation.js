/* Compact notations (ABC, ZzFX, sfxr, patterns) as clips and as whole documents.
   Shared by the sandbox worker and Node. Third-party engines load unmodified; a module-scope `Math`
   prelude makes their transcendental math and randomness deterministic (docs/step1-report.md §2.2). */
(() => {
const isNode = typeof module !== 'undefined';
const DMath = isNode ? require('./dmath.js') : globalThis.DMath;
const Instruments = isNode ? require('./instruments.js') : globalThis.Instruments;
const MiniNotation = isNode ? require('./mini-notation.js') : globalThis.MiniNotation;

class NotationError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Math with deterministic transcendentals and a seedable random(); exact operations are passed through. */
function mathShim() {
  const shim = {};
  for (const key of Object.getOwnPropertyNames(Math)) shim[key] = Math[key];
  let random = rng(0);
  Object.assign(shim, {
    sin: DMath.sin, cos: DMath.cos, tan: x => DMath.sin(x) / DMath.cos(x), exp: DMath.exp, log: DMath.log, pow: DMath.pow, tanh: DMath.tanh,
    log2: x => DMath.log(x) / Math.LN2, log10: x => DMath.log(x) / Math.LN10, expm1: x => DMath.exp(x) - 1, log1p: x => DMath.log(1 + x),
    cbrt: x => x < 0 ? -DMath.pow(-x, 1 / 3) : DMath.pow(x, 1 / 3), sinh: x => (DMath.exp(x) - DMath.exp(-x)) / 2, cosh: x => (DMath.exp(x) + DMath.exp(-x)) / 2,
    hypot: (...v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)), random: () => random()
  });
  Object.defineProperty(shim, 'seed', { value: seed => { random = rng(seed >>> 0); } });
  return shim;
}
const MODULES = {
  // Its UMD wrapper registers on `this`, which a module leaves undefined, so it runs as a method of a root object.
  abcjs: { file: 'abcjs/abcjs-basic-min.js', wrap: text => `const root = {};\n(function () {\n${text}\n}).call(root);\nexport default root.ABCJS;\n` },
  // ZzFX also uses the ** operator, which no Math prelude can reach and which engines evaluate differently.
  // The vendored file's hash is pinned, so these exact expressions are rewritten to Math.pow at load time.
  zzfx: { file: 'zzfx/ZzFX.js', patches: [['sampleRate**3', 'Math.pow(sampleRate,3)'], ['Math.sin(t**3)', 'Math.sin(Math.pow(t,3))'],
    ['abs(s)**shapeCurve', 'Math.pow(abs(s),shapeCurve)'], ['2**(semitoneOffset/12)', 'Math.pow(2,semitoneOffset/12)']],
  wrap: text => `const Math = globalThis.__audioOnlineMath;\nconst AudioContext = class { constructor() { this.sampleRate = 44100; } };\n${text}\n` },
  jsfxr: { file: 'jsfxr/sfxr.js', wrap: text => `const Math = globalThis.__audioOnlineMath;\n${text}\nexport default globalThis.jsfxr;\n` }
};

function patch(module, text) {
  for (const [from, to] of module.patches || []) {
    if (text.split(from).length !== 2) throw new NotationError(`${module.file} is not the pinned release (expected one "${from}").`);
    text = text.replace(from, to);
  }
  if (/[^*/\s]\s*\*\*\s*[^*/\s]/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) throw new NotationError(`${module.file} uses ** outside the known expressions.`);
  return text;
}
const PRESETS = ['pickupCoin', 'laserShoot', 'explosion', 'powerUp', 'hitHurt', 'jump', 'blipSelect', 'synth', 'tone', 'click', 'random'];
// General MIDI program families → built-in instruments (abcjs reports %%MIDI program numbers).
const GM = program => program < 8 ? 'piano' : program < 16 ? 'bell' : program < 24 ? 'organ' : program < 32 ? 'pluck' : program < 40 ? 'pluck' : program < 56 ? 'pad' : program < 80 ? 'organ' : program < 88 ? 'square' : 'pad';
const mix = (a, b) => { let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };

class Notation {
  /** read(path) → text of a vendored file; importSource(source) → module namespace. */
  constructor({ read, importSource }) { Object.assign(this, { read, importSource }); this.cache = new Map(); }
  async load() {
    if (this.libs) return this.libs;
    this.math = globalThis.__audioOnlineMath = mathShim();
    const entries = await Promise.all(Object.entries(MODULES).map(async ([name, m]) => [name, await this.importSource(m.wrap(patch(m, await this.read(m.file))))]));
    const mods = Object.fromEntries(entries);
    this.libs = { ABCJS: mods.abcjs.default, ZZFX: mods.zzfx.ZZFX, jsfxr: mods.jsfxr.default };
    return this.libs;
  }
  requireLibs(kind) { if (!this.libs) throw new NotationError(`The ${kind} engine is not loaded.`); return this.libs; }
  key(node) { return JSON.stringify(node, (k, v) => k === 'line' ? undefined : v); }
  cached(node, make) { const key = this.key(node); if (!this.cache.has(key)) this.cache.set(key, make()); return this.cache.get(key); }

  /** Renderer provider: sampled clips (zzfx, sfxr) as { rate, frames, channels }. */
  buffer(node) {
    return this.cached(node, () => {
      const seed = Number.isInteger(node.seed) ? node.seed : 0;
      if (node.op === 'zzfx') {
        const { ZZFX } = this.requireLibs('ZzFX');
        const params = node.params;
        if (!Array.isArray(params) || params.length > 21 || !params.every(v => v === null || Number.isFinite(v))) throw new NotationError('ZzFX takes an array of up to 21 numbers (blanks allowed).', node.line);
        this.math.seed(seed);
        const samples = Float32Array.from(ZZFX.buildSamples(...params.map(v => v === null ? undefined : v)));
        if (samples.length > 44100 * 60) throw new NotationError('ZzFX sounds are limited to 60 seconds.', node.line);
        return { rate: 44100, frames: samples.length, channels: [samples] };
      }
      if (node.op === 'sfxr') {
        const { jsfxr } = this.requireLibs('sfxr');
        const params = new jsfxr.Params();
        this.math.seed(seed);
        if (typeof node.preset === 'string') {
          if (!PRESETS.includes(node.preset)) throw new NotationError(`Unknown sfxr preset "${node.preset.slice(0, 40)}". Use one of: ${PRESETS.join(', ')}.`, node.line);
          params[node.preset]();
        } else if (typeof node.b58 === 'string') {
          if (!/^[1-9A-HJ-NP-Za-km-z]{8,200}$/.test(node.b58)) throw new NotationError('That is not an sfxr sound code.', node.line);
          params.fromB58(node.b58);
        } else if (node.params && typeof node.params === 'object') params.fromJSON(node.params);
        else throw new NotationError('sfxr needs a preset name, a sound code or a parameter object.', node.line);
        const rate = [44100, 22050, 11025].includes(Number(params.sample_rate)) ? Number(params.sample_rate) : 44100;
        params.sample_rate = rate;
        this.math.seed(mix(seed, 1));
        const raw = new jsfxr.SoundEffect(params).getRawBuffer().normalized;
        if (!raw.length || raw.length > rate * 60) throw new NotationError('sfxr produced no usable sound.', node.line);
        // jsfxr 1.4.1 emits NaN for its first sample (with the platform Math too); treat non-finite samples as silence.
        return { rate, frames: raw.length, channels: [Float32Array.from(raw, v => Number.isFinite(v) ? v : 0)] };
      }
      throw new NotationError(`Unknown sampled clip: ${node.op}.`, node.line);
    });
  }
  /** Renderer provider: notation clips (abc, pattern) as an "events" node of notes and drums. */
  expand(node) {
    return this.cached(node, () => node.op === 'abc' ? this.abc(node) : this.pattern(node));
  }
  abc(node) {
    const { ABCJS } = this.requireLibs('ABC');
    if (typeof node.text !== 'string' || !node.text.trim()) throw new NotationError('ABC needs tune text.', node.line);
    const tune = ABCJS.parseOnly(node.text)[0];
    if (!tune) throw new NotationError('No tune found. ABC tunes start with an X: line and need a K: line.', node.line);
    const audio = tune.setUpAudio({});
    const spw = 240 / (audio.tempo || 120), base = Number.isInteger(node.seed) ? node.seed : 0;
    const chosen = node.instrument;
    if (chosen && !Instruments.names.includes(chosen)) throw new NotationError(`Unknown instrument "${String(chosen).slice(0, 30)}". Use one of: ${Instruments.names.join(', ')}.`, node.line);
    const events = []; let end = 0, index = 0;
    for (const track of audio.tracks) for (const e of track) {
      if (e.cmd !== 'note' || !(e.duration > 0)) continue;
      const instrument = chosen || GM(e.instrument || 0), at = e.start * spw, held = e.duration * spw;
      events.push({ at, node: { op: 'note', instrument, freq: Instruments.frequency(e.pitch), seconds: held, velocity: Math.min(1, (e.volume ?? 100) / 127), seed: mix(base, index++) } });
      end = Math.max(end, at + held + Instruments.tail(instrument));
    }
    if (!events.length) throw new NotationError('The tune has no notes.', node.line);
    if (events.length > 20000) throw new NotationError('Tunes are limited to 20,000 notes.', node.line);
    return { op: 'events', seconds: end, events, line: node.line };
  }
  pattern(node) {
    const bpm = node.bpm ?? 120, cycles = node.cycles ?? 1, instrument = node.instrument || 'pluck';
    if (!(bpm >= 20 && bpm <= 400)) throw new NotationError('bpm must be 20–400.', node.line);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 256) throw new NotationError('cycles must be a whole number from 1 to 256.', node.line);
    if (!Instruments.names.includes(instrument)) throw new NotationError(`Unknown instrument "${String(instrument).slice(0, 30)}".`, node.line);
    let list;
    try { list = MiniNotation.events(String(node.text), cycles); }
    catch (error) { throw new NotationError(`Pattern: ${error.message}`, node.line); }
    const cycle = 240 / bpm, base = Number.isInteger(node.seed) ? node.seed : 0;
    const events = list.map((e, i) => {
      const at = e.start * cycle, name = e.name.toLowerCase();
      if (Instruments.drums.includes(name)) return { at, node: { op: 'drum', name, velocity: 0.9, seed: mix(base, i) } };
      const freq = Instruments.frequency(e.name);
      if (!freq) throw new NotationError(`Pattern: "${e.name}" is not a drum (${Instruments.drums.join(' ')}) or a note like c4 (column ${e.column})`, node.line);
      return { at, node: { op: 'note', instrument, freq, seconds: e.dur * cycle, velocity: 0.8, seed: mix(base, i) } };
    });
    return { op: 'events', seconds: cycles * cycle, events, line: node.line };
  }
  /** Seconds a clip lasts at any rate; the Python bridge uses this so self.time matches the render. */
  measure(node) {
    if (node.op === 'zzfx' || node.op === 'sfxr') { const b = this.buffer(node); return b.frames / b.rate; }
    if (node.op === 'abc' || node.op === 'pattern') return this.expand(node).seconds;
    if (node.op === 'note') return node.seconds + Instruments.tail(node.instrument);
    if (node.op === 'drum') return Instruments.DRUMS[node.name]?.seconds ?? 0;
    throw new NotationError(`Cannot measure ${node.op}.`, node.line);
  }

  /** A whole notation document as a timeline; each sound or pattern line becomes a placement. */
  timeline(kind, src, settings) {
    const base = { format: 'audio-timeline', version: 1, sampleRate: settings.sampleRate, channels: settings.channels, seed: 0, length: null, tracks: {}, master: { gain: 0 } };
    const lines = src.split('\n');
    if (kind === 'abc') {
      const title = /^T:\s*(.+)$/m.exec(src)?.[1].trim() || 'ABC tune';
      return { ...base, placements: [{ clip: { op: 'abc', text: src, line: 1 }, at: 0, track: 'music', gain: 0, pan: 0, line: 1, label: title.slice(0, 80) }] };
    }
    if (kind === 'pattern') {
      let bpm = 120, cycles = 1; const placements = [];
      lines.forEach((raw, index) => {
        const line = raw.replace(/(?:\/\/|#).*$/, '').trim(), number = index + 1;
        if (!line) return;
        const setting = /^(bpm|cycles)\s*[:=]?\s*(\d+(?:\.\d+)?)$/i.exec(line);
        if (setting) { if (setting[1].toLowerCase() === 'bpm') bpm = Number(setting[2]); else cycles = Number(setting[2]); return; }
        const m = /^(?:([A-Za-z][\w-]{0,31})(?:\(([a-z]+)\))?\s*:)?\s*(.+)$/.exec(line);
        placements.push({ clip: { op: 'pattern', text: m[3], instrument: m[2] || null, line: number }, at: 0, track: m[1] || `pattern ${placements.length + 1}`, gain: 0, pan: 0, line: number, label: m[3].slice(0, 80) });
      });
      for (const p of placements) Object.assign(p.clip, { bpm, cycles });
      if (!placements.length) throw new NotationError('Write a pattern such as: drums: bd [~ bd] sn ~');
      return { ...base, placements };
    }
    const sounds = kind === 'zzfx' ? this.zzfxSounds(lines) : this.sfxrSounds(src, lines);
    if (!sounds.length) throw new NotationError(kind === 'zzfx' ? 'Write ZzFX sounds as arrays, e.g. zzfx(...[,,925,.04,.3,.6,1,.3])' : 'Write sfxr presets (one per line, e.g. pickupCoin 3), sound codes, or a parameter JSON object.');
    let at = 0; const placements = [];
    for (const s of sounds) {
      const seconds = this.measure(s.clip);
      placements.push({ clip: s.clip, at, track: kind, gain: 0, pan: 0, line: s.line, label: s.label });
      at += seconds + 0.3;
    }
    return { ...base, placements };
  }
  zzfxSounds(lines) {
    const sounds = [];
    lines.forEach((raw, index) => {
      const line = raw.replace(/\/\/.*$/, ''), m = /^\s*(?:(?:const|let|var)\s+)?(?:([A-Za-z_]\w*)\s*[:=]\s*)?(?:zzfx\s*\(\s*\.\.\.\s*)?\[([^\]]*)\]\s*\)?\s*[,;]?\s*$/.exec(line);
      if (!m) { if (line.trim()) throw new NotationError('Each line holds one ZzFX array, optionally named: coin = [1,.05,1675,,.06,.24]', index + 1); return; }
      const params = m[2].split(',').map(v => v.trim() === '' ? null : Number(v.trim()));
      if (params.length && params[params.length - 1] === null && /,\s*$/.test(m[2])) params.pop();
      if (params.some(v => v !== null && !Number.isFinite(v))) throw new NotationError('ZzFX values must be numbers.', index + 1);
      sounds.push({ clip: { op: 'zzfx', params, seed: index + 1, line: index + 1 }, line: index + 1, label: m[1] || `sound ${sounds.length + 1}` });
    });
    return sounds;
  }
  sfxrSounds(src, lines) {
    const trimmed = src.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let value;
      try { value = JSON.parse(trimmed); } catch (error) { throw new NotationError(`sfxr JSON: ${error.message}`, 1); }
      return (Array.isArray(value) ? value : [value]).map((params, i) => ({ clip: { op: 'sfxr', params, seed: i + 1, line: 1 }, line: 1, label: `sound ${i + 1}` }));
    }
    const sounds = [];
    lines.forEach((raw, index) => {
      const line = raw.replace(/(?:\/\/|#).*$/, '').trim();
      if (!line) return;
      const m = /^(?:([A-Za-z_][\w-]*)\s*[:=]\s*)?(\S+)(?:\s+(\d+))?$/.exec(line);
      if (!m) throw new NotationError('Each line holds an sfxr preset (optionally with a seed) or a sound code.', index + 1);
      const seed = m[3] ? Number(m[3]) : index + 1;
      const clip = PRESETS.includes(m[2]) ? { op: 'sfxr', preset: m[2], seed, line: index + 1 } : { op: 'sfxr', b58: m[2], seed, line: index + 1 };
      sounds.push({ clip, line: index + 1, label: m[1] || m[2].slice(0, 24) });
    });
    return sounds;
  }
}
const AudioNotation = { Notation, NotationError, mathShim, PRESETS, KINDS: ['abc', 'zzfx', 'sfxr', 'pattern'] };
if (isNode) module.exports = AudioNotation;
else globalThis.AudioNotation = AudioNotation;
})();

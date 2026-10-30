/* Spike: runs as the classic worker inside the HashBin SDK v0.4.0 opaque sandbox. */
const A = new URL('assets/', hashbinSandbox.base).href;
const out = { context: 'sdk-opaque-worker' };
const hash = typed => {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0; h2 = Math.imul(h2 ^ bytes[i], 0x5bd1e995) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
};
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const step = async (name, fn) => { const t = performance.now(); try { out[name] = await fn(); } catch (e) { out[name] = { error: String(e && e.message || e) }; } (out.ms ||= {})[name] = Math.round(performance.now() - t); };

async function run() {
  await step('caps', async () => {
    const r = {};
    for (const k of ['OfflineAudioContext', 'AudioContext', 'webkitOfflineAudioContext', 'AudioWorkletNode', 'AudioBuffer', 'AudioEncoder', 'AudioDecoder', 'AudioData', 'OffscreenCanvas', 'WebAssembly', 'SharedArrayBuffer', 'CompressionStream'])
      r[k] = typeof self[k];
    r.crossOriginIsolated = self.crossOriginIsolated; r.isSecureContext = self.isSecureContext; r.origin = self.origin;
    r.subtle = typeof crypto?.subtle?.digest;
    try { indexedDB.open('x'); r.indexedDB = 'opened'; } catch (e) { r.indexedDB = 'blocked: ' + e.name; }
    try { await caches.keys(); r.caches = 'usable'; } catch (e) { r.caches = 'blocked: ' + (e.name || e); }
    r.ua = navigator.userAgent;
    return r;
  });

  await step('encoders', async () => {
    if (typeof AudioEncoder === 'undefined') return 'AudioEncoder missing';
    const configs = { opus: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
      aac: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
      flac: { codec: 'flac', sampleRate: 48000, numberOfChannels: 2 }, mp3: { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
      vorbis: { codec: 'vorbis', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }, pcm: { codec: 'pcm-s16', sampleRate: 48000, numberOfChannels: 2 } };
    const r = {};
    for (const [k, c] of Object.entries(configs)) { try { r[k] = (await AudioEncoder.isConfigSupported(c)).supported; } catch (e) { r[k] = 'throws ' + e.name; } }
    const encode = async codec => {
      const chunks = [];
      const enc = new AudioEncoder({ output: c => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: e => { throw e; } });
      enc.configure({ ...configs[codec] });
      const n = 48000, data = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) data[i] = data[n + i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / 48000);
      enc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: 0, data }));
      await enc.flush(); enc.close();
      const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
      return { bytes: all.length, hash: hash(all) };
    };
    for (const k of ['opus', 'aac']) if (r[k] === true) { const a = await encode(k), b = await encode(k); r[k + 'Run'] = { ...a, repeatSame: a.hash === b.hash }; }
    return r;
  });

  await step('math', () => {
    const N = 20000, x = new Float64Array(N); for (let i = 0; i < N; i++) x[i] = (i - N / 2) * 0.01370001;
    const fns = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: v => Math.exp(v / 100), log: v => Math.log(Math.abs(v) + 1e-3), pow: v => Math.pow(Math.abs(v) + 0.5, 1.37),
      tanh: Math.tanh, atan2: v => Math.atan2(v, 1.3), sqrt: v => Math.sqrt(Math.abs(v)), cbrt: Math.cbrt, sinh: v => Math.sinh(v / 50), expm1: v => Math.expm1(v / 100), log1p: v => Math.log1p(Math.abs(v)), log10: v => Math.log10(Math.abs(v) + 1e-3), hypot: v => Math.hypot(v, 3.1), fround: Math.fround };
    const r = {};
    for (const [k, f] of Object.entries(fns)) { const y = new Float64Array(N); for (let i = 0; i < N; i++) y[i] = f(x[i]); r[k] = hash(y); }
    return r;
  });

  // DSP using only IEEE-exact operations (+ - * / sqrt floor), with our own transcendental approximations.
  await step('pureDsp', () => {
    const TAU = 6.283185307179586;
    const sin = v => { v -= TAU * Math.floor(v / TAU + 0.5); const v2 = v * v; return v * (1 + v2 * (-1 / 6 + v2 * (1 / 120 + v2 * (-1 / 5040 + v2 * (1 / 362880 + v2 * (-1 / 39916800 + v2 * (1 / 6227020800 + v2 * (-1 / 1307674368000)))))))); };
    const cos = v => sin(v + TAU / 4);
    const exp2 = v => { const i = Math.floor(v), f = v - i; let p = 1, t = 1; const l = 0.6931471805599453; for (let k = 1; k < 14; k++) { t *= f * l / k; p += t; } let s = 1; if (i > 0) for (let k = 0; k < i; k++) s *= 2; else for (let k = 0; k < -i; k++) s /= 2; return p * s; };
    const sr = 48000, n = sr * 2, y = new Float32Array(n), rand = rng(7);
    // oscillator + noise
    for (let i = 0; i < n; i++) y[i] = 0.3 * sin(TAU * 220 * i / sr) + 0.2 * sin(TAU * 331.5 * i / sr) + 0.1 * (rand() * 2 - 1);
    // biquad lowpass (RBJ) with own sin/cos
    const w = TAU * 1200 / sr, al = sin(w) / (2 * 0.707), cw = cos(w), a0 = 1 + al;
    const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { const x0 = y[i], v = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x0; y2 = y1; y1 = v; y[i] = v; }
    // feedback delay
    const d = Math.round(0.25 * sr); for (let i = d; i < n; i++) y[i] += 0.4 * y[i - d];
    // Freeverb-style combs + allpasses
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(len => ({ buf: new Float64Array(len), i: 0, store: 0 }));
    const aps = [556, 441, 341, 225].map(len => ({ buf: new Float64Array(len), i: 0 }));
    const wet = new Float32Array(n);
    for (let i = 0; i < n; i++) { const inp = y[i] * 0.015; let s = 0;
      for (const c of combs) { const o = c.buf[c.i]; c.store = o * 0.8 + c.store * 0.2; c.buf[c.i] = inp + c.store * 0.84; c.i = (c.i + 1) % c.buf.length; s += o; }
      for (const a of aps) { const b = a.buf[a.i]; a.buf[a.i] = s + b * 0.5; s = b - s; a.i = (a.i + 1) % a.buf.length; }
      wet[i] = y[i] * 0.7 + s * 0.3; }
    // compressor with own exp2 for gain computation (log2 via iterative sqrt-free bit trick avoided: use ratio in linear domain)
    let env = 0; const att = exp2(-1 / (0.005 * sr) * 1.4426950408889634), rel = exp2(-1 / (0.1 * sr) * 1.4426950408889634);
    for (let i = 0; i < n; i++) { const a = Math.abs(wet[i]); env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a; const over = env / 0.25; wet[i] *= over > 1 ? 1 / Math.sqrt(Math.sqrt(over)) : 1; }
    let peak = 0, sumsq = 0; for (const v of wet) { peak = Math.max(peak, Math.abs(v)); sumsq += v * v; }
    return { hash: hash(wet), peak: +peak.toFixed(6), rms: +Math.sqrt(sumsq / n).toFixed(6) };
  });

  // Same graph using Math.sin/Math.exp (engine libm).
  await step('libmDsp', () => {
    const sr = 48000, n = sr * 2, y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sr) * Math.exp(-i / sr) + 0.2 * Math.tanh(3 * Math.sin(2 * Math.PI * 331.5 * i / sr));
    return { hash: hash(y) };
  });

  await step('abcjs', async () => {
    await hashbinSandbox.importScripts(A + 'abcjs-basic-min.js');
    const tune = 'X:1\nT:Spike\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\nGABc dedB|dedB dedB|c2ec B2dB|c2A2 A4|]';
    const t = ABCJS.parseOnly(tune)[0];
    const r = { lines: t.lines.length, warnings: (t.warnings || []).length };
    try {
      const seq = new ABCJS.synth.SynthSequence();
      r.synthSequence = typeof seq;
    } catch (e) { r.synthSequence = 'error: ' + e.message; }
    try { const audio = t.setUpAudio({}); r.tracks = audio.tracks.length; r.events = audio.tracks.reduce((s, tr) => s + tr.length, 0); r.eventsHash = hash(new TextEncoder().encode(JSON.stringify(audio.tracks))); } catch (e) { r.setUpAudio = 'error: ' + e.message; }
    return r;
  });

  await step('zzfx', async () => {
    const hadAC = 'AudioContext' in self; if (!hadAC) self.AudioContext = class { constructor() { this.sampleRate = 44100; } };
    const { ZZFX } = await hashbinSandbox.import(A + 'ZzFX.js'); if (!hadAC) delete self.AudioContext;
    const saved = Math.random; Math.random = rng(1);
    try {
      const sounds = { coin: [1, .05, 1675, , .06, .24, 1, 1.82, , , 837, .06], boom: [2, .1, 75, .02, .2, .6, 4, 2.5, , , , , , 1.6, , .5, .1, .47, .14], laser: [, , 925, .04, .3, .6, 1, .3, , 6.27, -184, .09, .17] };
      const r = {};
      for (const [k, p] of Object.entries(sounds)) { const s = Float32Array.from(ZZFX.buildSamples(...p)); r[k] = { n: s.length, hash: hash(s) }; }
      return r;
    } finally { Math.random = saved; }
  });

  await step('jsfxr', async () => {
    await hashbinSandbox.importScripts(A + 'sfxr.js');
    const saved = Math.random; Math.random = rng(2);
    try {
      const params = new jsfxr.Params(); params.pickupCoin();
      const raw = new jsfxr.SoundEffect(params).getRawBuffer();
      const s = Float32Array.from(raw.normalized || raw.buffer);
      return { n: s.length, hash: hash(s), sampleRate: params.sample_rate };
    } finally { Math.random = saved; }
  });

  await step('pico', async () => {
    const { default: SvoxPico } = await hashbinSandbox.import(A + 'pico/svoxpico.js');
    const wasmBinary = await (await fetch(A + 'pico/svoxpico.wasm')).arrayBuffer();
    const m = await SvoxPico({ wasmBinary, locateFile: f => A + 'pico/' + f, print: () => {}, printErr: () => {} });
    for (const f of ['en-US_ta.bin', 'en-US_lh0_sg.bin']) m.FS.writeFile('/' + f, new Uint8Array(await (await fetch(A + 'pico/' + f)).arrayBuffer()));
    const t0 = performance.now();
    const str = s => { const b = new TextEncoder().encode(s + '\0'); const p = m._malloc(b.length); m.HEAPU8.set(b, p); return p; };
    const ptr = () => m._malloc(4);
    const ok = (code, what) => { if (code !== 0 && code !== 200 && code !== 201) throw new Error(what + ' failed ' + code); return code; };
    const mem = m._malloc(2500000), sysP = ptr();
    ok(m._pico_initialize(mem, 2500000, sysP), 'init'); const sys = m.HEAPU32[sysP >> 2];
    const names = [];
    for (const f of ['en-US_ta.bin', 'en-US_lh0_sg.bin']) { const rp = ptr(); ok(m._pico_loadResource(sys, str('/' + f), rp), 'load ' + f); const np = m._malloc(32); ok(m._pico_getResourceName(sys, m.HEAPU32[rp >> 2], np), 'name'); names.push(np); }
    const voice = str('PicoVoice'); ok(m._pico_createVoiceDefinition(sys, voice), 'voice');
    for (const np of names) ok(m._pico_addResourceToVoiceDefinition(sys, voice, np), 'add');
    const eP = ptr(); ok(m._pico_newEngine(sys, voice, eP), 'engine'); const eng = m.HEAPU32[eP >> 2];
    const text = new TextEncoder().encode('Welcome to Audio Online. This voice is bundled, and it works offline.\0');
    const tp = m._malloc(text.length); m.HEAPU8.set(text, tp);
    const written = ptr(), buf = m._malloc(4096), cnt = ptr(), typ = ptr(); const parts = [];
    for (let off = 0; off < text.length;) {
      m.HEAP32[written >> 2] = 0; ok(m._pico_putTextUtf8(eng, tp + off, text.length - off, written), 'put'); off += m.HEAP32[written >> 2];
      let status;
      do { status = ok(m._pico_getData(eng, buf, 4096, cnt, typ), 'getData'); const c = m.HEAP16[cnt >> 1]; if (c > 0) parts.push(m.HEAPU8.slice(buf, buf + c)); } while (status === 201);
    }
    const total = parts.reduce((s, p) => s + p.length, 0), pcm = new Uint8Array(total); let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
    const samples = new Int16Array(pcm.buffer, 0, total >> 1);
    let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v));
    return { samples: samples.length, seconds: +(samples.length / 16000).toFixed(3), peak, hash: hash(samples), synthMs: Math.round(performance.now() - t0) };
  });

  await step('pyodide', async () => {
    const P = A + 'pyodide/';
    const t0 = performance.now();
    const [{ loadPyodide }, asm] = await Promise.all(['pyodide.mjs', 'pyodide.asm.mjs'].map(f => hashbinSandbox.import(P + f)));
    const py = await loadPyodide({ indexURL: P, createPyodideModule: asm.default, stdout: () => {}, stderr: () => {} });
    const bootMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    await py.loadPackage(P + 'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl');
    const numpyMs = Math.round(performance.now() - t1);
    const t2 = performance.now();
    const res = py.runPython(`
import numpy as np
sr = 48000
t = np.arange(sr * 2) / sr
y = 0.3*np.sin(2*np.pi*220*t)*np.exp(-t) + 0.2*np.tanh(3*np.sin(2*np.pi*331.5*t))
rng = np.random.default_rng(1)
y = y + 0.05*rng.standard_normal(y.size)
spec = np.abs(np.fft.rfft(y[:4096]))
k = np.arange(-1000, 1000) * 0.01370001
fns = np.concatenate([np.sin(k), np.cos(k), np.exp(k/100), np.log(np.abs(k)+1e-3), np.tanh(k), np.power(np.abs(k)+0.5, 1.37)])
(y.astype(np.float32).tobytes(), spec.tobytes(), fns.tobytes())
`).toJs();
    const [y, spec, fns] = res.map(b => new Uint8Array(b));
    return { bootMs, numpyMs, runMs: Math.round(performance.now() - t2), synthHash: hash(y), fftHash: hash(spec), libmHash: hash(fns) };
  });
}
run().then(() => postMessage({ type: 'done', out }), e => postMessage({ type: 'done', out: { ...out, fatal: String(e) } }));

/* Web Audio determinism suite. Runs on the editor origin and inside a raw opaque-origin iframe window. */
async function runWebAudioSuite() {
  const hash = typed => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0; h2 = Math.imul(h2 ^ bytes[i], 0x5bd1e995) >>> 0; }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  };
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { caps: { OfflineAudioContext: typeof OfflineAudioContext, AudioWorkletNode: typeof AudioWorkletNode, origin: self.origin, isSecureContext: self.isSecureContext } };
  if (typeof OfflineAudioContext === 'undefined') return r;
  const SR = 48000, LEN = SR;
  const noise = (ctx, rate = SR, seed = 3) => { const b = ctx.createBuffer(1, rate, rate), d = b.getChannelData(0), g = rng(seed); for (let i = 0; i < d.length; i++) d[i] = g() * 2 - 1; return b; };
  const stats = buf => { let peak = 0, s = 0; const d = buf.getChannelData(0); for (const v of d) { peak = Math.max(peak, Math.abs(v)); s += v * v; } return { peak: +peak.toFixed(5), rms: +Math.sqrt(s / d.length).toFixed(5) }; };
  const cases = {
    sine: ctx => { const o = ctx.createOscillator(); o.frequency.value = 440; o.connect(ctx.destination); o.start(); },
    sawtooth: ctx => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 220; o.connect(ctx.destination); o.start(); },
    bufferCopy: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.connect(ctx.destination); s.start(); },
    gainRamp: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); const g = ctx.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.3); g.gain.setTargetAtTime(0.2, 0.5, 0.1); s.connect(g).connect(ctx.destination); s.start(); },
    biquad: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200; f.Q.value = 0.7; s.connect(f).connect(ctx.destination); s.start(); },
    delayFeedback: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); const d = ctx.createDelay(1); d.delayTime.value = 0.1; const g = ctx.createGain(); g.gain.value = 0.5; s.connect(ctx.destination); s.connect(d); d.connect(g).connect(d); d.connect(ctx.destination); s.start(0); s.stop(0.05); },
    convolver: ctx => { const ir = ctx.createBuffer(2, SR / 2, SR), g = rng(9); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (g() * 2 - 1) * Math.pow(1 - i / d.length, 3); } const cv = ctx.createConvolver(); cv.normalize = false; cv.buffer = ir; const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.connect(cv).connect(ctx.destination); s.start(0); s.stop(0.02); },
    compressor: ctx => { const o = ctx.createOscillator(); o.frequency.value = 110; const g = ctx.createGain(); g.gain.value = 2; const c = ctx.createDynamicsCompressor(); c.threshold.value = -24; c.ratio.value = 4; o.connect(g).connect(c).connect(ctx.destination); o.start(); },
    resample16k: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx, 16000); s.connect(ctx.destination); s.start(); },
    playbackRate: ctx => { const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.playbackRate.value = 1.5; s.connect(ctx.destination); s.start(); },
    panner: ctx => { const o = ctx.createOscillator(); const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-1, 0); p.pan.linearRampToValueAtTime(1, 1); o.connect(p).connect(ctx.destination); o.start(); }
  };
  r.cases = {};
  for (const [name, build] of Object.entries(cases)) {
    try {
      const render = async () => { const ctx = new OfflineAudioContext(2, LEN, SR); build(ctx); const b = await ctx.startRendering(); return { h: hash(b.getChannelData(0)) + hash(b.getChannelData(1)), s: stats(b) }; };
      const t = performance.now(); const a = await render(); const ms = Math.round(performance.now() - t); const b = await render();
      r.cases[name] = { hash: a.h, repeatSame: a.h === b.h, ...a.s, ms };
    } catch (e) { r.cases[name] = { error: String(e.message || e) }; }
  }
  // Faster-than-real-time: 60 s stereo mix of 8 voices with filters.
  try {
    const t = performance.now(); const ctx = new OfflineAudioContext(2, SR * 60, SR);
    for (let v = 0; v < 8; v++) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110 * (v + 1); const f = ctx.createBiquadFilter(); f.frequency.value = 800 + v * 200; const p = ctx.createStereoPanner(); p.pan.value = v / 4 - 1; o.connect(f).connect(p).connect(ctx.destination); o.start(); }
    await ctx.startRendering(); r.speed60s = { ms: Math.round(performance.now() - t), realtimeX: +(60000 / (performance.now() - t)).toFixed(1) };
  } catch (e) { r.speed60s = { error: String(e.message || e) }; }
  // AudioWorklet from a blob: URL and from a data: URL.
  const worklet = `registerProcessor('half', class extends AudioWorkletProcessor { process(i, o) { const a = i[0], b = o[0]; for (let c = 0; c < b.length; c++) if (a[c]) for (let k = 0; k < b[c].length; k++) b[c][k] = a[c][k] * 0.5; return true; } });`;
  for (const kind of ['blob', 'data']) {
    try {
      const ctx = new OfflineAudioContext(1, SR / 10, SR);
      const url = kind === 'blob' ? URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' })) : 'data:text/javascript,' + encodeURIComponent(worklet);
      await ctx.audioWorklet.addModule(url);
      const n = new AudioWorkletNode(ctx, 'half'); const o = ctx.createOscillator(); o.connect(n).connect(ctx.destination); o.start();
      const b = await ctx.startRendering(); r['worklet_' + kind] = { ok: true, ...stats(b) };
    } catch (e) { r['worklet_' + kind] = { error: String(e.message || e) }; }
  }
  r.encoders = await (async () => {
    if (typeof AudioEncoder === 'undefined') return 'AudioEncoder missing';
    const configs = { opus: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }, aac: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
      aac44: { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128000 }, flac: { codec: 'flac', sampleRate: 48000, numberOfChannels: 2 }, mp3: { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
      vorbis: { codec: 'vorbis', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }, pcm: { codec: 'pcm-s16', sampleRate: 48000, numberOfChannels: 2 } };
    const o = {};
    for (const [k, c] of Object.entries(configs)) { try { o[k] = (await AudioEncoder.isConfigSupported(c)).supported; } catch (e) { o[k] = 'throws ' + e.name; } }
    for (const k of ['opus', 'aac']) if (o[k] === true) {
      const enc1 = async () => { const chunks = []; let err; const enc = new AudioEncoder({ output: c => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: e => { err = e; } });
        enc.configure(configs[k]); const n = 48000, data = new Float32Array(n * 2); for (let i = 0; i < n; i++) data[i] = data[n + i] = 0.4 * Math.sin(2 * Math.PI * 440 * i / 48000);
        enc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: 0, data })); await enc.flush(); enc.close(); if (err) throw err;
        const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let p = 0; for (const c of chunks) { all.set(c, p); p += c.length; } return { chunks: chunks.length, bytes: all.length, h: hash(all) }; };
      try { const a = await enc1(), b = await enc1(); o[k + 'Run'] = { chunks: a.chunks, bytes: a.bytes, hash: a.h, repeatSame: a.h === b.h }; } catch (e) { o[k + 'Run'] = 'error ' + e.message; }
    }
    return o;
  })();
  return r;
}
if (typeof module !== 'undefined') module.exports = runWebAudioSuite;

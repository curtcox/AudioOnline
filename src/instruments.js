/* Original note instruments and drum kit for notation clips. Same determinism rules as the renderer:
   basic float operations and DMath only, seeded noise, lengths in samples. */
(() => {
const DMath = typeof module !== 'undefined' ? require('./dmath.js') : globalThis.DMath;
const TAU = 2 * DMath.PI;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
/** RBJ biquad in place. */
function biquad(x, rate, type, freq, q = 0.7071067811865476) {
  const w = TAU * Math.min(freq, rate * 0.45) / rate, cw = DMath.cos(w), alpha = DMath.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const x0 = x[i], y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0; }
  return x;
}
/** exp(−t/τ) for each sample, computed by recurrence (one DMath.exp per note). */
function decay(n, rate, tau) { const out = new Float64Array(n), k = DMath.exp(-1 / (tau * rate)); let v = 1; for (let i = 0; i < n; i++) { out[i] = v; v *= k; } return out; }
/** Linear attack/decay/sustain plus a release after `held` samples. */
function adsr(n, rate, held, a, d, s, r) {
  const out = new Float64Array(n), A = Math.round(a * rate), D = Math.round(d * rate), R = Math.max(1, Math.round(r * rate));
  const level = t => t < A ? t / A : t < A + D ? 1 - (1 - s) * (t - A) / D : s;
  const atRelease = level(held);
  for (let t = 0; t < n; t++) out[t] = t < held ? level(t) : Math.max(0, atRelease * (1 - (t - held) / R));
  return out;
}

const INSTRUMENTS = {
  sine: { tail: 0.15, render(f, held, n, rate) { const env = adsr(n, rate, held, 0.005, 0.1, 0.8, 0.15), out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = DMath.sinTurns(f * i / rate) * env[i]; return out; } },
  square: { tail: 0.08, render(f, held, n, rate) {
    const env = adsr(n, rate, held, 0.004, 0.05, 0.6, 0.08), out = new Float64Array(n), dt = f / rate; let p = 0;
    for (let i = 0; i < n; i++) { const t2 = p + 0.5 - Math.floor(p + 0.5); out[i] = 0.6 * ((p < 0.5 ? 1 : -1) + blep(p, dt) - blep(t2, dt)) * env[i]; p += dt; p -= Math.floor(p); }
    return out;
  } },
  piano: { tail: 0.35, render(f, held, n, rate) {
    const out = new Float64Array(n), release = adsr(n, rate, held, 0.002, 0, 1, 0.35);
    for (let h = 1; h <= 6; h++) {
      if (f * h >= rate / 2) break;
      const env = decay(n, rate, 1.6 / (1 + 0.7 * h) * Math.min(1, 220 / f + 0.4)), amp = 0.5 / (h * Math.sqrt(h)); // 1/h^1.5; Math.sqrt is exact in every engine
      for (let i = 0; i < n; i++) out[i] += amp * DMath.sinTurns(f * h * i / rate) * env[i];
    }
    for (let i = 0; i < n; i++) out[i] *= release[i];
    return out;
  } },
  organ: { tail: 0.06, render(f, held, n, rate) {
    const env = adsr(n, rate, held, 0.01, 0, 1, 0.06), out = new Float64Array(n);
    for (const [h, a] of [[0.5, 0.3], [1, 0.5], [2, 0.35], [3, 0.2], [4, 0.15], [8, 0.08]]) if (f * h < rate / 2) for (let i = 0; i < n; i++) out[i] += a * DMath.sinTurns(f * h * i / rate);
    for (let i = 0; i < n; i++) out[i] *= env[i] * 0.6;
    return out;
  } },
  pad: { tail: 0.6, render(f, held, n, rate) {
    const out = new Float64Array(n);
    for (const detune of [0.994, 1, 1.006]) { const dt = f * detune / rate; let p = detune - 0.99; for (let i = 0; i < n; i++) { out[i] += (2 * p - 1 - blep(p, dt)) / 3; p += dt; p -= Math.floor(p); } }
    biquad(out, rate, 'lowpass', Math.min(1600, f * 6), 0.8);
    const env = adsr(n, rate, held, 0.25, 0.2, 0.8, 0.6);
    for (let i = 0; i < n; i++) out[i] *= env[i] * 0.7;
    return out;
  } },
  bell: { tail: 1.2, render(f, held, n, rate) {
    // Two-operator FM: inharmonic ratio 1.4, index decaying faster than the amplitude.
    const out = new Float64Array(n), amp = decay(n, rate, 0.9), index = decay(n, rate, 0.35), release = adsr(n, rate, held, 0.001, 0, 1, 1.2);
    for (let i = 0; i < n; i++) { const t = i / rate; out[i] = 0.5 * DMath.sinTurns(f * t + 0.5 * index[i] * DMath.sinTurns(1.4 * f * t)) * amp[i] * release[i]; }
    return out;
  } },
  pluck: { tail: 0.4, render(f, held, n, rate, seed) {
    // Karplus–Strong with a fractional delay (linear interpolation) and a two-point average.
    const random = rng(seed), period = rate / f, size = Math.ceil(period) + 2, line = new Float64Array(size);
    for (let i = 0; i < size; i++) line[i] = random() * 2 - 1;
    const out = new Float64Array(n), release = adsr(n, rate, held, 0, 0, 1, 0.4);
    let write = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const read = write - period, k = Math.floor(read), frac = read - k;
      const a = line[((k % size) + size) % size], b = line[(((k + 1) % size) + size) % size];
      const v = a + (b - a) * frac, y = 0.5 * (v + last) * 0.996;
      last = v; line[write % size] = y; write++;
      out[i] = y * 0.9 * release[i];
    }
    return out;
  } }
};

function noise(n, random) { const out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = random() * 2 - 1; return out; }
function sweep(n, rate, from, to, tau) {
  const out = new Float64Array(n), fall = decay(n, rate, tau); let phase = 0;
  for (let i = 0; i < n; i++) { out[i] = DMath.sinTurns(phase); phase += (to + (from - to) * fall[i]) / rate; phase -= Math.floor(phase); }
  return out;
}
const DRUMS = {
  bd: { seconds: 0.5, render(n, rate, random) { const body = sweep(n, rate, 150, 45, 0.04), env = decay(n, rate, 0.18), click = noise(Math.round(0.003 * rate), random); for (let i = 0; i < n; i++) body[i] *= env[i]; for (let i = 0; i < click.length && i < n; i++) body[i] += 0.3 * click[i] * (1 - i / click.length); return body; } },
  sn: { seconds: 0.3, render(n, rate, random) { const tone = decay(n, rate, 0.05), hiss = biquad(noise(n, random), rate, 'highpass', 1500), env = decay(n, rate, 0.08), out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = 0.5 * tone[i] * (DMath.sinTurns(185 * i / rate) + 0.6 * DMath.sinTurns(330 * i / rate)) + 0.7 * hiss[i] * env[i]; return out; } },
  hh: { seconds: 0.08, render(n, rate, random) { const out = biquad(noise(n, random), rate, 'highpass', 7000), env = decay(n, rate, 0.02); for (let i = 0; i < n; i++) out[i] *= 0.6 * env[i]; return out; } },
  oh: { seconds: 0.45, render(n, rate, random) { const out = biquad(noise(n, random), rate, 'highpass', 7000), env = decay(n, rate, 0.15); for (let i = 0; i < n; i++) out[i] *= 0.5 * env[i]; return out; } },
  cp: { seconds: 0.25, render(n, rate, random) {
    const out = biquad(noise(n, random), rate, 'bandpass', 1200, 1.2), env = new Float64Array(n), tail = decay(n, rate, 0.06), gap = Math.round(0.01 * rate);
    for (let i = 0; i < n; i++) { const burst = i < 3 * gap ? 1 - (i % gap) / gap : tail[i - 3 * gap] ?? 0; env[i] = burst; }
    for (let i = 0; i < n; i++) out[i] *= 1.5 * env[i]; return out;
  } },
  lt: { seconds: 0.4, render(n, rate) { const out = sweep(n, rate, 150, 100, 0.08), env = decay(n, rate, 0.14); for (let i = 0; i < n; i++) out[i] *= env[i]; return out; } },
  mt: { seconds: 0.35, render(n, rate) { const out = sweep(n, rate, 220, 150, 0.07), env = decay(n, rate, 0.12); for (let i = 0; i < n; i++) out[i] *= env[i]; return out; } },
  ht: { seconds: 0.3, render(n, rate) { const out = sweep(n, rate, 320, 220, 0.06), env = decay(n, rate, 0.1); for (let i = 0; i < n; i++) out[i] *= env[i]; return out; } },
  rim: { seconds: 0.06, render(n, rate, random) { const hiss = biquad(noise(n, random), rate, 'bandpass', 2500, 2), env = decay(n, rate, 0.008), out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = (0.6 * DMath.sinTurns(1700 * i / rate) + 0.6 * hiss[i]) * env[i]; return out; } },
  cb: { seconds: 0.3, render(n, rate) {
    const out = new Float64Array(n);
    for (const f of [540, 800]) { const dt = f / rate; let p = 0; for (let i = 0; i < n; i++) { const t2 = p + 0.5 - Math.floor(p + 0.5); out[i] += 0.4 * ((p < 0.5 ? 1 : -1) + blep(p, dt) - blep(t2, dt)); p += dt; p -= Math.floor(p); } }
    biquad(out, rate, 'bandpass', 800, 1.5); const env = decay(n, rate, 0.08); for (let i = 0; i < n; i++) out[i] *= env[i]; return out;
  } },
  cy: { seconds: 1.5, render(n, rate, random) { const out = biquad(noise(n, random), rate, 'highpass', 5000), env = decay(n, rate, 0.45); for (let i = 0; i < n; i++) out[i] *= 0.45 * env[i]; return out; } }
};

const NOTE_NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const Instruments = {
  INSTRUMENTS, DRUMS,
  names: Object.keys(INSTRUMENTS), drums: Object.keys(DRUMS),
  tail(name) { return INSTRUMENTS[name]?.tail ?? 0; },
  /** "c4", "f#3", "Bb2" or a MIDI number → frequency (A4 = 440 Hz, equal temperament). */
  frequency(pitch) {
    let midi = pitch;
    if (typeof pitch === 'string') {
      const m = /^([a-gA-G])([#b]?)(-?\d)?$/.exec(pitch);
      if (!m) return null;
      midi = 12 * (Number(m[3] ?? 4) + 1) + NOTE_NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    }
    if (!Number.isFinite(midi) || midi < 0 || midi > 135) return null;
    return 440 * DMath.pow(2, (midi - 69) / 12);
  },
  /** A note held for `held` samples plus the instrument's release; velocity 0–1. */
  note(name, freq, held, rate, velocity, seed) {
    const inst = INSTRUMENTS[name];
    const n = held + Math.round(inst.tail * rate), out = inst.render(freq, held, n, rate, seed);
    const gain = velocity * velocity * 0.6;
    for (let i = 0; i < n; i++) out[i] *= gain;
    return out;
  },
  drumLength(name, rate) { return Math.round(DRUMS[name].seconds * rate); },
  drum(name, rate, velocity, seed) {
    const out = DRUMS[name].render(this.drumLength(name, rate), rate, rng(seed));
    const gain = velocity * velocity * 0.5;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
    return out;
  }
};
if (typeof module !== 'undefined') module.exports = Instruments;
else globalThis.Instruments = Instruments;
})();

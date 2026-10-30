/* Effects for clips, tracks and the master, under the renderer's determinism rules: basic float operations
   and DMath only, all state in sample indices. Each effect may extend its input by a tail. */
(() => {
const DMath = typeof module !== 'undefined' ? require('./dmath.js') : globalThis.DMath;

class EffectError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}
const num = (value, name, min, max, fallback) => {
  const v = value ?? fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new EffectError(`${name} must be a number from ${min} to ${max}.`);
  return v;
};
/** One-pole smoothing coefficient for a time constant in seconds. */
const coefficient = (seconds, rate) => seconds <= 0 ? 0 : DMath.exp(-1 / (seconds * rate));
const toDb = v => v <= 1e-12 ? -240 : 20 * DMath.log(v) / 2.302585092994046;

function biquad(input, rate, type, freq, q) {
  const w = 2 * DMath.PI * freq / rate, cw = DMath.cos(w), alpha = DMath.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) { const x0 = input[i], y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x0; y2 = y1; y1 = y0; out[i] = y0; }
  return out;
}
const extend = (channels, extra) => channels.map(ch => { const out = new Float64Array(ch.length + extra); out.set(ch); return out; });

const EFFECTS = {
  gain: {
    tail: () => 0,
    apply(channels, e) { const g = DMath.dbToGain(num(e.db, 'Gain', -200, 60, 0)); return channels.map(ch => ch.map(v => v * g)); }
  },
  lowpass: { tail: () => 0, apply: (channels, e, rate) => channels.map(ch => biquad(ch, rate, 'lowpass', num(e.freq, 'Filter frequency', 1, rate / 2 - 1), num(e.q, 'Q', 0.01, 100, Math.SQRT1_2))) },
  highpass: { tail: () => 0, apply: (channels, e, rate) => channels.map(ch => biquad(ch, rate, 'highpass', num(e.freq, 'Filter frequency', 1, rate / 2 - 1), num(e.q, 'Q', 0.01, 100, Math.SQRT1_2))) },
  bandpass: { tail: () => 0, apply: (channels, e, rate) => channels.map(ch => biquad(ch, rate, 'bandpass', num(e.freq, 'Filter frequency', 1, rate / 2 - 1), num(e.q, 'Q', 0.01, 100, 1))) },
  drive: {
    tail: () => 0,
    apply(channels, e) { const k = num(e.amount, 'Drive amount', 0.1, 50, 2), norm = 1 / DMath.tanh(k); return channels.map(ch => ch.map(v => DMath.tanh(k * v) * norm)); }
  },
  delay: {
    // Echo tail: until the feedback has decayed below −60 dB (at most 10 s).
    tail(e) {
      const time = num(e.time, 'Delay time', 0.001, 5, 0.25), feedback = num(e.feedback, 'Feedback', 0, 0.95, 0.35);
      return Math.min(10, feedback > 0 ? time * Math.ceil(-3 / (DMath.log(feedback) / 2.302585092994046)) + time : time);
    },
    apply(channels, e, rate) {
      const d = Math.max(1, Math.round(num(e.time, 'Delay time', 0.001, 5, 0.25) * rate)), fb = num(e.feedback, 'Feedback', 0, 0.95, 0.35), mix = num(e.mix, 'Mix', 0, 1, 0.3);
      return extend(channels, Math.round(this.tail(e) * rate)).map(ch => {
        const out = new Float64Array(ch.length), line = new Float64Array(d);
        for (let i = 0; i < ch.length; i++) { const k = i % d, echo = line[k]; line[k] = ch[i] + echo * fb; out[i] = ch[i] * (1 - mix) + echo * mix; }
        return out;
      });
    }
  },
  reverb: {
    tail: e => 0.5 + 3 * num(e.room, 'Room', 0, 1, 0.5),
    // Freeverb-style network (public-domain design by Jezar): 8 damped combs then 4 allpasses per channel,
    // the right channel offset by 23 samples. Delay lengths scale with the sample rate.
    apply(channels, e, rate) {
      const room = num(e.room, 'Room', 0, 1, 0.5), damp = num(e.damp, 'Damping', 0, 1, 0.5), mix = num(e.mix, 'Mix', 0, 1, 0.3), width = num(e.width, 'Width', 0, 1, 1);
      const feedback = 0.7 + 0.28 * room, d = damp * 0.4, scale = rate / 44100;
      const input = extend(channels, Math.round(this.tail(e) * rate)), n = input[0].length;
      const mono = new Float64Array(n);
      for (const ch of input) for (let i = 0; i < n; i++) mono[i] += ch[i] * 0.015 / input.length;
      const wet = [0, 23].map(spread => {
        const out = new Float64Array(n);
        for (const length of [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) {
          const size = Math.round((length + spread) * scale), buf = new Float64Array(size); let k = 0, store = 0;
          for (let i = 0; i < n; i++) { const y = buf[k]; store = y * (1 - d) + store * d; buf[k] = mono[i] + store * feedback; k = k + 1 === size ? 0 : k + 1; out[i] += y; }
        }
        for (const length of [556, 441, 341, 225]) {
          const size = Math.round((length + spread) * scale), buf = new Float64Array(size); let k = 0;
          for (let i = 0; i < n; i++) { const b = buf[k], x = out[i]; buf[k] = x + b * 0.5; out[i] = b - x; k = k + 1 === size ? 0 : k + 1; }
        }
        return out;
      });
      const w1 = (1 + width) / 2, w2 = (1 - width) / 2, outputs = input.length === 1 ? [0] : [0, 1];
      return outputs.map(c => {
        const dry = input[c], out = new Float64Array(n), [a, b] = c === 0 ? [wet[0], wet[1]] : [wet[1], wet[0]];
        for (let i = 0; i < n; i++) out[i] = dry[i] * (1 - mix) + (a[i] * w1 + b[i] * w2) * mix * 3;
        return out;
      });
    }
  },
  compressor: {
    tail: () => 0,
    apply(channels, e, rate) {
      const threshold = num(e.threshold, 'Threshold', -80, 0, -18), ratio = num(e.ratio, 'Ratio', 1, 50, 4);
      const attack = coefficient(num(e.attack, 'Attack', 0, 1, 0.01), rate), release = coefficient(num(e.release, 'Release', 0.001, 5, 0.15), rate);
      const makeup = DMath.dbToGain(num(e.makeup, 'Makeup gain', -24, 24, 0)), n = channels[0].length;
      const gains = new Float64Array(n), limit = DMath.dbToGain(threshold);
      let env = 0;
      // Peak detection linked across channels; the gain computer works in decibels.
      for (let i = 0; i < n; i++) {
        let peak = 0; for (const ch of channels) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
        env = peak > env ? attack * env + (1 - attack) * peak : release * env + (1 - release) * peak;
        // Logarithms only above the threshold, where the gain computer needs decibels.
        gains[i] = env > limit ? DMath.dbToGain(-(toDb(env) - threshold) * (1 - 1 / ratio)) * makeup : makeup;
      }
      return channels.map(ch => ch.map((v, i) => v * gains[i]));
    }
  },
  limiter: {
    tail: () => 0,
    // Instant attack, smooth release: no sample leaves above the ceiling.
    apply(channels, e, rate) {
      const ceiling = DMath.dbToGain(num(e.ceiling, 'Ceiling', -60, 0, -1)), release = coefficient(num(e.release, 'Release', 0.001, 5, 0.05), rate), n = channels[0].length;
      const out = channels.map(() => new Float64Array(n));
      let gain = 1;
      for (let i = 0; i < n; i++) {
        let peak = 0; for (const ch of channels) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
        const needed = peak > ceiling ? ceiling / peak : 1;
        // Incremental form, so an idle limiter keeps gain exactly 1 and leaves the signal bit-identical.
        gain = needed < gain ? needed : gain + (1 - release) * (needed - gain);
        if (gain > needed) gain = needed;
        for (let c = 0; c < channels.length; c++) out[c][i] = channels[c][i] * gain;
      }
      return out;
    }
  }
};

const AudioEffects = {
  EffectError, EFFECTS, toDb, coefficient,
  check(chain) {
    if (!Array.isArray(chain) || chain.length > 32) throw new EffectError('Effect chains hold up to 32 effects.');
    for (const e of chain) if (!e || !Object.hasOwn(EFFECTS, e.type)) throw new EffectError(`Unknown effect: ${String(e?.type).slice(0, 30)}.`);
    return chain;
  },
  tail(chain) { return this.check(chain).reduce((sum, e) => sum + EFFECTS[e.type].tail(e), 0); },
  /** Applies a chain to channels (each a Float64Array); returns new channels, longer by the chain's tail. */
  apply(chain, channels, rate) {
    let out = channels;
    for (const e of this.check(chain)) out = EFFECTS[e.type].apply(out, e, rate);
    return out;
  },
  /** Per-sample gain from (seconds, dB) points, interpolated in dB and held past the ends. */
  automation(points, n, rate) {
    if (!Array.isArray(points) || !points.length || points.length > 10000) throw new EffectError('Automation needs 1–10,000 (time, dB) points.');
    const frames = points.map(([t, db]) => [Math.round(num(t, 'Automation time', 0, 300) * rate), num(db, 'Automation level', -200, 60)]);
    for (let k = 1; k < frames.length; k++) if (frames[k][0] < frames[k - 1][0]) throw new EffectError('Automation times must not decrease.');
    const out = new Float64Array(n); let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < frames.length - 1 && frames[k + 1][0] <= i) k++;
      const [t0, v0] = frames[k], next = frames[k + 1];
      out[i] = DMath.dbToGain(i < t0 || !next ? v0 : v0 + (next[1] - v0) * (i - t0) / (next[0] - t0));
    }
    return out;
  },
  /** Sidechain ducking: gain falls by amount dB while the key signal is above the threshold. */
  duck(key, n, rate, { amount = -9, threshold = -40, attack = 0.05, release = 0.3 } = {}) {
    num(amount, 'Duck amount', -60, 0); num(threshold, 'Duck threshold', -90, 0);
    const a = coefficient(num(attack, 'Duck attack', 0, 5), rate), r = coefficient(num(release, 'Duck release', 0, 10), rate);
    const floor = DMath.dbToGain(amount), limit = DMath.dbToGain(threshold), detect = coefficient(0.01, rate), out = new Float64Array(n);
    let env = 0, gain = 1;
    for (let i = 0; i < n; i++) {
      let peak = 0; for (const ch of key) { const v = i < ch.length ? Math.abs(ch[i]) : 0; if (v > peak) peak = v; }
      env = peak > env ? peak : detect * env + (1 - detect) * peak;
      const target = env > limit ? floor : 1;
      gain = target < gain ? a * gain + (1 - a) * target : r * gain + (1 - r) * target;
      out[i] = gain;
    }
    return out;
  }
};
if (typeof module !== 'undefined') module.exports = AudioEffects;
else globalThis.AudioEffects = AudioEffects;
})();

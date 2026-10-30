/* Realizes a timeline (format "audio-timeline", version 1) as PCM. Runs in the sandbox worker and in Node.
   Determinism contract: only basic float operations and DMath, sample-index time, seeded randomness,
   fixed evaluation order. The same timeline gives identical Float32 bytes in every engine. */
(() => {
const DMath = typeof module !== 'undefined' ? require('./dmath.js') : globalThis.DMath;
const AudioCore = typeof module !== 'undefined' ? require('./audio-core.js') : globalThis.AudioCore;
const Instruments = typeof module !== 'undefined' ? require('./instruments.js') : globalThis.Instruments;

class TimelineError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}
const finite = (value, what, line, { min = -Infinity, max = Infinity } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TimelineError(`${what} must be a number between ${min} and ${max}.`, line);
  return value;
};

// mulberry32: small, fast, and exact integer arithmetic in every engine.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mixSeed = (a, b) => { let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };

class Renderer {
  /** providers.buffer(node) → { rate, frames, channels } for sampled clips (zzfx, sfxr, speech);
      providers.expand(node) → an "events" node for notation clips (abc, pattern). */
  constructor(timeline, buffers = [], providers = {}) {
    this.providers = providers;
    if (!timeline || timeline.format !== 'audio-timeline' || timeline.version !== 1) throw new TimelineError('The scene did not produce a version 1 timeline.');
    this.rate = timeline.sampleRate;
    if (!AudioCore.SAMPLE_RATES.includes(this.rate)) throw new TimelineError(`Sample rate must be one of ${AudioCore.SAMPLE_RATES.join(', ')}.`);
    this.channels = timeline.channels === 1 ? 1 : 2;
    this.seed = Number.isInteger(timeline.seed) ? timeline.seed : 0;
    this.timeline = timeline; this.buffers = buffers;
    this.maxFrames = AudioCore.MAX_SECONDS * this.rate;
    this.noiseCount = 0; this.lengths = new WeakMap(); this.expansions = new WeakMap(); this.resamples = new WeakMap();
  }
  /** Bounds work and recursion before rendering: user scripts build these trees. */
  check(node, depth = 0, count = { n: 0 }) {
    if (!node || typeof node !== 'object') throw new TimelineError('A clip is malformed.');
    if (depth > 200) throw new TimelineError('Clips are nested too deeply (over 200 levels).', node.line);
    if (++count.n > 100000) throw new TimelineError('The scene is too complex (more than 100,000 clip operations).');
    if (node.of) this.check(node.of, depth + 1, count);
    if (node.events) {
      if (!Array.isArray(node.events) || node.events.length > 20000) throw new TimelineError('Notation clips are limited to 20,000 notes.', node.line);
      for (const e of node.events) this.check(e && e.node, depth + 1, count);
    }
    if (node.items) {
      if (!Array.isArray(node.items) || node.items.length > 10000) throw new TimelineError('Mixes and sequences are limited to 10,000 items.', node.line);
      for (const item of node.items) this.check(item, depth + 1, count);
    }
    return count;
  }
  toFrames(seconds, line) { return Math.round(finite(seconds, 'A time', line, { min: 0, max: AudioCore.MAX_SECONDS }) * this.rate); }
  /** Length in frames, or Infinity for generators that need a .dur(). */
  frames(node) {
    if (!this.lengths.has(node)) this.lengths.set(node, this.measure(node));
    return this.lengths.get(node);
  }
  measure(node) {
    const line = node.line;
    switch (node.op) {
      case 'osc': case 'noise': return Infinity;
      case 'silence': case 'dur': return this.toFrames(node.seconds, line);
      case 'buffer': case 'zzfx': case 'sfxr': case 'speech': { const b = this.buffer(node); return Math.round(b.frames * this.rate / b.rate); }
      case 'abc': case 'pattern': return this.frames(this.expanded(node));
      case 'events': return this.toFrames(node.seconds, line);
      case 'note': {
        if (!Instruments.names.includes(node.instrument)) throw new TimelineError(`Unknown instrument "${String(node.instrument).slice(0, 30)}". Use one of: ${Instruments.names.join(', ')}.`, line);
        return this.toFrames(node.seconds, line) + Math.round(Instruments.tail(node.instrument) * this.rate);
      }
      case 'drum':
        if (!Instruments.drums.includes(node.name)) throw new TimelineError(`Unknown drum "${String(node.name).slice(0, 20)}". Use one of: ${Instruments.drums.join(', ')}.`, line);
        return Instruments.drumLength(node.name, this.rate);
      case 'gain': case 'env': case 'fade': case 'filter': case 'reverse': return this.frames(node.of);
      case 'slice': {
        const n = this.frames(node.of), start = this.toFrames(node.start, line);
        const end = node.end == null ? n : Math.min(n, this.toFrames(node.end, line));
        if (!Number.isFinite(end)) throw new TimelineError('Slicing a generator needs an end time, or give it a .dur() first.', line);
        return Math.max(0, end - start);
      }
      case 'loop': {
        const n = this.frames(node.of);
        if (!Number.isFinite(n)) throw new TimelineError('Give a generator a .dur() before looping it.', line);
        if (!Number.isInteger(node.count) || node.count < 0 || node.count > 100000) throw new TimelineError('Loop counts must be whole numbers from 0 to 100,000.', line);
        return n * node.count;
      }
      case 'mix': return node.items.reduce((m, item) => Math.max(m, this.frames(item)), 0);
      case 'seq': return node.items.reduce((s, item) => {
        const n = this.frames(item);
        if (!Number.isFinite(n)) throw new TimelineError('Give each generator a .dur() before sequencing it with >>.', item.line ?? line);
        return s + n;
      }, 0);
      default: throw new TimelineError(`Unknown clip operation: ${String(node.op).slice(0, 40)}.`, line);
    }
  }
  /** Engine errors (notation, voices) become timeline errors that keep a line. */
  provide(work, node) {
    try { return work(); } catch (error) { throw error instanceof TimelineError ? error : new TimelineError(String(error?.message || error), error?.line ?? node.line); }
  }
  expanded(node) {
    if (!this.expansions.has(node)) {
      if (!this.providers.expand) throw new TimelineError(`${node.op} clips need the notation engines.`, node.line);
      const events = this.provide(() => this.providers.expand(node), node);
      this.check(events);
      this.expansions.set(node, events);
    }
    return this.expansions.get(node);
  }
  buffer(node) {
    if (node.op !== 'buffer') {
      if (!this.providers.buffer) throw new TimelineError(`${node.op} clips need their engine.`, node.line);
      return this.provide(() => this.providers.buffer(node), node);
    }
    const b = this.buffers[node.ref];
    if (!b) throw new TimelineError('A Samples clip refers to missing audio data.', node.line);
    return b;
  }
  /** Renders exactly n frames of node as an array of Float64Array channels (1 or 2). */
  render(node, n) {
    if (n > this.maxFrames) throw new TimelineError(`Clips are limited to ${AudioCore.MAX_SECONDS} seconds.`, node.line);
    switch (node.op) {
      case 'osc': return [this.osc(node, n)];
      case 'noise': return [this.noise(node, n)];
      case 'silence': return [new Float64Array(n)];
      case 'dur': return this.fit(this.render(node.of, Math.min(n, this.frames(node))), n);
      case 'buffer': case 'zzfx': case 'sfxr': case 'speech': return this.fit(this.resampled(this.buffer(node)).map(ch => ch.slice()), n);
      case 'abc': case 'pattern': return this.render(this.expanded(node), n);
      case 'events': {
        let out = [new Float64Array(n)];
        for (const e of node.events) {
          const at = this.toFrames(e.at, node.line);
          if (at >= n) continue;
          out = this.add(out, this.render(e.node, Math.min(this.frames(e.node), n - at)), at);
        }
        return out;
      }
      case 'note': {
        const held = this.toFrames(node.seconds, node.line), freq = finite(node.freq, 'Note frequency', node.line, { min: 1, max: this.rate / 2 });
        const velocity = finite(node.velocity ?? 0.8, 'Velocity', node.line, { min: 0, max: 1 });
        return this.fit([Instruments.note(node.instrument, freq, held, this.rate, velocity, Number.isInteger(node.seed) ? node.seed >>> 0 : 0)], n);
      }
      case 'drum': {
        const velocity = finite(node.velocity ?? 1, 'Velocity', node.line, { min: 0, max: 1 });
        return this.fit([Instruments.drum(node.name, this.rate, velocity, Number.isInteger(node.seed) ? node.seed >>> 0 : 0)], n);
      }
      case 'gain': { const g = DMath.dbToGain(finite(node.db, 'Gain', node.line, { min: -200, max: 60 })); return this.map(this.render(node.of, n), v => v * g); }
      case 'env': return this.envelope(node, this.render(node.of, n), n);
      case 'fade': return this.fade(node, this.render(node.of, n), Math.min(n, this.frames(node.of)));
      case 'filter': return this.render(node.of, n).map(ch => this.biquad(node, ch));
      case 'reverse': { const len = Math.min(n, this.frames(node.of)); return this.fit(this.render(node.of, len).map(ch => ch.slice().reverse()), n); }
      case 'slice': {
        const start = this.toFrames(node.start, node.line), len = this.frames(node);
        return this.fit(this.render(node.of, start + Math.min(n, len)).map(ch => ch.slice(start)), n);
      }
      case 'loop': {
        const one = this.frames(node.of), src = this.render(node.of, one), out = src.map(() => new Float64Array(n));
        if (one > 0) for (let c = 0; c < src.length; c++) for (let i = 0; i < n && i < one * node.count; i++) out[c][i] = src[c][i % one];
        return out;
      }
      case 'mix': {
        let out = [new Float64Array(n)];
        for (const item of node.items) out = this.add(out, this.render(item, Math.min(n, this.frames(item))), 0);
        return out;
      }
      case 'seq': {
        let out = [new Float64Array(n)], at = 0;
        for (const item of node.items) { const len = this.frames(item); if (at >= n) break; out = this.add(out, this.render(item, Math.min(len, n - at)), at); at += len; }
        return out;
      }
      default: throw new TimelineError(`Unknown clip operation: ${String(node.op).slice(0, 40)}.`, node.line);
    }
  }
  fit(channels, n) { return channels.map(ch => { if (ch.length === n) return ch; const out = new Float64Array(n); out.set(ch.length > n ? ch.subarray(0, n) : ch); return out; }); }
  map(channels, f) { for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = f(ch[i]); return channels; }
  /** Adds src into dst at frame offset; widens mono to stereo by duplication when needed. */
  add(dst, src, at) {
    if (src.length > dst.length) dst = [dst[0], dst[0].slice()];
    for (let c = 0; c < dst.length; c++) {
      const from = src[Math.min(c, src.length - 1)], to = dst[c];
      for (let i = 0; i < from.length && at + i < to.length; i++) to[at + i] += from[i];
    }
    return dst;
  }
  osc(node, n) {
    const freq = finite(node.freq, 'Frequency', node.line, { min: 0, max: this.rate / 2 });
    const step = freq / this.rate, out = new Float64Array(n);
    let phase = finite(node.phase ?? 0, 'Phase', node.line, { min: 0, max: 1 });
    // PolyBLEP smooths the square and saw discontinuities to limit aliasing.
    const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
    for (let i = 0; i < n; i++) {
      let v;
      switch (node.wave) {
        case 'sine': v = DMath.sinTurns(phase); break;
        case 'saw': v = 2 * phase - 1 - blep(phase, step); break;
        case 'square': { const t2 = phase + 0.5 - Math.floor(phase + 0.5); v = (phase < 0.5 ? 1 : -1) + blep(phase, step) - blep(t2, step); break; }
        case 'triangle': v = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase; break;
        default: throw new TimelineError(`Unknown waveform: ${String(node.wave).slice(0, 20)}.`, node.line);
      }
      out[i] = v;
      phase += step; phase -= Math.floor(phase);
    }
    return out;
  }
  noise(node, n) {
    const index = this.noiseCount++;
    const seed = Number.isInteger(node.seed) ? mixSeed(node.seed, 0x5eed) : mixSeed(this.seed, index);
    const random = rng(seed), out = new Float64Array(n);
    if (node.color === 'pink') {
      // Voss–McCartney: 16 rows updated at octave-spaced rates by trailing-zero count.
      const rows = new Float64Array(16); let sum = 0;
      for (let r = 0; r < 16; r++) { rows[r] = random() * 2 - 1; sum += rows[r]; }
      for (let i = 0; i < n; i++) {
        let k = i + 1, r = 0; while ((k & 1) === 0 && r < 15) { k >>= 1; r++; }
        sum -= rows[r]; rows[r] = random() * 2 - 1; sum += rows[r];
        out[i] = (sum + random() * 2 - 1) / 8; // RMS ≈ 0.3, like brown
      }
    } else if (node.color === 'brown') {
      let b = 0;
      for (let i = 0; i < n; i++) { b = (b + 0.02 * (random() * 2 - 1)) / 1.02; out[i] = b * 3.5; }
    } else if (node.color === 'white' || node.color == null) {
      for (let i = 0; i < n; i++) out[i] = random() * 2 - 1;
    } else throw new TimelineError(`Unknown noise color: ${String(node.color).slice(0, 20)}. Use white, pink or brown.`, node.line);
    return out;
  }
  envelope(node, channels, n) {
    const env = node.env || {}, line = node.line, gains = new Float64Array(n);
    if (env.kind === 'adsr') {
      const a = this.toFrames(env.a, line), d = this.toFrames(env.d, line), r = this.toFrames(env.r, line);
      const s = finite(env.s, 'Sustain level', line, { min: 0, max: 1 }), gate = Math.max(0, n - r);
      const level = t => t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : s;
      const atGate = level(gate);
      for (let t = 0; t < n; t++) gains[t] = t < gate ? level(t) : r > 0 ? atGate * (1 - (t - gate) / r) : 0;
    } else if (env.kind === 'points') {
      const points = env.points;
      if (!Array.isArray(points) || !points.length || points.length > 10000) throw new TimelineError('An Envelope needs 1–10,000 (time, level) points.', line);
      const frames = points.map(([t, v]) => [this.toFrames(t, line), finite(v, 'Envelope level', line, { min: -100, max: 100 })]);
      for (let k = 1; k < frames.length; k++) if (frames[k][0] < frames[k - 1][0]) throw new TimelineError('Envelope times must not decrease.', line);
      let k = 0;
      for (let t = 0; t < n; t++) {
        while (k < frames.length - 1 && frames[k + 1][0] <= t) k++;
        const [t0, v0] = frames[k], next = frames[k + 1];
        gains[t] = t < t0 ? v0 : next ? v0 + (next[1] - v0) * (t - t0) / (next[0] - t0) : v0;
      }
    } else throw new TimelineError('Unknown envelope.', line);
    for (const ch of channels) for (let i = 0; i < n; i++) ch[i] *= gains[i];
    return channels;
  }
  fade(node, channels, len) {
    const fin = this.toFrames(node.in || 0, node.line), fout = this.toFrames(node.out || 0, node.line);
    for (const ch of channels) {
      for (let i = 0; i < fin && i < len; i++) ch[i] *= i / fin;
      for (let i = 0; i < fout && i < len; i++) ch[len - 1 - i] *= i / fout;
    }
    return channels;
  }
  biquad(node, input) {
    const f = finite(node.freq, 'Filter frequency', node.line, { min: 1, max: this.rate / 2 - 1 });
    const q = finite(node.q ?? 0.7071067811865476, 'Filter Q', node.line, { min: 0.01, max: 100 });
    const w = 2 * DMath.PI * f / this.rate, cw = DMath.cos(w), alpha = DMath.sin(w) / (2 * q);
    let b0, b1, b2;
    switch (node.type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; break;
      default: throw new TimelineError(`Unknown filter type: ${String(node.type).slice(0, 20)}.`, node.line);
    }
    const a0 = 1 + alpha, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    const out = new Float64Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i], y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0; out[i] = y0;
    }
    return out;
  }
  /** Windowed-sinc resampling with a precomputed Blackman kernel table. */
  resampled(b) {
    if (!this.resamples.has(b)) this.resamples.set(b, this.resample(b));
    return this.resamples.get(b);
  }
  resample(b) {
    const channels = b.channels.map(ch => Float64Array.from(ch));
    if (b.rate === this.rate) return channels;
    const ratio = this.rate / b.rate, cutoff = Math.min(1, ratio), half = 16, phases = 512;
    const width = Math.ceil(half / cutoff), table = new Float64Array((2 * width + 1) * phases + 1);
    const kernel = x => {
      const ax = Math.abs(x); if (ax >= width) return 0;
      const sx = x * cutoff, sinc = sx === 0 ? 1 : DMath.sin(DMath.PI * sx) / (DMath.PI * sx);
      const t = x / width; // −1…1
      return cutoff * sinc * (0.42 + 0.5 * DMath.cos(DMath.PI * t) + 0.08 * DMath.cos(2 * DMath.PI * t));
    };
    for (let k = 0; k < table.length; k++) table[k] = kernel(k / phases - width);
    const n = Math.round(b.frames * ratio);
    return channels.map(src => {
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const pos = i / ratio, base = Math.floor(pos); let sum = 0;
        for (let j = base - width + 1; j <= base + width; j++) {
          if (j < 0 || j >= src.length) continue;
          const x = (j - pos + width) * phases, k = Math.floor(x), frac = x - k;
          sum += src[j] * (table[k] + (table[k + 1] - table[k]) * frac);
        }
        out[i] = sum;
      }
      return out;
    });
  }
  /** Places one clip as stereo (or mono) with gain and equal-power pan. */
  place(p) {
    const line = p.line, n = this.frames(p.clip);
    if (!Number.isFinite(n)) throw new TimelineError('Give generators like Sine() or Noise() a duration with .dur(seconds) before adding them.', line);
    let channels = this.render(p.clip, n);
    const g = DMath.dbToGain(finite(p.gain ?? 0, 'Gain', line, { min: -200, max: 60 }));
    const pan = finite(p.pan ?? 0, 'Pan', line, { min: -1, max: 1 });
    if (this.channels === 1) {
      const mono = channels.length === 1 ? channels[0] : channels[0].map((v, i) => (v + channels[1][i]) / 2);
      return [mono.map(v => v * g)];
    }
    const theta = (pan + 1) * DMath.PI / 4, left = DMath.cos(theta) * g, right = DMath.sin(theta) * g;
    if (channels.length === 1) return [channels[0].map(v => v * left), channels[0].map(v => v * right)];
    // Stereo sources keep unity at center and use an equal-power balance law.
    const norm = 1 / DMath.cos(DMath.PI / 4);
    return [channels[0].map(v => v * left * norm), channels[1].map(v => v * right * norm)];
  }
  run() {
    const placements = this.timeline.placements;
    if (!Array.isArray(placements)) throw new TimelineError('The timeline has no placements.');
    if (placements.length > AudioCore.MAX_CLIPS) throw new TimelineError(`Scenes are limited to ${AudioCore.MAX_CLIPS} clips.`);
    const count = { n: 0 };
    for (const p of placements) this.check(p && p.clip, 0, count);
    const tracks = new Map(), clips = [];
    let end = 0;
    const placed = placements.map(p => {
      let at, channels;
      // Nodes deep in a clip may lack a line; the placement's line still points at the right code.
      try { at = this.toFrames(p.at, p.line); channels = this.place(p); }
      catch (error) { if (error instanceof TimelineError && error.line == null) error.line = p.line; throw error; }
      const len = channels[0].length;
      end = Math.max(end, at + len);
      const track = typeof p.track === 'string' && p.track ? p.track.slice(0, 64) : 'main';
      if (!tracks.has(track)) tracks.set(track, null);
      clips.push({ track, start: at / this.rate, end: (at + len) / this.rate, line: Number.isInteger(p.line) ? p.line : null, label: String(p.label || '').slice(0, 80) });
      return { at, channels, track };
    });
    const length = this.timeline.length == null ? end : this.toFrames(this.timeline.length);
    if (length > this.maxFrames) throw new TimelineError(`Scenes are limited to ${AudioCore.MAX_SECONDS} seconds.`);
    for (const name of tracks.keys()) tracks.set(name, Array.from({ length: this.channels }, () => new Float64Array(length)));
    for (const { at, channels, track } of placed) this.add(tracks.get(track), channels, at);
    const settings = this.timeline.tracks || {}, master = Array.from({ length: this.channels }, () => new Float64Array(length));
    for (const [name, buffer] of tracks) {
      const t = settings[name] || {};
      if (t.mute) continue;
      const g = DMath.dbToGain(finite(t.gain ?? 0, 'Track gain', undefined, { min: -200, max: 60 }));
      for (let c = 0; c < this.channels; c++) for (let i = 0; i < length; i++) master[c][i] += buffer[c][i] * g;
    }
    const mg = DMath.dbToGain(finite(this.timeline.master?.gain ?? 0, 'Master gain', undefined, { min: -200, max: 60 }));
    return { sampleRate: this.rate, length, channels: master.map(ch => { const out = new Float32Array(length); for (let i = 0; i < length; i++) out[i] = ch[i] * mg; return out; }),
      tracks: [...tracks.keys()], clips };
  }
}
const AudioRenderer = {
  TimelineError,
  render(timeline, buffers, providers) { return new Renderer(timeline, buffers, providers).run(); }
};
if (typeof module !== 'undefined') module.exports = AudioRenderer;
else globalThis.AudioRenderer = AudioRenderer;
})();

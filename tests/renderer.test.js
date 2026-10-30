const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const DMath = require('../src/dmath.js');
const AudioRenderer = require('../src/audio-renderer.js');
const Wav = require('../src/wav.js');

const timeline = (placements, extra = {}) => ({ format: 'audio-timeline', version: 1, sampleRate: 48000, channels: 2, seed: 1, length: null, placements, tracks: {}, master: { gain: 0 }, ...extra });
const sine = (freq, seconds) => ({ op: 'dur', seconds, of: { op: 'osc', wave: 'sine', freq } });
const at = (clip, time = 0, more = {}) => ({ clip, at: time, track: 'main', gain: 0, pan: 0, line: 1, label: 'x', ...more });
const sha = result => crypto.createHash('sha256').update(Wav.encode(result.channels, result.sampleRate, 'float32')).digest('hex');

test('deterministic math stays within 1e-14 of the platform libm, with exact special values', () => {
  const xs = Array.from({ length: 4001 }, (_, i) => (i - 2000) * 0.0173);
  const near = (a, b) => Math.abs(a - b) <= 1e-14 * Math.max(1, Math.abs(b));
  for (const x of xs) {
    assert.ok(near(DMath.sin(x), Math.sin(x)), `sin ${x}`); assert.ok(near(DMath.cos(x), Math.cos(x)), `cos ${x}`);
    assert.ok(near(DMath.exp(x / 4), Math.exp(x / 4)), `exp ${x}`); assert.ok(near(DMath.tanh(x), Math.tanh(x)), `tanh ${x}`);
    if (x > 0) assert.ok(near(DMath.log(x), Math.log(x)), `log ${x}`);
  }
  assert.equal(DMath.exp(0), 1); assert.equal(DMath.log(1), 0); assert.equal(DMath.sin(0), 0); assert.equal(DMath.dbToGain(0), 1);
  assert.equal(DMath.exp(-Infinity), 0); assert.equal(DMath.log(0), -Infinity); assert.ok(Number.isNaN(DMath.log(-1)));
  assert.equal(DMath.dbToGain(-Infinity), 0); assert.ok(Math.abs(DMath.dbToGain(-6) - 0.501187) < 1e-6);
  // Any change to these bits changes every rendered file; update tests/golden.json deliberately.
  const grid = new Float64Array(xs.flatMap(x => [DMath.sin(x), DMath.exp(x / 8), DMath.log(Math.abs(x) + 0.5), DMath.tanh(x)]));
  assert.equal(crypto.createHash('sha256').update(new Uint8Array(grid.buffer)).digest('hex').slice(0, 16), '227db1b9400763bc');
});

test('lengths, sequencing, mixing, looping and slicing are exact sample counts', () => {
  const r = AudioRenderer.render(timeline([
    at({ op: 'seq', items: [sine(440, 0.1), { op: 'silence', seconds: 0.05 }, sine(220, 0.1)] }),
    at({ op: 'loop', count: 3, of: sine(330, 0.02) }, 1),
    at({ op: 'slice', start: 0.25, end: 0.5, of: { op: 'osc', wave: 'saw', freq: 100 } }, 2),
    at({ op: 'mix', items: [sine(100, 0.3), sine(150, 0.1)] }, 3)
  ]));
  assert.equal(r.length, 3.3 * 48000);
  assert.deepEqual(r.clips.map(c => [c.start, +(c.end - c.start).toFixed(6)]), [[0, 0.25], [1, 0.06], [2, 0.25], [3, 0.3]]);
  // Silence between the two sequenced tones.
  assert.ok(r.channels[0].subarray(4800 + 10, 7200 - 10).every(v => v === 0));
  assert.equal(r.channels[0][1.07 * 48000], 0);
});

test('equal-power pan, gains, mono scenes, mute and the master gain', () => {
  const one = { op: 'dur', seconds: 0.01, of: { op: 'env', env: { kind: 'points', points: [[0, 1]] }, of: { op: 'osc', wave: 'square', freq: 0 } } };
  const level = (extra, more) => AudioRenderer.render(timeline([at(one, 0, more)], extra)).channels.map(c => +c[100].toFixed(6));
  assert.deepEqual(level({}, {}), [0.707107, 0.707107]);
  assert.deepEqual(level({}, { pan: -1 }), [1, 0]);
  assert.deepEqual(level({}, { pan: 1, gain: -6 }), [0, 0.501187]);
  assert.deepEqual(level({ channels: 1 }, { pan: 1 }), [1]);
  assert.deepEqual(level({ tracks: { main: { mute: true } } }, {}), [0, 0]);
  assert.deepEqual(level({ master: { gain: -6 } }, { pan: -1 }), [0.501187, 0]);
});

test('noise is seeded: explicit seeds ignore the scene seed; unseeded noise follows it', () => {
  const noise = seed => ({ op: 'dur', seconds: 0.1, of: { op: 'noise', color: 'pink', ...(seed == null ? {} : { seed }) } });
  const hash = (seed, sceneSeed) => sha(AudioRenderer.render(timeline([at(noise(seed))], { seed: sceneSeed })));
  assert.equal(hash(5, 1), hash(5, 2));
  assert.notEqual(hash(null, 1), hash(null, 2));
  assert.equal(hash(null, 3), hash(null, 3));
  for (const color of ['white', 'pink', 'brown']) {
    const r = AudioRenderer.render(timeline([at({ op: 'dur', seconds: 1, of: { op: 'noise', color } })]));
    const c = r.channels[0], rms = Math.sqrt(c.reduce((s, v) => s + v * v, 0) / c.length) / Math.SQRT1_2;
    assert.ok(rms > 0.1 && rms < 0.7, `${color} ${rms}`);
  }
});

test('filters attenuate out of band; envelopes and fades shape the start and end', () => {
  const tone = (freq, type) => AudioRenderer.render(timeline([at({ op: 'dur', seconds: 0.5, of: { op: 'filter', type, freq: 1000, of: { op: 'osc', wave: 'sine', freq } } }, 0, { pan: -1 })]));
  const rms = r => Math.sqrt(r.channels[0].subarray(12000).reduce((s, v) => s + v * v, 0) / (r.length - 12000));
  assert.ok(rms(tone(8000, 'lowpass')) < 0.02); assert.ok(rms(tone(100, 'lowpass')) > 0.69);
  assert.ok(rms(tone(100, 'highpass')) < 0.02); assert.ok(rms(tone(8000, 'highpass')) > 0.69);
  const r = AudioRenderer.render(timeline([at({ op: 'fade', in: 0.1, out: 0.1, of: sine(1000, 1) }, 0, { pan: -1 })]));
  assert.equal(r.channels[0][0], 0); assert.ok(Math.abs(r.channels[0][47999]) < 1e-3);
  const env = AudioRenderer.render(timeline([at({ op: 'dur', seconds: 1, of: { op: 'env', env: { kind: 'adsr', a: 0.1, d: 0.1, s: 0.5, r: 0.2 }, of: { op: 'osc', wave: 'square', freq: 0 } } }, 0, { pan: -1 })]));
  assert.equal(+env.channels[0][2400].toFixed(6), 0.5); assert.equal(+env.channels[0][24000].toFixed(6), 0.5); assert.equal(env.channels[0][47999] < 0.01, true);
});

test('buffers are resampled with a windowed sinc and keep their pitch', () => {
  const rate = 16000, data = new Float32Array(rate);
  for (let i = 0; i < rate; i++) data[i] = 0.5 * Math.sin(2 * Math.PI * 441 * i / rate);
  const r = AudioRenderer.render(timeline([at({ op: 'buffer', ref: 0 }, 0, { pan: -1 })]), [{ rate, frames: rate, channels: [data] }]);
  assert.equal(r.length, 48000);
  // Zero crossings over the middle second give the frequency.
  let crossings = 0; const c = r.channels[0];
  for (let i = 4800; i < 43200; i++) if (c[i - 1] < 0 && c[i] >= 0) crossings++;
  assert.ok(Math.abs(crossings / 0.8 - 441) < 3, String(crossings));
  assert.ok(Math.abs(Math.max(...c.subarray(4800, 43200)) - 0.5) < 0.01);
});

test('errors carry the scene line and limits are enforced', () => {
  const fails = (tl, pattern, line) => assert.throws(() => AudioRenderer.render(tl), error => pattern.test(error.message) && error.line === line);
  fails(timeline([at({ op: 'osc', wave: 'sine', freq: 1 }, 0, { line: 7 })]), /\.dur\(seconds\)/, 7);
  fails(timeline([at({ op: 'dur', seconds: 1, line: 3, of: { op: 'osc', wave: 'sine', freq: 99999, line: 3 } }, 0, { line: 3 })]), /Frequency/, 3);
  fails(timeline([at(sine(1, 301), 0, { line: 4 })]), /A time/, 4);
  fails(timeline([at(sine(1, 1), 299.5, { line: 2 })]), /300 seconds/, undefined);
  fails(timeline([at({ op: 'nope', line: 9 }, 0, { line: 9 })]), /Unknown clip operation/, 9);
  let deep = sine(1, 1); for (let i = 0; i < 250; i++) deep = { op: 'gain', db: 0, of: deep };
  fails(timeline([at(deep)]), /nested too deeply/, undefined);
  assert.throws(() => AudioRenderer.render({ format: 'other' }), /version 1 timeline/);
  assert.throws(() => AudioRenderer.render(timeline([], { sampleRate: 12345 })), /Sample rate/);
});

test('rendering the same timeline twice gives identical bytes', () => {
  const tl = timeline([at({ op: 'mix', items: [sine(220, 1), { op: 'dur', seconds: 1, of: { op: 'filter', type: 'bandpass', freq: 900, q: 3, of: { op: 'noise' } } }] }, 0, { pan: 0.3 })]);
  assert.equal(sha(AudioRenderer.render(tl)), sha(AudioRenderer.render(tl)));
});

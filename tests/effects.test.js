const { test } = require('node:test');
const assert = require('node:assert/strict');
const AudioEffects = require('../src/effects.js');
const AudioRenderer = require('../src/audio-renderer.js');
const { render } = require('../scripts/node-python.cjs');

const R = 48000;
const tone = (seconds, amp = 0.5, freq = 440) => Float64Array.from({ length: Math.round(seconds * R) }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i / R));
const peak = ch => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (ch, a = 0, b = ch.length) => Math.sqrt(ch.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
const timeline = (placements, extra = {}) => ({ format: 'audio-timeline', version: 1, sampleRate: R, channels: 2, seed: 1, length: null, placements, tracks: {}, master: { gain: 0 }, ...extra });
const sine = (seconds, freq = 440) => ({ op: 'dur', seconds, of: { op: 'osc', wave: 'sine', freq } });
const at = (clip, time = 0, more = {}) => ({ clip, at: time, track: 'main', gain: 0, pan: 0, line: 1, label: 'x', ...more });

test('limiter never exceeds its ceiling; compressor reduces level above threshold', () => {
  const [limited] = AudioEffects.apply([{ type: 'limiter', ceiling: -6 }], [tone(0.5, 1.5)], R);
  assert.ok(peak(limited) <= 0.5011872336272722 + 1e-12, String(peak(limited)));
  const [loud] = AudioEffects.apply([{ type: 'compressor', threshold: -20, ratio: 4, attack: 0.001, release: 0.05 }], [tone(1, 0.9)], R);
  const [quiet] = AudioEffects.apply([{ type: 'compressor', threshold: -20, ratio: 4 }], [tone(1, 0.05)], R);
  assert.ok(rms(loud, R / 2) < 0.25, String(rms(loud, R / 2)));
  assert.ok(Math.abs(rms(quiet, R / 2) - rms(tone(1, 0.05), R / 2)) < 1e-9, 'below threshold is untouched');
});

test('delay and reverb extend by their tails; filters and drive keep length', () => {
  const input = [tone(0.1)];
  const tail = chain => AudioEffects.apply(chain, input, R)[0].length - input[0].length;
  assert.equal(tail([{ type: 'delay', time: 0.25, feedback: 0.5 }]), Math.round(AudioEffects.tail([{ type: 'delay', time: 0.25, feedback: 0.5 }]) * R));
  assert.equal(AudioEffects.tail([{ type: 'delay', time: 0.25, feedback: 0.5 }]), 0.25 * 10 + 0.25); // 0.5^10 < 0.001
  assert.equal(tail([{ type: 'reverb', room: 1 }]), 3.5 * R);
  assert.equal(tail([{ type: 'lowpass', freq: 500 }, { type: 'drive', amount: 3 }, { type: 'gain', db: -3 }]), 0);
  const [echo] = AudioEffects.apply([{ type: 'delay', time: 0.2, feedback: 0.5, mix: 0.5 }], input, R);
  assert.ok(rms(echo, 0.2 * R, 0.3 * R) > 0.1 && rms(echo, 0.1 * R, 0.2 * R) < 1e-9, 'the echo starts one delay later');
  const stereo = AudioEffects.apply([{ type: 'reverb', room: 0.5, width: 1 }], [tone(0.1), tone(0.1)], R);
  assert.equal(stereo.length, 2); assert.notDeepEqual(stereo[0].slice(R, R + 100), stereo[1].slice(R, R + 100));
  assert.throws(() => AudioEffects.apply([{ type: 'chorus' }], input, R), /Unknown effect/);
  assert.throws(() => AudioEffects.apply([{ type: 'reverb', room: 2 }], input, R), /Room must be a number from 0 to 1/);
});

test('automation interpolates in dB; ducking follows the key track', () => {
  const g = AudioEffects.automation([[0, -60], [1, 0]], R * 2, R);
  assert.ok(Math.abs(g[R / 2] - Math.pow(10, -30 / 20)) < 1e-12); assert.equal(g[R * 1.5], 1); assert.ok(g[0] < 0.0011);
  const key = [new Float64Array(R).fill(0)]; key[0].fill(0.5, R / 4, R / 2);
  const duck = AudioEffects.duck(key, R, R, { amount: -12, attack: 0.001, release: 0.05 });
  assert.equal(duck[R / 8], 1); assert.ok(Math.abs(duck[0.45 * R] - Math.pow(10, -12 / 20)) < 1e-3); assert.ok(duck[R - 1] > 0.99);
});

test('the renderer applies clip, track and master effects, track pan, tails and ducking order', () => {
  const r = AudioRenderer.render(timeline([at({ op: 'fx', chain: [{ type: 'reverb', room: 0.5 }], of: sine(0.5) })]));
  assert.equal(r.length, Math.round((0.5 + 2) * R)); assert.equal(r.clips[0].end, 2.5);
  const tracks = AudioRenderer.render(timeline([at(sine(1), 0, { track: 'a', pan: -1 }), at(sine(1), 0, { track: 'b' })], {
    tracks: { a: { fx: [{ type: 'delay', time: 0.5, feedback: 0 }], pan: 1 }, b: { duck: { under: 'a', amount: -20 } } }, master: { fx: [{ type: 'limiter', ceiling: -3 }] } }));
  assert.equal(tracks.length, 1.5 * R);
  assert.ok(peak(tracks.channels[0]) <= 0.7079457843841379 + 1e-6 && peak(tracks.channels[1]) <= 0.7079457843841379 + 1e-6);
  assert.deepEqual([...tracks.stems.keys()], ['a', 'b']);
  assert.ok(rms(tracks.stems.get('a')[0]) < 1e-9, 'track a is panned fully right');
  assert.ok(rms(tracks.stems.get('b')[0], 0.6 * R, 0.9 * R) < 0.06, 'b (rms 0.5 undecked) sits 20 dB down while a plays');
  const fails = (extra, pattern) => assert.throws(() => AudioRenderer.render(timeline([at(sine(1), 0, { track: 'a' }), at(sine(1), 0, { track: 'b' })], extra)), pattern);
  fails({ tracks: { a: { duck: { under: 'b' } }, b: { duck: { under: 'a' } } } }, /Ducking forms a loop/);
  fails({ tracks: { a: { duck: { under: 'zzz' } } } }, /has no clips/);
  fails({ master: { fx: [{ type: 'limiter', ceiling: 3 }] } }, /Ceiling/);
  // Muting a ducking key is a mix decision: the key still ducks, as on a console's sidechain.
  const mixed = AudioRenderer.mix(tracks.stems, ['b'], {}, R, 2, tracks.length);
  assert.equal(mixed.length, 2); assert.equal(mixed[0].length, tracks.length);
});

test('Python effects, tracks and the master describe the same chains, with checked arguments', { timeout: 120000 }, async () => {
  const scene = body => `from audio import *\n\nclass S(Scene):\n    def construct(self):\n${body.split('\n').map(line => '        ' + line).join('\n')}\n`;
  const { timeline, result } = await render(scene([
    'p = self.add(Sine(220).dur(0.5).fx(Reverb(room=0.2), Gain(-3)), track="music")',
    'self.tracks["music"].fx(Compressor(-24, 3), LowPass(4000)).pan(0.25).automate("gain", [(0, -6), (0.5, 0)])',
    'self.add(Noise().dur(0.3), track="noise").track',
    'self.track("noise").duck(under="music", amount=-6)',
    'self.master.fx(Limiter(-1)).gain(-1)'
  ].join('\n')));
  assert.deepEqual(timeline.placements[0].clip.chain, [{ type: 'reverb', room: 0.2, damp: 0.5, mix: 0.3, width: 1 }, { type: 'gain', db: -3 }]);
  assert.deepEqual(timeline.tracks.music, { gain: 0, mute: false, pan: 0.25, fx: [{ type: 'compressor', threshold: -24, ratio: 3, attack: 0.01, release: 0.15, makeup: 0 }, { type: 'lowpass', freq: 4000, q: 0.7071067811865476 }], automation: [[0, -6], [0.5, 0]] });
  assert.deepEqual(timeline.tracks.noise.duck, { under: 'music', amount: -6, threshold: -40, attack: 0.05, release: 0.3 });
  assert.deepEqual(timeline.master, { gain: -1, fx: [{ type: 'limiter', ceiling: -1, release: 0.05 }] });
  assert.ok(Math.abs(timeline.placements[0].clip.of.seconds - 0.5) < 1e-12);
  assert.equal(result.clips[0].end, 0.5 + 0.5 + 3 * 0.2);
  const fails = async (body, pattern, line) => assert.rejects(render(scene(body)), e => pattern.test(e.message) && (e.line ?? null) === line);
  await fails('Reverb(room=1.5)', /room must be at most 1/, 5);
  await fails('Sine(1).dur(1).fx("reverb")', /fx\(\) takes effects/, 5);
  await fails('self.master.duck(under="x")', /master cannot duck/, 5);
  await fails('self.track("a").automate("pan", [(0, 1)])', /only 'gain'/, 5);
  await fails('self.track("a").duck(under="a")', /names another track/, 5);
  await fails('self.add(Sine(1).dur(1), track="a")\nself.track("a").duck(under="b")\nself.track("b").duck(under="a")\nself.add(Sine(1).dur(1), track="b")', /Ducking forms a loop/, null);
});

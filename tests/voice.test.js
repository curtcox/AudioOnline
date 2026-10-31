const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const AudioVoice = require('../src/voice.js');
const { render, voices } = require('../scripts/node-python.cjs');

const scene = body => `from audio import *\n\nclass S(Scene):\n    def construct(self):\n${body.split('\n').map(line => '        ' + line).join('\n')}\n`;

test('the bundled voice files are the pinned releases', () => {
  const expected = {
    'svoxpico/svoxpico.js': '2e2d565f390d1ef351553558813ef82d5da28ced69454ce8cf030e60f04447e5',
    'svoxpico/svoxpico.wasm': '276a4e171734647f5d5edcc2a635df9b367867dc00848a8dc58120dd7004b0c6',
    'svoxpico/lang/en-US_ta.bin': '3a2a4d23de2a44dbbff50f69dcb9486be53b6d0a871d77cdc35f45c3e25e82aa',
    'svoxpico/lang/en-US_lh0_sg.bin': 'd6946526696d9eb085f7b23b1fbdf7a9986caca658b645e9eb73c6514fd4789d',
    'svoxpico/lang/en-GB_ta.bin': '57998f6423236dea25cd572a73b13f371e64155840e31b571eba7fca0b521b7e',
    'svoxpico/lang/en-GB_kh0_sg.bin': '8f9f5d13a920a9f3371517178d42ce89b835f1e587760c2db280beb593c388fa',
    'svoxpico/lang/de-DE_ta.bin': 'df292826754713d5efb6c95d60582c17753e95856b4c735c3150db722b2c218a',
    'svoxpico/lang/de-DE_gl0_sg.bin': '39147b816d08bbbe64b23797804cf691a761ab73a7689ca9e2b6f87ace722654',
    'svoxpico/lang/es-ES_ta.bin': 'b18c60baf249466bf8785d333d8cb4cf1f6b62e5545986f621c66568f1851961',
    'svoxpico/lang/es-ES_zl0_sg.bin': '82e724d3c788767ec95f0d22b0ab738e677ad397f26ec0bbbf2c07aafdf29000',
    'svoxpico/lang/fr-FR_ta.bin': 'd9da5eb3cd7aac7071ab8ff7fee8d716f58572ee5393c1f0a8db946d6bf32f97',
    'svoxpico/lang/fr-FR_nk0_sg.bin': '85e2d63cf9f5522ea2a483d25ddd1cb0c6bfeecc39c92884aecfe7d3f179837a',
    'svoxpico/lang/it-IT_ta.bin': '9b243c3470660293691d0d4e000901d7c5d0fa71976b33986e92e93a860ade33',
    'svoxpico/lang/it-IT_cm0_sg.bin': 'c48be4dc1f5a3c77a3dc4c8a457949b69bc433d674fac4fac91d49c01770e7e4'
  };
  for (const [file, sha] of Object.entries(expected)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync('vendor/' + file)).digest('hex'), sha, file);
  assert.deepEqual(Object.values(AudioVoice.LANGUAGES).flat().sort(), Object.keys(expected).filter(f => f.includes('/lang/')).map(f => f.split('/').pop()).sort());
});

test('every bundled language speaks; speed and pitch change the result deterministically', { timeout: 60000 }, async () => {
  await voices.load(AudioVoice.VOICES);
  for (const voice of AudioVoice.VOICES) {
    const b = voices.buffer({ op: 'speech', text: 'One, two, three.', voice });
    assert.equal(b.rate, 16000); assert.ok(b.frames > 8000, voice);
    assert.ok(b.channels[0].some(v => Math.abs(v) > 0.1) && b.channels[0].every(v => Math.abs(v) <= 1), voice);
  }
  const length = options => voices.measure({ op: 'speech', text: 'A longer sentence for timing.', voice: 'pico:en-US', ...options });
  assert.ok(length({ speed: 1.5 }) < length({}) && length({}) < length({ speed: 0.7 }));
  const fresh = new AudioVoice.Voices({ read: async f => { const b = fs.readFileSync('vendor/' + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }, readText: async f => fs.readFileSync('vendor/' + f, 'utf8'),
    importSource: async s => import('data:text/javascript;base64,' + Buffer.from(s).toString('base64')) });
  await fresh.load(['pico:en-US']);
  const node = { op: 'speech', text: 'Same bytes every time.', voice: 'pico:en-US', pitch: 1.2 };
  assert.deepEqual(fresh.buffer(node).channels[0], voices.buffer(node).channels[0]);
  // Angle brackets cannot inject Pico markup.
  assert.equal(fresh.measure({ op: 'speech', text: 'one <speed level="20">two</speed>', voice: 'pico:en-US' }), fresh.measure({ op: 'speech', text: 'one  speed level="20" two /speed ', voice: 'pico:en-US' }));
  assert.throws(() => fresh.buffer({ op: 'speech', text: 'x', voice: 'pico:de-DE' }), /VOICE_NOT_LOADED:pico:de-DE/);
  assert.throws(() => fresh.buffer({ op: 'speech', text: 'x', voice: 'pico:en-US', speed: 3 }), /speed must be from 0.5 to 2/);
  assert.throws(() => fresh.buffer({ op: 'speech', text: 'x'.repeat(5001), voice: 'pico:en-US' }), /5000 characters/);
});

test('say() places speech on the voice track and advances the cursor; voices named at run time load', { timeout: 120000 }, async () => {
  assert.deepEqual(AudioVoice.Voices.mentioned('self.say("hi")\nSpeech("x", voice="pico:it-IT")'), ['pico:it-IT', 'pico:en-US']);
  assert.deepEqual(AudioVoice.Voices.mentioned('print(1)'), []);
  const { timeline, result } = await render(scene([
    'self.say("First line.")',
    'self.wait(0.25)',
    'self.say("Zweite Zeile.", voice="pico:" + "de-DE", track="narrator", pitch=0.9)',
    'self.add(Speech("aside", speed=1.4), at=0.1, track="fx")'
  ].join('\n')));
  const [first, second] = result.clips;
  assert.deepEqual(result.tracks, ['voice', 'narrator', 'fx']);
  assert.ok(Math.abs(second.start - (first.end + 0.25)) < 1e-9);
  assert.equal(timeline.placements[1].clip.voice, 'pico:de-DE'); assert.equal(timeline.placements[1].line, 7);
  const fails = async (body, pattern, line) => assert.rejects(render(scene(body)), e => pattern.test(e.message) && e.line === line);
  await fails('self.say("")', /needs some text/, 5);
  await fails('self.say("hi", voice="kokoro:unknown")', /unknown voice/, 5);
  await fails('self.say("hi", speed=4)', /speed must be at most 2/, 5);
});

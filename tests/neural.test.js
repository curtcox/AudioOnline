const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { G2P, ipa, normalize, fallback } = require('../src/g2p.js');
const Neural = require('../src/neural-voice.js');
const pins = require('../src/neural-manifest.js');
const VoiceAssets = require('../src/voice-assets.js');
const AudioClient = require('../src/audio-client.js');
const sandbox = require('../src/audio-sandbox.js');

test('English normalization, dictionary variants, stress and original fallback', () => {
  assert.equal(ipa(['AH0', 'AA1', 'ER2', 'ER0', 'CH', 'DH', 'G', 'JH', 'NG', 'R', 'SH', 'TH', 'Y', 'ZH']), 'əˈɑˌɜɹɚʧðɡʤŋɹʃθjʒ');
  assert.equal(normalize('Dr. Cox has 1,234.56 & 07%.'), 'doctor Cox has one thousand two hundred thirty four point five six  and  zero seven percent .');
  const g = new G2P('hello HH AH0 L OW1\nhello(2) HH EH1 L OW0\nworld W ER1 L D\n');
  assert.equal(g.phonemes('Hello, world!'), 'həlˈoʊ , wˈɜɹld !');
  for (const word of ['codex', 'neural', 'phonic', 'glorp', 'knorp', 'shoop']) assert.ok(fallback(word).length > 0);
  assert.equal(fallback('make'), 'mˈeɪk');
  assert.equal(fallback('ship'), 'ʃˈɪp');
  assert.equal(g.phonemes('😊'), '');
});

test('missing models and utterances carry distinct retry markers; invalid options fail before loading', async () => {
  const engine = new Neural.NeuralVoices({ read: () => { throw new Error('unexpected download'); } });
  const node = { op: 'speech', voice: 'kitten:Bella', text: 'Hello' };
  assert.throws(() => engine.buffer(node), /VOICE_NOT_LOADED:kitten:Bella/);
  assert.deepEqual(engine.requested, node);
  engine.styles.set(node.voice, new Float32Array(256));
  assert.throws(() => engine.buffer(node), /NEURAL_UTTERANCE_NOT_READY/);
  await assert.rejects(engine.prepare({ ...node, speed: 3 }), /speed/);
  await assert.rejects(engine.prepare({ ...node, pitch: 1.2 }), /pitch=1/);
});

test('neural catalog agrees with Python and never joins Available offline', () => {
  const source = fs.readFileSync('src/py/audio.py', 'utf8');
  for (const voice of pins.voices) { assert.ok(source.includes('"' + voice + '"')); assert.ok(pins.files(voice).every(a => a.bytes > 0 && /^[a-f0-9]{64}$/.test(a.sha256))); }
  assert.throws(() => pins.files('kokoro:unknown'), /Unknown neural voice/);
  const offline = require('../offline-assets.js');
  for (const asset of Object.values(pins.assets)) assert.ok(!offline.assets.includes(asset.url));
  assert.match(fs.readFileSync('service-worker.js', 'utf8'), /name !== 'audioonline-voices-v1'/);
  assert.ok(sandbox.FILES.includes('neural-voice.js'));
});

test('chunks preserve punctuation, normalize before sentence splitting and bound both contexts', () => {
  const real = new G2P('three TH R IY1\npoint P OY1 N T\none W AH1 N\nfour F AO1 R\n');
  const decimals = Neural.chunks('3.14', real, false);
  assert.equal(decimals.length, 1); assert.match(decimals[0], /pˈɔɪnt/);
  const g = { phonemes: text => text };
  for (const kitten of [true, false]) {
    const chunks = Neural.chunks('a'.repeat(2000) + ' word. Some sentence!', g, kitten);
    assert.ok(chunks.length > 3);
    assert.ok(chunks.every(c => c.length <= (kitten ? 380 : 500)));
    assert.ok(chunks.join(' ').includes('Some sentence !') || chunks.join(' ').includes('Some sentence!'));
  }
});

// Use a small real response body to exercise consent, corruption recovery and storage failure.
const fixture = Buffer.from('verified voice bytes');
const asset = { url: 'https://example.test/model', bytes: fixture.length, sha256: crypto.createHash('sha256').update(fixture).digest('hex') };
async function withFixture(task) {
  const original = pins.files;
  pins.files = name => { assert.equal(name, 'kitten:Bella'); return [asset]; };
  try { await task(); } finally { pins.files = original; }
}
function storage() {
  const entries = new Map();
  return { entries, open: async name => { assert.equal(name, pins.CACHE); return {
    match: async url => entries.get(url)?.clone(), put: async (url, response) => entries.set(url, response), delete: async url => entries.delete(url)
  }; } };
}
test('consent precedes every uncached download; cached data is reverified; failed storage still works', async () => withFixture(async () => {
  let downloads = 0, approved = false; const cache = storage(), messages = [];
  const options = { storage: cache, confirm: message => { messages.push(message); return approved; }, fetch: async () => { downloads++; return new Response(fixture); } };
  const files = new VoiceAssets(options);
  await assert.rejects(files.ensure('kitten:Bella'), /cancelled/); assert.equal(downloads, 0);
  assert.match(messages[0], /not part of “Available offline”/);
  approved = true; await files.ensure('kitten:Bella'); assert.equal(downloads, 1);
  await files.ensure('kitten:Bella'); assert.equal(downloads, 1);
  const warm = new VoiceAssets(options); await warm.ensure('kitten:Bella'); assert.equal(downloads, 1);
  cache.entries.set(asset.url, new Response('tampered bytes'));
  await new VoiceAssets(options).ensure('kitten:Bella'); assert.equal(downloads, 2);
  const broken = new VoiceAssets({ ...options, storage: { open: async () => { throw new Error('quota'); } } });
  await broken.ensure('kitten:Bella'); assert.equal(downloads, 3);
  await assert.rejects(broken.fetch('https://example.test/unknown'), /confirmation/);
}));
test('hash failures and cancelled approvals never authorize assets', async () => withFixture(async () => {
  const files = new VoiceAssets({ storage: storage(), confirm: () => true, fetch: async () => new Response(Buffer.alloc(fixture.length)) });
  await assert.rejects(files.ensure('kitten:Bella'), /SHA-256/);
  const controller = new AbortController(); let downloads = 0;
  const stale = new VoiceAssets({ storage: storage(), confirm: () => { controller.abort(); return true; }, fetch: async () => { downloads++; } });
  await assert.rejects(stale.ensure('kitten:Bella', { signal: controller.signal }), /Cancelled/); assert.equal(downloads, 0);
}));

test('cancel while consent is pending cannot resume an obsolete worker', async () => {
  let approve, signal; const posted = [];
  const worker = { postMessage: data => posted.push(data), terminate() {} };
  const client = new AudioClient({ workerFactory: () => worker, onVoice: (_name, options) => { signal = options.signal; return new Promise(resolve => { approve = resolve; }); } });
  const run = client.run('source');
  worker.onmessage({ data: { id: 1, type: 'voice-request', voice: 'kitten:Bella' } });
  await Promise.resolve(); client.cancel(); approve();
  await assert.rejects(run, /Cancelled/); await Promise.resolve();
  assert.ok(signal.aborted); assert.equal(posted.length, 1);
});

test('the neural sandbox proxy delegates only its pinned prefixes and closes on cancellation', async () => {
  globalThis.AudioCore = require('../src/audio-core.js');
  let options; const fetched = [];
  const worker = sandbox.factory({ base: 'https://audio.hashbin.page/src/', fetchSource: async () => '',
    voiceAssets: { fetch: async url => { fetched.push(url); return new Response('verified'); } },
    loadSDK: async () => ({ createSandbox: value => { options = value; return { postMessage() {}, terminate() {} }; } }) })();
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(pins.prefixes.every(prefix => options.proxy.includes(prefix)));
    const url = pins.assets.kittenModel.url;
    assert.equal(await (await options.fetch(url)).text(), 'verified');
    assert.deepEqual(fetched, [url]);
    worker.terminate();
    assert.throws(() => options.fetch(url), /Cancelled/);
  } finally { worker.terminate(); delete globalThis.AudioCore; }
});

/* Sample("file.wav") and Sample(cid=…) with the actual Pyodide, renderer and WAV decoder. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Wav = require('../src/wav.js');
const AudioSamples = require('../src/samples.js');
const { HashBinStore, HashBinDocuments } = require('../src/hashbin.js');
const { render } = require('../scripts/node-python.cjs');

const scene = body => `from audio import *\n\nclass S(Scene):\n    def construct(self):\n${body.split('\n').map(line => '        ' + line).join('\n')}\n`;
const cidOf = bytes => {
  const size = Buffer.alloc(6); size.writeUIntBE(bytes.length, 0, 6);
  return size.toString('base64url') + Buffer.from(bytes.length <= 64 ? bytes : crypto.createHash('sha512').update(bytes).digest()).toString('base64url');
};
const ramp = (frames, rate = 8000) => Wav.encode([Float32Array.from({ length: frames }, (_, i) => i / frames - 0.5)], rate, 'pcm16');

test('uploaded files and CIDs decode with the WAV reader; missing ones name what to do', () => {
  const samples = new AudioSamples.Samples(), wav = ramp(800);
  samples.setFiles({ 'ramp.wav': Buffer.from(wav).toString('base64') });
  assert.equal(samples.measure({ op: 'sample', file: 'ramp.wav' }), 0.1);
  assert.throws(() => samples.buffer({ op: 'sample', file: 'other.wav' }), /No audio file named "other.wav"/);
  samples.setFiles({ 'bad.wav': Buffer.from('not a wav file').toString('base64') });
  assert.throws(() => samples.buffer({ op: 'sample', file: 'bad.wav' }), /bad\.wav: Not a WAV file/);
  assert.throws(() => samples.setFiles({ '../x.wav': '' }), /Invalid filename/);
  // Inline CIDs carry their bytes; larger ones must be added (verified) by the editor first.
  const tiny = ramp(10), inline = cidOf(tiny);
  assert.equal(samples.buffer({ op: 'sample', cid: inline }).frames, 10);
  const big = cidOf(wav);
  assert.throws(() => samples.buffer({ op: 'sample', cid: big }), error => AudioSamples.missingCid(error.message) === big);
  assert.throws(() => samples.add(big, wav.subarray(1)), /does not match its CID/);
  samples.add(big, wav);
  assert.equal(samples.buffer({ op: 'sample', cid: big }).frames, 800);
  assert.throws(() => samples.buffer({ op: 'sample', cid: 'nope' }), /valid HashBin CID/);
});

test('Sample clips place real audio, advance the cursor and keep error lines', { timeout: 120000 }, async () => {
  const wav = ramp(4000), files = { 'ramp.wav': Buffer.from(wav).toString('base64') }, inline = cidOf(ramp(10));
  const source = scene(`self.play(Sample("ramp.wav"), track="file")\nself.play(Sample(cid="${inline}").loop(400), track="cid")`);
  const { result, timeline, hash } = await render(source, {}, 'python', files);
  assert.equal(result.length, 48000);
  assert.deepEqual(result.tracks, ['file', 'cid']);
  assert.deepEqual(timeline.placements.map(p => p.at), [0, 0.5]);
  assert.ok(Math.abs(result.channels[0][24000 - 4800]) > 0.1, 'the file plays');
  assert.equal((await render(source, {}, 'python', files)).hash, hash, 'deterministic');
  await assert.rejects(render(scene('self.wait(1)\nself.play(Sample("missing.wav"))')), error => { assert.match(error.message, /No audio file named "missing\.wav"/); assert.equal(error.line, 6); return true; });
  await assert.rejects(render(scene('self.play(Sample())')), error => { assert.match(error.message, /needs a file name/); assert.equal(error.line, 5); return true; });
  const big = cidOf(wav);
  await assert.rejects(render(scene(`self.play(Sample(cid="${big}"))`)), error => AudioSamples.missingCid(error.message) === big && error.line === 5);
  assert.equal((await render(scene(`self.play(Sample(cid="${big}"))`), {}, 'python', {}, { [big]: wav })).result.length, 48000 * 0.5);
});

test('the editor fetches CID samples from 256t.us and verifies them before the sandbox sees them', async () => {
  const wav = ramp(800), big = cidOf(wav);
  let requested;
  const served = body => new HashBinStore({ fetchSource: async url => { requested = url; return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }; } });
  assert.deepEqual([...await served(wav).sample(big)], [...wav]);
  assert.equal(requested, `https://256t.us/${big}`);
  const tampered = Uint8Array.from(wav); tampered[100] ^= 1;
  await assert.rejects(served(tampered).sample(big), /does not match its CID/);
  const inline = cidOf(ramp(10));
  requested = null; assert.equal((await served(wav).sample(inline)).length, 64); assert.equal(requested, null, 'inline CIDs need no fetch');
  const huge = Buffer.alloc(6); huge.writeUIntBE(HashBinDocuments.MAX_SAMPLE_BYTES + 1, 0, 6);
  await assert.rejects(served(wav).sample(huge.toString('base64url') + 'A'.repeat(86)), /limited to 16 MiB/);
  await assert.rejects(new HashBinStore({ fetchSource: async () => ({ ok: false, status: 404 }) }).sample(big), /not found/);
});

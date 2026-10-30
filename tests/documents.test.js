const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { HashBinDocuments: Docs } = require('../src/hashbin.js');
const { ShareLinks, ShareClient } = require('../src/share-links.js');
const AudioFiles = require('../src/audio-files.js');
const { encodeQr, qrNotes } = require('../src/qr.js');
const lz = { compress: text => 'z' + Buffer.from(text).toString('base64url'), decompress: text => text[0] === 'z' ? Buffer.from(text.slice(1), 'base64url').toString() : null };
const wav = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

test('documents use the hashbin-audio format, normalize settings and still accept plain source', () => {
  const text = Docs.serialize({ src: 'from audio import *', settings: { sampleRate: 44100, channels: 1, scene: 'Intro', extra: 1 }, files: { 'kick.wav': wav } });
  assert.deepEqual(JSON.parse(text), { format: 'hashbin-audio', version: 1, src: 'from audio import *', type: 'python', settings: { sampleRate: 44100, channels: 1, scene: 'Intro' }, files: { 'kick.wav': wav } });
  assert.deepEqual(Docs.parse(text), { src: 'from audio import *', type: 'python', files: { 'kick.wav': wav }, settings: { sampleRate: 44100, channels: 1, scene: 'Intro' } });
  assert.deepEqual(Docs.parse('print(1)'), { src: 'print(1)', type: 'python', files: {}, settings: { sampleRate: 48000, channels: 2, scene: '' } });
  assert.deepEqual(Docs.parse('{"format":"other"}').src, '{"format":"other"}');
  assert.deepEqual(Docs.parse(JSON.stringify({ format: 'hashbin-audio', version: 1, src: 'x', type: 'python', settings: { sampleRate: 1, scene: 'bad name!' } })).settings, { sampleRate: 48000, channels: 2, scene: '' });
  assert.throws(() => Docs.parse(JSON.stringify({ format: 'hashbin-audio', version: 2, src: 'x', type: 'python' })), /Unsupported/);
  assert.throws(() => Docs.parse(JSON.stringify({ format: 'hashbin-audio', version: 1, src: 'x', type: 'abc' })), /newer version/);
  assert.throws(() => Docs.serialize({ src: 'x'.repeat(5 * 1024 * 1024 + 1) }), /5 MiB/);
});

test('audio files follow the shared name rules and size limits', () => {
  assert.ok(AudioFiles.validName('kick-01.wav')); assert.ok(AudioFiles.validName('A.WAV'));
  for (const name of ['scene.py', 'audio.py', 'x.txt', '../a.wav', 'a b.wav', '__proto__', 'x'.repeat(62) + '.wav', '.wav'.padStart(70, 'a')]) assert.equal(AudioFiles.validName(name), false, name);
  assert.throws(() => AudioFiles.validate({ 'a.wav': 'not base64!' }), /base64/);
  assert.throws(() => AudioFiles.validate({ 'a.wav': 'A'.repeat(4 * 1024 * 1024) }), /2 MiB/);
  assert.throws(() => AudioFiles.validate({ 'a.wav': 'A'.repeat(2700000), 'b.wav': 'A'.repeat(2700000) }), /5 MiB total/);
  assert.throws(() => AudioFiles.validate([]), /name-to-base64/);
});

test('share links round-trip source and whole documents, with fallbacks', () => {
  const url = 'https://audio.hashbin.page/?old=1#x';
  const plain = ShareLinks.build({ url, src: 'from audio import *\n', compress: lz.compress });
  assert.ok(new URL(plain.fallback).searchParams.has('compressed'));
  assert.equal(ShareLinks.parse(plain.fallback, lz.decompress).src, 'from audio import *\n');
  assert.equal(ShareLinks.parse(plain.long, lz.decompress).src, 'from audio import *\n');
  const doc = ShareLinks.build({ url, src: 'x = 1', settings: { sampleRate: 22050, scene: 'B' }, files: { 'a.wav': wav }, compress: lz.compress });
  for (const link of [doc.fallback, doc.long]) {
    const parsed = ShareLinks.parse(link, lz.decompress);
    assert.deepEqual([parsed.kind, parsed.src, parsed.settings.sampleRate, parsed.settings.scene, parsed.files['a.wav']], ['source', 'x = 1', 22050, 'B', wav]);
  }
  const broken = ShareLinks.build({ url, src: 'y', compress: () => { throw new Error('no'); } });
  assert.equal(broken.fallback, broken.long);
  assert.deepEqual(ShareLinks.parse('https://audio.hashbin.page/?example=hello', lz.decompress), { kind: 'example', id: 'hello' });
  assert.deepEqual(ShareLinks.parse('https://audio.hashbin.page/#hashbin_publish=1&cid=x', lz.decompress), { kind: 'publish' });
  assert.equal(ShareLinks.parse('https://audio.hashbin.page/', lz.decompress), null);
  assert.throws(() => ShareLinks.parse('https://audio.hashbin.page/?compressed=bad', lz.decompress), /decompressed/);
});

test('CIDs verify inline bytes and SHA-512 digests; links accept only HashBin hosts', async () => {
  const cid = text => { const data = Buffer.from(text), size = Buffer.alloc(6); size.writeUIntBE(data.length, 0, 6); return size.toString('base64url') + (data.length <= 64 ? data : createHash('sha512').update(data).digest()).toString('base64url'); };
  const short = 'from audio import *', long = 'x'.repeat(200);
  assert.ok(Docs.isCID(cid(short))); assert.ok(Docs.isCID(cid(long))); assert.equal(Docs.isCID('hello'), false);
  await Docs.verify(cid(long), Buffer.from(long));
  await assert.rejects(Docs.verify(cid(long), Buffer.from(long + 'y')), /does not match/);
  assert.equal(Docs.cid('https://audio.hashbin.page/#' + cid(short)), cid(short));
  assert.equal(Docs.cid('https://evil.example/#' + cid(short)), null);
  const link = Docs.link('https://audio.hashbin.page/?doc=1&compressed=2&keep=3', cid(short));
  assert.equal(link, 'https://audio.hashbin.page/?keep=3#' + cid(short));
});

test('QR encoder matches the known module grid and explains local or oversized links', () => {
  const qr = encodeQr('hello'); assert.equal(qr.version, 1);
  assert.equal(createHash('sha256').update(qr.modules.map(row => row.map(Number).join('')).join('\n')).digest('hex'), '69eec149521d0daf8dd3263acf22740ee26b4a844714a559cabedbf5de3f1bad');
  assert.equal(encodeQr('x'.repeat(4000)), null);
  assert.match(qrNotes('http://127.0.0.1:8000/', qr), /this computer/);
  assert.match(qrNotes('https://audio.hashbin.page/', null), /too long/);
});

test('link shortening stays bounded and only accepts is.gd results', async () => {
  const client = new ShareClient({ fetchLink: async () => ({ ok: true, json: async () => ({ contents: 'https://evil.example/x' }) }) });
  const result = await client.shorten({ long: 'https://audio.hashbin.page/#a', fallback: 'https://audio.hashbin.page/#a' });
  assert.equal(result.shortened, false); assert.match(result.error.message, /rejected/);
  const ok = new ShareClient({ fetchLink: async () => ({ ok: true, json: async () => ({ contents: 'https://is.gd/abc' }) }) });
  assert.deepEqual(await ok.shorten({ long: 'a', fallback: 'b' }), { url: 'https://is.gd/abc', shortened: true });
});

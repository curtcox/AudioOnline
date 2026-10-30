const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Zip = require('../src/zip.js');
const Spectrogram = require('../src/spectrogram.js');
const AudioClient = require('../src/audio-client.js');

test('stem ZIPs are valid stored archives with UTF-8 names and correct CRCs', () => {
  const files = [{ name: 'drums.wav', bytes: new Uint8Array([1, 2, 3]) }, { name: 'vocal-ö.wav', bytes: new TextEncoder().encode('hello') }];
  const zip = Zip.build(files), view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  let at = view.getUint32(end + 16, true);
  for (const file of files) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true), offset = view.getUint32(at + 42, true);
    assert.equal(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)), file.name);
    assert.equal(view.getUint32(at + 16, true), zlib.crc32(file.bytes));
    const data = offset + 30 + view.getUint16(offset + 26, true);
    assert.deepEqual(zip.subarray(data, data + size), file.bytes);
    at += 46 + nameLength;
  }
  assert.deepEqual(Zip.build(files), zip, 'fixed dates make archives reproducible');
});

test('the spectrogram puts a sine at its frequency row', () => {
  const rate = 48000, samples = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate));
  const width = 8, height = 64, pixels = Spectrogram.image(samples, rate, width, height);
  const brightness = y => { const p = (y * width + 4) * 4; return pixels[p] + pixels[p + 1] + pixels[p + 2]; };
  let best = 0; for (let y = 1; y < height; y++) if (brightness(y) > brightness(best)) best = y;
  const expected = Math.round((Math.log(24000) - Math.log(1000)) / (Math.log(24000) - Math.log(30)) * height - 0.5);
  assert.ok(Math.abs(best - expected) <= 1, `${best} vs ${expected}`);
  const re = Float64Array.of(1, 0, 0, 0), im = new Float64Array(4); Spectrogram.fft(re, im); assert.deepEqual([...re], [1, 1, 1, 1]);
});

test('mix and stem requests validate what the sandbox returns, and wait for renders', async () => {
  const ok = { sampleRate: 48000, length: 3, channels: [new Float32Array(3), new Float32Array(3)] };
  assert.equal(AudioClient.validateExtra(ok, 'mix').length, 3);
  assert.throws(() => AudioClient.validateExtra({ ...ok, channels: [new Float32Array(2)] }, 'mix'), /invalid mix/);
  assert.deepEqual(AudioClient.validateExtra({ sampleRate: 48000, length: 3, stems: [{ name: 'x'.repeat(80), channels: ok.channels }] }, 'stems').stems[0].name.length, 64);
  assert.throws(() => AudioClient.validateExtra({ sampleRate: 48000, length: 3, stems: [{ name: 1, channels: ok.channels }] }, 'stems'), /invalid stems/);
  const client = new AudioClient({ workerFactory: () => ({ postMessage() {}, terminate() {} }) });
  await assert.rejects(client.mix(['a']), /Render the scene first/);
  let posted; client.worker = { postMessage(data) { posted = data; queueMicrotask(() => this.onmessage({ data: { id: data.id, ...ok } })); } };
  assert.equal((await client.mix(['drums', 7])).length, 3); assert.deepEqual(posted.enabled, ['drums', '7']); assert.equal(posted.kind, 'mix');
  client.pending = { id: 99 }; await assert.rejects(client.stems(), /Render the scene first/);
});

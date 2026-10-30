const { test } = require('node:test');
const assert = require('node:assert/strict');
const Wav = require('../src/wav.js');

const ramp = n => Float32Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 - 1);

test('16-bit, 24-bit and float WAV round-trip with correct headers', () => {
  const left = ramp(101), right = left.map(v => -v / 2);
  for (const [format, bits, tag, tolerance] of [['pcm16', 16, 1, 2 / 32767], ['pcm24', 24, 1, 2 / 8388607], ['float32', 32, 3, 0]]) {
    const bytes = Wav.encode([left, right], 44100, format), view = new DataView(bytes.buffer);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF'); assert.equal(view.getUint32(4, true), bytes.length - 8);
    assert.equal(view.getUint16(20, true), tag); assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 44100);
    assert.equal(view.getUint16(34, true), bits); assert.equal(view.getUint32(40, true), 101 * 2 * bits / 8);
    const decoded = Wav.decode(bytes);
    assert.equal(decoded.sampleRate, 44100); assert.equal(decoded.channels.length, 2);
    for (let i = 0; i < 101; i++) {
      assert.ok(Math.abs(decoded.channels[0][i] - left[i]) <= tolerance + 1e-7, `${format} L${i}`);
      assert.ok(Math.abs(decoded.channels[1][i] - right[i]) <= tolerance + 1e-7, `${format} R${i}`);
    }
  }
});

test('integer formats clamp out-of-range and NaN samples; float keeps them', () => {
  const data = Float32Array.of(2, -2, NaN, 0.5);
  assert.deepEqual([...Wav.decode(Wav.encode([data], 8000, 'pcm16')).channels[0]].map(v => +v.toFixed(4)), [1, -1, 0, 0.5]);
  assert.equal(Wav.decode(Wav.encode([data], 8000, 'float32')).channels[0][0], 2);
  assert.throws(() => Wav.encode([], 8000), /1 or 2 channels/); assert.throws(() => Wav.encode([data], 8000, 'mp3'), /Unknown WAV format/);
});

test('decoding accepts 8-bit, 32-bit integer and extensible WAV, and rejects others', () => {
  const build = (tag, bits, samples, extensible = false) => {
    const fmtSize = extensible ? 40 : 16, width = bits / 8, data = samples.length * width;
    const view = new DataView(new ArrayBuffer(12 + 8 + fmtSize + 8 + data)), bytes = new Uint8Array(view.buffer);
    const ascii = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, fmtSize, true);
    view.setUint16(20, extensible ? 0xfffe : tag, true); view.setUint16(22, 1, true); view.setUint32(24, 22050, true); view.setUint16(34, bits, true);
    if (extensible) view.setUint16(44, tag, true);
    const d = 20 + fmtSize; ascii(d, 'data'); view.setUint32(d + 4, data, true);
    samples.forEach((s, i) => bits === 8 ? view.setUint8(d + 8 + i, s) : view.setInt32(d + 8 + 4 * i, s, true));
    return bytes;
  };
  assert.deepEqual([...Wav.decode(build(1, 8, [128, 255, 0])).channels[0]].map(v => +v.toFixed(3)), [0, 0.992, -1]);
  assert.deepEqual([...Wav.decode(build(1, 32, [1 << 30, -(1 << 30)], true)).channels[0]], [0.5, -0.5]);
  assert.throws(() => Wav.decode(build(2, 8, [0])), /Only mono or stereo PCM/);
  assert.throws(() => Wav.decode(new Uint8Array(20)), /Not a WAV file/);
  const truncated = build(1, 8, [1, 2, 3]); assert.throws(() => Wav.decode(truncated.subarray(0, truncated.length - 1)), /truncated/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AudioEncode = require('../src/encode.js');

function ebml(bytes, start = 0, end = bytes.length) {
  const out = [];
  for (let i = start; i < end;) {
    let idLength = 1; while (!(bytes[i] & (0x80 >> (idLength - 1)))) idLength++;
    let id = 0; for (let k = 0; k < idLength; k++) id = id * 256 + bytes[i + k];
    i += idLength;
    let sizeLength = 1; while (!(bytes[i] & (0x80 >> (sizeLength - 1)))) sizeLength++;
    let size = bytes[i] & (0xff >> sizeLength); for (let k = 1; k < sizeLength; k++) size = size * 256 + bytes[i + k];
    i += sizeLength;
    out.push({ id, start: i, size, data: bytes.subarray(i, i + size) }); i += size;
  }
  assert.equal(out.reduce((s, e) => s + e.size, 0) <= end - start, true);
  return out;
}
function boxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  for (let i = start; i < end;) { const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(i); out.push({ type: String.fromCharCode(...bytes.subarray(i + 4, i + 8)), start: i, size }); i += size; }
  return out;
}

test('EBML sizes use the shortest valid form', () => {
  assert.deepEqual([...AudioEncode.vint(0)], [0x80]); assert.deepEqual([...AudioEncode.vint(126)], [0xfe]);
  assert.deepEqual([...AudioEncode.vint(127)], [0x40, 0x7f]); assert.deepEqual([...AudioEncode.vint(16382)], [0x7f, 0xfe]); assert.deepEqual([...AudioEncode.vint(20000)], [0x20, 0x4e, 0x20]);
});

test('WebM: Opus track with OpusHead, codec delay and clusters of 16-bit relative block times', () => {
  const chunks = Array.from({ length: 600 }, (_, i) => ({ data: Uint8Array.of(i & 255, 1, 2), timestamp: i * 20000 })); // 20 ms frames, 12 s
  const file = AudioEncode.muxWebM({ chunks, channels: 2, sampleRate: 48000, description: null, durationSeconds: 12 });
  const [header, segment] = ebml(file);
  assert.equal(header.id, 0x1A45DFA3); assert.match(Buffer.from(header.data).toString('latin1'), /webm/);
  assert.equal(segment.id, 0x18538067); assert.equal(segment.start + segment.size, file.length);
  const children = ebml(file, segment.start, segment.start + segment.size);
  assert.deepEqual(children.map(c => c.id.toString(16)), ['1549a966', '1654ae6b', '1f43b675', '1f43b675', '1f43b675']);
  const track = ebml(file, children[1].start, children[1].start + children[1].size)[0], fields = ebml(file, track.start, track.start + track.size);
  const field = id => fields.find(f => f.id === id);
  assert.equal(Buffer.from(field(0x86).data).toString(), 'A_OPUS');
  assert.equal(Buffer.from(field(0x63A2).data.subarray(0, 8)).toString(), 'OpusHead'); assert.equal(field(0x63A2).data[9], 2);
  assert.equal(Buffer.from(field(0x56AA).data).readUIntBE(0, field(0x56AA).size), 6500000);
  const cluster = ebml(file, children[3].start, children[3].start + children[3].size);
  assert.equal(Buffer.from(cluster[0].data).readUIntBE(0, cluster[0].size), 5020); // second cluster starts after 5 s
  assert.equal(cluster.filter(e => e.id === 0xA3).length, 251);
  const last = cluster.filter(e => e.id === 0xA3).pop().data; assert.equal((last[1] << 8) | last[2], 5000); assert.equal(last[3], 0x80);
});

test('M4A: moov before mdat, AAC-LC sample entry and offsets that point at the frames', () => {
  const chunks = Array.from({ length: 10 }, (_, i) => ({ data: new Uint8Array(100 + i).fill(i), timestamp: i * 21333 }));
  const file = AudioEncode.muxM4A({ chunks, channels: 2, sampleRate: 44100, description: null });
  const top = boxes(file);
  assert.deepEqual(top.map(b => b.type), ['ftyp', 'moov', 'mdat']); assert.equal(top[2].start + top[2].size, file.length);
  const text = Buffer.from(file).toString('latin1');
  for (const type of ['mvhd', 'trak', 'tkhd', 'mdhd', 'hdlr', 'soun', 'smhd', 'stsd', 'mp4a', 'esds', 'stts', 'stsc', 'stsz', 'stco']) assert.ok(text.includes(type), type);
  assert.deepEqual([...AudioEncode.audioSpecificConfig(44100, 2)], [0x12, 0x10]);
  const stco = text.indexOf('stco'), offset = new DataView(file.buffer).getUint32(stco + 12);
  assert.equal(offset, top[2].start + 8); assert.equal(file[offset + 100], 1); // second frame begins after the first (100 bytes)
  const stsz = text.indexOf('stsz'); assert.equal(new DataView(file.buffer).getUint32(stsz + 12), 10); assert.equal(new DataView(file.buffer).getUint32(stsz + 16 + 4 * 9), 109);
});

test('AAC decoder configs are taken bare (Chromium) or out of an ES descriptor (WebKit)', () => {
  assert.deepEqual([...AudioEncode.decoderConfig(Uint8Array.of(17, 144))], [17, 144]);
  const webkit = Uint8Array.of(3, 128, 128, 128, 34, 0, 0, 0, 4, 128, 128, 128, 20, 64, 20, 0, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 128, 128, 128, 2, 17, 144, 6, 128, 128, 128, 1, 2);
  assert.deepEqual([...AudioEncode.decoderConfig(webkit)], [17, 144]);
  assert.equal(AudioEncode.decoderConfig(new Uint8Array()), null);
});

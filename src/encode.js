/* Compressed export on the editor origin: WebCodecs AudioEncoder (Opus everywhere, AAC where the browser
   has it), muxed here into WebM or M4A. Timestamps come from sample indices, never wall-clock time.
   Lossy files differ between browsers' encoders; the rendered PCM does not. */
(() => {
const concat = parts => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const ascii = text => Uint8Array.from(text, c => c.charCodeAt(0));
const uint = (value, bytes) => { const out = new Uint8Array(bytes); for (let i = bytes - 1; i >= 0; i--) { out[i] = value % 256; value = Math.floor(value / 256); } return out; };

// --- WebM (Matroska subset) ---
function vint(n) { // EBML size: the shortest form that leaves the all-ones value free
  for (let length = 1; length <= 8; length++) if (n < 2 ** (7 * length) - 1) { const out = uint(n, length); out[0] |= 1 << (8 - length); return out; }
  throw new Error('Element too large.');
}
const element = (id, ...children) => { const body = concat(children); return concat([uint(id, id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1), vint(body.length), body]); };
const uintElement = (id, value) => { let bytes = 1; while (value >= 2 ** (8 * bytes)) bytes++; return element(id, uint(value, bytes)); };
const floatElement = (id, value) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, value); return element(id, b); };
function opusHead(channels, rate, preSkip) {
  const b = new Uint8Array(19), v = new DataView(b.buffer);
  b.set(ascii('OpusHead')); b[8] = 1; b[9] = channels; v.setUint16(10, preSkip, true); v.setUint32(12, rate, true);
  return b;
}
/** chunks: [{ data, timestamp (µs) }] from an Opus encoder at 48 kHz. */
function muxWebM({ chunks, channels, sampleRate, description, durationSeconds }) {
  let head = description && description.byteLength >= 19 ? new Uint8Array(description) : opusHead(channels, sampleRate, 312);
  const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
  const header = element(0x1A45DFA3, uintElement(0x4286, 1), uintElement(0x42F7, 1), uintElement(0x42F2, 4), uintElement(0x42F3, 8),
    element(0x4282, ascii('webm')), uintElement(0x4287, 4), uintElement(0x4285, 2));
  const info = element(0x1549A966, uintElement(0x2AD7B1, 1000000), element(0x4D80, ascii('Audio Online')), element(0x5741, ascii('Audio Online')), floatElement(0x4489, durationSeconds * 1000));
  const track = element(0xAE, uintElement(0xD7, 1), uintElement(0x73C5, 1), uintElement(0x83, 2), element(0x86, ascii('A_OPUS')), element(0x63A2, head),
    uintElement(0x56AA, Math.round(preSkip / 48000 * 1e9)), uintElement(0x56BB, 80000000), element(0xE1, floatElement(0xB5, sampleRate), uintElement(0x9F, channels)));
  const clusters = [];
  for (let i = 0; i < chunks.length;) {
    const start = Math.round(chunks[i].timestamp / 1000), blocks = [];
    for (; i < chunks.length; i++) {
      const relative = Math.round(chunks[i].timestamp / 1000) - start;
      if (relative > 5000) break; // a cluster spans at most 5 s (relative times are 16-bit milliseconds)
      blocks.push(element(0xA3, Uint8Array.of(0x81, (relative >> 8) & 255, relative & 255, 0x80), chunks[i].data));
    }
    clusters.push(element(0x1F43B675, uintElement(0xE7, start), ...blocks));
  }
  return concat([header, element(0x18538067, info, element(0x1654AE6B, track), ...clusters)]);
}

// --- MP4 / M4A ---
const box = (type, ...children) => { const body = concat(children); return concat([uint(body.length + 8, 4), ascii(type), body]); };
const full = (type, version, flags, ...children) => box(type, uint(version, 1), uint(flags, 3), ...children);
const descriptor = (tag, ...children) => { const body = concat(children); return concat([Uint8Array.of(tag, 0x80, 0x80, 0x80, body.length), body]); };
function audioSpecificConfig(sampleRate, channels) {
  const index = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].indexOf(sampleRate);
  const value = (2 << 11) | (index << 7) | (channels << 3); // AAC-LC
  return Uint8Array.of(value >> 8, value & 255);
}
/** The AudioSpecificConfig: Chromium's description is exactly that; WebKit's wraps it in an ES descriptor. */
function decoderConfig(bytes) {
  if (!bytes || !bytes.length) return null;
  if (bytes[0] !== 3) return bytes;
  let i = 0;
  const header = () => { const tag = bytes[i++]; let size = 0, b; do { b = bytes[i++]; size = size * 128 + (b & 127); } while (b & 128 && i < bytes.length); return { tag, size }; };
  const es = header(); if (es.tag !== 3) return null;
  const flags = bytes[i + 2]; i += 3;
  if (flags & 0x80) i += 2; if (flags & 0x40) i += 1 + bytes[i]; if (flags & 0x20) i += 2;
  const config = header(); if (config.tag !== 4) return null;
  i += 13;
  const specific = header();
  return specific.tag === 5 ? bytes.slice(i, i + specific.size) : null;
}
/** chunks: [{ data, timestamp }] of raw AAC frames (1024 samples each). */
function muxM4A({ chunks, channels, sampleRate, description, bitrate = 192000 }) {
  const asc = decoderConfig(description && new Uint8Array(description)) || audioSpecificConfig(sampleRate, channels);
  const samples = chunks.length * 1024, sizes = chunks.map(c => c.data.length);
  const esds = full('esds', 0, 0, descriptor(3, uint(1, 2), Uint8Array.of(0),
    descriptor(4, Uint8Array.of(0x40, 0x15), uint(0, 3), uint(bitrate, 4), uint(bitrate, 4), descriptor(5, asc)), descriptor(6, Uint8Array.of(2))));
  const mp4a = box('mp4a', new Uint8Array(6), uint(1, 2), new Uint8Array(8), uint(channels, 2), uint(16, 2), new Uint8Array(4), uint(sampleRate * 65536 % 2 ** 32, 4), esds);
  const stbl = offset => box('stbl', full('stsd', 0, 0, uint(1, 4), mp4a), full('stts', 0, 0, uint(1, 4), uint(chunks.length, 4), uint(1024, 4)),
    full('stsc', 0, 0, uint(1, 4), uint(1, 4), uint(chunks.length, 4), uint(1, 4)), full('stsz', 0, 0, uint(0, 4), uint(chunks.length, 4), ...sizes.map(s => uint(s, 4))),
    full('stco', 0, 0, uint(1, 4), uint(offset, 4)));
  const matrix = concat([uint(0x10000, 4), uint(0, 4), uint(0, 4), uint(0, 4), uint(0x10000, 4), uint(0, 4), uint(0, 4), uint(0, 4), uint(0x40000000, 4)]);
  const moov = offset => box('moov',
    full('mvhd', 0, 0, uint(0, 8), uint(sampleRate, 4), uint(samples, 4), uint(0x10000, 4), uint(0x100, 2), new Uint8Array(10), matrix, new Uint8Array(24), uint(2, 4)),
    box('trak', full('tkhd', 0, 3, uint(0, 8), uint(1, 4), uint(0, 4), uint(samples, 4), new Uint8Array(8), uint(0, 4), uint(0x100, 2), uint(0, 2), matrix, uint(0, 4), uint(0, 4)),
      box('mdia', full('mdhd', 0, 0, uint(0, 8), uint(sampleRate, 4), uint(samples, 4), uint(0x55C4, 2), uint(0, 2)),
        full('hdlr', 0, 0, uint(0, 4), ascii('soun'), new Uint8Array(12), ascii('Audio Online\0')),
        box('minf', full('smhd', 0, 0, uint(0, 4)), box('dinf', full('dref', 0, 0, uint(1, 4), full('url ', 0, 1))), stbl(offset)))));
  const ftyp = box('ftyp', ascii('M4A '), uint(0, 4), ascii('M4A isommp42'));
  const size = moov(0).length, data = concat(chunks.map(c => c.data));
  // moov comes first so players can start before the whole file arrives; its offsets account for itself.
  return concat([ftyp, moov(ftyp.length + size + 8), uint(data.length + 8, 4), ascii('mdat'), data]);
}

const FORMATS = {
  opus: { label: 'Opus (.webm)', extension: 'webm', type: 'audio/webm', config: { codec: 'opus', bitrate: 128000 }, rates: [48000] },
  aac: { label: 'AAC (.m4a)', extension: 'm4a', type: 'audio/mp4', config: { codec: 'mp4a.40.2', bitrate: 192000, aac: { format: 'aac' } }, rates: [48000, 44100] }
};
const AudioEncode = {
  FORMATS, muxWebM, muxM4A, opusHead, audioSpecificConfig, decoderConfig, vint,
  /** Formats this browser can encode on this origin. */
  async supported(env = globalThis) {
    if (typeof env.AudioEncoder === 'undefined') return [];
    const out = [];
    for (const [name, f] of Object.entries(FORMATS)) {
      try { if ((await env.AudioEncoder.isConfigSupported({ ...f.config, sampleRate: 48000, numberOfChannels: 2 })).supported) out.push(name); } catch (_) { /* Unsupported. */ }
    }
    return out;
  },
  /** Opus needs 48 kHz; other rates are resampled for the lossy file only. */
  async resample(channels, from, to, env = globalThis) {
    if (from === to) return channels;
    const length = Math.ceil(channels[0].length * to / from), context = new env.OfflineAudioContext(channels.length, length, to);
    const buffer = context.createBuffer(channels.length, channels[0].length, from);
    channels.forEach((c, i) => buffer.getChannelData(i).set(c));
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
    const rendered = await context.startRendering();
    return Array.from({ length: channels.length }, (_, i) => rendered.getChannelData(i));
  },
  async encode(name, channels, sampleRate, env = globalThis) {
    const format = FORMATS[name];
    const rate = format.rates.includes(sampleRate) ? sampleRate : 48000;
    const input = await this.resample(channels, sampleRate, rate, env), frames = input[0].length, chunks = [];
    let description = null, failure = null;
    const encoder = new env.AudioEncoder({
      output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data, timestamp: chunk.timestamp }); if (meta?.decoderConfig?.description) description = meta.decoderConfig.description; },
      error: error => { failure = error; }
    });
    encoder.configure({ ...format.config, sampleRate: rate, numberOfChannels: input.length });
    const block = 4800;
    for (let start = 0; start < frames; start += block) {
      const n = Math.min(block, frames - start), data = new Float32Array(n * input.length);
      input.forEach((c, i) => data.set(c.subarray(start, start + n), i * n));
      encoder.encode(new env.AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: input.length, timestamp: Math.round(start * 1e6 / rate), data }));
    }
    await encoder.flush(); encoder.close();
    if (failure) throw new Error(`The ${format.label} encoder failed: ${failure.message}`);
    const options = { chunks, channels: input.length, sampleRate: rate, description: description && new Uint8Array(description instanceof ArrayBuffer ? description : description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength)), durationSeconds: frames / rate };
    return new env.Blob([name === 'opus' ? muxWebM(options) : muxM4A(options)], { type: format.type });
  }
};
if (typeof module !== 'undefined') module.exports = AudioEncode;
else globalThis.AudioEncode = AudioEncode;
})();

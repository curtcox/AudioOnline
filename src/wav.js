/* RIFF/WAVE encoding (16-bit, 24-bit PCM or 32-bit float) and PCM decoding. No dithering, so output is deterministic. */
(() => {
const Wav = {
  FORMATS: { pcm16: { bits: 16, tag: 1 }, pcm24: { bits: 24, tag: 1 }, float32: { bits: 32, tag: 3 } },
  encode(channels, sampleRate, format = 'pcm16') {
    const spec = this.FORMATS[format];
    if (!spec) throw new Error('Unknown WAV format.');
    if (!channels.length || channels.length > 2) throw new Error('WAV export supports 1 or 2 channels.');
    const frames = channels[0].length, bytes = spec.bits / 8, block = bytes * channels.length;
    const data = frames * block, out = new ArrayBuffer(44 + data), view = new DataView(out);
    const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + data, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, spec.tag, true); view.setUint16(22, channels.length, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * block, true); view.setUint16(32, block, true); view.setUint16(34, spec.bits, true);
    ascii(36, 'data'); view.setUint32(40, data, true);
    let offset = 44;
    for (let i = 0; i < frames; i++) for (const channel of channels) {
      const v = channel[i];
      if (format === 'float32') view.setFloat32(offset, v, true);
      else {
        const clamped = v !== v ? 0 : Math.max(-1, Math.min(1, v));
        if (format === 'pcm16') view.setInt16(offset, Math.round(clamped * 32767), true);
        else { const s = Math.round(clamped * 8388607); view.setUint8(offset, s & 255); view.setUint8(offset + 1, (s >> 8) & 255); view.setUint8(offset + 2, (s >> 16) & 255); }
      }
      offset += bytes;
    }
    return new Uint8Array(out);
  },
  /** Decodes PCM 8/16/24/32-bit integer or 32-bit float WAV, including WAVE_FORMAT_EXTENSIBLE. */
  decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (bytes.length < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('Not a WAV file.');
    let fmt = null, data = null;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const id = ascii(offset, 4), size = view.getUint32(offset + 4, true), body = offset + 8;
      if (body + size > bytes.length) throw new Error('The WAV file is truncated.');
      if (id === 'fmt ') fmt = { tag: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true),
        sub: size >= 26 ? view.getUint16(body + 24, true) : 0 };
      else if (id === 'data') data = { offset: body, size };
      offset = body + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('The WAV file has no format or data chunk.');
    const tag = fmt.tag === 0xfffe ? fmt.sub : fmt.tag;
    const supported = (tag === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (tag === 3 && fmt.bits === 32);
    if (!supported || fmt.channels < 1 || fmt.channels > 2) throw new Error('Only mono or stereo PCM (8–32-bit) and 32-bit float WAV files are supported.');
    if (fmt.rate < 8000 || fmt.rate > 192000) throw new Error('WAV sample rates must be 8–192 kHz.');
    const width = fmt.bits / 8, frames = Math.floor(data.size / (width * fmt.channels));
    const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
    let offset = data.offset;
    for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) {
      let v;
      if (tag === 3) v = view.getFloat32(offset, true);
      else if (fmt.bits === 8) v = (view.getUint8(offset) - 128) / 128;
      else if (fmt.bits === 16) v = view.getInt16(offset, true) / 32768;
      else if (fmt.bits === 24) { const s = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16); v = s / 8388608; }
      else v = view.getInt32(offset, true) / 2147483648;
      channels[c][i] = v; offset += width;
    }
    return { sampleRate: fmt.rate, channels };
  }
};
if (typeof module !== 'undefined') module.exports = Wav;
else globalThis.Wav = Wav;
})();

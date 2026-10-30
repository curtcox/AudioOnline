/* A minimal ZIP writer (stored entries, no compression) for downloading several files at once. */
(() => {
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const Zip = {
  crc32,
  /** files: [{ name, bytes: Uint8Array }] → Uint8Array of a ZIP archive (names are UTF-8; dates fixed for reproducibility). */
  build(files) {
    const encoder = new TextEncoder(), local = [], central = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), crc = crc32(file.bytes), size = file.bytes.length;
      if (size >= 0xffffffff || offset >= 0xffffffff) throw new Error('Stem downloads are limited to 4 GiB.');
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true); // UTF-8 names
      header.setUint16(10, 0, true); header.setUint16(12, 0x21, true); // 1980-01-01 00:00
      header.setUint32(14, crc, true); header.setUint32(18, size, true); header.setUint32(22, size, true); header.setUint16(26, name.length, true);
      local.push(new Uint8Array(header.buffer), name, file.bytes);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
      entry.setUint16(14, 0x21, true); entry.setUint32(16, crc, true); entry.setUint32(20, size, true); entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((s, part) => s + part.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const parts = [...local, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }
};
if (typeof module !== 'undefined') module.exports = Zip;
else globalThis.Zip = Zip;
})();

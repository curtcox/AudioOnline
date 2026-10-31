/** Uploaded WAV files, stored base64 in documents. Same name rules and limits as Gnuplot's data files. */
class AudioFiles {
  static MAX_FILE = 2 * 1024 * 1024;
  static MAX_TOTAL = 5 * 1024 * 1024;
  static RESERVED = ['.', 'scene.py', 'audio.py', '__proto__', 'constructor', 'prototype'];
  static validName(name) {
    return /^[A-Za-z0-9._-]{1,64}$/.test(name) && !name.includes('..') && /\.wav$/i.test(name) && !this.RESERVED.includes(name);
  }
  static bytes(text) { return new TextEncoder().encode(text).length; }
  static encode64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }
  static decodedSize(base64) { return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0); }
  static validate(files, source = '') {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Audio files must be a name-to-base64 object.');
    let total = this.bytes(source);
    for (const [name, data] of Object.entries(files)) {
      if (!this.validName(name)) throw new Error(`Invalid filename: ${name}. Use 1–64 letters, digits, dots, underscores or hyphens, ending in .wav; no '..'.`);
      if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4) throw new Error(`${name}: file data must be base64.`);
      if (this.decodedSize(data) > this.MAX_FILE) throw new Error(`${name} exceeds the 2 MiB file limit.`);
      total += data.length;
    }
    if (total > this.MAX_TOTAL) throw new Error('Source and files exceed the 5 MiB total limit.');
    return total;
  }
}
if (typeof module !== 'undefined') module.exports = AudioFiles;
else globalThis.AudioFiles = AudioFiles;

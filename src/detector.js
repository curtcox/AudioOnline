/* Chooses the renderer for a document. Python indicators are read with strings and comments blanked,
   so an ABC tune or pattern inside abc("…") or pattern("…") does not change the document type. */
(() => {
const PRESETS = ['pickupCoin', 'laserShoot', 'explosion', 'powerUp', 'hitHurt', 'jump', 'blipSelect', 'synth', 'tone', 'click', 'random'];
const AudioDetector = {
  TYPES: ['python', 'abc', 'zzfx', 'sfxr', 'pattern'],
  LABELS: { python: 'Python scene', abc: 'ABC tune', zzfx: 'ZzFX sounds', sfxr: 'sfxr sounds', pattern: 'Pattern' },
  /** Python strings (including triple-quoted) and # comments become spaces; line breaks are kept. */
  stripPython(code) {
    let out = '', i = 0;
    const blank = text => text.replace(/[^\n]/g, ' ');
    while (i < code.length) {
      const c = code[i];
      if (c === '#') { const end = code.indexOf('\n', i); const stop = end < 0 ? code.length : end; out += blank(code.slice(i, stop)); i = stop; continue; }
      if (c === '"' || c === "'") {
        const quote = code.startsWith(c.repeat(3), i) ? c.repeat(3) : c, start = i;
        i += quote.length;
        while (i < code.length && !code.startsWith(quote, i)) { if (code[i] === '\\') i++; else if (quote.length === 1 && code[i] === '\n') break; i++; }
        i = Math.min(code.length, i + quote.length);
        out += blank(code.slice(start, i)); continue;
      }
      out += c; i++;
    }
    return out;
  },
  detect(code) {
    const text = String(code || ''), trimmed = text.trim();
    if (!trimmed) return { type: 'python', reason: 'empty' };
    const executable = this.stripPython(text);
    if (/^\s*(?:from\s+[\w.]+\s+import\b|import\s+\w)|^\s*class\s+\w+\s*\(|^\s*def\s+\w+\s*\(|\bself\./m.test(executable)) return { type: 'python', reason: 'Python statements' };
    if (/^X:\s*\d+/m.test(text) && /^K:/m.test(text)) return { type: 'abc', reason: 'ABC X: and K: headers' };
    const lines = text.split('\n').map(line => line.replace(/(?:\/\/|#).*$/, '').trim()).filter(Boolean);
    if (/^[{[]/.test(trimmed) && /"(?:wave_type|p_env_attack|p_base_freq)"/.test(trimmed)) return { type: 'sfxr', reason: 'sfxr parameter JSON' };
    if (lines.length && lines.every(line => /^(?:[A-Za-z_]\w*\s*[:=]\s*)?(?:zzfx\s*\(\s*\.\.\.\s*)?\[[-\d.,\s]*\]\s*\)?\s*[,;]?$/.test(line))) return { type: 'zzfx', reason: 'ZzFX parameter arrays' };
    if (lines.length && lines.every(line => new RegExp(`^(?:[A-Za-z_][\\w-]*\\s*[:=]\\s*)?(?:${PRESETS.join('|')})(?:\\s+\\d+)?$`).test(line))) return { type: 'sfxr', reason: 'sfxr presets' };
    if (lines.some(line => /^(?:bpm|cycles)\s*[:=]?\s*\d/i.test(line) || /^[A-Za-z][\w-]*(?:\([a-z]+\))?\s*:\s*\S/.test(line) && !/^[A-Z]:/.test(line))) return { type: 'pattern', reason: 'pattern lines' };
    return { type: 'python', reason: 'default' };
  }
};
if (typeof module !== 'undefined') module.exports = AudioDetector;
else globalThis.AudioDetector = AudioDetector;
})();

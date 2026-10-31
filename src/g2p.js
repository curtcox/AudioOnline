/* Original English text normalizer and CMUdict ARPAbet → IPA front end (no eSpeak/GPL code).
   Unknown words use context rules in the spirit of the public-domain NRL letter-to-sound method;
   this compact fallback is deliberately approximate, not a reproduction of the NRL rule table. */
(() => {
const vowels = { AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɜɹ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u' };
const consonants = { CH: 'ʧ', DH: 'ð', G: 'ɡ', HH: 'h', JH: 'ʤ', NG: 'ŋ', R: 'ɹ', SH: 'ʃ', TH: 'θ', Y: 'j', ZH: 'ʒ' };
function ipa(phones) {
  return phones.map(phone => {
    const match = /^([A-Z]+)([012]?)$/.exec(phone);
    if (!match) return '';
    const [, base, stress] = match;
    if (!vowels[base]) return consonants[base] || base.toLowerCase();
    return (stress === '1' ? 'ˈ' : stress === '2' ? 'ˌ' : '') + (base === 'AH' && stress === '0' ? 'ə' : base === 'ER' && stress === '0' ? 'ɚ' : vowels[base]);
  }).join('');
}
const small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function integer(value) {
  if (value < 20) return small[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? ' ' + small[value % 10] : '');
  if (value < 1000) return small[Math.floor(value / 100)] + ' hundred' + (value % 100 ? ' ' + integer(value % 100) : '');
  for (const [scale, label] of [[1e9, 'billion'], [1e6, 'million'], [1000, 'thousand']]) {
    if (value >= scale) return integer(Math.floor(value / scale)) + ' ' + label + (value % scale ? ' ' + integer(value % scale) : '');
  }
}
function normalize(text) {
  const abbr = { mr: 'mister', mrs: 'missus', ms: 'miz', dr: 'doctor', prof: 'professor', sr: 'senior', jr: 'junior', st: 'saint', etc: 'et cetera', vs: 'versus' };
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|etc|vs)\./gi, (_, s) => abbr[s.toLowerCase()])
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, s => s.replace(/,/g, ''))
    .replace(/-?\d+(?:\.\d+)?/g, s => {
      const negative = s.startsWith('-'); if (negative) s = s.slice(1);
      const [whole, fraction] = s.split('.');
      const words = whole.length > 12 || (whole.length > 1 && whole[0] === '0') ? [...whole].map(n => small[+n]).join(' ') : integer(+whole);
      return (negative ? 'minus ' : '') + words + (fraction ? ' point ' + [...fraction].map(n => small[+n]).join(' ') : '');
    }).replace(/&/g, ' and ').replace(/%/g, ' percent ');
}
function fallback(word) {
  const digraph = { tion: 'ʃən', sion: 'ʒən', tch: 'ʧ', dge: 'ʤ', igh: 'aɪ', ch: 'ʧ', sh: 'ʃ', th: 'θ', ph: 'f', ng: 'ŋ', ck: 'k', qu: 'kw', ee: 'i', ea: 'i', oo: 'u', ai: 'eɪ', ay: 'eɪ', oa: 'oʊ', ow: 'aʊ', oi: 'ɔɪ', oy: 'ɔɪ', ou: 'aʊ', er: 'ɚ', ir: 'ɚ', ur: 'ɚ', ar: 'ɑɹ', or: 'ɔɹ' };
  const letter = { a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɑ', u: 'ʌ', c: 'k', g: 'ɡ', j: 'ʤ', q: 'k', r: 'ɹ', x: 'ks', y: 'j' };
  word = word.toLowerCase().replace(/^kn/, 'n').replace(/^wr/, 'r');
  let out = '', stressed = false;
  for (let i = 0; i < word.length;) {
    if (word[i] === "'") { i++; continue; }
    if (word[i] === 'e' && i === word.length - 1 && word.length > 2) break;
    let sound, count = 1;
    for (const n of [4, 3, 2]) if (digraph[word.slice(i, i + n)]) { sound = digraph[word.slice(i, i + n)]; count = n; break; }
    if (!sound) {
      const c = word[i], next = word[i + 1] || '';
      sound = c === 'c' && /[eiy]/.test(next) ? 's' : c === 'g' && /[eiy]/.test(next) ? 'ʤ' : letter[c] || c;
      if (/[aeiou]/.test(c) && i + 2 === word.length - 1 && word.endsWith('e')) sound = { a: 'eɪ', e: 'i', i: 'aɪ', o: 'oʊ', u: 'u' }[c];
      if (i && c === word[i - 1] && !/[aeiou]/.test(c)) sound = '';
    }
    if (!stressed && /[aeiouæɛɪɑʌɔɚ]/.test(sound)) { out += 'ˈ'; stressed = true; }
    out += sound; i += count;
  }
  return out;
}
class G2P {
  constructor(dictionary) {
    this.words = new Map();
    for (const line of dictionary.split('\n')) {
      const [word, ...phones] = line.trim().split(/\s+/);
      if (!word || word.startsWith(';;;') || /\(\d+\)$/.test(word)) continue;
      if (!this.words.has(word.toLowerCase())) this.words.set(word.toLowerCase(), ipa(phones.filter(p => /^[A-Z]+[012]?$/.test(p))));
    }
  }
  phonemes(text) {
    return (normalize(text).match(/[a-z]+(?:'[a-z]+)*|[^\w\s]/gi) || []).map(token => {
      if (!/^[a-z]/i.test(token)) return /[;:,.!?—…"()]/.test(token) ? token : '';
      return this.words.get(token.toLowerCase()) || fallback(token);
    }).filter(Boolean).join(' ');
  }
}
const api = { G2P, ipa, normalize, fallback };
if (typeof module !== 'undefined') module.exports = api; else globalThis.AudioG2P = api;
})();

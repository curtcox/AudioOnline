/* An original implementation of a Tidal-style pattern mini-notation subset (not Strudel; see the Step 1 report).
   A pattern divides each cycle among its steps:
     bd sn        two steps            ~            rest
     [bd sn] hh   subdivision          bd*3         repeat inside the step
     <bd sn cp>   one per cycle        bd/2         every second cycle
     bd!3         three steps          bd(3,8)      Euclidean rhythm (optional rotation: bd(3,8,2))
     [bd, hh*2]   play together        bd@3 sn      bd takes 3 of 4 parts
   Events have start and duration in cycles. Parsing errors report the 1-based column. */
(() => {
class PatternError extends Error {
  constructor(message, column) { super(column ? `${message} (column ${column})` : message); this.column = column; }
}

function parse(text) {
  let i = 0;
  const peek = () => text[i], eat = c => { if (text[i] !== c) throw new PatternError(`Expected "${c}"`, i + 1); i++; };
  const space = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const number = () => {
    const m = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    if (!m) throw new PatternError('Expected a number', i + 1);
    i += m[0].length; return Number(m[0]);
  };
  function sequence(end) {
    const steps = [];
    space();
    while (i < text.length && !end.includes(peek())) {
      const step = atom();
      steps.push(...modifiers(step));
      space();
    }
    return steps;
  }
  function stack(close) {
    const layers = [sequence([',', close])];
    while (peek() === ',') { i++; layers.push(sequence([',', close])); }
    eat(close);
    return layers;
  }
  function atom() {
    const column = i + 1, c = peek();
    if (c === '[') { i++; return { type: 'stack', layers: stack(']'), column }; }
    if (c === '<') { i++; const items = sequence(['>']); eat('>'); if (!items.length) throw new PatternError('Empty < >', column); return { type: 'alt', items, column }; }
    if (c === '~') { i++; return { type: 'rest', column }; }
    const m = /^[A-Za-z][A-Za-z0-9#_.-]*/.exec(text.slice(i));
    if (!m) throw new PatternError(`Unexpected "${c}"`, column);
    i += m[0].length;
    return { type: 'sound', name: m[0], column };
  }
  function modifiers(step) {
    let steps = [{ ...step, weight: 1 }];
    for (;;) {
      const c = peek();
      if (c === '*') { i++; steps = steps.map(s => ({ ...s, fast: (s.fast || 1) * number() })); }
      else if (c === '/') { i++; steps = steps.map(s => ({ ...s, slow: (s.slow || 1) * number() })); }
      else if (c === '@') { i++; const w = number(); steps = steps.map(s => ({ ...s, weight: w })); }
      else if (c === '!') {
        i++; const n = /\d/.test(peek() || '') ? number() : 2;
        if (!Number.isInteger(n) || n < 1 || n > 64) throw new PatternError('Use !2 to !64', i);
        steps = Array.from({ length: n }, () => steps).flat().map(s => ({ ...s }));
      } else if (c === '(') {
        i++; space(); const k = number(); space(); eat(','); space(); const n = number(); space();
        let rotate = 0; if (peek() === ',') { i++; space(); rotate = number(); space(); }
        eat(')');
        if (!Number.isInteger(k) || !Number.isInteger(n) || n < 1 || n > 64 || k < 0 || k > n) throw new PatternError('Euclidean rhythms need 0 ≤ k ≤ n ≤ 64', i);
        steps = steps.map(s => ({ ...s, euclid: [k, n, Math.round(rotate)] }));
      } else return steps;
    }
  }
  // Top-level commas stack layers, as inside brackets: "bd sn, hh*8".
  const layers = [sequence([','])];
  while (peek() === ',') { i++; layers.push(sequence([','])); }
  if (i < text.length) throw new PatternError(`Unexpected "${text[i]}"`, i + 1);
  return layers.length === 1 ? layers[0] : [{ type: 'stack', layers, weight: 1, column: 1 }];
}

/** Bjorklund's distribution of k onsets over n steps, as booleans. */
function euclid(k, n, rotate = 0) {
  let a = Array.from({ length: k }, () => [true]), b = Array.from({ length: n - k }, () => [false]);
  while (a.length && b.length > 1) {
    const m = Math.min(a.length, b.length), paired = [];
    for (let j = 0; j < m; j++) paired.push(a[j].concat(b[j]));
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = paired; b = rest;
  }
  const out = a.concat(b).flat();
  const r = ((rotate % n) + n) % n;
  return out.slice(r).concat(out.slice(0, r));
}

/** Events for one cycle of a step list, scaled into [start, start + span). */
function query(steps, cycle, start, span, out) {
  const total = steps.reduce((sum, s) => sum + s.weight, 0);
  let at = start;
  for (const step of steps) {
    const width = span * step.weight / total;
    place(step, cycle, at, width, out);
    at += width;
  }
}
function place(step, cycle, start, span, out) {
  if (step.slow && cycle % step.slow !== 0) return;
  const inner = step.slow ? Math.floor(cycle / step.slow) : cycle;
  const fast = step.fast || 1;
  if (step.euclid) {
    const [k, n, rotate] = step.euclid, hits = euclid(k, n, rotate);
    hits.forEach((hit, j) => { if (hit) one({ ...step, euclid: null, fast: 1, slow: 0 }, inner, start + span * j / n, span / n, out); });
    return;
  }
  for (let r = 0; r < fast; r++) one(step, inner * fast + r, start + span * r / fast, span / fast, out);
}
function one(step, cycle, start, span, out) {
  if (step.type === 'rest') return;
  if (step.type === 'sound') { out.push({ name: step.name, start, dur: span, column: step.column }); return; }
  if (step.type === 'alt') { place(step.items[cycle % step.items.length], Math.floor(cycle / step.items.length), start, span, out); return; }
  for (const layer of step.layers) query(layer, cycle, start, span, out);
}

const MiniNotation = {
  PatternError, parse, euclid,
  /** Events for cycles [0, cycles), sorted by start; times in cycles. */
  events(text, cycles = 1) {
    const steps = parse(text), out = [];
    for (let c = 0; c < cycles; c++) {
      const before = out.length; query(steps, c, 0, 1, out);
      for (let k = before; k < out.length; k++) out[k].start += c;
    }
    if (out.length > 20000) throw new PatternError('Patterns are limited to 20,000 events.');
    return out.sort((a, b) => a.start - b.start);
  }
};
if (typeof module !== 'undefined') module.exports = MiniNotation;
else globalThis.MiniNotation = MiniNotation;
})();

/* Deterministic math. Engines implement Math.sin/exp/log/tanh with different libms (docs/step1-report.md
   §2.2), so rendering uses only IEEE-754 basic operations (+ − × ÷), Math.floor/round/abs and exact
   power-of-two scaling. The same inputs give identical bits in every engine. Accuracy is ~1e-15. */
(() => {
const LN2 = 0.6931471805599453;
// ln 2 and π/2 split so that k·HI is exact for the integer multiples used in range reduction.
const LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10;
const PIO2_1 = 1.5707963267341256, PIO2_2 = 6.077100506506192e-11, PIO2_3 = 2.0222662487111665e-21;
const SQRT2 = 1.4142135623730951, LN10 = 2.302585092994046;
const view = new DataView(new ArrayBuffer(8));

function pow2(k) { // exact 2^k for −1022 ≤ k ≤ 1023
  view.setUint32(0, (k + 1023) << 20); view.setUint32(4, 0);
  return view.getFloat64(0);
}
function scale(x, k) {
  while (k > 1023) { x *= pow2(1023); k -= 1023; }
  while (k < -1022) { x *= pow2(-1022); k += 1022; }
  return x * pow2(k);
}
function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;
  const k = Math.round(x / LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  return scale(taylorExp(r), k);
}
function taylorExp(r) { // |r| ≤ ln2/2, so terms past n = 16 are below 1e-24
  let term = 1, sum = 1;
  for (let n = 1; n <= 16; n++) { term = term * r / n; sum += term; }
  return sum;
}
function log(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < 2.2250738585072014e-308) { x *= pow2(54); e = -54; }
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  e += ((hi >>> 20) & 0x7ff) - 1023;
  view.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);
  let m = view.getFloat64(0);
  if (m > SQRT2) { m /= 2; e += 1; }
  // log m = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716.
  const s = (m - 1) / (m + 1), s2 = s * s;
  let term = s, sum = s;
  for (let n = 3; n <= 31; n += 2) { term *= s2; sum += term / n; }
  return e * LN2_HI + (2 * sum + e * LN2_LO);
}
function kernelSin(r) { // |r| ≤ π/4
  const r2 = r * r;
  let term = r, sum = r;
  for (let n = 2; n <= 18; n += 2) { term = -term * r2 / (n * (n + 1)); sum += term; }
  return sum;
}
function kernelCos(r) {
  const r2 = r * r;
  let term = 1, sum = 1;
  for (let n = 1; n <= 17; n += 2) { term = -term * r2 / (n * (n + 1)); sum += term; }
  return sum;
}
function reduce(x) {
  const n = Math.round(x / (PIO2_1 + PIO2_2));
  return [((x - n * PIO2_1) - n * PIO2_2) - n * PIO2_3, n];
}
function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  const [r, n] = reduce(x), q = ((n % 4) + 4) % 4;
  return q === 0 ? kernelSin(r) : q === 1 ? kernelCos(r) : q === 2 ? -kernelSin(r) : -kernelCos(r);
}
function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  const [r, n] = reduce(x), q = ((n % 4) + 4) % 4;
  return q === 0 ? kernelCos(r) : q === 1 ? -kernelSin(r) : q === 2 ? -kernelCos(r) : kernelSin(r);
}
/** sin(2π·turns), reduced in turns first so long-running phases stay exact. */
function sinTurns(turns) { return sin(6.283185307179586 * (turns - Math.round(turns))); }
function tanh(x) {
  if (x !== x) return NaN;
  if (x > 22) return 1;
  if (x < -22) return -1;
  if (Math.abs(x) < 1e-9) return x;
  const e = exp(2 * x);
  return (e - 1) / (e + 1);
}
function pow(a, b) {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) {
    if (!Number.isInteger(b)) return NaN;
    const v = exp(b * log(-a));
    return Math.abs(b % 2) === 1 ? -v : v;
  }
  return exp(b * log(a));
}
const dbToGain = db => db === -Infinity ? 0 : exp(db * (LN10 / 20));
const DMath = { exp, log, sin, cos, sinTurns, tanh, pow, dbToGain, PI: 3.141592653589793 };
if (typeof module !== 'undefined') module.exports = DMath;
else globalThis.DMath = DMath;
})();

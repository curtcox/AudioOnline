/* Spectrogram for the preview (display only; it never affects rendered bytes). One 2048-point FFT per
   column, Hann window, log-frequency rows from 30 Hz to Nyquist, −100…0 dBFS mapped to a color ramp. */
(() => {
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let size = 2; size <= n; size <<= 1) {
    const step = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < size / 2; k++) {
      const wr = Math.cos(step * k), wi = Math.sin(step * k), a = start + k, b = a + size / 2;
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
// Dark violet → magenta → orange → pale yellow.
const STOPS = [[16, 10, 40], [80, 30, 140], [190, 50, 140], [250, 130, 60], [255, 240, 180]];
function color(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}
const Spectrogram = {
  fft, color,
  /** RGBA pixels (width × height) for mono samples; a width-length array of columns. */
  image(samples, rate, width, height, size = 2048) {
    const pixels = new Uint8ClampedArray(width * height * 4), window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    const re = new Float64Array(size), im = new Float64Array(size), low = Math.log(30), high = Math.log(rate / 2);
    const bins = Array.from({ length: height }, (_, y) => Math.min(size / 2 - 1, Math.max(1, Math.round(Math.exp(high - (high - low) * (y + 0.5) / height) / rate * size))));
    for (let x = 0; x < width; x++) {
      const center = Math.floor((x + 0.5) * samples.length / width);
      for (let i = 0; i < size; i++) { const k = center - size / 2 + i; re[i] = (k >= 0 && k < samples.length ? samples[k] : 0) * window[i]; im[i] = 0; }
      fft(re, im);
      for (let y = 0; y < height; y++) {
        const k = bins[y], magnitude = Math.hypot(re[k], im[k]) * 4 / size, db = 20 * Math.log10(magnitude + 1e-12);
        const [r, g, b] = color((db + 100) / 100), p = (y * width + x) * 4;
        pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
      }
    }
    return pixels;
  }
};
if (typeof module !== 'undefined') module.exports = Spectrogram;
else globalThis.Spectrogram = Spectrogram;
})();

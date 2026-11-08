/* Renders the gallery covers (PNG: waveform over spectrogram) and short AAC previews for every example.
   Audio comes from the same Pyodide and deterministic renderer as tests/golden.json; AAC encoding uses
   src/encode.js in Playwright Chromium (WebCodecs). Unchanged examples are skipped by fingerprint.
   Usage: node scripts/render-gallery.mjs [--check] [--force] [example ids…]
   --check renders nothing and fails if any asset is missing or stale. Neural-voice examples get a cover
   rendered with the bundled voice and no preview. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { catalog } = require('../src/examples.js');
const Spectrogram = require('../src/spectrogram.js');
const output = path.join(root, 'gallery/previews'), manifestPath = path.join(output, 'manifest.json');
const args = process.argv.slice(2), check = args.includes('--check'), force = args.includes('--force'), selected = args.filter(a => !a.startsWith('--'));
const PREVIEW_SECONDS = 12, WIDTH = 480, HEIGHT = 270, WAVE = 96;

// Anything that can change the rendered audio or the way assets are drawn.
const RUNTIME = ['src/py/audio.py', 'src/audio-python.js', 'src/audio-renderer.js', 'src/dmath.js', 'src/effects.js', 'src/instruments.js',
  'src/sample-cid.js', 'vendor/fragment-kit-v0.3.5/src/core/cid.js', 'vendor/fragment-kit-v0.3.5/src/core/bytes.js', 'src/notation.js', 'src/mini-notation.js', 'src/voice.js', 'src/samples.js', 'src/wav.js', 'src/audio-core.js', 'src/spectrogram.js',
  'src/encode.js', 'scripts/node-python.cjs', 'scripts/render-gallery.mjs', 'package-lock.json'];
const VENDOR = ['vendor/abcjs', 'vendor/zzfx', 'vendor/jsfxr', 'vendor/svoxpico'];
const files = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
const runtime = createHash('sha256');
for (const file of [...RUNTIME, ...VENDOR.flatMap(files)]) runtime.update(file).update(fs.readFileSync(path.join(root, file)));
const RUNTIME_HASH = runtime.digest('hex');
const fingerprint = sample => createHash('sha256').update(JSON.stringify({ source: sample.source, type: sample.type || 'python', files: sample.files || {}, neural: sample.neural || null, runtime: RUNTIME_HASH })).digest('hex');
const assets = sample => [`${sample.id}.png`, ...(sample.neural ? [] : [`${sample.id}.m4a`])];

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const stale = catalog.filter(sample => (!selected.length || selected.includes(sample.id)) &&
  (force || selected.length || manifest[sample.id] !== fingerprint(sample) || !assets(sample).every(file => fs.existsSync(path.join(output, file)))));
const orphans = Object.keys(manifest).filter(id => !catalog.some(sample => sample.id === id));
if (check) {
  if (stale.length || orphans.length) {
    console.error(`Stale gallery assets: ${[...stale.map(s => s.id), ...orphans].join(', ')}. Run node scripts/render-gallery.mjs.`);
    process.exit(1);
  }
  console.log(`Gallery assets are current for ${catalog.length} examples.`);
  process.exit(0);
}

// PNG: 8-bit RGBA, filter 0 rows, zlib-deflated; enough for covers.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgba, width, height) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function cover(channels, rate) {
  const n = channels[0].length, mono = new Float64Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let p = 0; p < WIDTH * WAVE * 4; p += 4) pixels.set([255, 255, 255, 255], p);
  let peak = 0; for (const v of mono) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 1e-9 ? 1 / Math.max(peak, 0.25) : 1, mid = WAVE / 2;
  for (let x = 0; x < WIDTH; x++) {
    let lo = 0, hi = 0;
    for (let i = Math.floor(x * n / WIDTH); i < Math.floor((x + 1) * n / WIDTH); i++) { lo = Math.min(lo, mono[i]); hi = Math.max(hi, mono[i]); }
    const top = Math.round(mid - hi * scale * (mid - 4)), bottom = Math.round(mid - lo * scale * (mid - 4));
    for (let y = Math.max(0, top); y <= Math.min(WAVE - 1, Math.max(bottom, top + 1)); y++) pixels.set([91, 63, 209, 255], (y * WIDTH + x) * 4);
  }
  pixels.set(Spectrogram.image(mono, rate, WIDTH, HEIGHT - WAVE), WIDTH * WAVE * 4);
  return png(pixels, WIDTH, HEIGHT);
}
/** The first PREVIEW_SECONDS, faded out over the last half second when the scene is longer. */
function excerpt(channels, rate) {
  const n = Math.min(channels[0].length, PREVIEW_SECONDS * rate), fade = channels[0].length > n ? Math.round(rate / 2) : 0;
  return channels.map(ch => { const out = Float32Array.from(ch.subarray(0, n)); for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade; return out; });
}

if (!stale.length) { console.log('Gallery assets are current.'); process.exit(0); }
fs.mkdirSync(output, { recursive: true });
const { render } = require('./node-python.cjs');
let page, browser;
async function encoder() {
  if (page) return page;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // *.localhost is a secure context, which WebCodecs needs; nothing is served from the network.
  await page.route('http://gallery.localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>encode</title>' }));
  await page.goto('http://gallery.localhost/');
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'src/encode.js'), 'utf8') });
  if (!(await page.evaluate(() => AudioEncode.supported())).includes('aac')) throw new Error('This Chromium cannot encode AAC with WebCodecs; run on macOS or Windows.');
  return page;
}
try {
  for (const sample of stale) {
    // A neural voice is never downloaded here: the cover uses the bundled voice instead.
    const source = sample.neural ? sample.source.replace(/"(?:kitten|kokoro):[^"]+"/g, '"pico:en-US"') : sample.source;
    const { result } = await render(source, {}, sample.type || 'python', sample.files || {});
    fs.writeFileSync(path.join(output, `${sample.id}.png`), cover(result.channels, result.sampleRate));
    if (!sample.neural) {
      const pcm = excerpt(result.channels, result.sampleRate).map(ch => Buffer.from(ch.buffer).toString('base64'));
      const m4a = await (await encoder()).evaluate(async ({ pcm, rate }) => {
        const channels = pcm.map(text => new Float32Array(Uint8Array.from(atob(text), c => c.charCodeAt(0)).buffer));
        const blob = await AudioEncode.encode('aac', channels, rate);
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        return btoa(binary);
      }, { pcm, rate: result.sampleRate });
      fs.writeFileSync(path.join(output, `${sample.id}.m4a`), Buffer.from(m4a, 'base64'));
    }
    manifest[sample.id] = fingerprint(sample);
    console.log(`${sample.id}: ${(result.length / result.sampleRate).toFixed(2)} s${sample.neural ? ' (cover only; neural voice)' : ''}`);
  }
} finally { await browser?.close(); }
for (const id of orphans) { delete manifest[id]; for (const ext of ['png', 'm4a']) fs.rmSync(path.join(output, `${id}.${ext}`), { force: true }); }
const ordered = Object.fromEntries(catalog.filter(s => manifest[s.id]).map(s => [s.id, manifest[s.id]]));
fs.writeFileSync(manifestPath, JSON.stringify(ordered, null, 2) + '\n');

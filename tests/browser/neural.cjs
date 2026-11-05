/* Actual models, Pyodide and opaque worker. Run fetch-neural.mjs first; Kokoro is opt-in. */
const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pins = require('../../src/neural-manifest.js');
const core = require('../../src/audio-core.js');
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const name = process.argv[3] || 'chromium';
(async () => {
  const browser = name === 'firefox' && process.env.FIREFOX_PATH
    ? await firefox.launch({ headless: true, channel: 'moz-firefox', executablePath: process.env.FIREFOX_PATH })
    : await ({ chromium, firefox, webkit }[name]).launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' }), page = await context.newPage();
    const errors = [], downloads = [], prompts = [];
    page.on('requestfailed', r => errors.push('Failed: ' + r.url() + ' ' + r.failure()?.errorText));
    await context.exposeBinding('__csp', (_, s) => errors.push('CSP: ' + s));
    await context.addInitScript(() => addEventListener('securitypolicyviolation', e => {
      if (location.pathname === 'srcdoc' && e.blockedURI === 'data' && e.violatedDirective === 'script-src-elem') return;
      globalThis.__csp?.(e.violatedDirective + ' ' + e.blockedURI);
    }));
    page.on('pageerror', e => { if (!e.message.includes('data:text/javascript,')) errors.push(e.message); });
    await context.route(core.PYODIDE_URL + '**', r => {
      const suffix = r.request().url().slice(core.PYODIDE_URL.length);
      const file = [path.join('node_modules/pyodide', suffix), path.join('.pyodide-cache', suffix)].find(file => fs.existsSync(file));
      if (!file) return r.continue();
      return r.fulfill({ body: fs.readFileSync(file), headers: { 'Access-Control-Allow-Origin': '*' }, contentType: file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : 'application/zip' });
    });
    // Route large fixture bodies over HTTP. CDP's message size limit cannot carry Kokoro as base64.
    const fixtureURLs = Object.fromEntries(Object.values(pins.assets).map(asset => [asset.url, new URL('.neural-cache/' + asset.sha256, base).href]));
    await context.addInitScript(fixtureURLs => {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (url, init) => nativeFetch(fixtureURLs[String(url)] || url, init);
    }, fixtureURLs);
    page.on('request', request => { if (request.url().includes('/.neural-cache/')) downloads.push(request.url()); });
    let approve = false;
    page.on('dialog', async dialog => { console.log(name + ': ' + dialog.message().split('\n')[0]); prompts.push(dialog.message()); if (approve) await dialog.accept(); else await dialog.dismiss(); });
    const wait = async () => {
      await page.waitForFunction(() => /^(Rendered|Check your scene|Rendering stopped)/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
      const error = await page.locator('#error').textContent(); console.log(name + ': ' + await page.locator('#status').textContent());
      if (error) throw new Error(error);
    };
    const edit = async source => { await page.evaluate(source => editor.setValue(source, -1), source); };
    const source = voice => `from audio import *\nclass Neural(Scene):\n    def construct(self):\n        self.say("Hello, world. One, two, three!", voice=${JSON.stringify(voice)})\n        self.play(Sine(440).dur(0.1))\n`;
    const hash = () => page.evaluate(async () => {
      const r = audioPlayer.result, bytes = await crypto.subtle.digest('SHA-256', Wav.encode(r.channels, r.sampleRate, 'float32'));
      return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' }); console.log(name + ': page loaded'); await wait(); console.log(name + ": ordinary scene rendered");
    // WebKit's ephemeral CacheStorage survives navigation while its real service worker is registered.
    await page.waitForFunction(() => document.getElementById('offline-status').textContent === 'Available offline' && !!navigator.serviceWorker.controller, null, { timeout: 120000 });
    assert.equal(downloads.length, 0, 'ordinary scenes never download neural assets');
    const previous = await hash();
    await edit(source('kitten:Bella'));
    await page.waitForFunction(() => /cancelled/i.test(document.getElementById('error').textContent));
    assert.equal(downloads.length, 0, 'declining downloads no files');
    assert.equal(await hash(), previous, 'declining keeps the last good render');
    assert.match(prompts[0], /45\.\d MB/); assert.match(prompts[0], /not part of “Available offline”/);
    approve = true;
    await page.click('#render'); await wait();
    const first = await hash();
    const metrics = await page.evaluate(() => {
      const r = audioPlayer.result;
      return { seconds: r.length / r.sampleRate, peak: r.channels[0].reduce((peak, v) => Math.max(peak, Math.abs(v)), 0), start: r.clips[1].start, end: r.clips[0].end };
    });
    assert.ok(metrics.seconds > 1 && metrics.seconds < 20, JSON.stringify(metrics));
    assert.ok(metrics.peak > 0.01); assert.equal(metrics.start, metrics.end, 'say advances the cursor by the actual model duration');
    const twoLines = source('kitten:Bella').replace('    def construct(self):', '    def construct(self):\n        print("once")')
      .replace('        self.play', '        self.say("Hello, world. One, two, three!", voice="kitten:Bella", speed=1.5)\n        self.play');
    await edit(twoLines); await wait();
    const timing = await page.evaluate(() => audioPlayer.result.clips.map(c => [c.start, c.end, c.line]));
    assert.equal(timing[1][0], timing[0][1]); assert.equal(timing[2][0], timing[1][1]);
    assert.ok(timing[1][1] - timing[1][0] < timing[0][1], 'speed changes use actual model timing');
    assert.equal((await page.locator('#output').textContent()).trim(), 'once', 'collect retries do not duplicate output');
    const cold = async (voice = 'kitten:Bella') => {
      // Cancelling a live run discards the worker and all utterance caches. The next render performs fresh inference.
      await edit('from audio import *\nclass Slow(Scene):\n def construct(self):\n  while True: pass');
      await page.waitForFunction(() => !document.getElementById('cancel').hidden);
      await page.click('#cancel');
      await edit(source(voice)); await wait();
    };
    await cold();
    assert.equal(await hash(), first, 'fresh seeded sessions produce identical bytes');
    assert.equal(prompts.length, 2, 'verified cached assets need no new consent');
    assert.equal(downloads.length, pins.files('kitten:Bella').length, 'assets download only once');
    // Exercise the other voices and nonliteral selection using the real model.
    await edit(source('kitten:Hugo').replace('voice="kitten:Hugo"', 'voice="kitten:" + "Hugo"')); await wait();
    assert.notEqual(await hash(), first);
    if (process.env.KOKORO === '1') {
      await edit(source('kokoro:af_heart')); await wait(); const before = await hash();
      await cold('kokoro:af_heart'); assert.equal(await hash(), before, 'fresh Kokoro inference repeats exactly');
    }
    const downloaded = downloads.length, prompted = prompts.length;
    await page.reload({ waitUntil: 'domcontentloaded' }); await wait();
    assert.equal(downloads.length, downloaded, 'a new page uses verified persistent assets without a network download');
    assert.equal(prompts.length, prompted, 'a new page needs no approval for already cached assets');
    assert.deepEqual(errors, []);
    console.log(`${name}: neural synthesis, consent, cache, runtime voice choice and fresh-session determinism passed; Kitten ${first}`);
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

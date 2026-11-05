/* End-to-end checks against a static server, the real sandbox, Pyodide and renderer. Never a mock engine. */
const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:8000/';
const name = process.argv[3] || 'chromium';
const { HashBinDocuments: Docs } = require('../../src/fragment-config.mjs');
const examples = require('../../src/examples.js');
const AudioCore = require('../../src/audio-core.js');
const golden = require('../golden.json');
const example = id => examples.catalog.find(e => e.id === id);
const root = path.resolve(__dirname, '../..');
fs.mkdirSync('test-results', { recursive: true });
let browser;
const errors = [];
// Serve the pinned runtime from the identical npm/lockfile bytes when present (faster, and checked by tests/offline.test.js).
function runtimeFile(url) {
  const file = url.slice(AudioCore.PYODIDE_URL.length);
  for (const candidate of [path.join(root, 'node_modules/pyodide', file), path.join(root, '.pyodide-cache', file)]) if (fs.existsSync(candidate)) return candidate;
  return null;
}
async function context(options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, ...options });
  await context.route(AudioCore.PYODIDE_URL + '**', route => {
    const file = runtimeFile(route.request().url());
    if (!file) return route.continue();
    const type = file.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/zip';
    return route.fulfill({ contentType: type, body: fs.readFileSync(file), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  // Content-Security-Policy violations count as page errors: the policy must not block the app itself.
  await context.exposeBinding('__cspViolation', (_, text) => errors.push('CSP: ' + text));
  await context.addInitScript(() => addEventListener('securitypolicyviolation', event => {
    // The same Pyodide classic-worker probe, reported to the sandbox frame by Firefox.
    if (location.pathname === 'srcdoc' && event.blockedURI === 'data' && event.violatedDirective === 'script-src-elem') return;
    globalThis.__cspViolation?.(`${event.violatedDirective} ${event.blockedURI} ${location.pathname}`);
  }));
  // Pyodide probes importScripts('data:text/javascript,') to detect a classic worker and catches the refusal;
  // desktop Firefox over BiDi still reports that CSP block as a page error. Nothing else is excused.
  const page = await context.newPage(); page.on('pageerror', error => { if (!/blocked a script \(script-src-elem\) at data:text\/javascript,(?: from|$)/.test(error.message)) errors.push(error.message); });
  return { context, page };
}
async function more(page){if(!await page.locator('#fk-more-drawer').isVisible())await page.click('#more-toggle');}
async function closeMore(page){if(await page.locator('#fk-more-drawer').isVisible())await page.click('#fk-more-drawer .fk-close');}
async function shareOpen(page){await closeMore(page);await page.click('#share');}
const renderedText = () => /^Rendered/.test(document.getElementById('status').textContent);
async function rendered(page, timeout = 90000) { await page.waitForFunction(renderedText, null, { timeout }); }
async function edit(page, source) {
  await page.evaluate(() => { document.getElementById('status').textContent = ''; });
  await page.evaluate(source => editor.setValue(source, -1), source);
  await rendered(page);
}
/** SHA-256 of the float32 WAV of the current render, computed in the page. */
const pageHash = page => page.evaluate(async () => {
  const r = audioPlayer.result, digest = await crypto.subtle.digest('SHA-256', Wav.encode(r.channels, r.sampleRate, 'float32'));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
});
function cidFor(text) {
  const n = Buffer.byteLength(text), prefix = Buffer.alloc(6); prefix.writeUIntBE(n, 0, 6);
  return prefix.toString('base64url') + (n <= 64 ? Buffer.from(text) : Buffer.alloc(64, 7)).toString('base64url');
}
// Desktop Firefox (BiDi) saves into a real folder and numbers repeated names: name(1).ext.
const named = file => new RegExp('^' + file.replace(/\./g, '(?:\\(\\d+\\))?\\.') + '$');
const isCIDHash = hash => Docs.isCID(hash.slice(1));
async function run(label, task) { const start = Date.now(); await task(); console.log(`${name}: ${label} (${Date.now() - start} ms)`); }
(async () => {
  // FIREFOX_PATH drives a desktop Firefox over WebDriver BiDi where Playwright's build cannot launch (macOS 27).
  browser = name === 'firefox' && process.env.FIREFOX_PATH
    ? await firefox.launch({ headless: true, channel: 'moz-firefox', executablePath: process.env.FIREFOX_PATH })
    : await ({ chromium, firefox, webkit }[name]).launch({ headless: true });
  await run('every example renders the golden bytes in this engine, deterministically', async () => {
    const { context: c, page: p } = await context();
    // Neural-voice examples download models on demand; tests/browser/neural.cjs covers that path.
    for (const sample of examples.catalog.filter(e => !e.neural)) {
      await p.goto(base + '?example=' + sample.id); await rendered(p);
      assert.equal(await p.evaluate(() => editor.getValue()), sample.source);
      assert.equal(await pageHash(p), golden[sample.id].hash, sample.id);
      const scenes = await p.$$eval('#scene option', options => options.map(o => o.value));
      for (const scene of scenes.slice(1)) {
        await p.evaluate(() => { document.getElementById('status').textContent = ''; });
        await p.selectOption('#scene', scene); await rendered(p);
        assert.equal(await pageHash(p), golden[`${sample.id}:${scene}`].hash, `${sample.id}:${scene}`);
      }
    }
    // Render the same scene again: identical bytes.
    const before = await pageHash(p);
    await p.evaluate(() => { document.getElementById('status').textContent = ''; }); await p.click('#render'); await rendered(p);
    assert.equal(await pageHash(p), before);
    await c.close();
  });
  await run('notation documents render without loading Python; the Renderer selector overrides detection', async () => {
    const { context: c, page: p } = await context();
    const runtime = []; c.on('request', request => { if (request.url().startsWith(AudioCore.PYODIDE_URL)) runtime.push(request.url()); });
    await p.goto(base + '?example=drum-pattern'); await rendered(p);
    assert.deepEqual(runtime, [], 'no Pyodide downloads for a pattern document');
    assert.equal(await p.locator('#renderer option').first().textContent(), 'Auto (Pattern)');
    assert.equal(await p.locator('#filename').textContent(), 'beat.pattern');
    assert.deepEqual(await p.$$eval('#lanes .lane-name', names => names.map(n => n.textContent)), ['kick', 'snare', 'hats', 'toms', 'bass']);
    await p.evaluate(() => editor.setValue('bpm 120\nkick: bd [sn', -1));
    await p.waitForSelector('#error:not([hidden])'); assert.match(await p.locator('#error').innerText(), /^Line 2: Pattern: Expected "\]"/);
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.selectOption('#renderer', 'python'); await p.waitForSelector('#error:not([hidden])');
    await p.waitForFunction(() => /SyntaxError/.test(document.getElementById('error').textContent));
    assert.equal(await p.locator('#filename').textContent(), 'scene.py');
    await p.selectOption('#renderer', 'auto'); await edit(p, 'bpm 120\nkick: bd sn');
    assert.equal(await p.locator('#filename').textContent(), 'beat.pattern');
    await c.close();
  });
  await run('scene code runs in an opaque sandbox without storage, nested workers or editor access', async () => {
    const { context: c, page: p } = await context();
    await p.goto(base); await rendered(p);
    assert.equal(await p.locator('iframe[title="Code sandbox"]').getAttribute('sandbox'), 'allow-scripts');
    await p.evaluate(async () => {
      localStorage.setItem('audio-isolation-probe', 'editor-only');
      await (await caches.open('audio-isolation-probe')).put('/private-sentinel', new Response('editor-only'));
    });
    await edit(p, [
      'import js',
      'from audio import *',
      'found = {n: getattr(js, n, None) is not None for n in ["caches", "indexedDB", "localStorage", "Worker", "SharedWorker", "importScripts"]}',
      'print("origin", js.self.origin, "parent", getattr(js, "parent", None) is not None, sorted(k for k, v in found.items() if v))',
      'class S(Scene):',
      '    def construct(self):',
      '        self.add(Sine(1).dur(0.01))'
    ].join('\n'));
    assert.equal(await p.locator('#output').textContent(), 'origin null parent False []');
    await p.evaluate(async () => { localStorage.removeItem('audio-isolation-probe'); await caches.delete('audio-isolation-probe'); });
    await c.close();
  });
  await run('diagnostics keep the last good render; lanes jump to source; cancel stops runaway code', async () => {
    const { context: c, page: p } = await context();
    await p.goto(base); await rendered(p);
    assert.equal(await p.locator('#lanes .lane').count(), 3);
    await p.locator('#lanes .lane').nth(2).locator('.clip').click();
    assert.equal(await p.evaluate(() => editor.getCursorPosition().row + 1), 15);
    await p.evaluate(() => editor.setValue('from audio import *\nclass S(Scene):\n    def construct(self):\n        self.add(Sine(3))\n', -1));
    await p.waitForSelector('#error:not([hidden])'); assert.match(await p.locator('#error').innerText(), /^Line 4: ValueError: give Sine\(3\) a duration/);
    await p.waitForSelector('.ace_gutter-cell.scene-error'); assert.ok(await p.locator('#preview.stale').count());
    assert.ok(await p.evaluate(() => audioPlayer.result.length > 0), 'last good render is kept');
    await p.evaluate(() => editor.setValue('from audio import *\nprint("spinning")\nwhile True:\n    pass\n', -1));
    await p.waitForSelector('#cancel:not([hidden])', { timeout: 20000 }); await p.waitForFunction(() => /Still rendering/.test(document.getElementById('status').textContent));
    await p.click('#cancel'); assert.equal(await p.locator('#status').textContent(), 'Cancelled');
    assert.equal(await p.locator('iframe[title="Code sandbox"]').count(), 0, 'cancel terminates the sandbox');
    await edit(p, examples.defaultSource); assert.equal(await p.locator('#preview.stale').count(), 0);
    await c.close();
  });
  await run('playback, seeking and downloads', async () => {
    const { context: c, page: p } = await context();
    await p.goto(base); await rendered(p);
    await p.click('#play'); assert.equal(await p.locator('#play').textContent(), 'Pause');
    // Headless CI hosts have no audio device: Firefox's AudioContext never runs and WebKit ends the source at once.
    // There the playhead and pause toggle cannot be observed, so only the start of playback is checked.
    const running = await p.waitForFunction(() => audioPlayer.context.state === 'running' && audioPlayer.playing, null, { timeout: 3000 }).then(() => true, () => false);
    if (running) {
      await p.waitForFunction(() => audioPlayer.position > 0.05, null, { timeout: 10000 });
      await p.click('#play'); assert.equal(await p.locator('#play').textContent(), 'Play');
    } else { console.log(`${name}: no running audio output; playhead and pause not checked`); await p.evaluate(() => audioPlayer.pause()); }
    await closeMore(p);await p.locator('#waveform').scrollIntoViewIfNeeded();
    const box = await p.locator('#waveform').boundingBox(); await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.ok(Math.abs(await p.evaluate(() => audioPlayer.position) - 1.25) < 0.05);
    const expected = { pcm16: 44 + 120000 * 4, pcm24: 44 + 120000 * 6, float32: 44 + 120000 * 8 };
    for (const format of ['pcm16', 'pcm24', 'float32', 'svg', 'png', 'source']) {
      await more(p);await p.selectOption('#export-format', format);
      const pending = p.waitForEvent('download'); await p.click('#download'); const download = await pending;
      const content = fs.readFileSync(await download.path());
      if (expected[format]) { assert.match(download.suggestedFilename(), named('hello.wav')); assert.equal(content.subarray(0, 4).toString(), 'RIFF'); assert.equal(content.length, expected[format]); }
      if (format === 'svg') { assert.match(download.suggestedFilename(), named('hello-waveform.svg')); assert.match(content.toString(), /^<svg/); }
      if (format === 'png') assert.equal(content.subarray(1, 4).toString(), 'PNG');
      if (format === 'source') { assert.match(download.suggestedFilename(), named('scene.py')); assert.equal(content.toString(), examples.defaultSource); }
    }
    await c.close();
  });
  await run('mute and solo re-mix in the sandbox; stems download as a ZIP; dragging sets a loop region', async () => {
    const { context: c, page: p } = await context();
    await p.goto(base + '?example=podcast-ducking'); await rendered(p);
    const full = await pageHash(p), energy = () => p.evaluate(() => audioPlayer.result.channels[0].subarray(0, 96000).reduce((s, v) => s + v * v, 0));
    assert.ok(await energy() > 1, 'music plays in the first two seconds');
    await p.click('[aria-label="Mute music"]'); await p.waitForFunction(() => !document.getElementById('note').hidden && /Preview mix/.test(document.getElementById('note').textContent));
    assert.equal(await energy(), 0, 'muted music leaves silence before the voice');
    assert.equal(await p.locator('[aria-label="Mute music"]').getAttribute('aria-pressed'), 'true');
    await p.click('[aria-label="Mute music"]'); await p.waitForFunction(() => document.getElementById('note').hidden);
    assert.equal(await pageHash(p), full, 'unmuting restores the exact full mix');
    await p.click('[aria-label="Solo voice"]'); await p.waitForFunction(() => !document.getElementById('note').hidden && /Preview mix/.test(document.getElementById('note').textContent));
    assert.equal(await energy(), 0);
    // A new render keeps the solo and re-applies it.
    await p.evaluate(() => { document.getElementById('status').textContent = ''; }); await p.click('#render'); await rendered(p);
    await p.waitForFunction(() => audioPlayer.result.channels[0].subarray(0, 96000).every(v => v === 0));
    await p.click('[aria-label="Solo voice"]'); await p.waitForFunction(() => document.getElementById('note').hidden);
    await more(p);await p.selectOption('#export-format', 'stems');
    const pending = p.waitForEvent('download'); await p.click('#download'); const download = await pending;
    assert.match(download.suggestedFilename(), named('episode-stems.zip'));
    const zip = fs.readFileSync(await download.path());
    assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.match(zip.toString('latin1'), /music\.wav[\s\S]*voice\.wav/);
    await closeMore(p);await p.locator('#waveform').scrollIntoViewIfNeeded();
    const box = await p.locator('#waveform').boundingBox();
    await p.mouse.move(box.x + box.width * 0.25, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.5, box.y + 20, { steps: 5 }); await p.mouse.up();
    const loop = await p.evaluate(() => ({ region: audioPlayer.region, looping: audioPlayer.looping, position: audioPlayer.position }));
    assert.ok(Math.abs(loop.region.start - 13.04 * 0.25) < 0.1 && Math.abs(loop.region.end - 13.04 * 0.5) < 0.1 && loop.looping, JSON.stringify(loop));
    assert.equal(await p.locator('#loop').getAttribute('aria-pressed'), 'true');
    await p.click('#loop'); assert.equal(await p.locator('#loop').getAttribute('aria-pressed'), 'false');
    await c.close();
  });
  await run('compressed export: each format this browser encodes decodes back to the same length and level', async () => {
    const { context: c, page: p } = await context();
    await p.goto(base); await rendered(p);
    await p.waitForFunction(() => typeof AudioEncoder === 'undefined' || document.querySelectorAll('#export-format option').length > 7, null, { timeout: 5000 }).catch(() => {});
    const formats = await p.$$eval('#export-format option', options => options.map(o => o.value).filter(v => v === 'opus' || v === 'aac'));
    console.log(`${name}: compressed formats offered: ${formats.join(', ') || 'none (WAV only)'}`);
    for (const format of formats) {
      await more(p);await p.selectOption('#export-format', format);
      const pending = p.waitForEvent('download'); await p.click('#download'); const download = await pending;
      assert.match(download.suggestedFilename(), named(format === 'opus' ? 'hello.webm' : 'hello.m4a'));
      const bytes = fs.readFileSync(await download.path());
      const decoded = await p.evaluate(async b64 => {
        const data = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)).buffer, original = audioPlayer.result.channels[0];
        try {
          const audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data), ch = audio.getChannelData(0);
          const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
          return { duration: audio.duration, channels: audio.numberOfChannels, ratio: rms(ch) / rms(original) };
        } catch (error) { return { error: String(error) }; }
      }, bytes.toString('base64'));
      assert.ok(!decoded.error, `${format}: ${decoded.error}`);
      assert.equal(decoded.channels, 2);
      assert.ok(Math.abs(decoded.duration - 2.5) < 0.1, `${format} duration ${decoded.duration}`);
      assert.ok(Math.abs(20 * Math.log10(decoded.ratio)) < 1.5, `${format} level ${decoded.ratio}`);
    }
    await c.close();
  });
  await run('sharing, settings, QR and shortener', async () => {
    const { context: c, page: p } = await context(); await p.goto(base); await rendered(p);
    await edit(p, 'from audio import *\nclass Shared(Scene):\n    def construct(self):\n        self.play(Sine(330).dur(0.3))\n');
    await shareOpen(p);
    let link = await p.inputValue('#share-link'); assert.ok(new URL(link).searchParams.has('compressed'));
    const p2 = await c.newPage(); p2.on('dialog', dialog => dialog.accept()); await p2.goto(link); await rendered(p2); assert.match(await p2.evaluate(() => editor.getValue()), /class Shared/);
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.click('#share-dialog .fk-close');await p.selectOption('#sample-rate', '22050'); await rendered(p); await shareOpen(p);
    link = await p.inputValue('#share-link'); assert.ok(new URL(link).searchParams.has('doc'));
    await p2.goto(link); await rendered(p2); assert.equal(await p2.inputValue('#sample-rate'), '22050');
    assert.equal(await p2.evaluate(() => audioPlayer.result.sampleRate), 22050);
    await p.click('#share-dialog .fk-close');await p.click('#qr-open'); await p.waitForSelector('#qr-code svg'); assert.match(await p.locator('#qr-notes').innerText(), /computer/);
    const download = p.waitForEvent('download'); await p.getByRole('button',{name:'Download SVG',exact:true}).click(); assert.match((await download).suggestedFilename(), named('audio-qr.svg')); await p.click('#qr-dialog .fk-close');
    await p.route('https://api.allorigins.win/**', route => route.fulfill({ json: { contents: 'https://is.gd/test123' } }));
    await shareOpen(p);await p.getByRole('button',{name:'Shorten link',exact:true}).click(); await p.waitForFunction(() => document.getElementById('share-link').value === 'https://is.gd/test123');
    // Settings survive the localStorage restore.
    await p.goto(base); await rendered(p); await more(p);await p.locator('#resume-work').evaluate(button=>button.click()); await p.click('#restore-work'); await p.waitForFunction(()=>!document.getElementById('draft-dialog').open); assert.equal(await p.inputValue('#sample-rate'), '22050');
    await c.close();
  });
  await run('HashBin inline CIDs, stale loads, URL identity and recovery and mocked Publish saves', async () => {
    const { context: c, page: p } = await context();
    const bare = 'from audio import *\nclass Cid(Scene):\n    pass\n', inline = cidFor(bare);
    assert.ok(bare.length <= 64);
    await p.goto(base + '#' + inline); await rendered(p); assert.match(await p.evaluate(() => editor.getValue()), /class Cid/);
    // The policy is live: a script from an unlisted host is refused and reported.
    await p.evaluate(() => { const script = document.createElement('script'); script.src = 'https://example.invalid/injected.js'; document.head.append(script); });
    await new Promise(resolve => { const wait = () => errors.some(e => e.includes('example.invalid')) ? resolve() : setTimeout(wait, 50); wait(); });
    errors.splice(0, errors.length, ...errors.filter(e => !e.includes('example.invalid')));
    await more(p);await p.click('#hashbin-save');await p.waitForFunction(()=>/registered client ID/.test(document.getElementById('hashbin-message').textContent));await p.click('#hashbin-dialog .fk-close');
    const payload = Docs.serialize({ src: 'from audio import *\nclass SlowOld(Scene):\n    pass\n', settings: {}, files: {} }), remote = cidFor(payload);
    let release; const pending = new Promise(resolve => { release = resolve; });
    await p.route('https://256t.us/' + remote, async route => { await pending; await route.fulfill({ body: payload }); });
    await more(p);await p.fill('#hashbin-cid', remote); await p.click('#hashbin-load');await closeMore(p); await edit(p, 'from audio import *\nclass NewerEdit(Scene):\n    pass\n'); release();
    await p.waitForTimeout(250); assert.match(await p.evaluate(() => editor.getValue()), /NewerEdit/);
    // Local drafts cannot block a program URL; previous work is recoverable.
    const previousDraft = await p.evaluate(() => localStorage.getItem('audioonline:document'));
    await p.goto(base + '?example=numpy-glide'); await rendered(p);
    assert.equal(await p.evaluate(() => editor.getValue()), example('numpy-glide').source);
    assert.equal(await p.evaluate(() => localStorage.getItem('audioonline:document')), previousDraft);
    await c.close();
    const { context: auth, page: a } = await context();
    await auth.route(base + '**', async route => {
      if (route.request().isNavigationRequest()) { const html = fs.readFileSync('index.html', 'utf8').replace(/name="hashbin-client-id" content="[^"]*"/, 'name="hashbin-client-id" content="test-client"'); await route.fulfill({ contentType: 'text/html', body: html }); } else await route.continue();
    });
    // Stands in for the pinned SDK: popup approval, cancellation, a blocked popup's redirect round trip and revocation.
    const sdk = `const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
    async function cid(text){const bytes=new TextEncoder().encode(text),size=new Uint8Array(6);new DataView(size.buffer).setUint32(2,bytes.length);return encode(size)+encode(bytes.length<=64?bytes:new Uint8Array(await crypto.subtle.digest('SHA-512',bytes)));}
    export class HashBinClient {
      constructor(options){this.options=options}
      publish(content,{clientState}){const mode=localStorage.getItem('test:publish')||'approve';return cid(content).then(saved=>{
        if(mode==='cancel')throw new Error('access_denied');
        if(mode==='redirect'){sessionStorage.setItem('test:state',JSON.stringify(clientState));location.href=new URL('./',location.href).href+'#hashbin_publish=t&cid='+saved;return {redirected:true};}
        return {cid:saved};});}
      async handlePublishCallback({hash}){const clientState=JSON.parse(sessionStorage.getItem('test:state'));return {cid:new URLSearchParams(hash.slice(1)).get('cid'),clientState};}
      async disconnect(){localStorage.removeItem('hashbin:tokens:test-client');localStorage.setItem('test:revoked','yes');}
    }`;
    await auth.route('**/vendor/fragment-kit-v0.3.3/vendor/hashbin-sdk-v0.4.0.mjs', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
    await auth.addInitScript(() => {
      if (window !== window.top) return;
      // Firefox over BiDi also runs this in other documents where storage throws SecurityError.
      try { if (!sessionStorage.getItem('test:seeded')) { sessionStorage.setItem('test:seeded', '1'); localStorage.setItem('hashbin:tokens:test-client', '{"refreshToken":"old"}'); } } catch (_) { /* not this test's page */ }
    });
    await a.goto(base); await rendered(a); await a.waitForFunction(() => localStorage.getItem('test:revoked') === 'yes' && !localStorage.getItem('hashbin:tokens:test-client'));
    const save = async () => { await more(a);await a.click('#hashbin-save'); await a.waitForFunction(() => document.getElementById('hashbin-confirm').textContent === 'Review on HashBin' && !document.getElementById('hashbin-confirm').disabled); };
    await edit(a, 'from audio import *\nclass PopupSave(Scene):\n    pass\n'); await a.waitForTimeout(300);
    await save(); await a.click('#hashbin-confirm'); await a.waitForFunction(() => document.getElementById('hashbin-status').textContent === 'Saved to HashBin.'); assert.ok(isCIDHash(new URL(a.url()).hash), a.url()); await a.click('#hashbin-dialog .fk-close');
    await a.evaluate(() => localStorage.setItem('test:publish', 'cancel')); await edit(a, 'from audio import *\nclass Cancelled(Scene):\n    pass\n'); await save(); await a.click('#hashbin-confirm');
    await a.waitForFunction(() => /cancelled on HashBin/.test(document.getElementById('hashbin-message').textContent)); await a.click('#hashbin-dialog .fk-close');
    await a.evaluate(() => localStorage.setItem('test:publish', 'redirect')); await edit(a, 'from audio import *\nclass Restored(Scene):\n    pass\n'); await a.waitForTimeout(300); await save();
    await Promise.all([a.waitForURL('**#hashbin_publish=*'), a.click('#hashbin-confirm')]); await rendered(a);
    await a.waitForFunction(() => document.getElementById('hashbin-status').textContent === 'Saved to HashBin.'); assert.match(await a.evaluate(() => editor.getValue()), /class Restored/); assert.ok(isCIDHash(new URL(a.url()).hash));
    await a.evaluate(() => localStorage.removeItem('test:publish'));
    await edit(a, 'from audio import *\nclass After(Scene):\n    pass\n'); await a.waitForFunction(() => !location.hash); assert.ok(new URL(a.url()).searchParams.has('compressed'));
    await auth.close();
  });
  await run('audio files and CID samples: upload, verified HashBin fetch, tamper refusal and share links', async () => {
    const Wav = require('../../src/wav.js'), crypto = require('node:crypto');
    const wav = Buffer.from(Wav.encode([Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 3) * (1 - i / 8000))], 16000, 'pcm16'));
    const cidOf = bytes => { const size = Buffer.alloc(6); size.writeUIntBE(bytes.length, 0, 6); return size.toString('base64url') + crypto.createHash('sha512').update(bytes).digest().toString('base64url'); };
    const good = cidOf(wav), tampered = cidOf(Buffer.concat([wav.subarray(0, 44), Buffer.alloc(wav.length - 44, 1)]));
    const source = `from audio import *\nclass Uploaded(Scene):\n    def construct(self):\n        self.play(Sample("tone.wav"), track="file")\n        self.play(Sample(cid="${good}").speed(2), track="cid")\n`;
    // The expected bytes come from Node's Pyodide and renderer: the same everywhere.
    const expected = (await require('../../scripts/node-python.cjs').render(source, {}, 'python', { 'tone.wav': wav.toString('base64') }, { [good]: wav })).hash;
    const { context: c, page: p } = await context();
    let fetches = 0;
    await c.route('https://256t.us/**', route => { fetches++; return route.fulfill({ body: wav, contentType: 'application/octet-stream', headers: { 'Access-Control-Allow-Origin': '*' } }); });
    await p.goto(base); await rendered(p);
    await p.click('#files-open');
    await p.setInputFiles('#file-upload', { name: 'notes.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
    await p.waitForFunction(() => /notes\.wav: Not a WAV file/.test(document.getElementById('files-message').textContent));
    await p.setInputFiles('#file-upload', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
    await p.waitForFunction(() => document.getElementById('file-count').textContent === '1');
    assert.match(await p.locator('#file-list').innerText(), /Sample\("tone\.wav"\)[\s\S]*0\.50 s · mono/);
    await p.click('[data-close="files-dialog"]');
    await edit(p, source);
    assert.equal(await pageHash(p), expected, 'uploaded and CID samples render the Node bytes');
    assert.equal(fetches, 1);
    assert.deepEqual(await p.$$eval('#lanes .lane-name', names => names.map(n => n.textContent)), ['file', 'cid']);
    // Content that does not match its CID never reaches the scene; the last good render stays.
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.evaluate(([src, bad]) => editor.setValue(src.replace(/cid="[^"]+"/, `cid="${bad}"`), -1), [source, tampered]);
    await p.waitForSelector('#error:not([hidden])'); assert.match(await p.locator('#error').innerText(), /^Line 5: .*does not match its CID/);
    assert.equal(await pageHash(p), expected, 'last good render is kept');
    // Files travel with share links.
    await edit(p, source); await shareOpen(p);
    const link = await p.inputValue('#share-link'), p2 = await c.newPage(); p2.on('dialog', dialog => dialog.accept());
    await p2.goto(link); await rendered(p2);
    assert.equal(await p2.locator('#file-count').textContent(), '1'); assert.equal(await pageHash(p2), expected);
    await c.close();
  });
  await run('the gallery lists every example with covers, lazy previews and editor links', async () => {
    const { context: c, page: p } = await context({ viewport: { width: 375, height: 812 } });
    await p.goto(base + 'gallery.html');
    assert.equal(await p.locator('.card').count(), examples.catalog.length);
    assert.equal(await p.locator('#count').textContent(), `${examples.catalog.length} examples`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.waitForFunction(() => { const img = document.querySelector('.card img'); return img.complete && img.naturalWidth > 0; });
    for (const sample of examples.catalog) {
      const card = p.locator('#' + sample.id);
      assert.equal(new URL(await card.locator('a.load').getAttribute('href')).pathname,'/');assert.equal(require('../../src/fragment-config.mjs').urlState.parse(await card.locator('a.load').getAttribute('href')).doc.src,sample.source);
      if (sample.neural) { assert.equal(await card.locator('audio').count(), 0); assert.match(await card.locator('.neural').innerText(), /not part of “Available offline”/); continue; }
      assert.equal(await card.locator('audio').getAttribute('preload'), 'none');
      const status = await p.evaluate(async url => (await fetch(url, { method: 'HEAD' })).status, `gallery/previews/${sample.id}.m4a`);
      assert.equal(status, 200, sample.id);
    }
    // Playing one preview pauses the others.
    const paused = await p.evaluate(() => {
      const [a, b] = document.querySelectorAll('.card audio');
      Object.defineProperty(a, 'paused', { value: false, configurable: true }); let stopped = false; a.pause = () => { stopped = true; };
      b.dispatchEvent(new Event('play')); return stopped;
    });
    assert.ok(paused);
    await p.fill('#search', 'door'); assert.deepEqual(await p.$$eval('.card', cards => cards.map(card => card.id)), ['door']);
    await p.fill('#search', ''); await p.selectOption('#tag', 'samples'); assert.deepEqual(await p.$$eval('.card', cards => cards.map(card => card.id)), ['cid-wavetable', 'uploaded-loop']);
    await p.click('#uploaded-loop a.load'); await rendered(p);
    assert.equal(await p.locator('#file-count').textContent(), '1'); assert.equal(await pageHash(p), golden['uploaded-loop'].hash);
    await c.close();
  });
  await run('phone tabs, More menu, touch-sized controls and no horizontal overflow', async () => {
    const { context: c, page: p } = await context({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: name !== 'firefox' });
    await p.goto(base); await rendered(p); assert.equal(await p.locator('#editor-pane').isVisible(), false);
    await p.click('#tab-code'); assert.equal(await p.locator('#editor-pane').isVisible(), true); assert.equal(await p.locator('#preview-pane').isVisible(), false);
    await edit(p, example('two-scenes').source);
    await p.click('#tab-preview'); assert.equal(await p.locator('#waveform').isVisible(), true);
    assert.equal(await p.locator('#hashbin-save').isVisible(), false);
    await more(p);assert.ok(await p.locator('#fk-more-drawer').isVisible()); assert.equal(await p.locator('#hashbin-save').isVisible(), true);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const selector of ['#tab-code', '#tab-preview', '#render', '#more-toggle', '#play', '#download', '#qr-open']) { const box = await p.locator(selector).boundingBox(); assert.ok(box.height >= 44, selector); }
    await closeMore(p);
    // Playwright's Firefox BiDi mode does not dispatch synthetic taps; a click is the same user gesture there.
    if (process.env.FIREFOX_PATH && name === 'firefox') await p.click('#play'); else await p.tap('#play');
    assert.equal(await p.locator('#play').textContent(), 'Pause');
    await p.screenshot({ path: `test-results/${name}-mobile.png`, fullPage: true }); await c.close();
  });
  await run('activating an offline update synchronously preserves the latest source and settings',async()=>{
    const{context:c,page:p}=await context();await p.goto(base+'?run=0');await p.waitForFunction(()=>document.body.dataset.ready==='true');
    await p.evaluate(()=>{editor.setValue('from audio import *\nclass Latest(Scene):\n    pass\n',-1);document.getElementById('sample-rate').value='22050';document.getElementById('sample-rate').onchange();dispatchEvent(new Event('offline-before-reload'));});
    const doc=require('../../src/fragment-config.mjs').urlState.parse(p.url()).doc;assert.match(doc.src,/Latest/);assert.equal(doc.audio.settings.sampleRate,22050);await c.close();
  });
  await run('offline reload and render with the origin stopped', async () => {
    // Real origin failure avoids browser-specific offline-emulation behavior.
    const fixture=require('./server.cjs').createServer(),server=fixture.server;
    const offlineBase=(await fixture.start())+'/';
    const { context: c, page: p } = await context({ serviceWorkers: 'allow' });
    try {
      await p.goto(offlineBase); await rendered(p);
      await p.waitForFunction(() => document.getElementById('offline-status').textContent === 'Available offline', null, { timeout: 120000 });
      await p.waitForFunction(() => !!navigator.serviceWorker.controller);
      await p.reload(); await rendered(p);
      // Anything on this origin can write Cache Storage; altered entries are never served.
      await p.evaluate(async () => { const cache = await caches.open((await caches.keys()).find(name => name.startsWith('audioonline-'))); await cache.put(new URL('vendor/fragment-kit-v0.3.3/src/qr/encode.js', location.href).href, new Response('globalThis.poisonedCache=true;', { headers: { 'Content-Type': 'text/javascript' } })); });
      assert.equal(await p.evaluate(async()=>{const{OfflineClient}=await import('./vendor/fragment-kit-v0.3.3/src/index.js');return(await new OfflineClient().status()).ready;}),false);
      await p.reload(); await rendered(p); assert.equal(await p.evaluate(() => globalThis.poisonedCache), undefined);
      // The shared core refetches and verifies a damaged requested module. An
      // unused damaged document exercises explicit repair through the app UI.
      await p.evaluate(async()=>{const name=(await caches.keys()).find(name=>name.startsWith('audioonline-'));await(await caches.open(name)).put(new URL('docs/index.html',location.href),new Response('tampered'));});
      await more(p);await p.click('#offline-repair');await closeMore(p); await p.waitForFunction(() => document.getElementById('offline-status').textContent === 'Available offline', null, { timeout: 120000 });
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      await assert.rejects(fetch(offlineBase));
      await c.route(AudioCore.PYODIDE_URL + '**', route => route.abort());
      await p.reload(); await rendered(p);
      await edit(p, example('numpy-glide').source);
      assert.equal(await pageHash(p), golden['numpy-glide'].hash, 'numpy works offline');
      await edit(p, example('narrated-intro').source);
      assert.equal(await pageHash(p), golden['narrated-intro'].hash, 'the bundled voice works offline');
    } finally { await c.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  });
  assert.deepEqual(errors, [], 'Unexpected page errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

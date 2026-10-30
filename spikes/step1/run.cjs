/* node run.cjs <engine...> — serves this folder and records each engine's spike results.
   Engines: chromium, firefox, webkit, firefox-bidi (a desktop Firefox via WebDriver BiDi; set FIREFOX_PATH).
   Run ./fetch-assets.sh first. PW may point at another checkout's playwright package. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium, firefox, webkit } = require(process.env.PW || 'playwright');
const root = __dirname;
const WINDOW_BOOTSTRAP = "onmessage=function(e){if(e.source!==parent||typeof e.data!=='string')return;onmessage=null;var s=document.createElement('script');s.src=URL.createObjectURL(new Blob([e.data],{type:'text/javascript'}));document.head.appendChild(s)}";
const sha = s => "'sha256-" + crypto.createHash('sha256').update(s).digest('base64') + "'";
const SDK_HASH = "'sha256-IMEqdP+AkCKdxhM3X7mQM4pV/chykJXPvdtndD+XeH8='";
const csp = `default-src 'self'; script-src 'self' ${SDK_HASH} ${sha(WINDOW_BOOTSTRAP)} blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'`;
fs.writeFileSync(path.join(root, 'bootstrap.js'), `window.WINDOW_BOOTSTRAP=${JSON.stringify(WINDOW_BOOTSTRAP)};\n`);
fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>spike</title><body><script src="bootstrap.js"></script><script src="webaudio-suite.js"></script><script src="spike.js"></script></body>`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.zip': 'application/zip', '.whl': 'application/zip', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8123, '127.0.0.1', async () => {
  const engines = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
  for (const name of engines) {
    const t = Date.now();
    let browser;
    try {
      browser = name === 'firefox-bidi' ? await firefox.launch({ channel: 'moz-firefox', executablePath: process.env.FIREFOX_PATH || '/Applications/Firefox.app/Contents/MacOS/firefox' }) : await { chromium, firefox, webkit }[name].launch();
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto('http://127.0.0.1:8123/index.html');
      await page.waitForFunction(() => window.__results, null, { timeout: 420000 });
      const results = await page.evaluate(() => window.__results);
      results.consoleErrors = errors.slice(0, 20); results.browserVersion = browser.version(); results.wallMs = Date.now() - t;
      fs.writeFileSync(path.join(root, 'results', name.replace('-bidi', '') + '.json'), JSON.stringify(results, null, 1));
      console.log(name, 'ok', results.wallMs + 'ms');
    } catch (e) { console.log(name, 'FAILED', e.message); fs.writeFileSync(path.join(root, 'results', name.replace('-bidi', '') + '.json'), JSON.stringify({ fatal: e.message })); }
    finally { await browser?.close(); }
  }
  server.close();
});

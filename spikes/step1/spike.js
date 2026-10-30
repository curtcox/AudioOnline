/* Spike driver on the "editor" origin. */
const results = { ua: navigator.userAgent };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

async function sdkWorker() {
  const sdk = await import('./assets/hashbin-sdk-v0.4.0.mjs');
  const base = new URL('./', location.href).href;
  const source = fetch('worker.js').then(r => r.text());
  return withTimeout(new Promise((resolve, reject) => {
    const sb = sdk.createSandbox({ source, origin: 'opaque', base, proxy: [new URL('assets/', base).href] });
    sb.onmessage = ({ data }) => { if (data.type === 'done') { sb.terminate(); resolve(data.out); } };
    sb.onerror = e => reject(new Error(e.message));
  }), 240000, 'sdk worker');
}

async function opaqueWindow() {
  const suite = await (await fetch('webaudio-suite.js')).text();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><script>${window.WINDOW_BOOTSTRAP}</script>`;
  const done = new Promise(resolve => addEventListener('message', e => { if (e.source === frame.contentWindow && e.data?.type === 'window-done') resolve(e.data.out); }));
  frame.addEventListener('load', () => frame.contentWindow.postMessage(suite + '\nrunWebAudioSuite().then(o=>parent.postMessage({type:"window-done",out:o},"*"),e=>parent.postMessage({type:"window-done",out:{fatal:String(e)}},"*"));', '*'), { once: true });
  document.body.append(frame);
  return withTimeout(done, 120000, 'opaque window');
}

(async () => {
  for (const [name, fn] of [['editorOrigin', () => runWebAudioSuite()], ['opaqueWindow', opaqueWindow], ['sdkWorker', sdkWorker]]) {
    const t = performance.now();
    try { results[name] = await fn(); } catch (e) { results[name] = { fatal: String(e.message || e) }; }
    results[name + 'Ms'] = Math.round(performance.now() - t);
  }
  window.__results = results;
  document.body.append(Object.assign(document.createElement('pre'), { textContent: JSON.stringify(results, null, 1) }));
})();

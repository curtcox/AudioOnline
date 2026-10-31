/* Scenes run with an opaque origin, separate from the editor's storage and service worker. */
(() => {
const AudioSandbox = {
  FILES: ['audio-core.js', 'dmath.js', 'instruments.js', 'mini-notation.js', 'notation.js', 'voice.js', 'neural-manifest.js', 'g2p.js', 'neural-voice.js', 'effects.js', 'audio-renderer.js', 'audio-python.js', 'audio-worker.js'],
  factory({ loadSDK = () => import('../vendor/hashbin-sdk-v0.4.0.mjs'),
    base = new URL('src/', location.href).href,
    pyodide = globalThis.AudioCore.PYODIDE_URL,
    voiceAssets = null,
    fetchSource = url => fetch(url).then(response => {
      if (!response.ok) throw new Error('Could not load the audio sandbox. Reload and try again.');
      return response.text();
    }) } = {}) {
    return () => {
      // The client needs a worker immediately; queue runs while the pinned SDK loads.
      const worker = { onmessage: null, onerror: null, queue: [], sandbox: null, closed: false,
        postMessage(data) { if (this.closed) return; if (this.sandbox) this.sandbox.postMessage(data); else this.queue.push(data); },
        terminate() { this.closed = true; this.queue.length = 0; this.sandbox?.terminate(); } };
      Promise.resolve().then(loadSDK).then(sdk => {
        if (worker.closed) return;
        const source = Promise.all(this.FILES.map(file => fetchSource(new URL(file, base).href))).then(parts => parts.join('\n;\n'));
        // The SDK awaits source after its frame loads; handle an earlier fetch rejection too.
        source.catch(() => {});
        const pins = typeof module !== 'undefined' ? require('./neural-manifest.js') : globalThis.AudioNeuralManifest;
        const sandbox = worker.sandbox = sdk.createSandbox({ source, origin: 'opaque', base,
          proxy: [pyodide, new URL('py/', base).href, new URL('../vendor/', base).href, ...(voiceAssets ? pins.prefixes : [])],
          fetch: (url, init) => {
            if (worker.closed) throw new Error('Cancelled');
            if (pins.prefixes.some(prefix => url.startsWith(prefix))) {
              if (!voiceAssets) throw new Error('Neural voice download needs confirmation.');
              return voiceAssets.fetch(url, init);
            }
            return fetch(url, init);
          } });
        sandbox.onmessage = event => { if (!worker.closed) worker.onmessage?.(event); };
        sandbox.onerror = event => { if (!worker.closed) worker.onerror?.(event); };
        for (const data of worker.queue.splice(0)) sandbox.postMessage(data);
      }).catch(error => {
        if (!worker.closed) worker.onerror?.({ message: error.message || 'Could not start the audio sandbox.', preventDefault() {} });
      });
      return worker;
    };
  }
};
if (typeof module !== 'undefined') module.exports = AudioSandbox;
else globalThis.AudioSandbox = AudioSandbox;
})();

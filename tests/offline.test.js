const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const OfflineAssets = require('../offline-assets.js');
const AudioSandbox = require('../src/audio-sandbox.js');
const AudioCore = require('../src/audio-core.js');

test('the offline manifest covers HTML resources, sandbox files, audio.py and the pinned runtime', () => {
  const { assets, hashes } = OfflineAssets;
  const source = fs.readFileSync('index.html', 'utf8');
  for (const match of source.matchAll(/(?:src|href)="([^"<>]+)"/g)) {
    const url = match[1].split('?')[0];
    if (url === './' || /^https:\/\/(?!cdnjs)/.test(url)) continue;
    assert.ok(assets.includes(url), `index.html: ${url}`);
  }
  for (const file of AudioSandbox.FILES) assert.ok(assets.includes('src/' + file), file);
  for (const name of ['src/py/audio.py', 'vendor/hashbin-sdk-v0.4.0.mjs', 'vendor/hashbin-cache-v0.4.0.js', 'vendor/lz-string.min.js', 'service-worker.js']) assert.ok(assets.includes(name), name);
  for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', AudioCore.NUMPY_WHEEL]) assert.ok(assets.includes(AudioCore.PYODIDE_URL + file), file);
  for (const asset of assets.filter(x => !x.startsWith('https:'))) {
    assert.ok(fs.existsSync(asset), asset);
    assert.equal(hashes[asset], crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex'), asset);
  }
});

test('pinned runtime hashes agree with the Pyodide lockfile and npm package', () => {
  const lock = require('pyodide/pyodide-lock.json');
  assert.equal(OfflineAssets.hashes[AudioCore.PYODIDE_URL + AudioCore.NUMPY_WHEEL], lock.packages.numpy.sha256);
  assert.equal(lock.packages.numpy.file_name, AudioCore.NUMPY_WHEEL);
  assert.equal(require('pyodide/package.json').version, /pyodide\/v([\d.]+)\//.exec(AudioCore.PYODIDE_URL)[1]);
  for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
    assert.equal(OfflineAssets.hashes[AudioCore.PYODIDE_URL + file], crypto.createHash('sha256').update(fs.readFileSync(require.resolve('pyodide/' + file))).digest('hex'), file);
  }
  // The CSP lets the editor fetch the runtime for the sandbox proxy, and nothing broader on that CDN.
  assert.match(fs.readFileSync('index.html', 'utf8'), /connect-src [^;]*https:\/\/cdn\.jsdelivr\.net\/pyodide\/v314\.0\.7\/full\/[;\s]/);
});

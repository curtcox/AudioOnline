import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const run = (...args) => { const result = spawnSync(process.execPath, args, { stdio: 'inherit' }); if (result.status) process.exit(result.status); };
for (const dir of ['src', 'scripts', 'tests', 'tests/browser']) for (const file of await fs.readdir(dir)) {
  if (/\.(js|cjs|mjs)$/.test(file)) run('--check', dir + '/' + file);
}
for (const file of ['offline-assets.js', 'service-worker.js']) run('--check', file);
// audio.py must at least compile; the unit tests execute it with the pinned Pyodide.
const py = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open("src/py/audio.py").read())'], { stdio: 'inherit' });
if (py.error) console.warn('python3 not found; skipped audio.py syntax check (unit tests still run it).'); else if (py.status) process.exit(py.status);
run('scripts/update-offline.mjs', '--check');
// Gallery covers and previews must match the current examples and renderer (fingerprints only; nothing renders).
run('scripts/render-gallery.mjs', '--check');

run('vendor/fragment-kit-v0.3.3/tools/check.mjs');
run('vendor/fragment-kit-v0.3.3/tools/vendor-sync.mjs','--check','--target','.');
run('scripts/render-docs.mjs','--check');
run('scripts/render-kit-gallery.mjs','--check');

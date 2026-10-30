/* Renders every example in Node with the pinned Pyodide and records the expected bytes.
   Browsers must reproduce these hashes exactly (tests/browser/all.cjs): the renderer is deterministic
   across engines. Run after an intentional renderer, audio.py or example change; --check verifies. */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { render } = require('./node-python.cjs');
const { catalog } = require('../src/examples.js');
const file = new URL('../tests/golden.json', import.meta.url);
const golden = {};
const record = ({ result, hash, scene }) => {
  let peak = 0, sum = 0;
  for (const channel of result.channels) for (const v of channel) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { hash, scene, sampleRate: result.sampleRate, channels: result.channels.length, frames: result.length,
    peak: +peak.toFixed(6), rms: +Math.sqrt(sum / (result.length * result.channels.length || 1)).toFixed(6) };
};
// Keys are the example id, plus "id:Scene" for each further Scene in the file.
for (const example of catalog) {
  const first = await render(example.source, {}, example.type || 'python');
  golden[example.id] = record(first);
  for (const scene of first.scenes.slice(1)) golden[`${example.id}:${scene}`] = record(await render(example.source, { scene }));
}
const text = JSON.stringify(golden, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await fs.readFile(file, 'utf8').catch(() => '') !== text) { console.error('tests/golden.json is stale. Run node scripts/golden.mjs.'); process.exit(1); }
} else await fs.writeFile(file, text);
console.log(Object.entries(golden).map(([id, g]) => `${id}: ${g.hash.slice(0, 16)} ${(g.frames / g.sampleRate).toFixed(2)} s`).join('\n'));

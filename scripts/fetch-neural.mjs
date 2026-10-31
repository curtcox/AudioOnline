/* Test fixtures only. Production downloads on demand after consent in voice-assets.js. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), pins = require('../src/neural-manifest.js');
const directory = '.neural-cache';
const files = new Map(pins.files('kitten:Bella').map(asset => [asset.url, asset]));
if (process.argv.includes('--kokoro')) for (const asset of pins.files('kokoro:af_heart')) files.set(asset.url, asset);
await fs.mkdir(directory, { recursive: true });
for (const asset of files.values()) {
  const file = directory + '/' + asset.sha256;
  const valid = bytes => bytes?.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256;
  if (valid(await fs.readFile(file).catch(() => null))) continue;
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error('Download failed: ' + asset.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('Pinned hash mismatch: ' + asset.url);
  await fs.writeFile(file, bytes);
  console.log(`Verified ${asset.bytes} bytes: ${asset.url}`);
}

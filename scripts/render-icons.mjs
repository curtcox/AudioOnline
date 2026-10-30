/* Rasterizes icon.svg into the PNG app icons with Playwright's Chromium. */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const svg = await fs.readFile(new URL('../icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../icons/icon-${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();

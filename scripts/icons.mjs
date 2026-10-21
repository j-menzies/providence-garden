import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
for (const s of [512, 192, 180]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>body{margin:0}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  await p.screenshot({ path: `public/${s === 180 ? 'apple-touch-icon' : 'icon-' + s}.png`, omitBackground: true });
}
await b.close();

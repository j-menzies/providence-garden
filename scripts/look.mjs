import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
await p.goto('http://localhost:4173/providence-garden/');
await p.waitForTimeout(6000);
await p.screenshot({ path: process.argv[2] });
await b.close();

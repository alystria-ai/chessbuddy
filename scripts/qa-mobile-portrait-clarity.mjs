import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.QA_OUTPUT || '.verify-out/mobile-clarity';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await page.addInitScript(() => {
  localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
});
const reports = [];
try {
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Game menu', exact: true }).click({ force: true });
  await page.getByRole('button', { name: /^Game settings/ }).click({ force: true });
  await page.locator('.game-ready-coach-picker button').filter({ hasText: 'Leila' }).click({ force: true });
  await page.getByRole('button', { name: 'Close game settings', exact: true }).dispatchEvent('pointerdown');
  await page.waitForFunction(() => document.querySelector('[data-coach-id="leila"] [data-portrait-handoff="done"] canvas'), null, { timeout: 120000 });
  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-coach-id="leila"] canvas');
    const rect = canvas.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height,
      density: canvas.width / rect.width, ...window.__chessPortraitPerformanceQa.leila.sample() };
  });
  const capture = async name => {
    const clip = await page.locator('.character-window').boundingBox();
    await page.screenshot({ path: `${out}/${name}.png`, clip, timeout: 120000 });
  };
  await capture('leila-live');
  reports.push({ phase: 'initial', ...await sample() });
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.__chessPortraitPerformanceQa.leila.decline());
    await page.waitForTimeout(100);
  }
  await capture('leila-after-declines');
  reports.push({ phase: 'after-eight-declines', ...await sample() });
  // Show the real warmup image/crop in the same live layout for inspection.
  await page.evaluate(() => {
    const host = document.querySelector('[data-coach-id="leila"] .character-window');
    const image = document.createElement('img');
    image.className = 'character-warmup-img';
    image.src = '/coach-portraits/leila.png';
    host.classList.remove('is-ready', 'is-handoff-complete');
    host.append(image);
    return image.decode();
  });
  await capture('leila-warmup-crop');
} finally { await browser.close(); }
await writeFile(`${out}/report.json`, JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
process.exitCode = reports.at(-1).density >= 1.99 ? 0 : 1;

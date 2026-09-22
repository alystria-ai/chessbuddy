/** Temporal regression; software GPU evidence, never a substitute for a phone run. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.QA_OUTPUT || '.verify-out/portrait-handoff';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const dpr = Number(process.env.QA_DPR || 2);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  window.__handoffSamples = [];
  const sample = () => {
    const host = document.querySelector('.character-window');
    const canvas = host?.querySelector('canvas');
    if (canvas) {
      const coach = host.closest('[data-coach-id]')?.dataset.coachId;
      const warmup = host.querySelector('.character-warmup-img');
      window.__handoffSamples.push({
        time: performance.now(), coach, phase: host.dataset.portraitHandoff,
        warmup: !!warmup, opacity: Number(getComputedStyle(canvas).opacity),
        body: canvas.dataset[`${coach}BodyReady`], face: canvas.dataset[`${coach}FaceReady`],
        frame: canvas.dataset.portraitPresentedFrames, blink: canvas.dataset.portraitBlink,
        animationTime: canvas.dataset.portraitAnimationTime,
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
const results = [];
async function capturePortrait(name) {
  const clip = await page.locator('.character-window').boundingBox();
  if (!clip) throw new Error('Portrait window has no bounds');
  // Element screenshot waits for two stable layout frames; a software-rendered
  // full coach can miss that deadline even though the portrait is stationary.
  await page.screenshot({ path: `${output}/${name}.png`, clip, timeout: 120000 });
}
try {
  await page.goto(process.env.QA_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
  for (const coach of (process.env.QA_COACHES || 'sofia,leila,arjun,magnus').split(',')) {
    if (coach !== 'sofia') {
      await page.getByRole('button', { name: 'Game menu', exact: true }).click({ force: true });
      await page.getByRole('button', { name: /^Game settings/ }).click({ force: true });
      await page.locator('.game-ready-coach-picker button').filter({ hasText: new RegExp(coach, 'i') }).click({ force: true });
      await page.getByRole('button', { name: 'Close game settings', exact: true }).dispatchEvent('pointerdown');
      await page.locator('.game-setup-scrim').waitFor({ state: 'detached', timeout: 2000 });
    }
    await page.waitForFunction(id => document.querySelector(`[data-coach-id="${id}"] [data-portrait-handoff="done"] canvas`), coach, { timeout: 120000 });
    await capturePortrait(`${coach}-first-live`);
    await page.waitForTimeout(800);
    await capturePortrait(`${coach}-live-later`);
    const samples = await page.evaluate(id => window.__handoffSamples.filter(s => s.coach === id), coach);
    const overlap = samples.filter(s => s.warmup && s.opacity > 0);
    const first = samples.find(s => !s.warmup && s.opacity > 0);
    const liveTimes = new Set(samples.filter(s => !s.warmup && s.animationTime).map(s => s.animationTime));
    results.push({ coach, samples: samples.length, overlapFrames: overlap.length, firstLive: first, animationSamples: liveTimes.size,
      overlapDuration: overlap.length ? overlap.at(-1).time - overlap[0].time : 0 });
  }
} catch (error) { errors.push(error.message); }
const samples = await page.evaluate(() => window.__handoffSamples).catch(() => []);
await writeFile(`${output}/samples.json`, JSON.stringify(samples, null, 2));
await browser.close();
const passed = !errors.length && results.length > 0 && results.every(r => r.overlapFrames === 0
  && r.firstLive && Number(r.firstLive.frame) >= 3 && Number(r.firstLive.blink ?? 0) <= 0.15
  && (dpr < 2 || (r.firstLive.body === 'true' && r.firstLive.face === 'true' && r.animationSamples > 1)));
const report = { passed, device: 'Playwright Chromium software GPU, touch viewport', results, errors };
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = passed ? 0 : 1;

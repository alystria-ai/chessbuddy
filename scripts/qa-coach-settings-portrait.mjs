/**
 * QA for game settings close, portrait handoff, and board coordinate padding.
 *
 *   node scripts/qa-coach-settings-portrait.mjs
 *
 * Requires a running dev/preview server (default http://127.0.0.1:4173).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const outputDir = fileURLToPath(new URL('../.verify-out/coach-settings-portrait/', import.meta.url));
const viewport = { width: 390, height: 844 };

const report = {
  passed: false,
  checks: [],
  errors: [],
};

function pass(name, details = {}) {
  report.checks.push({ name, ok: true, ...details });
}

function fail(name, details = {}) {
  report.checks.push({ name, ok: false, ...details });
  throw new Error(name);
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});

try {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
      return;
    }
    if (url.pathname === '/api/convai/token') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"authToken":"qa-inert-token"}',
      });
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
    window.__blinkOverride = 0;
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.game-screen[data-screen="game"]').waitFor({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Game menu' }).click({ force: true });
  await page.getByRole('button', { name: 'Game settings' }).click({ force: true });
  await page.getByRole('dialog', { name: /game settings/i }).waitFor({ timeout: 10_000 });

  const initialCoach = await page.locator('.game-ready-coach-picker button.is-selected strong').innerText();
  const alternateCoachButton = page.locator('.game-ready-coach-picker button:not(.is-selected)').first();
  const alternateCoach = await alternateCoachButton.locator('strong').innerText();
  await alternateCoachButton.click({ force: true });
  await page.waitForFunction(
    (name) => document.querySelector('.game-ready-coach-picker button.is-selected strong')?.textContent === name,
    alternateCoach,
    { timeout: 5_000 },
  );
  pass('coach-switch-in-settings', { from: initialCoach, to: alternateCoach });

  await page.getByRole('button', { name: 'Close game settings' }).dispatchEvent('pointerdown');
  await page.waitForFunction(
    () => !document.querySelector('.game-setup-scrim'),
    undefined,
    { timeout: 2_000 },
  );
  pass('settings-close-first-pointerdown');

  const settingsStillOpen = await page.locator('.game-setup-scrim').count();
  if (settingsStillOpen !== 0) {
    fail('settings-closed-after-first-close', { settingsStillOpen });
  }

  await page.waitForFunction(
    () => {
      const windowEl = document.querySelector('.character-window');
      const canvas = windowEl?.querySelector('canvas');
      return windowEl?.classList.contains('is-ready')
        && canvas instanceof HTMLCanvasElement
        && getComputedStyle(canvas).opacity !== '0';
    },
    undefined,
    { timeout: 120_000 },
  );
  pass('live-portrait-ready');

  await page.waitForFunction(
    () => {
      const windowEl = document.querySelector('.character-window');
      if (!windowEl) return false;
      const phase = windowEl.getAttribute('data-portrait-handoff');
      const warmup = windowEl.querySelector('.character-warmup-img');
      return phase === 'done' && !warmup;
    },
    undefined,
    { timeout: 15_000 },
  );
  pass('portrait-handoff-complete');

  const handoffState = await page.evaluate(() => {
    const windowEl = document.querySelector('.character-window');
    const warmup = windowEl?.querySelector('.character-warmup-img');
    const canvas = windowEl?.querySelector('canvas');
    return {
      phase: windowEl?.getAttribute('data-portrait-handoff') ?? null,
      warmupMounted: Boolean(warmup),
      warmupOpacity: warmup ? getComputedStyle(warmup).opacity : null,
      warmupDisplay: warmup ? getComputedStyle(warmup).display : null,
      canvasVisible: canvas ? getComputedStyle(canvas).opacity : null,
      warmupObjectPosition: windowEl ? getComputedStyle(windowEl).getPropertyValue('--mobile-warmup-object-position').trim() : null,
    };
  });

  if (handoffState.phase !== 'done' || handoffState.warmupMounted) {
    fail('warmup-removed-after-handoff', handoffState);
  }
  pass('warmup-unmounted-after-handoff', handoffState);

  const labelSpacing = await page.evaluate(() => {
    const board = document.querySelector('.chess-board')?.getBoundingClientRect();
    const rank = document.querySelector('.rank-labels span')?.getBoundingClientRect();
    const file = document.querySelector('.file-labels span')?.getBoundingClientRect();
    if (!board || !rank || !file) return null;
    const rankSpan = document.querySelector('.rank-labels span')?.getBoundingClientRect();
    const fileSpan = document.querySelector('.file-labels span')?.getBoundingClientRect();
    return {
      rankToBoardGap: rankSpan ? Math.round(board.left - rankSpan.right) : null,
      fileToBoardGap: fileSpan ? Math.round(fileSpan.top - board.bottom) : null,
      gutter: getComputedStyle(document.documentElement).getPropertyValue('--compact-gutter').trim(),
    };
  });

  if (!labelSpacing || labelSpacing.rankToBoardGap < 3 || labelSpacing.fileToBoardGap < 14) {
    fail('board-label-padding', labelSpacing);
  }
  pass('board-label-padding', labelSpacing);

  await page.getByRole('button', { name: 'Game menu' }).click({ force: true });
  await page.getByRole('button', { name: 'Game settings' }).click({ force: true });
  const leilaButton = page.locator('.game-ready-coach-picker button').filter({ hasText: 'Leila' });
  await leilaButton.click({ force: true });
  await page.getByRole('button', { name: 'Close game settings' }).click({ force: true });
  await page.waitForFunction(() => !document.querySelector('.game-setup-scrim'), undefined, { timeout: 2_000 });
  pass('settings-close-after-coach-switch-click');
  await page.waitForFunction(
    () => document.querySelector('.coach-card[data-coach-id="leila"] .character-window.is-ready canvas'),
    undefined,
    { timeout: 120_000 },
  );
  const leilaWarmupPosition = await page.evaluate(() => {
    const windowEl = document.querySelector('.coach-card[data-coach-id="leila"] .character-window');
    return windowEl?.style.getPropertyValue('--mobile-warmup-object-position').trim()
      || getComputedStyle(windowEl).getPropertyValue('--mobile-warmup-object-position').trim();
  });
  if (leilaWarmupPosition !== '70% 6%' && leilaWarmupPosition !== '70% 6.0%') {
    fail('leila-warmup-css-var', { leilaWarmupPosition });
  }
  pass('leila-warmup-alignment', { leilaWarmupPosition });

  await page.screenshot({ path: join(outputDir, 'after-handoff-390x844.png'), fullPage: true });
  await page.screenshot({ path: join(outputDir, 'leila-ready-390x844.png'), fullPage: true });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errors.push(String(error instanceof Error ? error.message : error));
  try {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: join(outputDir, 'failure-390x844.png'), fullPage: true });
    }
  } catch {
    // ignore secondary screenshot failures
  }
} finally {
  await browser.close();
}

await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);

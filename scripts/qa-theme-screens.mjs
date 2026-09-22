import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/theme-screens/', import.meta.url));
const specimens = [
  ['modernist', 'bauhaus'],
  ['print-editorial', 'newspaper'],
  ['heritage', 'persian-miniature'],
  ['material', 'kinetic-chrome'],
  ['retro-digital', 'desktop-90s'],
  ['future-worlds', 'lunar-colony'],
  ['story-drama', 'pop-art-comic'],
  ['escapes', 'nordic-frost'],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertViewport(page, label) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    visibleMain: Boolean(document.querySelector('main')),
  }));
  assert(metrics.visibleMain, `${label}: no main screen is mounted`);
  assert(metrics.documentWidth <= metrics.viewportWidth + 1, `${label}: horizontal overflow`);
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [];

await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/auth/me') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
  } else if (url.hostname === '127.0.0.1') {
    await route.continue();
  } else {
    await route.abort();
  }
});

const page = await context.newPage();
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) {
    errors.push(`console: ${message.text()}`);
  }
});

async function loadMenu(themeId) {
  if (page.url() === 'about:blank') {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.evaluate((id) => localStorage.setItem('classic-chess.theme.v1', id), themeId);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.menu-screen').waitFor();
  await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
}

try {
  for (const [categoryId, themeId] of specimens) {
    await loadMenu(themeId);
    await assertViewport(page, `${themeId}/menu`);

    await page.getByRole('button', { name: /My Games/ }).click();
    await page.locator('.games-layout').waitFor();
    await assertViewport(page, `${themeId}/games`);
    await page.screenshot({ path: join(outputDir, `${categoryId}-${themeId}-games.png`) });

    await loadMenu(themeId);
    await page.getByRole('button', { name: /Custom Coach/ }).click();
    await page.locator('.creator-layout').waitFor();
    await assertViewport(page, `${themeId}/creator`);
    await page.screenshot({ path: join(outputDir, `${categoryId}-${themeId}-creator.png`) });

    await loadMenu(themeId);
    await page.getByRole('button', { name: /Puzzles with AI/ }).click();
    await page.getByRole('button', { name: 'Start Puzzles' }).click();
    // Live Convai traffic is intentionally blocked in visual QA. Depending on
    // whether the cached coach is ready, capture either the puzzle intro or its
    // themed loading state without sending credentials off-machine.
    await page.locator('.puzzle-cover, .puzzle-intro-overlay, .loading-screen').first().waitFor({ timeout: 15_000 });
    await assertViewport(page, `${themeId}/puzzles`);
    await page.screenshot({ path: join(outputDir, `${categoryId}-${themeId}-puzzles.png`) });

    await loadMenu(themeId);
    await page.locator('.api-key-badge').click();
    await page.locator('.api-key-modal').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outputDir, `${categoryId}-${themeId}-api-modal.png`) });

    await loadMenu(themeId);
    const signIn = page.locator('.auth-signin-trigger');
    if (await signIn.count()) {
      await signIn.click();
      await page.locator('.auth-signin-modal').waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outputDir, `${categoryId}-${themeId}-auth-modal.png`) });
    }
  }

  assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ categories: specimens.length, screens: 5, errors, output: outputDir }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

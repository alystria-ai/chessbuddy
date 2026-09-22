import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/theme-controls/', import.meta.url));
const specimens = [
  ['modernist', 'flat-icon'],
  ['modernist', 'swiss'],
  ['retro-digital', 'arcade-neon'],
  ['story-drama', 'pop-art-comic'],
  ['material', 'kinetic-chrome'],
];

const forbiddenLegacyChannels = [
  '216, 167, 79',
  '242, 207, 128',
  '241, 207, 130',
  '246, 216, 145',
  '205, 160, 70',
  '164, 95, 52',
  '192, 138, 106',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function selectTheme(page, categoryId, themeId) {
  const trigger = page.locator('.theme-switcher-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.locator(`.theme-category-tab[data-category-id="${categoryId}"]`).click();
  await page.locator(`.theme-option[data-theme-id="${themeId}"]`).click();
  await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
}

async function legacyLeaks(page, selectors) {
  return page.evaluate(({ requested, forbidden }) => {
    return requested.flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
      const style = getComputedStyle(element);
      const rendered = [
        style.color,
        style.backgroundColor,
        style.backgroundImage,
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
        style.boxShadow,
        style.outlineColor,
      ].join(' | ');
      const channel = forbidden.find((candidate) => rendered.includes(candidate));
      return channel ? [{ selector, className: element.className, channel, rendered }] : [];
    }));
  }, { requested: selectors, forbidden: forbiddenLegacyChannels });
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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
await page.addInitScript(() => localStorage.setItem('classic-chess.theme.v1', 'flat-icon'));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.menu-screen').waitFor();

  for (const [categoryId, themeId] of specimens) {
    await selectTheme(page, categoryId, themeId);
    const leaks = await legacyLeaks(page, [
      '.api-key-badge',
      '.coaching-control-info',
      '.coaching-control-option.is-selected',
    ]);
    assert(leaks.length === 0, `${themeId}/menu: ${JSON.stringify(leaks[0])}`);
  }

  await page.keyboard.press('Escape');
  await page.locator('.menu-play').click();
  await page.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
  await page.locator('.chess-board').waitFor({ state: 'visible' });

  for (const [categoryId, themeId] of specimens) {
    await selectTheme(page, categoryId, themeId);
    await page.keyboard.press('Escape');

    const developerButton = page.getByRole('button', { name: 'Developer options' });
    await developerButton.click();
    await page.locator('.dev-menu-panel').waitFor({ state: 'visible' });

    const leaks = await legacyLeaks(page, [
      '.topbar-actions > span',
      '.debug-copy-button.is-active',
      '.audio-btn',
      '.coach-chat-btn',
      '.dev-menu-head',
      '.dev-menu-row',
      '.dev-switch',
      '.dev-switch-knob',
      '.dev-menu-foot',
    ]);
    assert(leaks.length === 0, `${themeId}/game: ${JSON.stringify(leaks[0])}`);
    await page.screenshot({ path: join(outputDir, `${themeId}-developer-controls.png`) });
    await developerButton.click();
  }

  console.log(JSON.stringify({ themes: specimens.length, menuControls: 3, gameControlSelectors: 9, legacyLeaks: 0, output: outputDir }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

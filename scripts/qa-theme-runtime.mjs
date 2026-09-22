import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/themes/', import.meta.url));

const themeCategories = [
  ['original', ['classic']],
  ['modernist', ['flat-icon', 'swiss', 'neo-brutalist', 'bauhaus', 'memphis-pop']],
  ['print-editorial', ['hand-drawn', 'newspaper', 'risograph', 'editorial', 'botanical-engraving']],
  ['heritage', ['art-deco', 'japanese-minimal', 'stained-glass', 'royal-opera', 'persian-miniature']],
  ['material', ['wooden', 'marble', 'soft-clay', 'mediterranean-ceramic', 'kinetic-chrome']],
  ['retro-digital', ['terminal', 'arcade-neon', 'frutiger-aero', 'desktop-90s', 'vaporwave-dream']],
  ['future-worlds', ['blueprint', 'cyberpunk-hud', 'solarpunk-conservatory', 'cosmic-observatory', 'lunar-colony']],
  ['story-drama', ['noir-detective', 'library-at-midnight', 'candy-kawaii', 'dark-academia', 'pop-art-comic']],
  ['escapes', ['desert-modernism', 'oceanic-biome', 'alpine-lodge', 'nordic-frost', 'tropical-resort']],
];

const themeIds = themeCategories.flatMap(([, ids]) => ids);
const artisticThemeIds = themeIds.filter((id) => id !== 'classic');
const legacyGoldChannels = [
  '216, 167, 79',
  '242, 207, 128',
  '241, 207, 130',
  '246, 216, 145',
  '205, 160, 70',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function pageMetrics(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    screen: document.querySelector('main')?.className ?? '',
  }));
}

async function visualSignature(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const heading = document.querySelector('.menu-heading');
    const headingStyle = heading ? getComputedStyle(heading) : null;
    return [
      '--theme-page', '--theme-surface', '--theme-surface-2', '--theme-text',
      '--theme-accent', '--theme-accent-2', '--theme-board-light', '--theme-board-dark',
      '--theme-board-frame', '--theme-radius', '--theme-font-display',
    ].map((property) => root.getPropertyValue(property).trim()).concat([
      body.backgroundImage,
      headingStyle?.backgroundImage ?? '',
      headingStyle?.borderRadius ?? '',
    ]);
  });
}

async function menuLayoutSignature(page) {
  return page.evaluate(() => {
    const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
    const workspace = document.querySelector('.menu-workspace').getBoundingClientRect();
    const quantizedRect = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      const quantize = (value, basis) => Math.round((value / Math.max(1, basis)) * 40) / 40;
      return [
        quantize(rect.x - workspace.x, workspace.width),
        quantize(rect.y - workspace.y, workspace.height),
        quantize(rect.width, workspace.width),
        quantize(rect.height, workspace.height),
      ];
    };
    const workspaceStyle = styleOf('.menu-workspace');
    const modeStyle = styleOf('.mode-grid');
    const setupStyle = styleOf('.setup-panel');
    return {
      workspace: [workspaceStyle.gridTemplateColumns, workspaceStyle.gridTemplateRows, workspaceStyle.gridTemplateAreas],
      modes: [modeStyle.gridTemplateColumns, modeStyle.gridTemplateRows],
      setup: [setupStyle.gridTemplateColumns, setupStyle.gridTemplateRows, setupStyle.gridTemplateAreas],
      sections: ['.menu-heading', '.mode-grid', '.setup-panel', '.mode-launch'].map(quantizedRect),
      setupChildren: [
        '.setup-panel > .setup-panel-coach',
        '.setup-panel > :nth-child(2)',
        '.setup-panel > .coach-summary-stack',
      ].map(quantizedRect),
    };
  });
}

async function assertMenuGeometry(page, context) {
  const result = await page.evaluate(() => {
    const selectors = ['.menu-heading', '.mode-grid', '.setup-panel', '.mode-launch'];
    const viewportWidth = document.documentElement.clientWidth;
    return selectors.map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        selector,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        display: getComputedStyle(document.querySelector(selector)).display,
        viewportWidth,
      };
    });
  });
  for (const item of result) {
    assert(item.display !== 'none' && item.width > 0 && item.height > 0, `${context}: ${item.selector} is not visible`);
    assert(item.left >= -1 && item.right <= item.viewportWidth + 1, `${context}: ${item.selector} escaped horizontally`);
  }
}

async function assertNoLegacyGold(page, selectors, context) {
  const leaks = await page.evaluate(({ selectors: requested, channels }) => {
    const properties = (element) => {
      const style = getComputedStyle(element);
      return [
        style.color, style.backgroundColor, style.backgroundImage,
        style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor,
        style.boxShadow, style.outlineColor, style.fill, style.stroke,
      ].join(' | ');
    };
    return requested.flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
      const rendered = properties(element);
      const channel = channels.find((candidate) => rendered.includes(candidate));
      return channel ? [{ selector, channel, rendered }] : [];
    }));
  }, { selectors, channels: legacyGoldChannels });
  assert(leaks.length === 0, `${context}: legacy gold leak ${JSON.stringify(leaks[0])}`);
}

function signatureDifference(left, right) {
  return left.reduce((count, value, index) => count + Number(value !== right[index]), 0);
}

async function openSwitcher(page) {
  const trigger = page.locator('.theme-switcher-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.locator('.theme-switcher-popover').waitFor({ state: 'visible' });
}

async function activateCategory(page, categoryId) {
  const tab = page.locator(`.theme-category-tab[data-category-id="${categoryId}"]`);
  await tab.click();
  await page.waitForFunction(
    (id) => document.querySelector(`.theme-category-tab[data-category-id="${id}"]`)?.getAttribute('aria-selected') === 'true',
    categoryId,
  );
}

async function selectTheme(page, themeId) {
  await openSwitcher(page);
  const category = themeCategories.find(([, ids]) => ids.includes(themeId));
  assert(category, `missing category mapping for ${themeId}`);
  await activateCategory(page, category[0]);
  await page.locator(`.theme-option[data-theme-id="${themeId}"]`).click();
  await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
}

async function assertSwitcherGeometry(page, viewportName) {
  const metrics = await pageMetrics(page);
  const desktopLayout = metrics.viewportWidth > 760;
  const triggerBox = await page.locator('.theme-switcher-trigger').boundingBox();
  const panelBox = await page.locator('.theme-switcher-popover').boundingBox();
  const authBox = await page.locator('.menu-auth-slot .auth-control').boundingBox();

  assert(triggerBox, `${viewportName}: switcher trigger is not measurable`);
  assert(panelBox, `${viewportName}: switcher panel is not measurable`);
  assert(triggerBox.x >= -1, `${viewportName}: trigger escaped the left edge`);
  assert(triggerBox.x + triggerBox.width <= metrics.viewportWidth + 1, `${viewportName}: trigger escaped the right edge`);
  assert(panelBox.x >= -1, `${viewportName}: panel escaped the left edge`);
  assert(panelBox.y >= -1, `${viewportName}: panel escaped the top edge`);
  assert(panelBox.x + panelBox.width <= metrics.viewportWidth + 1, `${viewportName}: panel escaped the right edge`);
  assert(panelBox.y + panelBox.height <= metrics.viewportHeight + 1, `${viewportName}: panel escaped the bottom edge`);
  assert(metrics.documentWidth <= metrics.viewportWidth + 1, `${viewportName}: horizontal overflow`);
  if (authBox) assert(!boxesOverlap(triggerBox, authBox), `${viewportName}: visual-style trigger overlaps Sign in`);

  if (desktopLayout) {
    assert(triggerBox.x <= 24, `${viewportName}: rail is not anchored to the left edge`);
    assert(panelBox.x >= triggerBox.x + triggerBox.width - 2, `${viewportName}: style panel is not beside the rail`);
  }

  const childGeometry = await page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
      };
    };
    const overlaps = (left, right) => Boolean(left && right
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top);
    return {
      browser: box(document.querySelector('.theme-switcher-browser')),
      rail: box(document.querySelector('.theme-category-rail')),
      stylePanel: box(document.querySelector('.theme-style-panel')),
      tabs: [...document.querySelectorAll('.theme-category-tab')].map((tab) => {
        const tabBox = box(tab);
        return {
          width: tabBox?.width ?? 0,
          height: tabBox?.height ?? 0,
          labelCountOverlap: overlaps(
            box(tab.querySelector('.theme-category-label')),
            box(tab.querySelector('.theme-category-count')),
          ),
        };
      }),
      options: [...document.querySelectorAll('.theme-option')].map((option) => {
        const optionBox = box(option);
        return {
          width: optionBox?.width ?? 0,
          height: optionBox?.height ?? 0,
          copyMetaOverlap: overlaps(
            box(option.querySelector('.theme-option-copy')),
            box(option.querySelector('.theme-option-meta')),
          ),
          overflow: option.scrollWidth > option.clientWidth + 1,
        };
      }),
    };
  });

  assert(childGeometry.tabs.every((tab) => tab.height >= 44), `${viewportName}: category hit target is under 44px`);
  assert(childGeometry.tabs.every((tab) => !tab.labelCountOverlap), `${viewportName}: category label overlaps its count`);
  assert(childGeometry.options.every((option) => option.height >= 44), `${viewportName}: preset hit target is under 44px`);
  assert(childGeometry.options.every((option) => !option.copyMetaOverlap), `${viewportName}: preset copy overlaps metadata`);
  assert(childGeometry.options.every((option) => !option.overflow), `${viewportName}: preset content overflows its card`);
  if (desktopLayout) {
    assert(
      childGeometry.rail && childGeometry.stylePanel
        && childGeometry.stylePanel.left >= childGeometry.rail.right - 1,
      `${viewportName}: category rail and style panel are not adjacent columns`,
    );
    assert(childGeometry.rail.width >= 120, `${viewportName}: category rail is too cramped`);
    assert(childGeometry.stylePanel.width >= 360, `${viewportName}: style panel is too cramped`);
  } else {
    assert(
      childGeometry.rail && childGeometry.stylePanel
        && childGeometry.stylePanel.top >= childGeometry.rail.bottom - 1,
      `${viewportName}: style panel is not below the mobile category strip`,
    );
  }
}

async function checkThemeMatrix(page, viewportName) {
  await openSwitcher(page);
  const categoryCount = await page.locator('.theme-category-tab').count();
  assert(categoryCount === 9, `${viewportName}: expected 9 category tabs, found ${categoryCount}`);
  await assertSwitcherGeometry(page, viewportName);

  const seen = new Set();
  const signatures = new Map();
  const layoutSignatures = new Map();
  for (const [categoryId, categoryThemeIds] of themeCategories) {
    await activateCategory(page, categoryId);
    const optionCount = await page.locator('.theme-option').count();
    assert(optionCount === categoryThemeIds.length, `${viewportName}/${categoryId}: expected ${categoryThemeIds.length} options, found ${optionCount}`);

    for (const themeId of categoryThemeIds) {
      const option = page.locator(`.theme-option[data-theme-id="${themeId}"]`);
      assert(await option.count() === 1, `${viewportName}/${categoryId}: ${themeId} is missing or duplicated`);
      seen.add(themeId);
      await option.click();
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
      const metrics = await pageMetrics(page);
      assert(metrics.theme === themeId, `${viewportName}/${themeId}: root theme did not update`);
      assert(
        metrics.documentWidth <= metrics.viewportWidth + 1,
        `${viewportName}/${themeId}: horizontal overflow ${metrics.documentWidth} > ${metrics.viewportWidth}`,
      );
      await assertSwitcherGeometry(page, viewportName);
      signatures.set(themeId, await visualSignature(page));
      await assertMenuGeometry(page, `${viewportName}/${themeId}`);
      if (themeId !== 'classic') {
        await assertNoLegacyGold(
          page,
          ['.api-key-badge', '.coaching-control-info', '.coaching-control-option.is-selected'],
          `${viewportName}/${themeId}`,
        );
        if (viewportName === 'wide') layoutSignatures.set(themeId, await menuLayoutSignature(page));
      }

      if (viewportName === 'wide') {
        await page.keyboard.press('Escape');
        await page.screenshot({ path: join(outputDir, `${viewportName}-${themeId}.png`) });
        await openSwitcher(page);
        await activateCategory(page, categoryId);
      }
    }
  }

  assert(seen.size === 41, `${viewportName}: expected 41 unique styles, found ${seen.size}`);
  assert(themeIds.every((themeId) => seen.has(themeId)), `${viewportName}: theme inventory mismatch`);
  if (viewportName === 'wide') {
    for (let leftIndex = 0; leftIndex < themeIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < themeIds.length; rightIndex += 1) {
        const leftId = themeIds[leftIndex];
        const rightId = themeIds[rightIndex];
        const difference = signatureDifference(signatures.get(leftId), signatures.get(rightId));
        assert(difference >= 4, `${leftId}/${rightId}: only ${difference} of 14 visual signature fields differ`);
      }
    }
    const uniqueLayouts = new Set(artisticThemeIds.map((themeId) => JSON.stringify(layoutSignatures.get(themeId))));
    assert(uniqueLayouts.size === 40, `wide: expected 40 unique computed menu layouts, found ${uniqueLayouts.size}`);
  }
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];

async function prepareContext(viewport) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (url.hostname === '127.0.0.1') await route.continue();
    else await route.abort();
  });
  return context;
}

function collectErrors(page, prefix = '') {
  page.on('pageerror', (error) => errors.push(`${prefix}pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${prefix}response ${response.status()}: ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${prefix}console: ${message.text()}`);
  });
}

try {
  const freshContext = await prepareContext({ width: 1440, height: 900 });
  const fresh = await freshContext.newPage();
  collectErrors(fresh, 'fresh-default ');
  await fresh.goto(baseUrl, { waitUntil: 'networkidle' });
  await fresh.locator('.menu-screen').waitFor();
  assert((await pageMetrics(fresh)).theme === 'classic', 'fresh install did not start in Original Classic');
  await fresh.screenshot({ path: join(outputDir, 'original-default.png') });
  await freshContext.close();

  const context = await prepareContext({ width: 1440, height: 900 });
  const page = await context.newPage();
  collectErrors(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.menu-screen').waitFor();

  await checkThemeMatrix(page, 'wide');

  // Keyboard contract: category tabs use a vertical tablist; theme choices use radio navigation.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.classList.contains('theme-switcher-trigger'));
  assert(
    await page.locator('.theme-switcher-trigger').evaluate((element) => element === document.activeElement),
    'Escape did not restore focus to the switcher trigger',
  );
  await page.locator('.theme-switcher-trigger').press('Enter');
  const selectedTab = page.locator('.theme-category-tab[aria-selected="true"]');
  await selectedTab.focus();
  const categoryBefore = await selectedTab.getAttribute('data-category-id');
  await selectedTab.press('ArrowDown');
  const categoryAfter = await page.locator('.theme-category-tab[aria-selected="true"]').getAttribute('data-category-id');
  assert(categoryAfter && categoryAfter !== categoryBefore, 'ArrowDown did not activate the next category');

  const selectedOption = page.locator('.theme-option[aria-checked="true"]');
  const focusOption = await selectedOption.count() ? selectedOption : page.locator('.theme-option').first();
  await focusOption.focus();
  const selectedBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await focusOption.press('ArrowDown');
  const selectedAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(selectedAfter && selectedAfter !== selectedBefore, 'ArrowDown did not select the next theme');
  await page.keyboard.press('Escape');

  // Persistence survives a full reload.
  await selectTheme(page, 'persian-miniature');
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'networkidle' });
  assert((await pageMetrics(page)).theme === 'persian-miniature', 'theme did not persist across reload');

  // Route continuity: changing style must not navigate or replace the active screen.
  await page.getByRole('button', { name: /My Games/ }).click();
  await page.locator('.games-layout').waitFor();
  const routeBefore = await page.locator('main').getAttribute('class');
  await selectTheme(page, 'terminal');
  const routeAfter = await page.locator('main').getAttribute('class');
  assert(routeAfter === routeBefore, 'theme selection changed the active app screen');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(outputDir, 'wide-my-games-terminal.png') });
  await context.close();

  const mobileContext = await prepareContext({ width: 390, height: 844 });
  const mobile = await mobileContext.newPage();
  collectErrors(mobile, 'mobile ');
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
  await mobile.locator('.menu-screen').waitFor();
  await checkThemeMatrix(mobile, 'mobile');
  await mobile.screenshot({ path: join(outputDir, 'mobile-switcher-open.png') });
  await mobile.keyboard.press('Escape');
  await mobile.screenshot({ path: join(outputDir, 'mobile-menu-kinetic-chrome.png'), fullPage: true });
  await mobileContext.close();

  // Breakpoint smoke matrix: rail/panel geometry, safe containment, and ARIA
  // orientation at desktop, tablet, narrow phone, and short landscape sizes.
  const responsiveViewports = [
    ['tablet-wide', 1024, 768],
    ['tablet-portrait', 768, 1024],
    ['phone-narrow', 360, 800],
    ['short-landscape', 844, 390],
  ];
  for (const [name, width, height] of responsiveViewports) {
    const responsiveContext = await prepareContext({ width, height });
    const responsive = await responsiveContext.newPage();
    collectErrors(responsive, `${name} `);
    await responsive.addInitScript(() => localStorage.setItem('classic-chess.theme.v1', 'kinetic-chrome'));
    await responsive.goto(baseUrl, { waitUntil: 'networkidle' });
    await responsive.locator('.menu-screen').waitFor();
    await openSwitcher(responsive);
    await assertSwitcherGeometry(responsive, name);
    const expectedOrientation = width <= 760 ? 'horizontal' : 'vertical';
    assert(
      await responsive.locator('.theme-category-rail').getAttribute('aria-orientation') === expectedOrientation,
      `${name}: category rail ARIA orientation does not match its layout`,
    );
    await responsive.screenshot({ path: join(outputDir, `${name}-switcher-open.png`) });
    await responsiveContext.close();
  }

  assert(errors.length === 0, `browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ themes: themeIds.length, artisticPresets: artisticThemeIds.length, uniqueMenuLayouts: 40, categories: themeCategories.length, viewports: 6, errors, output: outputDir }, null, 2));
} finally {
  await browser.close();
}

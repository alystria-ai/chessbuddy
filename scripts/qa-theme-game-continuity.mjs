import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/themes/', import.meta.url));
const fastLayoutOnly = process.env.QA_FAST_LAYOUTS === '1';
const themeCategories = [
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function settlePortraitCanvas(page) {
  const canvas = page.locator('.character-window.is-ready canvas');
  await canvas.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const element = document.querySelector('.character-window.is-ready canvas');
    if (!(element instanceof HTMLCanvasElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || element.width <= 0 || element.height <= 0) return false;
    const cssAspect = rect.width / rect.height;
    const bufferAspect = element.width / element.height;
    return Math.abs(cssAspect - bufferAspect) <= 0.02;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
}

async function gameLayoutSignature(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell:not(.analysis-shell)');
    const shellRect = shell.getBoundingClientRect();
    const quantizedRect = (selector) => {
      const rect = shell.querySelector(selector).getBoundingClientRect();
      const q = (value, basis) => Math.round((value / Math.max(1, basis)) * 50) / 50;
      return [q(rect.x - shellRect.x, shellRect.width), q(rect.y - shellRect.y, shellRect.height), q(rect.width, shellRect.width), q(rect.height, shellRect.height)];
    };
    const shellStyle = getComputedStyle(shell);
    return {
      grid: [shellStyle.gridTemplateColumns, shellStyle.gridTemplateRows, shellStyle.gridTemplateAreas],
      rects: ['.coach-card', '.game-stage', '.side-panel'].map(quantizedRect),
      align: ['.coach-card', '.game-stage', '.side-panel'].map((selector) => {
        const style = getComputedStyle(shell.querySelector(selector));
        return [style.gridArea, style.alignSelf, style.justifySelf];
      }),
    };
  });
}

async function assertGameGeometry(page, themeId) {
  const geometry = await page.evaluate(() => {
    const selectors = ['.coach-card', '.game-stage', '.side-panel'];
    const rectangles = selectors.map((selector) => {
      const rect = document.querySelector(`.app-shell:not(.analysis-shell) > ${selector}`).getBoundingClientRect();
      return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    const board = document.querySelector('.chess-board').getBoundingClientRect();
    return {
      rectangles,
      board: { width: board.width, height: board.height },
      squares: document.querySelectorAll('.chess-board .square').length,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  for (const rect of geometry.rectangles) {
    assert(rect.width > 0 && rect.height > 0, `${themeId}: ${rect.selector} is not visible`);
    assert(rect.left >= -1 && rect.right <= geometry.viewportWidth + 1, `${themeId}: ${rect.selector} escaped horizontally`);
  }
  for (let leftIndex = 0; leftIndex < geometry.rectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < geometry.rectangles.length; rightIndex += 1) {
      const left = geometry.rectangles[leftIndex];
      const right = geometry.rectangles[rightIndex];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      assert(
        overlapWidth <= 1 || overlapHeight <= 1,
        `${themeId}: ${left.selector} overlaps ${right.selector} by ${Math.round(overlapWidth)}x${Math.round(overlapHeight)}px`,
      );
    }
  }
  const railRight = await page.locator('.theme-switcher-trigger').evaluate((element) => element.getBoundingClientRect().right);
  for (const rect of geometry.rectangles) {
    assert(rect.left >= railRight + 8, `${themeId}: ${rect.selector} collides with the visual-style rail`);
  }
  assert(Math.abs(geometry.board.width - geometry.board.height) <= 2, `${themeId}: board is not square`);
  assert(geometry.squares === 64, `${themeId}: expected 64 board squares, found ${geometry.squares}`);
  assert(geometry.documentWidth <= geometry.viewportWidth + 1, `${themeId}: horizontal document overflow`);
}

await mkdir(outputDir, { recursive: true });
const progressPath = join(outputDir, 'game-continuity-progress.json');
async function checkpoint(stage, extra = {}) {
  await writeFile(progressPath, `${JSON.stringify({ stage, ...extra }, null, 2)}\n`, 'utf8');
}
await checkpoint('launching-browser');
const browser = await chromium.launch({ headless: true });

try {
  await checkpoint('creating-context');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (url.hostname === '127.0.0.1') {
      await route.continue();
    } else {
      // The continuity probe must never call Convai or other external services.
      await route.abort();
    }
  });

  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('classic-chess.theme.v1', 'wooden'));
  await checkpoint('navigating');
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await checkpoint('menu-visible');
  await page.locator('.menu-screen').waitFor();
  await page.locator('.menu-play').click();
  await checkpoint('launch-clicked');
  await page.locator('.loading-screen').waitFor({ state: 'visible', timeout: 15_000 });
  await checkpoint('loading-visible');
  await page.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
  await page.locator('.chess-board').waitFor({ state: 'visible' });
  await checkpoint('game-visible');
  await settlePortraitCanvas(page);
  await checkpoint('portrait-ready');

  // Give the live component an in-progress UI state that would disappear on remount.
  await page.locator('.square[aria-label^="e2 white p"]').click({ timeout: 10_000 });
  await checkpoint('selection-clicked');
  await page.waitForFunction(() => document.querySelector('.square.selected')?.getAttribute('aria-label')?.startsWith('e2'));
  await checkpoint('selection-ready');
  await page.evaluate(() => {
    window.__qaChessBoard = document.querySelector('.chess-board');
    window.__qaPortraitCanvas = document.querySelector('.character-window canvas');
  });
  const boardBefore = await page.locator('.chess-board').innerText();
  const selectedBefore = await page.locator('.square.selected').getAttribute('aria-label');
  const moveRowsBefore = await page.locator('.move-card li, .move-list li, .history-row').count();
  if (!fastLayoutOnly) await page.screenshot({ path: join(outputDir, 'game-wooden-selected-e2.png') });
  await checkpoint('theme-loop-ready');

  if (!fastLayoutOnly) await page.locator('.theme-switcher-trigger').click();
  const layoutSignatures = new Map();
  const processedThemes = [];
  for (const [categoryId, categoryThemeIds] of themeCategories) {
    if (!fastLayoutOnly) await page.locator(`.theme-category-tab[data-category-id="${categoryId}"]`).click();
    for (const themeId of categoryThemeIds) {
      if (fastLayoutOnly) await checkpoint('theme-start', { currentTheme: themeId, processedThemes });
      if (fastLayoutOnly) {
        await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, themeId);
      } else {
        await page.locator(`.theme-option[data-theme-id="${themeId}"]`).click();
      }
      await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
      if (fastLayoutOnly) await checkpoint('theme-applied', { currentTheme: themeId, processedThemes });
      if (!fastLayoutOnly) await settlePortraitCanvas(page);

      const stateNow = await page.evaluate(() => ({
        sameBoardNode: window.__qaChessBoard === document.querySelector('.chess-board'),
        samePortraitCanvas: window.__qaPortraitCanvas === document.querySelector('.character-window canvas'),
        screenVisible: Boolean(document.querySelector('.game-screen')),
        boardText: document.querySelector('.chess-board')?.innerText ?? '',
        selectedSquare: document.querySelector('.square.selected')?.getAttribute('aria-label') ?? null,
        moveRows: document.querySelectorAll('.move-card li, .move-list li, .history-row').length,
      }));
      assert(stateNow.sameBoardNode, `${themeId}: ChessBoard DOM node was replaced`);
      assert(stateNow.samePortraitCanvas, `${themeId}: portrait canvas was replaced`);
      assert(stateNow.screenVisible, `${themeId}: active game screen disappeared`);
      assert(stateNow.boardText === boardBefore, `${themeId}: board position changed`);
      assert(stateNow.selectedSquare === selectedBefore, `${themeId}: selected square changed`);
      assert(stateNow.moveRows === moveRowsBefore, `${themeId}: move history changed`);
      if (fastLayoutOnly) await checkpoint('theme-state-checked', { currentTheme: themeId, processedThemes });
      await assertGameGeometry(page, themeId);
      if (fastLayoutOnly) await checkpoint('theme-geometry-checked', { currentTheme: themeId, processedThemes });
      layoutSignatures.set(themeId, await gameLayoutSignature(page));
      processedThemes.push(themeId);
      if (fastLayoutOnly) {
        await checkpoint('themes', { processedThemes, currentTheme: themeId });
      }

      if (!fastLayoutOnly) await page.keyboard.press('Escape');
      if (!fastLayoutOnly) {
        await settlePortraitCanvas(page);
        await page.screenshot({ path: join(outputDir, `game-${themeId}.png`) });
      }
      if (!fastLayoutOnly) {
        await page.locator('.theme-switcher-trigger').click();
        await page.locator(`.theme-category-tab[data-category-id="${categoryId}"]`).click();
      }
    }
  }

  const uniqueGameLayouts = new Set(themeIds.map((themeId) => JSON.stringify(layoutSignatures.get(themeId))));
  assert(uniqueGameLayouts.size === 40, `expected 40 unique computed game layouts, found ${uniqueGameLayouts.size}`);

  const stateAfter = await page.evaluate(() => ({
    sameBoardNode: window.__qaChessBoard === document.querySelector('.chess-board'),
    samePortraitCanvas: window.__qaPortraitCanvas === document.querySelector('.character-window canvas'),
    screenVisible: Boolean(document.querySelector('.game-screen')),
  }));
  const boardAfter = await page.locator('.chess-board').innerText();
  const selectedAfter = await page.locator('.square.selected').getAttribute('aria-label');
  const moveRowsAfter = await page.locator('.move-card li, .move-list li, .history-row').count();

  assert(stateAfter.sameBoardNode, 'ChessBoard DOM node was replaced during theme switching');
  assert(stateAfter.samePortraitCanvas, 'portrait canvas was replaced during theme switching');
  assert(stateAfter.screenVisible, 'active game screen disappeared during theme switching');
  assert(boardAfter === boardBefore, 'board position changed during theme switching');
  assert(selectedAfter === selectedBefore, 'selected square state changed during theme switching');
  assert(moveRowsAfter === moveRowsBefore, 'move history changed during theme switching');

  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (!fastLayoutOnly) await page.screenshot({ path: join(outputDir, 'game-tropical-resort-selected-e2.png') });
  const result = {
    sameBoardNode: stateAfter.sameBoardNode,
    samePortraitCanvas: stateAfter.samePortraitCanvas,
    selectedSquare: selectedAfter,
    moveRows: moveRowsAfter,
    themesApplied: themeIds,
    uniqueGameLayouts: uniqueGameLayouts.size,
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
  };
  await writeFile(join(outputDir, 'game-continuity-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const failure = {
    passed: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  await writeFile(join(outputDir, 'game-continuity-result.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  await browser.close();
}

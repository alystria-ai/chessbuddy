import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'https://chessbuddy.live';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
await page.addInitScript(() => {
  localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.locator('.game-screen[data-screen="game"]').waitFor({ timeout: 30_000 });

const data = await page.evaluate(() => {
  const board = document.querySelector('.chess-board')?.getBoundingClientRect();
  const fileLabels = document.querySelector('.file-labels');
  const fileSpan = document.querySelector('.file-labels span');
  const wrap = document.querySelector('.board-wrap');
  const cs = fileLabels ? getComputedStyle(fileLabels) : null;
  const wcs = wrap ? getComputedStyle(wrap) : null;
  return {
    boardBottom: board?.bottom,
    fileLabelsTop: fileLabels?.getBoundingClientRect().top,
    fileSpanTop: fileSpan?.getBoundingClientRect().top,
    boardToLabelsGap: board && fileLabels ? Math.round(fileLabels.getBoundingClientRect().top - board.bottom) : null,
    boardToLetterGap: board && fileSpan ? Math.round(fileSpan.getBoundingClientRect().top - board.bottom) : null,
    fileLabelsPosition: cs?.position,
    fileLabelsPaddingTop: cs?.paddingTop,
    fileLabelsPaddingBottom: cs?.paddingBottom,
    fileLabelsHeight: cs?.height,
    wrapGridRows: wcs?.gridTemplateRows,
    wrapPadding: wcs?.padding,
    compactGutterRoot: getComputedStyle(document.documentElement).getPropertyValue('--compact-gutter').trim(),
    compactGutterScreen: document.querySelector('.game-screen[data-screen="game"]')
      ? getComputedStyle(document.querySelector('.game-screen[data-screen="game"]')).getPropertyValue('--compact-gutter').trim()
      : '',
    premiumLayout: document.documentElement.getAttribute('data-premium-layout'),
    theme: document.documentElement.getAttribute('data-theme'),
    isGameReady: document.querySelector('.game-screen[data-screen="game"]')?.classList.contains('is-game-ready'),
    fileLabelsRule: cs?.cssText?.slice(0, 200),
  };
});

console.log(JSON.stringify(data, null, 2));
await page.screenshot({ path: '.verify-out/board-label-gap.png', fullPage: true });
await browser.close();

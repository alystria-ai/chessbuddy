import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4176/';
const outputDir = process.env.QA_OUTPUT_DIR || '.verify-out/game-ready';
const headed = process.argv.includes('--headed');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
const report = { passed: false, desktop: null, mobile: null, errors: [] };

async function openReady(viewport) {
  const context = await browser.newContext({ viewport });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (url.pathname === '/api/convai/token') {
      // The visual/interaction harness runs against Vite rather than the
      // production API server. Supply an inert credential so an expected
      // missing local endpoint cannot masquerade as a UI console regression.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"authToken":"qa-inert-token"}',
      });
    } else if (url.origin === new URL(baseUrl).origin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const page = await context.newPage();
  const errors = [];
  const tokenRequests = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) {
      const source = message.location().url;
      errors.push(`console${source ? ` (${source})` : ''}: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/convai/token')) tokenRequests.push(request.url());
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('chessbuddy-game-ready-qa-initialized')) {
      localStorage.clear();
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      sessionStorage.setItem('chessbuddy-game-ready-qa-initialized', 'true');
    }
    window.__blinkOverride = 0;
  });
  const navigationAt = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.game-screen[data-screen-state="ready"]').waitFor({ timeout: 30_000 });
  return { context, page, errors, tokenRequests, navigationToReadyMs: Date.now() - navigationAt };
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const desktop = await openReady({ width: 1440, height: 900 });
  const initial = await desktop.page.evaluate(() => ({
    boardMounted: Boolean(document.querySelector('.chess-board')),
    staticPortraitMounted: Boolean(document.querySelector('.character-warmup-img')),
    canvasMounted: Boolean(document.querySelector('.character-window canvas')),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  requireCondition(initial.boardMounted, 'Ready screen did not mount the real chess board');
  requireCondition(initial.staticPortraitMounted, 'Ready screen did not mount the lightweight portrait');
  requireCondition(initial.overflowX <= 0, 'Desktop ready screen overflows by ' + initial.overflowX + 'px');
  await desktop.page.waitForFunction(
    () => document.documentElement.dataset.convaiPreconnectStarted === 'true',
    undefined,
    { timeout: 10_000 },
  );
  const preconnectState = await desktop.page.evaluate(
    () => document.documentElement.dataset.convaiPreconnect ?? '',
  );
  const beforePlayTokens = desktop.tokenRequests.length;

  const originalBoard = await desktop.page.locator('.chess-board').elementHandle();
  const clickAt = Date.now();
  await desktop.page.getByRole('button', { name: 'PLAY' }).click();
  await desktop.page.locator('.game-screen[data-screen-state="active"]').waitFor();
  const playwrightClickToActiveMs = Date.now() - clickAt;
  const reactClickToActiveMs = await desktop.page.evaluate(() => window.__chessGameReadyTiming?.playToActiveMs ?? null);
  const sameBoard = await desktop.page.evaluate(
    (board) => board === document.querySelector('.chess-board'),
    originalBoard,
  );
  requireCondition(sameBoard, 'Play remounted the chess board');
  requireCondition(
    typeof reactClickToActiveMs === 'number' && reactClickToActiveMs < 150,
    'Play-to-active React transition was ' + reactClickToActiveMs + 'ms',
  );

  // Simulate the time a person spends reading the board and choosing their
  // first move. Stockfish should finish its background handshake in this gap.
  await desktop.page.waitForTimeout(2_500);
  await desktop.page.getByRole('button', { name: 'e2 white p', exact: true }).click();
  await desktop.page.getByRole('button', { name: 'e4', exact: true }).click();
  await desktop.page.waitForFunction(
    () => Number(document.documentElement.dataset.coachMoveMs) > 0,
    undefined,
    { timeout: 12_000 },
  );
  const coachMoveMs = await desktop.page.evaluate(() => Number(document.documentElement.dataset.coachMoveMs));
  requireCondition(coachMoveMs < 1_500, 'Warm coach move took ' + coachMoveMs + 'ms to appear');
  await desktop.page.screenshot({ path: outputDir + '/desktop-active.png' });
  report.desktop = {
    navigationToReadyMs: desktop.navigationToReadyMs,
    playwrightClickToActiveMs,
    reactClickToActiveMs,
    sameBoard,
    coachMoveMs,
    preconnectState,
    tokenRequestsBeforePlay: beforePlayTokens,
    errors: desktop.errors,
  };
  report.errors.push(...desktop.errors);
  await desktop.context.close();

  const mobile = await openReady({ width: 390, height: 844 });
  const mobileMetrics = await mobile.page.evaluate(() => {
    const visiblePlay = Array.from(document.querySelectorAll('.game-ready-play'))
      .find((element) => element.getBoundingClientRect().width > 0);
    const board = document.querySelector('.board-wrap')?.getBoundingClientRect();
    const play = visiblePlay?.getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      overflowY: document.documentElement.scrollHeight - window.innerHeight,
      desktopRailVisible: Boolean(document.querySelector('.game-ready-rail-tools')?.getClientRects().length),
      boardBottom: board?.bottom ?? null,
      playTop: play?.top ?? null,
    };
  });
  requireCondition(mobileMetrics.overflowX <= 0, 'Mobile ready screen overflows horizontally by ' + mobileMetrics.overflowX + 'px');
  requireCondition(mobileMetrics.overflowY <= 0, 'Mobile ready screen overflows vertically by ' + mobileMetrics.overflowY + 'px');
  requireCondition(!mobileMetrics.desktopRailVisible, 'Desktop rail is visible on mobile');
  requireCondition(
    mobileMetrics.boardBottom !== null
      && mobileMetrics.playTop !== null
      && mobileMetrics.boardBottom <= mobileMetrics.playTop,
    'Mobile Play sheet overlaps the chess board',
  );
  await mobile.page.waitForFunction(
    () => document.documentElement.dataset.convaiPreconnectStarted === 'true',
    undefined,
    { timeout: 10_000 },
  );
  await mobile.page.screenshot({ path: outputDir + '/mobile-ready.png' });
  await mobile.page.locator('.game-ready-change:visible').click();
  await mobile.page.getByRole('dialog', { name: 'Game settings' }).waitFor();
  await mobile.page.getByRole('button').filter({ hasText: 'Leila' }).click();
  await mobile.page.getByRole('radio', { name: /Advanced/ }).click();
  await mobile.page.getByRole('button', { name: 'Done' }).click();
  await mobile.page.reload({ waitUntil: 'domcontentloaded' });
  await mobile.page.locator('.game-screen[data-screen-state="ready"]').waitFor();
  const restoredSummary = await mobile.page.evaluate(() => Array.from(document.querySelectorAll('.game-ready-summary'))
    .find((element) => element.getBoundingClientRect().width > 0)?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  requireCondition(
    restoredSummary.includes('Leila') && restoredSummary.includes('Advanced'),
    'Ready preferences did not survive reload: ' + restoredSummary,
  );
  report.mobile = {
    navigationToReadyMs: mobile.navigationToReadyMs,
    ...mobileMetrics,
    restoredSummary,
    tokenRequestsBeforePlay: mobile.tokenRequests.length,
    errors: mobile.errors,
  };
  report.errors.push(...mobile.errors);
  await mobile.context.close();

  requireCondition(report.errors.length === 0, report.errors.join('\n'));
  report.passed = true;
} finally {
  await writeFile(outputDir + '/report.json', JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/adaptive-layouts/', import.meta.url));

const viewports = [
  { id: 'phone-portrait', width: 390, height: 844 },
  { id: 'phone-landscape', width: 844, height: 390 },
  { id: 'tablet-portrait', width: 820, height: 1180 },
  { id: 'tablet-landscape', width: 1024, height: 768 },
  { id: 'compact-laptop', width: 1280, height: 720 },
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'windows-qhd-scaled', width: 1706, height: 938 },
  { id: 'wide-desktop', width: 2048, height: 1152 },
  { id: 'qhd', width: 2560, height: 1440 },
];

const now = '2026-08-17T12:00:00.000Z';
const savedSession = {
  id: 'adaptive-layout-session',
  createdAt: now,
  updatedAt: now,
  mode: 'quick-play',
  coachId: 'sofia',
  difficultyId: 'intermediate',
  result: 'In progress',
  finalFen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
  hintsUsed: 0,
  moves: [
    {
      san: 'e4',
      from: 'e2',
      to: 'e4',
      piece: 'p',
      color: 'w',
      by: 'You',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    },
    {
      san: 'e5',
      from: 'e7',
      to: 'e5',
      piece: 'p',
      color: 'b',
      by: 'Sofia',
      fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    },
  ],
  analysis: {
    opening: 'King Pawn Game',
    whiteAccuracy: 87,
    blackAccuracy: 84,
    inaccuracies: 0,
    mistakes: 0,
    blunders: 0,
    keyMoments: [],
    tips: ['Develop before attacking.'],
  },
};

const failures = [];
const cases = [];
const screenshots = [];
const browserErrors = [];

function fail(viewport, route, message, details) {
  failures.push({ viewport, route, message, ...(details ? { details } : {}) });
}

function horizontallyContained(child, parent, tolerance = 1) {
  return child && parent
    && child.left >= parent.left - tolerance
    && child.right <= parent.right + tolerance;
}

async function capture(page, viewport, route, fullPage = true) {
  const path = join(outputDir, `${viewport.id}-${route}.png`);
  await page.screenshot({ path, animations: 'disabled', fullPage, timeout: 90_000 });
  screenshots.push(path);
  return path;
}

async function inspect(page, selectors) {
  return page.evaluate((requestedSelectors) => {
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      elements: Object.fromEntries(requestedSelectors.map(([name, selector]) => [
        name,
        rect(document.querySelector(selector)),
      ])),
    };
  }, selectors);
}

async function openMenu(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('main[data-screen="menu"]').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'japanese-minimal');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function validateNoHorizontalOverflow(page, viewport, route) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    screenScrollWidth: document.querySelector('main')?.scrollWidth ?? 0,
    screenClientWidth: document.querySelector('main')?.clientWidth ?? 0,
  }));
  if (dimensions.scrollWidth > dimensions.clientWidth + 1
    || dimensions.screenScrollWidth > dimensions.screenClientWidth + 1) {
    fail(viewport.id, route, 'horizontal overflow', dimensions);
  }
  return dimensions;
}

async function validateMenu(page, viewport) {
  const route = 'menu';
  await openMenu(page);
  const geometry = await inspect(page, [
    ['workspace', '.menu-workspace'],
    ['heading', '.menu-heading'],
    ['modes', '.mode-grid'],
    ['setup', '.setup-panel'],
    ['launch', '.mode-launch'],
  ]);
  await validateNoHorizontalOverflow(page, viewport, route);
  for (const [name, rect] of Object.entries(geometry.elements)) {
    if (!rect || rect.left < -1 || rect.right > viewport.width + 1 || rect.width < 1) {
      fail(viewport.id, route, `${name} escapes the viewport`, rect);
    }
  }
  const modeCount = await page.locator('.mode-grid > .mode-tile').count();
  if (modeCount !== 4) fail(viewport.id, route, `expected four player modes, found ${modeCount}`);
  const alignment = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const modes = document.querySelector('.mode-grid');
    const panels = [
      document.querySelector('.setup-panel-coach'),
      document.querySelector('.setup-panel > :nth-child(2)'),
      document.querySelector('.coach-summary-stack'),
    ].filter(Boolean);
    return {
      title: rect('.menu-heading h1'),
      eyebrow: rect('.menu-heading .eyebrow'),
      subtitle: rect('.menu-heading > p:not(.eyebrow)'),
      modePaddingLeft: modes ? Number.parseFloat(getComputedStyle(modes).paddingLeft) : 0,
      panelBottoms: panels.map((panel) => panel.getBoundingClientRect().bottom),
    };
  });
  const visibleSubtitle = alignment.subtitle && alignment.subtitle.width > 0 && alignment.subtitle.height > 0;
  if (viewport.width >= 768 && alignment.title && alignment.eyebrow
    && (Math.abs(alignment.title.left - alignment.eyebrow.left) > 1
      || (visibleSubtitle && Math.abs(alignment.subtitle.left - alignment.eyebrow.left) > 1))) {
    fail(viewport.id, route, 'hero copy does not share one left alignment axis', alignment);
  }
  if (alignment.title && alignment.eyebrow && alignment.title.top - alignment.eyebrow.bottom < 8) {
    fail(viewport.id, route, 'Chessbuddy title collides with the eyebrow above it', alignment);
  }
  if (alignment.title && visibleSubtitle && alignment.subtitle.top - alignment.title.bottom < 8) {
    fail(viewport.id, route, 'Chessbuddy title collides with the introduction below it', alignment);
  }
  if (alignment.modePaddingLeft < 20) {
    fail(viewport.id, route, 'Ways to Play panel lacks its minimum left inset', alignment);
  }
  if (viewport.width >= 1200 && alignment.panelBottoms.length === 3
    && Math.max(...alignment.panelBottoms) - Math.min(...alignment.panelBottoms) > 1) {
    fail(viewport.id, route, 'coach, challenge, and coaching-style panels do not share a bottom edge', alignment);
  }
  cases.push({ viewport: viewport.id, route, geometry, screenshot: await capture(page, viewport, route) });
}

async function validateLibrary(page, viewport) {
  const route = 'library-selected';
  await page.getByRole('button', { name: 'Game Library', exact: true }).click();
  await page.locator('.replay-layout').waitFor({ state: 'visible', timeout: 30_000 });
  const geometry = await inspect(page, [
    ['layout', '.games-layout'],
    ['sessions', '.games-list'],
    ['replay', '.replay-layout'],
    ['boardWrap', '.replay-layout > .board-wrap'],
    ['board', '.replay-layout .chess-board'],
    ['review', '.replay-panel'],
  ]);
  await validateNoHorizontalOverflow(page, viewport, route);
  const { layout, sessions, replay, boardWrap, board, review } = geometry.elements;
  for (const [name, rect] of Object.entries({ sessions, replay, boardWrap, board, review })) {
    if (!horizontallyContained(rect, layout, 1.5)) fail(viewport.id, route, `${name} escapes the Library workspace`, { rect, layout });
  }
  if (!board || Math.abs(board.width - board.height) > 2 || board.width < 240) {
    fail(viewport.id, route, 'replay board is missing, non-square, or too small', board);
  }
  if (!horizontallyContained(board, boardWrap, 1.5)) {
    fail(viewport.id, route, 'replay board escapes its coordinate card', { board, boardWrap });
  }
  if (board && boardWrap && (board.top < boardWrap.top - 1.5 || board.bottom > boardWrap.bottom + 1.5)) {
    fail(viewport.id, route, 'replay board escapes the coordinate card vertically', { board, boardWrap });
  }
  if (board && review && board.right > review.left - 1.5 && board.left < review.right + 1.5
    && board.bottom > review.top - 1.5 && board.top < review.bottom + 1.5) {
    fail(viewport.id, route, 'replay board overlaps the review panel', { board, review });
  }
  cases.push({ viewport: viewport.id, route, geometry, screenshot: await capture(page, viewport, route) });
}

async function validateCreator(page, viewport) {
  const route = 'creator';
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Create a Coach', exact: true }).click();
  await page.locator('.creator-form').waitFor({ state: 'visible', timeout: 30_000 });
  const geometry = await inspect(page, [
    ['layout', '.creator-layout'],
    ['form', '.creator-form'],
    ['appearance', '.creator-section--appearance'],
    ['backstory', '.creator-field--backstory'],
    ['speaking', '.creator-field--speaking-style'],
    ['dialogue', '.creator-field--sample-dialogue'],
    ['submit', '.creator-actions .primary-action'],
  ]);
  await validateNoHorizontalOverflow(page, viewport, route);
  const { layout, form, ...children } = geometry.elements;
  if (!horizontallyContained(form, layout, 1.5)) fail(viewport.id, route, 'creator form escapes its layout', { form, layout });
  for (const [name, rect] of Object.entries(children)) {
    if (!horizontallyContained(rect, form, 1.5)) fail(viewport.id, route, `${name} escapes the creator form`, { rect, form });
  }
  if (viewport.width < 768) {
    const childRects = await page.locator('.creator-form > *').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }));
    const first = childRects[0];
    for (const [index, rect] of childRects.entries()) {
      if (!first || Math.abs(rect.left - first.left) > 1 || Math.abs(rect.right - first.right) > 1) {
        fail(viewport.id, route, `compact creator child ${index} is not on the single-column track`, { first, rect });
      }
    }
  }
  const undersized = await page.locator('.creator-form input, .creator-form select, .creator-actions button').evaluateAll((elements) => (
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, width: rect.width, height: rect.height };
    }).filter((item) => item.width < 44 || item.height < 44)
  ));
  if (undersized.length) fail(viewport.id, route, 'creator has undersized controls', undersized);
  cases.push({ viewport: viewport.id, route, geometry, screenshot: await capture(page, viewport, route) });
}

async function validatePuzzles(page, viewport) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Tactics', exact: true }).click();
  await page.getByRole('button', { name: 'Start tactics', exact: true }).click();
  await page.locator('.puzzle-cover').waitFor({ state: 'visible', timeout: 30_000 });

  const introRoute = 'puzzles-intro';
  await validateNoHorizontalOverflow(page, viewport, introRoute);
  const introGeometry = await inspect(page, [
    ['cover', '.puzzle-cover'],
    ['card', '.puzzle-intro-card'],
    ['start', '.puzzle-intro-card .primary-action'],
  ]);
  if (!horizontallyContained(introGeometry.elements.card, introGeometry.elements.cover, 1.5)) {
    fail(viewport.id, introRoute, 'puzzle intro card escapes its cover', introGeometry.elements);
  }
  cases.push({ viewport: viewport.id, route: introRoute, geometry: introGeometry, screenshot: await capture(page, viewport, introRoute, false) });

  await page.getByRole('button', { name: 'Start puzzles', exact: true }).click();
  await page.locator('main[data-screen="puzzles"][data-screen-state="active"]').waitFor({ state: 'visible', timeout: 30_000 });
  const activeRoute = 'puzzles-active';
  const activeGeometry = await inspect(page, [
    ['layout', '.training-layout'],
    ['coach', '.puzzle-left-col'],
    ['stage', '.puzzle-board-stage'],
    ['boardWrap', '.puzzle-board-stage .board-wrap'],
    ['board', '.puzzle-board-stage .chess-board'],
  ]);
  await validateNoHorizontalOverflow(page, viewport, activeRoute);
  const { layout, coach, stage, boardWrap, board } = activeGeometry.elements;
  for (const [name, rect] of Object.entries({ coach, stage, boardWrap, board })) {
    if (!horizontallyContained(rect, layout, 1.5)) fail(viewport.id, activeRoute, `${name} escapes the puzzle workspace`, { rect, layout });
  }
  if (!board || Math.abs(board.width - board.height) > 2 || board.width < 240) {
    fail(viewport.id, activeRoute, 'puzzle board is missing, non-square, or too small', board);
  }
  if (!horizontallyContained(board, boardWrap, 1.5)) {
    fail(viewport.id, activeRoute, 'puzzle board escapes its coordinate card', { board, boardWrap });
  }
  cases.push({ viewport: viewport.id, route: activeRoute, geometry: activeGeometry, screenshot: await capture(page, viewport, activeRoute, false) });
}

async function configureOfflineRoutes(context) {
  const allowedHost = new URL(baseUrl).hostname;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (url.hostname === 'api.convai.com' && url.pathname === '/tts/get_available_voices') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ voices: [{ 'Ava — warm and clear': { voice_value: 'qa-ava', gender: 'Female', lang_codes: ['en-US'] } }] }),
      });
    } else if (url.hostname === 'api.convai.com' && url.pathname === '/tts/get_available_languages') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ English: { lang_code: 'en-US', lang_name: 'English' } }]) });
    } else if (url.hostname === allowedHost) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

async function enterActivePuzzle(page, completedIds = []) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate((ids) => {
    localStorage.setItem('classic-chess.puzzleProgress.v1', JSON.stringify({ intermediate: ids }));
  }, completedIds);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Tactics', exact: true }).click();
  await page.getByRole('button', { name: 'Start tactics', exact: true }).click();
  await page.getByRole('button', { name: 'Start puzzles', exact: true }).click();
}

async function capturePuzzleState(page, route) {
  const viewport = { id: 'desktop-state', width: 1440, height: 900 };
  await validateNoHorizontalOverflow(page, viewport, route);
  const state = await page.locator('main[data-screen="puzzles"]').getAttribute('data-screen-state');
  const path = join(outputDir, `desktop-${route}.png`);
  await page.screenshot({ path, animations: 'disabled', timeout: 90_000 });
  screenshots.push(path);
  cases.push({ viewport: viewport.id, route, state, screenshot: path });
  return state;
}

async function validatePuzzleStateMachine(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ session }) => {
    window.__blinkOverride = 0;
    localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
    localStorage.setItem('classic-chess.sessions.v1', JSON.stringify([session]));
  }, { session: savedSession });
  await configureOfflineRoutes(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(`desktop-state: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) {
      browserErrors.push(`desktop-state: console: ${message.text()}`);
    }
  });
  try {
    await enterActivePuzzle(page);

    await page.getByRole('button', { name: /^b3 / }).click();
    await page.getByRole('button', { name: 'b4', exact: true }).click();
    await page.locator('main[data-screen-state="wrong"]').waitFor({ state: 'visible', timeout: 2_000 });
    if (await capturePuzzleState(page, 'puzzles-wrong') !== 'wrong') {
      fail('desktop-state', 'puzzles-wrong', 'wrong verdict state was not rendered');
    }

    await page.waitForTimeout(1_300);
    await page.getByRole('button', { name: /^b3 / }).click();
    await page.getByRole('button', { name: 'b8', exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^d1 / }).click();
    await page.getByRole('button', { name: 'd8', exact: true }).click();
    await page.locator('main[data-screen-state="solved"]').waitFor({ state: 'visible', timeout: 2_000 });
    if (await capturePuzzleState(page, 'puzzles-solved') !== 'solved') {
      fail('desktop-state', 'puzzles-solved', 'solved verdict state was not rendered');
    }

    const firstFour = [
      'int-opera-deflection-mate',
      'int-pawn-fork-double-attack',
      'int-rank-skewer',
      'int-black-zwischenzug-fork',
    ];
    await enterActivePuzzle(page, firstFour);
    await page.getByRole('button', { name: /^d1 / }).click();
    await page.getByRole('button', { name: 'd2', exact: true }).click();
    await page.waitForTimeout(1_300);
    await page.getByRole('button', { name: /^d1 / }).click();
    await page.getByRole('button', { name: 'a4', exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^a4 / }).click();
    await page.getByRole('button', { name: /^b4 / }).click();
    await page.locator('main[data-screen-state="batch-complete"]').waitFor({ state: 'visible', timeout: 6_000 });
    if (await capturePuzzleState(page, 'puzzles-batch-complete') !== 'batch-complete') {
      fail('desktop-state', 'puzzles-batch-complete', 'batch completion state was not rendered');
    }

    await page.getByRole('button', { name: /Review mistakes/ }).click();
    await page.locator('main[data-screen-state="review"]').waitFor({ state: 'visible', timeout: 2_000 });
    const staleReviewVerdicts = await page.locator('.puzzle-result-chip').count();
    if (staleReviewVerdicts !== 0) {
      fail('desktop-state', 'puzzles-review', 'review mode retained a stale solved/wrong verdict', { staleReviewVerdicts });
    }
    if (await capturePuzzleState(page, 'puzzles-review') !== 'review') {
      fail('desktop-state', 'puzzles-review', 'mistake review state was not rendered');
    }

    await enterActivePuzzle(page, [...firstFour, 'int-check-and-collect']);
    await page.locator('main[data-screen-state="complete"]').waitFor({ state: 'visible', timeout: 2_000 });
    if (await capturePuzzleState(page, 'puzzles-complete') !== 'complete') {
      fail('desktop-state', 'puzzles-complete', 'all-complete state was not rendered');
    }
  } catch (error) {
    fail('desktop-state', 'puzzle-state-machine', error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const startedAt = Date.now();

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.addInitScript(({ session }) => {
      window.__blinkOverride = 0;
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      localStorage.setItem('classic-chess.sessions.v1', JSON.stringify([
        session,
        { ...session, id: `${session.id}-second`, createdAt: '2026-08-17T13:00:00.000Z' },
      ]));
    }, { session: savedSession });
    await configureOfflineRoutes(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => browserErrors.push(`${viewport.id}: pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('net::ERR_FAILED')) {
        browserErrors.push(`${viewport.id}: console: ${message.text()}`);
      }
    });
    try {
      await validateMenu(page, viewport);
      await validateLibrary(page, viewport);
      await validateCreator(page, viewport);
      await validatePuzzles(page, viewport);
    } catch (error) {
      fail(viewport.id, 'runner', error instanceof Error ? error.message : String(error));
    } finally {
      await context.close();
    }
  }
  await validatePuzzleStateMachine(browser);
} finally {
  await browser.close();
}

for (const message of browserErrors) failures.push({ viewport: 'browser', route: 'runtime', message });

const result = {
  passed: failures.length === 0,
  baseUrl,
  viewports,
  expectedCases: (viewports.length * 5) + 5,
  completedCases: cases.length,
  cases,
  screenshots,
  browserErrors,
  failures,
  durationMs: Date.now() - startedAt,
  outputDir,
};

const resultPath = join(outputDir, 'result.json');
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  passed: result.passed,
  expectedCases: result.expectedCases,
  completedCases: result.completedCases,
  screenshotCount: screenshots.length,
  browserErrorCount: browserErrors.length,
  failures,
  durationMs: result.durationMs,
  resultPath,
}, null, 2));
if (!result.passed) process.exitCode = 1;

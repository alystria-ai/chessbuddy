import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:5189/?headless&legacy-menu=1';
const outputDir = resolve(process.env.QA_OUTPUT_DIR || '.verify-out/analysis-polish');
const captures = [
  { name: 'desktop-1080p', width: 1920, height: 1080, fullPage: false },
  { name: 'video-2560x1440', width: 2560, height: 1440, fullPage: false },
  { name: 'mobile-390x844', width: 390, height: 844, fullPage: true, mobile: true },
];

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`);
  }
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--disable-features=CalculateNativeWinOcclusion'],
});

const context = await browser.newContext({ viewport: captures[0] });
await context.addInitScript(() => {
  localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
  window.__blinkOverride = 0;
});

const allowedHost = new URL(baseUrl).hostname;
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/auth/me') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
  } else if (url.hostname === allowedHost) {
    await route.continue();
  } else {
    await route.abort();
  }
});

const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error'
    && !message.text().includes('net::ERR_FAILED')
    && !message.text().includes('Failed to load resource: the server responded with a status of 404')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // Development's legacy-menu flag is intentionally unavailable in production.
  // Exercise whichever real entry point this build exposes.
  await page.locator('.menu-play, .game-ready-play').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.menu-play, .game-ready-play').first().click();
  await page.locator('.game-screen[data-screen="game"][data-screen-state="active"]').waitFor({
    state: 'visible',
    timeout: 140_000,
  });
  await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 140_000 });
  await page.waitForFunction(() => document.querySelectorAll('.chess-board .square').length === 64);

  // Make one real move so the analysis contains production-rendered timeline,
  // performance, and key-moment content even when the engine sample is offline.
  await page.getByRole('button', { name: /^e2 white p$/ }).click();
  await page.getByRole('button', { name: /^e4$/ }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label^="e4 "]')?.getAttribute('aria-label')?.includes('white p'));

  await page.getByRole('button', { name: 'Resign game', exact: true }).click();
  const resignDialog = page.locator('[role="dialog"][aria-labelledby="resign-title"]');
  await resignDialog.getByRole('button', { name: 'Resign', exact: true }).click();
  const gameOverDialog = page.locator('[role="dialog"][aria-labelledby="gameover-title"]');
  await gameOverDialog.waitFor({ state: 'visible', timeout: 30_000 });
  await gameOverDialog.getByRole('button', { name: 'View Analysis', exact: true }).click();

  const analysisScreen = page.locator('.game-screen[data-screen="analysis"]');
  await analysisScreen.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('.game-screen[data-screen="analysis"]')?.dataset.screenState === 'ready');
  await page.locator('.moment-item').first().waitFor({ state: 'visible', timeout: 30_000 });

  // Empty history must still expose a useful analysis chat and its live composer.
  const emptyConversation = page.locator('.coach-conversation-empty');
  const chatInput = page.getByRole('textbox', { name: /^Ask / });
  const sendButton = page.getByRole('button', { name: 'Send message', exact: true });
  assert(await page.locator('.coach-message').count() === 0, 'Analysis did not start with an empty conversation');
  await emptyConversation.waitFor({ state: 'visible', timeout: 10_000 });
  await chatInput.waitFor({ state: 'visible', timeout: 10_000 });
  assert(await sendButton.isDisabled(), 'Empty analysis composer should start disabled');
  await chatInput.fill('Explain the final position');
  assert(await sendButton.isEnabled(), 'Analysis composer did not enable for typed input');
  await chatInput.fill('');
  assert(await sendButton.isDisabled(), 'Analysis composer did not return to its empty disabled state');

  // Exercise the reported 9/8 glyph pairing without changing application state.
  // This is a typography specimen on the production score element only.
  await page.locator('.perf-score').evaluate((element) => { element.textContent = '98%'; });

  const report = [];
  for (const capture of captures) {
    await page.setViewportSize({ width: capture.width, height: capture.height });
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));

    const metrics = await analysisScreen.evaluate((root) => {
      const box = (node) => {
        const rect = node?.getBoundingClientRect();
        return rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        } : null;
      };
      const px = (node, property) => Number.parseFloat(getComputedStyle(node)[property]);
      const topbar = root.querySelector(':scope > .topbar');
      const title = topbar?.querySelector('h1');
      const menu = topbar?.querySelector('.analysis-menu-action');
      const actions = topbar?.querySelector('.topbar-actions');
      const shell = root.querySelector('.analysis-shell');
      const coach = shell?.querySelector(':scope > .coach-card');
      const boardStage = shell?.querySelector(':scope > .analysis-board-stage');
      const boardWrap = boardStage?.querySelector('.analysis-review-board');
      const board = boardWrap?.querySelector('.chess-board');
      const panel = root.querySelector('.analysis-panel');
      const sections = [...root.querySelectorAll('.analysis-section')];
      const sectionLabels = [...root.querySelectorAll('.analysis-section > .eyebrow')];
      const moment = root.querySelector('.moment-item');
      const momentHeader = moment?.querySelector('.moment-header');
      const markerStyle = moment ? getComputedStyle(moment, '::before') : null;
      const score = root.querySelector('.perf-score');
      const bodySamples = [...root.querySelectorAll('.section-hint, .perf-desc, .legend-item, .moment-item p')];
      const conversation = root.querySelector('.coach-line-wrap.has-conversation');
      const conversationEmpty = root.querySelector('.coach-conversation-empty');
      const composer = root.querySelector('.coach-chat-row');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        topbar: box(topbar),
        title: box(title),
        menu: box(menu),
        actions: box(actions),
        shell: box(shell),
        coach: box(coach),
        boardStage: box(boardStage),
        boardWrap: box(boardWrap),
        board: box(board),
        panel: box(panel),
        sectionPaddingLeft: sections.map((section) => px(section, 'paddingLeft')),
        sectionLabelFontSizes: sectionLabels.map((label) => px(label, 'fontSize')),
        bodyFontSizes: bodySamples.map((sample) => px(sample, 'fontSize')),
        score: score ? {
          text: score.textContent,
          fontFamily: getComputedStyle(score).fontFamily,
          fontVariantNumeric: getComputedStyle(score).fontVariantNumeric,
          fontFeatureSettings: getComputedStyle(score).fontFeatureSettings,
        } : null,
        moment: box(moment),
        momentHeader: box(momentHeader),
        momentDisplay: moment ? getComputedStyle(moment).display : null,
        momentColumns: moment ? getComputedStyle(moment).gridTemplateColumns : null,
        markerPosition: markerStyle?.position ?? null,
        markerSize: markerStyle ? { width: markerStyle.width, height: markerStyle.height } : null,
        conversation: box(conversation),
        conversationEmpty: box(conversationEmpty),
        conversationEmptyText: conversationEmpty?.textContent?.trim() ?? null,
        composer: box(composer),
      };
    });

    assert(metrics.documentWidth <= capture.width + 1, `${capture.name}: horizontal overflow`, metrics);
    assert(metrics.conversation && metrics.conversation.height >= (capture.mobile ? 90 : 150), `${capture.name}: empty chat lane is not visibly reserved`, metrics);
    assert(metrics.conversationEmpty && metrics.conversationEmpty.height > 0
      && /Review chat is ready/.test(metrics.conversationEmptyText ?? ''), `${capture.name}: empty chat state is missing`, metrics);
    assert(metrics.composer && metrics.composer.height >= 44, `${capture.name}: analysis composer is not visible`, metrics);

    if (capture.mobile) {
      assert(metrics.coach && metrics.shell && metrics.coach.width <= metrics.shell.width + 1, `${capture.name}: coach card escapes the mobile shell`, metrics);
      const screenshot = resolve(outputDir, `${capture.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: capture.fullPage, timeout: 90_000 });
      await page.locator('.analysis-shell > .coach-card').scrollIntoViewIfNeeded();
      const chatScreenshot = resolve(outputDir, 'mobile-empty-chat.png');
      await page.screenshot({ path: chatScreenshot, fullPage: false, timeout: 90_000 });
      report.push({ name: capture.name, screenshot, chatScreenshot, metrics });
      continue;
    }

    const topbarCenter = metrics.topbar.top + metrics.topbar.height / 2;
    assert(metrics.title && Math.abs(metrics.title.centerY - topbarCenter) <= 2.5, `${capture.name}: title is not vertically balanced`, metrics);
    assert(metrics.menu && Math.abs(metrics.menu.centerY - topbarCenter) <= 2.5, `${capture.name}: Menu is not vertically balanced`, metrics);
    assert(metrics.actions && Math.abs(metrics.actions.centerY - topbarCenter) <= 2.5, `${capture.name}: actions are not vertically balanced`, metrics);
    const coachShare = metrics.coach.width / metrics.shell.width;
    assert(coachShare >= .24 && coachShare <= .27, `${capture.name}: character column is outside the 24-27% target`, { coachShare, ...metrics });
    assert(metrics.boardWrap.left >= metrics.boardStage.left - 1
      && metrics.boardWrap.right <= metrics.boardStage.right + 1
      && metrics.boardWrap.top >= metrics.boardStage.top - 1
      && metrics.boardWrap.bottom <= metrics.boardStage.bottom + 1,
    `${capture.name}: review board escapes its column`, metrics);
    assert(metrics.board.width >= (capture.width >= 2560 ? 620 : 500), `${capture.name}: review board became too small`, metrics);
    assert(metrics.panel.width >= (capture.width >= 2560 ? 840 : 680), `${capture.name}: report became too narrow`, metrics);
    assert(metrics.sectionPaddingLeft.every((value) => value >= (capture.width <= 390 ? 5 : 11)), `${capture.name}: report section padding is too small`, metrics);
    const videoTarget = capture.width >= 2560;
    assert(metrics.bodyFontSizes.every((value) => value >= (videoTarget ? 18 : 15)), `${capture.name}: report body type is not comfortably readable`, metrics);
    assert(metrics.sectionLabelFontSizes.every((value) => value >= (videoTarget ? 16 : 14)), `${capture.name}: report section labels are too small`, metrics);
    assert(metrics.score?.text === '98%' && /Segoe UI|Yu Gothic|sans-serif/i.test(metrics.score.fontFamily), `${capture.name}: score is still using the oldstyle display face`, metrics);
    assert(/tabular-nums/.test(metrics.score?.fontVariantNumeric ?? '') || /tnum/.test(metrics.score?.fontFeatureSettings ?? ''), `${capture.name}: score numerals are not tabular`, metrics);
    assert(metrics.momentDisplay === 'grid' && metrics.markerPosition === 'static', `${capture.name}: key-moment marker is not in the header flow`, metrics);

    const screenshot = resolve(outputDir, `${capture.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: capture.fullPage, timeout: 90_000 });
    report.push({ name: capture.name, screenshot, metrics });
  }

  assert(browserErrors.length === 0, 'Browser errors occurred', browserErrors);
  await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Analysis polish QA passed: ${report.length} responsive captures in ${outputDir}`);
} finally {
  await context.close();
  await browser.close();
}

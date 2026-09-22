/**
 * Layout QA for the live game across phone and small-desktop viewports.
 *
 * The compact game screen derives every size from the viewport height, so the
 * defect this guards against is geometric: a board that collapses, a coach band
 * that clips, or chrome that forces the page to scroll. It reports the numbers
 * and writes screenshots for a visual pass.
 *
 *   node scripts/qa-mobile-game.mjs                 ready screen, all sizes
 *   node scripts/qa-mobile-game.mjs --play          live game, all sizes
 *   node scripts/qa-mobile-game.mjs --chrome        phone bubble/composer/menu
 *   node scripts/qa-mobile-game.mjs --play --live   live WebGL portrait, no poster
 *
 * QA_SIZES=390x844,900x650 narrows the sweep. Requires `npm run dev`.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const outputDir = fileURLToPath(new URL('../.verify-out/mobile-game/', import.meta.url));

const PLAY = process.argv.includes('--play');
const CHROME = process.argv.includes('--chrome');
/** Skip ?headless so the live WebGL portrait renders instead of the baked poster. */
const LIVE = process.argv.includes('--live');

const ALL_SIZES = [
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x600', width: 768, height: 600 },
  { name: '900x650', width: 900, height: 650 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },
];
const requested = (process.env.QA_SIZES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const sizes = requested.length ? ALL_SIZES.filter((s) => requested.includes(s.name)) : ALL_SIZES;

const rects = () => {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  };
  const wrap = document.querySelector('.board-wrap');
  const squares = document.querySelector('.chess-board');
  let boardPadding = null;
  if (wrap && squares) {
    const wr = wrap.getBoundingClientRect();
    const br = squares.getBoundingClientRect();
    boardPadding = {
      top: Math.round(br.top - wr.top),
      right: Math.round(wr.right - br.right),
      bottom: Math.round(wr.bottom - br.bottom),
      left: Math.round(br.left - wr.left),
    };
  }
  const canvas = document.querySelector('.character-window canvas');
  const menu = document.querySelector('.coach-menu-btn');
  const menuStyle = menu ? getComputedStyle(menu) : null;
  return {
    verticalScroll: document.documentElement.scrollHeight - window.innerHeight,
    horizontalScroll: document.documentElement.scrollWidth - window.innerWidth,
    board: rect('.board-wrap'),
    boardPadding,
    stage: rect('.game-stage'),
    coach: rect('.coach-card'),
    portrait: rect('.character-window'),
    menu: rect('.coach-menu-btn'),
    menuStyle: menuStyle ? {
      display: menuStyle.display,
      width: menuStyle.width,
      height: menuStyle.height,
      position: menuStyle.position,
    } : null,
    sidePanel: rect('.side-panel'),
    rail: rect('.game-navigation-rail'),
    portraitQuality: canvas instanceof HTMLCanvasElement
      ? {
        tier: canvas.dataset.portraitMobileTier || null,
        model: canvas.dataset.portraitMobileModel || null,
        maxDpr: canvas.dataset.portraitMobileMaxDpr || null,
      }
      : null,
  };
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});

async function openGame(size) {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(LIVE ? baseUrl : `${baseUrl}?headless`, { waitUntil: 'domcontentloaded' });
  await page.locator('.game-screen[data-screen="game"]').waitFor({ timeout: 30_000 });
  return { page, errors };
}

async function startGame(page) {
  const play = page.locator('.game-ready-stage-overlay .game-ready-play').first();
  if (!(await play.count())) return;
  await play.click();
  await page.locator('[data-screen-state="active"]').waitFor({ timeout: 30_000 });
  if (LIVE) {
    await page.locator('.character-window.is-ready canvas')
      .waitFor({ timeout: 120_000 })
      .catch(() => {});
  }
}

async function sweep() {
  const report = [];
  for (const size of sizes) {
    const { page, errors } = await openGame(size);
    if (PLAY) await startGame(page);
    await page.waitForTimeout(LIVE ? 4_000 : 600);
    const label = `${PLAY ? 'active' : 'ready'}${LIVE ? '-live' : ''}`;
    // A full-size live portrait under swiftshader starves the compositor, so
    // the capture needs far more than the default budget.
    await page.screenshot({ path: join(outputDir, `${label}-${size.name}.png`), timeout: 180_000 });
    report.push({ size: size.name, ...(await page.evaluate(rects)), errors });
    await page.close();
  }
  return report;
}

async function phoneChrome() {
  const size = sizes[0] ?? ALL_SIZES[1];
  const { page } = await openGame(size);
  await startGame(page);
  await page.waitForTimeout(1_200);

  // The bubble only renders with coach speech, and Convai is unreachable in QA.
  // Fill the live element so the authored bubble geometry can be measured.
  await page.evaluate(() => {
    const wrap = document.querySelector('.coach-line-wrap');
    if (!wrap) return;
    const line = document.createElement('p');
    line.className = 'coach-line';
    line.textContent = 'Good opening choice — control the centre with d4 and watch my knight on f6.';
    wrap.replaceChildren(line);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outputDir, `phone-bubble-${size.name}.png`) });
  const bubble = await page.evaluate(rects);

  // Mobile keeps the desktop-style composer visible during an active game.
  await page.waitForTimeout(400);
  // A real tap proves the field is reachable through the caption layers.
  await page.locator('.coach-chat-input').click({ timeout: 5_000 });
  await page.keyboard.type('Why is d4 better than e4 here?');
  await page.screenshot({ path: join(outputDir, `phone-composer-${size.name}.png`) });

  const composing = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const overlaps = (a, b) => !!a && !!b
      && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const actions = box('.caption-actions');
    const composer = box('.coach-chat-row');
    return {
      actions,
      composer,
      controls: [...document.querySelectorAll('.caption-actions .audio-btn')]
        .map((el) => el.getAttribute('aria-label')),
      composerOverlapsControls: overlaps(composer, actions),
    };
  });

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const composerRemainsAfterEnter = (await page.locator('.coach-chat-row').count()) === 1;

  await page.locator('.coach-menu-btn').click();
  await page.locator('.mobile-game-drawer[open]').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outputDir, `phone-drawer-${size.name}.png`) });
  const drawer = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-game-drawer-panel > nav');
    return {
      entries: [...nav.querySelectorAll(':scope > button, :scope .rail-tool')]
        .map((el) => el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)),
      poweredBy: document.querySelector('.mobile-drawer-powered')?.textContent.trim(),
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const drawerClosedOnEscape = (await page.locator('.mobile-game-drawer[open]').count()) === 0;

  await page.close();
  return {
    size: size.name,
    bubble: bubble.verticalScroll === 0 ? 'no page scroll' : `scrolls ${bubble.verticalScroll}px`,
    ...composing,
    composerRemainsAfterEnter,
    ...drawer,
    drawerClosedOnEscape,
  };
}

console.log(JSON.stringify(CHROME ? await phoneChrome() : await sweep(), null, 2));
console.log(`screenshots: ${outputDir}`);
await browser.close();

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/?headless&legacy-menu=1';
const outputDir = fileURLToPath(new URL('../.verify-out/premium-layouts/', import.meta.url));

const layoutFamilies = {
  publication: ['hand-drawn', 'newspaper', 'risograph', 'editorial'],
  poster: ['swiss', 'bauhaus', 'neo-brutalist', 'pop-art-comic'],
  workstation: ['terminal', 'blueprint', 'desktop-90s', 'cyberpunk-hud'],
  cabinet: ['wooden', 'art-deco', 'dark-academia', 'library-at-midnight'],
  gallery: ['marble', 'japanese-minimal', 'nordic-frost', 'botanical-engraving'],
  playroom: ['flat-icon', 'soft-clay', 'candy-kawaii', 'memphis-pop'],
  orbital: ['cosmic-observatory', 'solarpunk-conservatory', 'oceanic-biome', 'vaporwave-dream'],
  terrace: ['desert-modernism', 'mediterranean-ceramic', 'alpine-lodge', 'tropical-resort'],
  proscenium: ['stained-glass', 'noir-detective', 'royal-opera', 'persian-miniature'],
  instrument: ['arcade-neon', 'frutiger-aero', 'lunar-colony', 'kinetic-chrome'],
};

const themeIds = Object.values(layoutFamilies).flat();
const familyByTheme = new Map(
  Object.entries(layoutFamilies).flatMap(([family, ids]) => ids.map((id) => [id, family])),
);
const representativeByFamily = new Map(
  Object.entries(layoutFamilies).map(([family, ids]) => [family, ids[0]]),
);

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const primaryRegions = ['.menu-heading', '.mode-grid', '.setup-panel', '.mode-launch'];
const criticalControlSelectors = [
  '.mode-tile',
  '.coach-picker button',
  '.difficulty-picker button',
  '.coaching-control-option',
  '.menu-play',
  '.theme-switcher-trigger',
];

function parseArguments(argv) {
  let all = false;
  let theme = null;
  let games = process.env.QA_CAPTURE_GAMES === '1';
  let secondary = process.env.QA_SECONDARY_SCREENS === '1' ? true : null;
  let requestedBaseUrl = baseUrl;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') all = true;
    else if (argument === '--games') games = true;
    else if (argument === '--no-games') games = false;
    else if (argument === '--secondary') secondary = true;
    else if (argument === '--no-secondary') secondary = false;
    else if (argument === '--base-url') requestedBaseUrl = argv[++index];
    else if (argument.startsWith('--base-url=')) requestedBaseUrl = argument.slice('--base-url='.length);
    else if (argument === '--theme') theme = argv[++index];
    else if (argument.startsWith('--theme=')) theme = argument.slice('--theme='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (all === Boolean(theme)) {
    throw new Error('Choose exactly one scope: --all or --theme <theme-id>');
  }
  if (theme && !familyByTheme.has(theme)) {
    throw new Error(`Unknown premium theme "${theme}". Expected one of: ${themeIds.join(', ')}`);
  }

  if (!requestedBaseUrl) throw new Error('--base-url requires a URL');
  return {
    all,
    theme,
    games,
    // Incremental preset gates cover the whole product by default. The full
    // 40-theme matrix stays menu-focused unless explicitly requested.
    secondary: secondary ?? Boolean(theme),
    baseUrl: requestedBaseUrl,
  };
}

function overlapAmount(left, right) {
  return {
    width: Math.min(left.right, right.right) - Math.max(left.left, right.left),
    height: Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  };
}

function addFailure(failures, context, message, details) {
  failures.push({ context, message, ...(details ? { details } : {}) });
}

async function prepareContext(browser, viewport, errors) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    // Inspect an intentionally open-eye frame; a random 185ms procedural blink
    // must never make a healthy character look broken in durable screenshots.
    window.__blinkOverride = 0;
  });
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ English: { lang_code: 'en-US', lang_name: 'English' } }]),
      });
    } else if (url.hostname === allowedHost) {
      await route.continue();
    } else {
      // Visual QA must never send credentials or coaching traffic off-machine.
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
  return { context, page };
}

async function openMenu(page, themeId) {
  if (page.url() === 'about:blank') {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.evaluate((id) => localStorage.setItem('classic-chess.theme.v1', id), themeId);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.menu-screen').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction((id) => document.documentElement.dataset.theme === id, themeId);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspectMenu(page) {
  return page.evaluate(({ regionSelectors, controlSelectors }) => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      let ancestor = element.parentElement;
      let clippedByHiddenAncestor = false;
      while (ancestor && !clippedByHiddenAncestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) <= 0.01) {
          clippedByHiddenAncestor = true;
          break;
        }
        const ancestorRect = ancestor.getBoundingClientRect();
        if (['hidden', 'clip'].includes(ancestorStyle.overflowX)
          && (rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1)) {
          clippedByHiddenAncestor = true;
        }
        if (['hidden', 'clip'].includes(ancestorStyle.overflowY)
          && (rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1)) {
          clippedByHiddenAncestor = true;
        }
        ancestor = ancestor.parentElement;
      }
      return !clippedByHiddenAncestor
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const selectorLabel = (element) => {
      const className = typeof element.className === 'string'
        ? element.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
    };
    const rowPattern = (elements) => {
      const rows = [];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        let row = rows.find((candidate) => Math.abs(candidate.top - rect.top) <= 4);
        if (!row) {
          row = { top: rect.top, count: 0 };
          rows.push(row);
        }
        row.count += 1;
      }
      return rows.sort((left, right) => left.top - right.top).map((row) => row.count);
    };
    const parseColor = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const values = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (values.length < 3 || values.some((valuePart) => Number.isNaN(valuePart))) return null;
      return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
    };
    const blendOver = (foreground, background) => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const resolvedBackground = (element) => {
      let color = { r: 0, g: 0, b: 0, a: 0 };
      let current = element;
      while (current && color.a < 0.999) {
        const layer = parseColor(getComputedStyle(current).backgroundColor);
        if (layer && layer.a > 0) color = blendOver(color, layer);
        current = current.parentElement;
      }
      return color.a < 0.999 ? blendOver(color, { r: 255, g: 255, b: 255, a: 1 }) : color;
    };
    const luminance = (color) => {
      const linear = [color.r, color.g, color.b].map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };

    const menu = document.querySelector('.menu-screen');
    const workspace = document.querySelector('.menu-workspace');
    const heading = document.querySelector('.menu-heading');
    const titleElement = document.querySelector('.menu-heading h1');
    const copyElement = document.querySelector('.menu-heading > p:not(.eyebrow)');
    const firstFourModes = [...document.querySelectorAll('.mode-grid > .mode-tile')].slice(0, 4);
    const regions = regionSelectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      return element ? [{
        selector,
        rect: rectOf(element),
        visible: visible(element),
        display: getComputedStyle(element).display,
      }] : [];
    });
    const setupSections = [
      document.querySelector('.setup-panel > .setup-panel-coach'),
      document.querySelector('.setup-panel > :nth-child(2)'),
      document.querySelector('.setup-panel > .coach-summary-stack'),
    ].filter(Boolean).map((element) => ({ label: selectorLabel(element), rect: rectOf(element) }));
    const controls = controlSelectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((element, index) => ({
      selector,
      index,
      label: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || selectorLabel(element),
      rect: rectOf(element),
      visible: visible(element),
      disabled: element.matches(':disabled'),
      clippedText: [...element.querySelectorAll('span, strong, small')].flatMap((content) => {
        const text = content.textContent?.trim().replace(/\s+/g, ' ') ?? '';
        const contentRect = rectOf(content);
        if (!text
          || contentRect.width <= 1.5
          || contentRect.height <= 1.5
          // Inline text metrics commonly report a 2-3px vertical delta from
          // font ascender/descender rounding even when every glyph is painted.
          // Preserve the tight horizontal threshold, but require a material
          // vertical overflow before treating it as visible clipping.
          || (content.scrollWidth <= content.clientWidth + 1 && content.scrollHeight <= content.clientHeight + 4)) return [];
        return [{
          text: text.slice(0, 80),
          rect: contentRect,
          scrollWidth: content.scrollWidth,
          clientWidth: content.clientWidth,
          scrollHeight: content.scrollHeight,
          clientHeight: content.clientHeight,
        }];
      }),
    })));
    const authControl = document.querySelector('.menu-auth-slot .auth-control');
    const apiKeyControl = document.querySelector('.menu-api-key-trigger, .api-key-badge');
    if (authControl) {
      controls.push({
        selector: '.menu-auth-slot .auth-control',
        index: 0,
        label: authControl.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || 'auth control',
        rect: rectOf(authControl),
        visible: visible(authControl),
        disabled: authControl.matches(':disabled'),
      });
    }
    const selectedMode = document.querySelector('.mode-grid > .mode-tile.selected-mode-tile');
    const selectedModeLabel = selectedMode?.querySelector('span') ?? selectedMode;
    const selectedForeground = selectedModeLabel ? parseColor(getComputedStyle(selectedModeLabel).color) : null;
    const selectedBackground = selectedMode ? resolvedBackground(selectedMode) : null;

    return {
      theme: document.documentElement.dataset.theme ?? null,
      family: document.documentElement.dataset.layoutFamily ?? null,
      variant: document.documentElement.dataset.layoutVariant ?? null,
      title: titleElement?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      titleVisible: titleElement ? visible(titleElement) : false,
      copy: copyElement?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      copyVisible: copyElement ? visible(copyElement) : false,
      headingContent: heading ? {
        rect: rectOf(heading),
        titleRect: titleElement ? rectOf(titleElement) : null,
        copyRect: copyElement ? rectOf(copyElement) : null,
        authRect: authControl ? rectOf(authControl) : null,
        apiKeyRect: apiKeyControl ? rectOf(apiKeyControl) : null,
      } : null,
      copySignature: [
        titleElement?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
        copyElement?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      ].join(' | '),
      canonicalAria: {
        workspace: workspace?.getAttribute('aria-label') ?? null,
        title: titleElement?.getAttribute('aria-label') ?? null,
        coachHeading: document.querySelector('.setup-panel-coach .eyebrow')?.getAttribute('aria-label') ?? null,
        coachingControl: document.querySelector('.coaching-control-toggle')?.getAttribute('aria-label') ?? null,
        coachingInfo: document.querySelector('.coaching-control-info')?.getAttribute('aria-label') ?? null,
        themeTrigger: document.querySelector('.theme-switcher-trigger')?.getAttribute('aria-label') ?? null,
        launch: document.querySelector('.menu-play')?.getAttribute('aria-label') ?? null,
      },
      canonicalModes: firstFourModes.map((element) => element.getAttribute('aria-label') ?? ''),
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      menu: menu ? { rect: rectOf(menu), scrollWidth: menu.scrollWidth, clientWidth: menu.clientWidth } : null,
      workspace: workspace ? { rect: rectOf(workspace), scrollWidth: workspace.scrollWidth, clientWidth: workspace.clientWidth } : null,
      regions,
      setupSections,
      controls,
      modeCount: firstFourModes.length,
      selectedModeContrast: selectedForeground && selectedBackground
        ? {
            ratio: contrast(selectedForeground, selectedBackground),
            foreground: selectedForeground,
            background: selectedBackground,
          }
        : null,
      modeRowPattern: rowPattern(firstFourModes),
      modeRects: firstFourModes.map((element) => {
        const rect = rectOf(element);
        const contentRects = [...element.querySelectorAll(':scope > span, :scope > strong')].map(rectOf);
        return {
          ...rect,
          contentFits: contentRects.every((content) => content.left >= rect.left - 1
            && content.right <= rect.right + 1
            && content.top >= rect.top - 1
            && content.bottom <= rect.bottom + 1),
          contentRects,
        };
      }),
      railRect: document.querySelector('.theme-switcher-trigger')
        ? rectOf(document.querySelector('.theme-switcher-trigger'))
        : null,
    };
  }, { regionSelectors: primaryRegions, controlSelectors: criticalControlSelectors });
}

async function inspectControlReachability(page, selector, index) {
  const locator = page.locator(selector).nth(index);
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const stack = document.elementsFromPoint(centerX, centerY);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      centerInsideViewport: rect.width > 0
        && rect.height > 0
        && rect.left + rect.width / 2 >= 0
        && rect.left + rect.width / 2 <= innerWidth
        && rect.top + rect.height / 2 >= 0
        && rect.top + rect.height / 2 <= innerHeight,
      topmostAtCenter: stack.some((candidate) => candidate === element || element.contains(candidate)),
    };
  });
}

async function inspectLocatorReachability(locator, { scroll = true } = {}) {
  if (scroll) {
    await locator.scrollIntoViewIfNeeded();
    await locator.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    let clippedByAncestor = false;
    let clippingAncestor = null;
    let ancestor = element.parentElement;
    while (ancestor && !clippedByAncestor) {
      const ancestorStyle = getComputedStyle(ancestor);
      const ancestorRect = ancestor.getBoundingClientRect();
      const clipsX = ['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowX);
      const clipsY = ['auto', 'scroll', 'hidden', 'clip'].includes(ancestorStyle.overflowY);
      if ((clipsX && (center.x < ancestorRect.left || center.x > ancestorRect.right))
        || (clipsY && (center.y < ancestorRect.top || center.y > ancestorRect.bottom))) {
        clippedByAncestor = true;
        clippingAncestor = ancestor.tagName.toLowerCase()
          + (typeof ancestor.className === 'string' && ancestor.className.trim()
            ? `.${ancestor.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '');
      }
      ancestor = ancestor.parentElement;
    }
    const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const stack = document.elementsFromPoint(centerX, centerY);
    return {
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      visible: style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.01
        && rect.width > 0
        && rect.height > 0
        && !clippedByAncestor,
      clippedByAncestor,
      clippingAncestor,
      centerInsideViewport: rect.width > 0
        && rect.height > 0
        && rect.left + rect.width / 2 >= 0
        && rect.left + rect.width / 2 <= innerWidth
        && rect.top + rect.height / 2 >= 0
        && rect.top + rect.height / 2 <= innerHeight,
      topmostAtCenter: stack.some((candidate) => candidate === element || element.contains(candidate)),
    };
  });
}

async function assertLocatorReachable(locator, contextLabel, label, failures, { optional = false } = {}) {
  const count = await locator.count();
  if (count === 0) {
    if (!optional) addFailure(failures, contextLabel, `${label} is missing`);
    return null;
  }
  const metrics = await inspectLocatorReachability(locator.first());
  if (!metrics.visible) addFailure(failures, contextLabel, `${label} is not visible`, metrics.rect);
  else if (!metrics.centerInsideViewport) addFailure(failures, contextLabel, `${label} cannot be scrolled into view`, metrics.rect);
  else if (!metrics.topmostAtCenter) addFailure(failures, contextLabel, `${label} is occluded at its center`, metrics.rect);
  return metrics;
}

async function assertVisibleDescendantsContained(page, containerSelector, descendantSelector, contextLabel, failures) {
  const metrics = await page.evaluate(({ containerSelector: requestedContainer, descendantSelector: requestedDescendants }) => {
    const container = document.querySelector(requestedContainer);
    if (!container) return { container: null, escaped: [] };
    const containerRect = container.getBoundingClientRect();
    const rectOf = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const escaped = [...container.querySelectorAll(requestedDescendants)].flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.01
        && rect.width > 0
        && rect.height > 0;
      if (!visible) return [];
      const outside = rect.left < containerRect.left - 1
        || rect.right > containerRect.right + 1
        || rect.top < containerRect.top - 1
        || rect.bottom > containerRect.bottom + 1;
      return outside ? [{
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className : null,
        text: (element.textContent || '').trim().slice(0, 80),
        rect: rectOf(rect),
      }] : [];
    });
    return { container: rectOf(containerRect), escaped };
  }, { containerSelector, descendantSelector });

  if (!metrics.container) {
    addFailure(failures, contextLabel, `${containerSelector} containment surface is missing`);
  }
  for (const escaped of metrics.escaped) {
    addFailure(failures, contextLabel, `${escaped.tag}${escaped.id ? `#${escaped.id}` : ''} escapes ${containerSelector}`, escaped);
  }
  return metrics;
}

async function assertScrollExtentReachable(page, rootSelector, contextLabel, failures) {
  const metrics = await page.locator(rootSelector).evaluate((root) => {
    const original = root.scrollTop;
    const maximum = Math.max(0, root.scrollHeight - root.clientHeight);
    root.scrollTop = maximum;
    const reached = root.scrollTop;
    root.scrollTop = original;
    return {
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      maximum,
      reached,
    };
  });
  if (metrics.maximum > 1 && metrics.reached < metrics.maximum - 2) {
    addFailure(failures, contextLabel, 'surface scroll extent is not reachable', metrics);
  }
  return metrics;
}

async function validateMenu(page, themeId, viewportName, failures) {
  const context = `${viewportName}/${themeId}`;
  const expectedFamily = familyByTheme.get(themeId);
  const metrics = await inspectMenu(page);

  if (metrics.theme !== themeId) addFailure(failures, context, `root theme is ${metrics.theme || 'missing'}, expected ${themeId}`);
  if (metrics.family !== expectedFamily) {
    addFailure(failures, context, `layout family is ${metrics.family || 'missing'}, expected ${expectedFamily}`);
  }
  if (!metrics.variant) addFailure(failures, context, 'root data-layout-variant is missing');
  if (!metrics.titleVisible || !metrics.title) addFailure(failures, context, 'menu h1/title is missing or not visible');
  if (!metrics.copyVisible || !metrics.copy) addFailure(failures, context, 'menu description copy is missing or not visible');
  if (metrics.headingContent) {
    for (const [label, contentRect] of [
      ['title', metrics.headingContent.titleRect],
      ['description copy', metrics.headingContent.copyRect],
    ]) {
      if (!contentRect) continue;
      const headingRect = metrics.headingContent.rect;
      if (contentRect.left < headingRect.left - 1
        || contentRect.right > headingRect.right + 1
        || contentRect.top < headingRect.top - 1
        || contentRect.bottom > headingRect.bottom + 1) {
        addFailure(failures, context, `menu ${label} escapes or is clipped by its heading panel`, {
          headingRect,
          contentRect,
        });
      }
    }
    if (metrics.headingContent.titleRect && metrics.headingContent.authRect) {
      const overlap = overlapAmount(metrics.headingContent.titleRect, metrics.headingContent.authRect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, 'sign-in control overlaps the product title', overlap);
      }
    }
    if (metrics.headingContent.copyRect && metrics.headingContent.apiKeyRect) {
      const overlap = overlapAmount(metrics.headingContent.copyRect, metrics.headingContent.apiKeyRect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, 'API key control overlaps the menu description copy', overlap);
      }
    }
  }
  if (metrics.title.toLocaleLowerCase() === 'classic chess') {
    addFailure(failures, context, 'premium preset still uses the generic "Classic Chess" h1/title');
  }
  if (metrics.canonicalAria.workspace !== 'Chessbuddy setup') {
    addFailure(failures, context, 'canonical workspace aria-label changed', metrics.canonicalAria);
  }
  if (metrics.canonicalAria.title !== 'Chessbuddy') {
    addFailure(failures, context, 'canonical product-title aria-label changed', metrics.canonicalAria);
  }
  if (metrics.canonicalAria.coachHeading !== 'Coach') {
    addFailure(failures, context, 'canonical coach-heading aria-label changed', metrics.canonicalAria);
  }
  if (metrics.canonicalAria.coachingControl !== 'Coaching control mode') {
    addFailure(failures, context, 'canonical coaching-control aria-label changed', metrics.canonicalAria);
  }
  if (metrics.canonicalAria.coachingInfo !== 'About coaching control') {
    addFailure(failures, context, 'canonical coaching-info aria-label changed', metrics.canonicalAria);
  }
  if (metrics.canonicalAria.themeTrigger !== null) {
    addFailure(failures, context, 'disabled visual-style trigger is still rendered', metrics.canonicalAria);
  }
  if (!['Start game', 'Start tactics'].includes(metrics.canonicalAria.launch)) {
    addFailure(failures, context, 'canonical launch aria-label changed', metrics.canonicalAria);
  }
  const expectedModeLabels = ['Play a Game', 'Tactics', 'Game Library', 'Create a Coach'];
  if (JSON.stringify(metrics.canonicalModes) !== JSON.stringify(expectedModeLabels)) {
    addFailure(failures, context, 'canonical mode labels changed', {
      expected: expectedModeLabels,
      actual: metrics.canonicalModes,
    });
  }
  if (metrics.document.scrollWidth > metrics.document.clientWidth + 1) {
    addFailure(failures, context, 'document has horizontal overflow', metrics.document);
  }
  if (metrics.menu && metrics.menu.scrollWidth > metrics.menu.clientWidth + 1) {
    addFailure(failures, context, 'menu scroll container has horizontal overflow', metrics.menu);
  }
  if (metrics.workspace && metrics.workspace.scrollWidth > metrics.workspace.clientWidth + 1) {
    addFailure(failures, context, 'menu workspace has horizontal overflow', metrics.workspace);
  }

  if (metrics.modeCount !== 4) {
    addFailure(failures, context, `expected four primary mode controls, found ${metrics.modeCount}`);
  }
  if (!metrics.selectedModeContrast) {
    addFailure(failures, context, 'selected mode label contrast could not be measured');
  } else if (metrics.selectedModeContrast.ratio < 3) {
    addFailure(failures, context, 'selected mode label contrast is below 3:1', metrics.selectedModeContrast);
  }
  const sortedModeRows = [...metrics.modeRowPattern].sort((left, right) => left - right);
  if (sortedModeRows.length === 2 && sortedModeRows[0] === 1 && sortedModeRows[1] === 3) {
    addFailure(failures, context, `orphaned 3 + 1 mode composition detected (${metrics.modeRowPattern.join(' + ')})`);
  }

  for (const region of metrics.regions) {
    const suppliesOwnBox = region.display !== 'contents';
    if (suppliesOwnBox && !region.visible) addFailure(failures, context, `${region.selector} is not visible`, region.rect);
    if (!suppliesOwnBox) continue;
    if (region.rect.left < -1 || region.rect.right > metrics.viewport.width + 1) {
      addFailure(failures, context, `${region.selector} escapes the viewport horizontally`, region.rect);
    }
  }
  for (let leftIndex = 0; leftIndex < metrics.regions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.regions.length; rightIndex += 1) {
      const left = metrics.regions[leftIndex];
      const right = metrics.regions[rightIndex];
      if (left.display === 'contents' || right.display === 'contents') continue;
      const overlap = overlapAmount(left.rect, right.rect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, `${left.selector} overlaps ${right.selector}`, overlap);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < metrics.setupSections.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.setupSections.length; rightIndex += 1) {
      const left = metrics.setupSections[leftIndex];
      const right = metrics.setupSections[rightIndex];
      const overlap = overlapAmount(left.rect, right.rect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, `${left.label} overlaps ${right.label}`, overlap);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < metrics.modeRects.length; leftIndex += 1) {
    const mode = metrics.modeRects[leftIndex];
    if (!mode.contentFits) {
      addFailure(failures, context, `mode ${leftIndex + 1} clips its label or description`, mode);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.modeRects.length; rightIndex += 1) {
      const overlap = overlapAmount(metrics.modeRects[leftIndex], metrics.modeRects[rightIndex]);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, `mode ${leftIndex + 1} overlaps mode ${rightIndex + 1}`, overlap);
      }
    }
  }

  const rail = metrics.railRect;
  if (rail) {
    for (const region of metrics.regions) {
      if (region.display === 'contents') continue;
      const overlap = overlapAmount(rail, region.rect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, context, `visual-style rail overlaps ${region.selector}`, overlap);
      }
    }
  }

  for (const control of metrics.controls) {
    if (!control.visible) {
      addFailure(failures, context, `${control.selector}[${control.index}] is not visible`, control);
      continue;
    }
    if (control.rect.width < 1 || control.rect.height < 1) {
      addFailure(failures, context, `${control.selector}[${control.index}] has no usable geometry`, control.rect);
      continue;
    }
    if (control.clippedText?.length) {
      addFailure(failures, context, `${control.selector}[${control.index}] clips its text`, control.clippedText);
    }
    const requiresFullTouchTarget = [
      '.mode-tile',
      '.coach-picker button',
      '.difficulty-picker button',
      '.coaching-control-option',
      '.menu-play',
      '.theme-switcher-trigger',
      '.menu-auth-slot .auth-control',
    ].includes(control.selector);
    if (requiresFullTouchTarget && (control.rect.width < 44 || control.rect.height < 44)) {
      addFailure(failures, context, `${control.selector}[${control.index}] is smaller than the 44px interaction target`, control.rect);
    }
    if (control.rect.left < -1 || control.rect.right > metrics.viewport.width + 1) {
      addFailure(failures, context, `${control.selector}[${control.index}] escapes horizontally`, control.rect);
    }
    if (control.disabled) continue;
    const reachability = await inspectControlReachability(page, control.selector, control.index);
    if (!reachability.centerInsideViewport) {
      addFailure(failures, context, `${control.selector}[${control.index}] cannot be scrolled into view`, reachability.rect);
    } else if (!reachability.topmostAtCenter) {
      addFailure(failures, context, `${control.selector}[${control.index}] is occluded at its center`, reachability.rect);
    }
  }

  const cta = metrics.controls.find((control) => control.selector === '.menu-play');
  if (!cta) addFailure(failures, context, 'primary launch CTA is missing');

  return metrics;
}

async function captureMenu(page, viewport, family, themeId, screenshots) {
  await page.evaluate(() => {
    const menu = document.querySelector('.menu-screen');
    if (menu) menu.scrollTop = 0;
    scrollTo(0, 0);
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const filename = `menu-${viewport.name}-${family}-${themeId}.png`;
  const path = join(outputDir, filename);
  await page.screenshot({ path, animations: 'disabled' });
  screenshots.push(path);
}

async function inspectSurface(page, rootSelector, geometrySelectors, modal = false) {
  return page.evaluate(({ rootSelector: requestedRoot, geometrySelectors: requestedGeometry, modal: isModal }) => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const root = document.querySelector(requestedRoot);
    const targets = requestedGeometry.flatMap((selector) => [...document.querySelectorAll(selector)].map((element, index) => ({
      selector,
      index,
      visible: isVisible(element),
      rect: rectOf(element),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    })));
    return {
      root: root ? {
        visible: isVisible(root),
        rect: rectOf(root),
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      } : null,
      targets,
      modal: isModal,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      theme: document.documentElement.dataset.theme ?? null,
    };
  }, { rootSelector, geometrySelectors, modal });
}

function validateSurfaceMetrics(metrics, contextLabel, failures) {
  if (!metrics.root?.visible) addFailure(failures, contextLabel, 'expected screen/dialog root is missing or not visible');
  if (metrics.theme !== contextLabel.split('/')[1]) {
    addFailure(failures, contextLabel, `theme changed unexpectedly to ${metrics.theme || 'missing'}`);
  }
  if (metrics.document.scrollWidth > metrics.document.clientWidth + 1) {
    addFailure(failures, contextLabel, 'surface has horizontal document overflow', metrics.document);
  }
  if (metrics.root && metrics.root.scrollWidth > metrics.root.clientWidth + 1) {
    addFailure(failures, contextLabel, 'surface root has horizontal overflow', metrics.root);
  }

  for (const target of metrics.targets) {
    if (!target.visible) {
      addFailure(failures, contextLabel, `${target.selector}[${target.index}] is missing or not visible`, target);
      continue;
    }
    if (target.rect.left < -1 || target.rect.right > metrics.viewport.width + 1) {
      addFailure(failures, contextLabel, `${target.selector}[${target.index}] escapes horizontally`, target.rect);
    }
    if (target.scrollWidth > target.clientWidth + 1) {
      addFailure(failures, contextLabel, `${target.selector}[${target.index}] has horizontal content overflow`, target);
    }
    if (metrics.modal && (target.rect.top < -1 || target.rect.bottom > metrics.viewport.height + 1)) {
      addFailure(failures, contextLabel, `${target.selector}[${target.index}] escapes the modal viewport vertically`, target.rect);
    }
  }

  for (let leftIndex = 0; leftIndex < metrics.targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.targets.length; rightIndex += 1) {
      const left = metrics.targets[leftIndex];
      const right = metrics.targets[rightIndex];
      // Only compare siblings from the same geometry selector. A modal panel
      // intentionally sits inside its full-viewport backdrop/root.
      if (left.selector !== right.selector) continue;
      const overlap = overlapAmount(left.rect, right.rect);
      if (overlap.width > 1 && overlap.height > 1) {
        addFailure(failures, contextLabel, `${left.selector}[${left.index}] overlaps sibling ${right.index}`, overlap);
      }
    }
  }
}

async function captureSurface(page, {
  themeId,
  family,
  name,
  rootSelector,
  geometrySelectors,
  modal = false,
}, screenshots, failures) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const contextLabel = `desktop/${themeId}/${name}`;
  const metrics = await inspectSurface(page, rootSelector, geometrySelectors, modal);
  validateSurfaceMetrics(metrics, contextLabel, failures);
  const filename = `secondary-desktop-${family}-${themeId}-${name}.png`;
  const path = join(outputDir, filename);
  await page.screenshot({ path, animations: 'disabled' });
  screenshots.push(path);
  return {
    name,
    theme: metrics.theme,
    targetsChecked: metrics.targets.length,
    screenshot: path,
  };
}

async function captureTargetedSecondaryScreens(browser, themeId, screenshots, failures, errors) {
  const family = familyByTheme.get(themeId);
  const scopedErrors = [];
  const { context, page } = await prepareContext(browser, { width: 1440, height: 900 }, scopedErrors);
  const results = [];
  const runCase = async (name, action) => {
    try {
      await openMenu(page, themeId);
      results.push(await action());
    } catch (error) {
      addFailure(failures, `desktop/${themeId}/${name}`, error instanceof Error ? error.message : String(error));
    }
  };

  try {
    await runCase('public-chrome', async () => {
      const chrome = await page.evaluate(() => ({
        apiKeyControls: document.querySelectorAll('.menu-api-key-trigger, .api-key-badge, [aria-labelledby="api-key-title"]').length,
        themeControls: document.querySelectorAll('.theme-switcher, .theme-switcher-trigger').length,
        numberedModes: [...document.querySelectorAll('.mode-grid > .mode-tile')].filter((element) => {
          const marker = getComputedStyle(element, '::before');
          return marker.display !== 'none' && !['none', 'normal', '""'].includes(marker.content);
        }).length,
        headingMarker: (() => {
          const heading = document.querySelector('.menu-heading');
          return heading ? getComputedStyle(heading, '::after').content : null;
        })(),
      }));
      if (chrome.apiKeyControls !== 0) addFailure(failures, `desktop/${themeId}/public-chrome`, 'API-key controls remain in the player-facing menu', chrome);
      if (chrome.themeControls !== 0) addFailure(failures, `desktop/${themeId}/public-chrome`, 'theme controls remain in the player-facing menu', chrome);
      if (chrome.numberedModes !== 0) addFailure(failures, `desktop/${themeId}/public-chrome`, 'mode numbering remains visible', chrome);
      if (chrome.headingMarker && !['none', 'normal', '""'].includes(chrome.headingMarker)) {
        addFailure(failures, `desktop/${themeId}/public-chrome`, 'decorative heading symbol remains visible', chrome);
      }
      return { name: 'public-chrome', ...chrome };
    });

    await runCase('games', async () => {
      await page.getByRole('button', { name: 'Game Library', exact: true }).click();
      await page.locator('main[data-screen="games"]').waitFor({ state: 'visible', timeout: 30_000 });
      const result = await captureSurface(page, {
        themeId,
        family,
        name: 'games',
        rootSelector: 'main[data-screen="games"]',
        geometrySelectors: ['.games-layout', '.games-layout > *'],
      }, screenshots, failures);
      const contextLabel = `desktop/${themeId}/games`;
      await assertLocatorReachable(page.getByRole('button', { name: 'Menu', exact: true }), contextLabel, 'canonical Menu control', failures);
      return result;
    });

    await runCase('creator', async () => {
      await page.getByRole('button', { name: 'Create a Coach', exact: true }).click();
      await page.locator('main[data-screen="creator"]').waitFor({ state: 'visible', timeout: 30_000 });
      const creatorHeading = await inspectLocatorReachability(
        page.locator('main[data-screen="creator"] > .topbar h1'),
        { scroll: false },
      );
      if (creatorHeading.rect.top < -1 || creatorHeading.rect.bottom > 901) {
        addFailure(failures, `desktop/${themeId}/creator`, 'creator screen heading is clipped by the viewport', creatorHeading.rect);
      }
      const result = await captureSurface(page, {
        themeId,
        family,
        name: 'creator',
        rootSelector: 'main[data-screen="creator"]',
        geometrySelectors: ['.creator-layout', '.creator-layout > *'],
      }, screenshots, failures);
      const contextLabel = `desktop/${themeId}/creator`;
      const createCoachControl = page.getByRole('button', { name: 'Create coach', exact: true });
      const initialSubmit = await inspectLocatorReachability(createCoachControl, { scroll: false });
      const scrollExtent = await assertScrollExtentReachable(page, 'main[data-screen="creator"]', contextLabel, failures);
      if ((!initialSubmit.visible || !initialSubmit.centerInsideViewport) && scrollExtent.maximum <= 1) {
        addFailure(failures, contextLabel, 'creator content is clipped but its root exposes no vertical scroll range', {
          initialSubmit,
          scrollExtent,
        });
      }
      await assertLocatorReachable(createCoachControl, contextLabel, 'canonical Create coach control', failures);
      await assertLocatorReachable(page.locator('.creator-row--model select').last(), contextLabel, 'final creator form select', failures);
      await assertLocatorReachable(page.getByRole('button', { name: 'Menu', exact: true }), contextLabel, 'canonical Menu control', failures);
      return { ...result, scrollExtent };
    });

    await runCase('puzzles', async () => {
      await page.getByRole('button', { name: 'Tactics', exact: true }).click();
      await page.getByRole('button', { name: 'Start tactics', exact: true }).click();
      await page.locator('main[data-screen="puzzles"]').waitFor({ state: 'visible', timeout: 30_000 });
      const stateLayer = page.locator('.loading-screen, .puzzle-cover, .puzzle-intro-overlay').first();
      await stateLayer.waitFor({ state: 'visible', timeout: 30_000 });
      const puzzleState = await stateLayer.evaluate((element) => (
        element.classList.contains('loading-screen') ? 'loading' : 'intro'
      ));
      const result = await captureSurface(page, {
        themeId,
        family,
        name: `puzzles-${puzzleState}`,
        rootSelector: 'main[data-screen="puzzles"]',
        geometrySelectors: ['.training-layout', '.training-layout > *', '.loading-screen, .puzzle-cover, .puzzle-intro-overlay'],
      }, screenshots, failures);
      const contextLabel = `desktop/${themeId}/puzzles-${puzzleState}`;
      await assertScrollExtentReachable(page, 'main[data-screen="puzzles"]', contextLabel, failures);
      if (puzzleState === 'intro') {
        await assertLocatorReachable(page.getByRole('button', { name: 'Start puzzles', exact: true }), contextLabel, 'canonical Start puzzles control', failures);
      } else {
        await assertLocatorReachable(stateLayer, contextLabel, 'puzzle loading state', failures);
        // Offline visual QA deliberately blocks Convai. If this build holds the
        // route at its connection cover, that cover is the honest state we can
        // validate; do not turn the intentional network boundary into a timeout.
        return { ...result, puzzleState };
      }
      const introResult = await captureSurface(page, {
        themeId,
        family,
        name: 'puzzles-intro',
        rootSelector: 'main[data-screen="puzzles"]',
        geometrySelectors: ['.training-layout', '.training-layout > *', '.puzzle-cover'],
      }, screenshots, failures);
      await page.getByRole('button', { name: 'Start puzzles', exact: true }).click();
      await page.locator('main[data-screen="puzzles"][data-screen-state="active"]').waitFor({ state: 'visible', timeout: 30_000 });
      const activeResult = await captureSurface(page, {
        themeId,
        family,
        name: 'puzzles-active',
        rootSelector: 'main[data-screen="puzzles"]',
        geometrySelectors: ['.training-layout', '.puzzle-left-col', '.puzzle-board-stage', '.chess-board'],
      }, screenshots, failures);
      await assertLocatorReachable(page.getByRole('button', { name: /^Hint/ }), `desktop/${themeId}/puzzles-active`, 'Hint control', failures);
      return { ...result, puzzleState, intro: introResult.screenshot, active: activeResult.screenshot };
    });

    await runCase('auth-modal', async () => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.locator('[role="dialog"][aria-labelledby="auth-signin-title"]').waitFor({ state: 'visible' });
      const canonicalTitle = await page.locator('#auth-signin-title').getAttribute('aria-label');
      // The modal may immediately advance to pending/error when external auth
      // is blocked by this offline QA context. The initial themed title keeps
      // the canonical product label; state-specific headings need not repeat it.
      if (canonicalTitle !== null && canonicalTitle !== 'Sign in to Chessbuddy') {
        addFailure(failures, `desktop/${themeId}/auth-modal`, 'canonical sign-in dialog label changed', { canonicalTitle });
      }
      const result = await captureSurface(page, {
        themeId,
        family,
        name: 'auth-modal',
        rootSelector: '[role="dialog"][aria-labelledby="auth-signin-title"]',
        geometrySelectors: ['.auth-signin-modal'],
        modal: true,
      }, screenshots, failures);
      const contextLabel = `desktop/${themeId}/auth-modal`;
      await assertVisibleDescendantsContained(page, '.auth-signin-modal', 'h1, h2, h3, p, label, input, button, a', contextLabel, failures);
      await assertLocatorReachable(page.getByRole('button', { name: 'Close sign in', exact: true }), contextLabel, 'canonical Close sign in control', failures);
      await assertLocatorReachable(page.getByRole('button', { name: 'Try again', exact: true }), contextLabel, 'Try again control', failures, { optional: true });
      return result;
    });
  } finally {
    errors.push(...scopedErrors.map((message) => `desktop/${themeId}/secondary: ${message}`));
    await context.close();
  }
  return results;
}

async function captureRepresentativeGame(browser, family, themeId, screenshots, failures, errors) {
  const contextLabel = `desktop/${themeId}/game`;
  const { context, page } = await prepareContext(browser, { width: 1440, height: 900 }, errors);
  try {
    await openMenu(page, themeId);
    await page.locator('.menu-play').click();
    await page.locator('.game-screen[data-screen="game"][data-screen-state="active"]').waitFor({ state: 'visible', timeout: 140_000 });
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 140_000 });
    await page.locator('.chess-board').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll('.chess-board .square').length === 64);
    await page.locator('.character-window').waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const geometry = await page.evaluate(() => {
      const selectors = ['.coach-card', '.game-stage', '.side-panel'];
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) > 0.01
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.top < innerHeight
          && rect.right > 0
          && rect.left < innerWidth;
      };
      const rects = selectors.flatMap((selector) => {
        const element = document.querySelector(`.app-shell:not(.analysis-shell) > ${selector}`);
        if (!element || !visible(element)) return [];
        return [{ selector, ...rectOf(element) }];
      });
      const boardElement = document.querySelector('.chess-board');
      const board = boardElement?.getBoundingClientRect();
      const boardStyle = boardElement ? getComputedStyle(boardElement) : null;
      const rail = document.querySelector('.game-navigation-rail');
      const railTools = rail ? [...rail.querySelectorAll('.rail-tool')] : [];
      const chatRow = document.querySelector('.app-shell:not(.analysis-shell) .coach-chat-row');
      const chatInput = chatRow?.querySelector('.coach-chat-input');
      const turnCard = document.querySelector('.app-shell:not(.analysis-shell) .turn-card');
      const turnHeading = turnCard?.querySelector('h2');
      const turnPrimaryAction = turnCard?.querySelector('.primary-action');
      const turnActions = turnCard ? [...turnCard.querySelectorAll('button')].map((action) => {
        const actionRect = action.getBoundingClientRect();
        const cardRect = turnCard.getBoundingClientRect();
        return {
          rect: rectOf(action),
          visible: visible(action),
          centerInCard: actionRect.top + actionRect.height / 2 >= cardRect.top
            && actionRect.top + actionRect.height / 2 <= cardRect.bottom,
          text: action.textContent?.trim().replace(/\s+/g, ' ') ?? '',
        };
      }) : [];
      const portraitWindow = document.querySelector('.app-shell:not(.analysis-shell) .character-window');
      const portraitCanvas = portraitWindow?.querySelector('canvas');
      const coachStatus = document.querySelector('.app-shell:not(.analysis-shell) .coach-card .caption-info span');
      const canvasRect = portraitCanvas?.getBoundingClientRect();
      return {
        rects,
        board: board ? { width: board.width, height: board.height } : null,
        boardChrome: boardStyle ? {
          borderTopWidth: Number.parseFloat(boardStyle.borderTopWidth),
          borderTopColor: boardStyle.borderTopColor,
          borderRadius: boardStyle.borderRadius,
        } : null,
        navigationRail: rail ? {
          rect: rectOf(rail),
          visible: visible(rail),
          toolCount: railTools.length,
          visibleToolCount: railTools.filter(visible).length,
          activeLabel: rail.querySelector('[aria-current="page"]')?.textContent?.trim() ?? '',
          wordmarkCount: rail.querySelectorAll('h1').length,
        } : null,
        developerControls: document.querySelectorAll('.debug-copy-button, .dev-menu-wrap, [aria-label="Developer options"]').length,
        chat: chatRow && chatInput ? {
          row: rectOf(chatRow),
          input: rectOf(chatInput),
          visible: visible(chatRow) && visible(chatInput),
        } : null,
        turnCard: turnCard ? { rect: rectOf(turnCard), visible: visible(turnCard) } : null,
        turnHeading: turnHeading ? {
          rect: rectOf(turnHeading),
          visible: visible(turnHeading),
          centerInCard: turnCard
            ? turnHeading.getBoundingClientRect().top + turnHeading.getBoundingClientRect().height / 2 >= turnCard.getBoundingClientRect().top
              && turnHeading.getBoundingClientRect().top + turnHeading.getBoundingClientRect().height / 2 <= turnCard.getBoundingClientRect().bottom
            : false,
          text: turnHeading.textContent?.trim() ?? '',
        } : null,
        turnPrimaryAction: turnPrimaryAction ? {
          rect: rectOf(turnPrimaryAction),
          visible: visible(turnPrimaryAction),
          centerInCard: turnCard
            ? turnPrimaryAction.getBoundingClientRect().top + turnPrimaryAction.getBoundingClientRect().height / 2 >= turnCard.getBoundingClientRect().top
              && turnPrimaryAction.getBoundingClientRect().top + turnPrimaryAction.getBoundingClientRect().height / 2 <= turnCard.getBoundingClientRect().bottom
            : false,
          text: turnPrimaryAction.textContent?.trim() ?? '',
        } : null,
        turnActions,
        sidePanelVisible: Boolean(document.querySelector('.app-shell:not(.analysis-shell) > .side-panel')
          && visible(document.querySelector('.app-shell:not(.analysis-shell) > .side-panel'))),
        moveCardCount: document.querySelectorAll('.app-shell:not(.analysis-shell) .move-card').length,
        portraitCanvas: portraitCanvas && canvasRect ? {
          rect: rectOf(portraitCanvas),
          visible: visible(portraitCanvas),
          readyClass: portraitWindow?.classList.contains('is-ready') ?? false,
          bufferWidth: portraitCanvas.width,
          bufferHeight: portraitCanvas.height,
          cssAspect: canvasRect.height > 0 ? canvasRect.width / canvasRect.height : 0,
          bufferAspect: portraitCanvas.height > 0 ? portraitCanvas.width / portraitCanvas.height : 0,
        } : null,
        portraitWindow: portraitWindow ? {
          rect: rectOf(portraitWindow),
          visible: visible(portraitWindow),
          readyClass: portraitWindow.classList.contains('is-ready'),
          hasCanvas: Boolean(portraitCanvas),
          hasFallback: Boolean(portraitWindow.querySelector('.character-fallback-img')),
          hasLoadingSurface: Boolean(portraitWindow.querySelector('.character-loading')),
        } : null,
        coachStatus: coachStatus ? {
          rect: rectOf(coachStatus),
          visible: visible(coachStatus),
          text: coachStatus.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          scrollWidth: coachStatus.scrollWidth,
          clientWidth: coachStatus.clientWidth,
          scrollHeight: coachStatus.scrollHeight,
          clientHeight: coachStatus.clientHeight,
        } : null,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    if (geometry.rects.length !== 2) addFailure(failures, contextLabel, `expected coach and board regions only, found ${geometry.rects.length}`);
    if (geometry.documentWidth > geometry.viewportWidth + 1) addFailure(failures, contextLabel, 'game has horizontal overflow', geometry);
    if (!geometry.board || Math.abs(geometry.board.width - geometry.board.height) > 2) {
      addFailure(failures, contextLabel, 'game board is missing or not square', geometry.board);
    } else if (geometry.board.width < 680) {
      addFailure(failures, contextLabel, 'desktop board did not expand into the removed right-panel space', geometry.board);
    }
    if (!geometry.navigationRail?.visible || geometry.navigationRail.rect.height < 890 || geometry.navigationRail.rect.width < 64) {
      addFailure(failures, contextLabel, 'desktop game navigation rail is missing or undersized', geometry.navigationRail);
    }
    if (geometry.navigationRail?.toolCount !== 5 || geometry.navigationRail.visibleToolCount !== 5 || geometry.navigationRail.activeLabel !== 'Board') {
      addFailure(failures, contextLabel, 'desktop game shortcut dock is incomplete or missing its active board state', geometry.navigationRail);
    }
    if (geometry.navigationRail?.wordmarkCount !== 0) {
      addFailure(failures, contextLabel, 'redundant Chessbuddy wordmark remains in the desktop rail', geometry.navigationRail);
    }
    if (geometry.developerControls !== 0) {
      addFailure(failures, contextLabel, 'developer controls remain in the player-facing game', geometry.developerControls);
    }
    if (!geometry.boardChrome || geometry.boardChrome.borderTopWidth > 2) {
      addFailure(failures, contextLabel, 'board still uses a heavy outline', geometry.boardChrome);
    }
    if (!geometry.chat?.visible || geometry.chat.row.height < 58 || geometry.chat.input.width < 190) {
      addFailure(failures, contextLabel, 'coach conversation controls remain congested', geometry.chat);
    }
    if (geometry.sidePanelVisible || geometry.moveCardCount !== 0) {
      addFailure(failures, contextLabel, 'desktop right-side status or move-list panel is still present', geometry);
    }
    if (!geometry.portraitWindow?.visible
      || geometry.portraitWindow.rect.width < 280
      || geometry.portraitWindow.rect.height < 260
      || (!geometry.portraitWindow.hasCanvas
        && !geometry.portraitWindow.hasFallback
        && !geometry.portraitWindow.hasLoadingSurface)) {
      addFailure(failures, contextLabel, 'coach portrait surface is missing or undersized', geometry.portraitWindow);
    }
    if (!geometry.coachStatus?.visible || !geometry.coachStatus.text) {
      addFailure(failures, contextLabel, 'coach status is missing or not visible', geometry.coachStatus);
    } else if (geometry.coachStatus.scrollWidth > geometry.coachStatus.clientWidth + 1
      || geometry.coachStatus.scrollHeight > geometry.coachStatus.clientHeight + 1) {
      addFailure(failures, contextLabel, 'coach status text is clipped', geometry.coachStatus);
    }
    for (let leftIndex = 0; leftIndex < geometry.rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < geometry.rects.length; rightIndex += 1) {
        const left = geometry.rects[leftIndex];
        const right = geometry.rects[rightIndex];
        const overlap = overlapAmount(left, right);
        if (overlap.width > 1 && overlap.height > 1) {
          addFailure(failures, contextLabel, `${left.selector} overlaps ${right.selector}`, overlap);
        }
      }
    }

    const coachMessageGeometry = await page.evaluate(() => {
      const portrait = document.querySelector('.app-shell:not(.analysis-shell) .character-window');
      const wrap = document.querySelector('.app-shell:not(.analysis-shell) .coach-line-wrap');
      if (!portrait || !wrap) return null;
      const original = wrap.innerHTML;
      const measure = (state, text) => {
        wrap.innerHTML = text ? `<p class="coach-line">${text}</p>` : '';
        const portraitRect = portrait.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        return { state, portraitHeight: portraitRect.height, guidanceHeight: wrapRect.height };
      };
      const measurements = [
        measure('short', 'Good move.'),
        measure('long', 'Before choosing your move, compare every check, capture, and direct threat. Then inspect the opponent’s strongest reply and make sure your king remains safe. '.repeat(5)),
        measure('cleared', ''),
      ];
      wrap.innerHTML = original;
      return measurements;
    });
    if (!coachMessageGeometry) {
      addFailure(failures, contextLabel, 'coach message geometry could not be measured');
    } else {
      const portraitHeights = coachMessageGeometry.map((entry) => entry.portraitHeight);
      const guidanceHeights = coachMessageGeometry.map((entry) => entry.guidanceHeight);
      if (Math.max(...portraitHeights) - Math.min(...portraitHeights) > 1
        || Math.max(...guidanceHeights) - Math.min(...guidanceHeights) > 1) {
        addFailure(failures, contextLabel, 'coach portrait or guidance track resizes with message length', coachMessageGeometry);
      }
    }

    const filename = `game-desktop-${family}-${themeId}.png`;
    const path = join(outputDir, filename);
    await page.screenshot({ path, animations: 'disabled' });
    screenshots.push(path);

    const responsiveCases = [
      { id: 'tablet-landscape', width: 1024, height: 768, expectsRail: false },
      { id: 'small-desktop', width: 1200, height: 800, expectsRail: true },
      { id: 'compact-desktop', width: 1280, height: 720, expectsRail: true },
      { id: 'laptop', width: 1366, height: 768, expectsRail: true },
      { id: 'windows-qhd-scaled', width: 1706, height: 938, expectsRail: true },
      { id: 'desktop-hd', width: 1920, height: 1080, expectsRail: true },
      { id: 'desktop-reference', width: 2048, height: 1152, expectsRail: true },
      { id: 'desktop-qhd', width: 2560, height: 1440, expectsRail: true },
    ];
    for (const responsiveCase of responsiveCases) {
      await page.setViewportSize({ width: responsiveCase.width, height: responsiveCase.height });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const responsiveGeometry = await page.evaluate(() => {
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
        };
        const visible = (element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01
            && bounds.width > 0 && bounds.height > 0;
        };
        const stage = document.querySelector('.app-shell:not(.analysis-shell) > .game-stage');
        const wrap = stage?.querySelector('.board-wrap');
        const board = wrap?.querySelector('.chess-board');
        const rail = document.querySelector('.game-navigation-rail');
        const dock = rail?.querySelector('.rail-tools');
        const tools = dock ? [...dock.querySelectorAll('.rail-tool')] : [];
        const turnCard = document.querySelector('.app-shell:not(.analysis-shell) .turn-card');
        const sidePanel = document.querySelector('.app-shell:not(.analysis-shell) > .side-panel');
        const turnActions = turnCard ? [...turnCard.querySelectorAll('button')] : [];
        const regions = [...document.querySelectorAll('.app-shell:not(.analysis-shell) > .coach-card, .app-shell:not(.analysis-shell) > .game-stage, .app-shell:not(.analysis-shell) > .side-panel')]
          .map(rect);
        return {
          viewport: { width: innerWidth, height: innerHeight },
          documentWidth: document.documentElement.scrollWidth,
          stage: stage ? rect(stage) : null,
          wrap: wrap ? rect(wrap) : null,
          board: board ? rect(board) : null,
          rail: rail ? { rect: rect(rail), visible: visible(rail) } : null,
          dock: dock ? { rect: rect(dock), visible: visible(dock) } : null,
          tools: tools.map((tool) => ({
            rect: rect(tool),
            visible: visible(tool),
            label: tool.querySelector('small')?.textContent?.trim() ?? '',
            labelRect: tool.querySelector('small') ? rect(tool.querySelector('small')) : null,
          })),
          turnCard: turnCard ? rect(turnCard) : null,
          sidePanelVisible: Boolean(sidePanel && visible(sidePanel)),
          moveCardCount: document.querySelectorAll('.app-shell:not(.analysis-shell) .move-card').length,
          turnActions: turnActions.map((action) => ({
            label: action.textContent?.trim().replace(/\s+/g, ' ') ?? '',
            rect: rect(action),
            visible: visible(action),
          })),
          regions,
        };
      });
      const responsiveLabel = `${contextLabel}/${responsiveCase.id}`;
      if (responsiveGeometry.documentWidth > responsiveGeometry.viewport.width + 1) {
        addFailure(failures, responsiveLabel, 'responsive game has horizontal overflow', responsiveGeometry);
      }
      if (!responsiveGeometry.stage || !responsiveGeometry.wrap || !responsiveGeometry.board
        || responsiveGeometry.board.left < responsiveGeometry.wrap.left - 1
        || responsiveGeometry.board.right > responsiveGeometry.wrap.right + 1
        || responsiveGeometry.board.top < responsiveGeometry.wrap.top - 1
        || responsiveGeometry.board.bottom > responsiveGeometry.wrap.bottom + 1
        || responsiveGeometry.wrap.left < responsiveGeometry.stage.left - 1
        || responsiveGeometry.wrap.right > responsiveGeometry.stage.right + 1
        || responsiveGeometry.wrap.top < responsiveGeometry.stage.top - 1
        || responsiveGeometry.wrap.bottom > responsiveGeometry.stage.bottom + 1) {
        addFailure(failures, responsiveLabel, 'responsive board escapes its nested game card', responsiveGeometry);
      }
      if (!responsiveCase.expectsRail) {
        for (const expectedAction of ['Ask Hint', 'New game', 'Resign']) {
          const action = responsiveGeometry.turnActions.find(
            (candidate) => candidate.label.toLocaleLowerCase() === expectedAction.toLocaleLowerCase(),
          );
          if (!action?.visible || !responsiveGeometry.turnCard
            || action.rect.top < responsiveGeometry.turnCard.top - 1
            || action.rect.bottom > responsiveGeometry.turnCard.bottom + 1) {
            addFailure(failures, responsiveLabel, `responsive ${expectedAction} action is clipped or missing`, responsiveGeometry);
          }
        }
      }
      for (const region of responsiveGeometry.regions) {
        if (region.left < -1 || region.right > responsiveGeometry.viewport.width + 1) {
          addFailure(failures, responsiveLabel, 'responsive game region escapes horizontally', { region, responsiveGeometry });
        }
      }
      if (responsiveCase.expectsRail) {
        if (!responsiveGeometry.rail?.visible || !responsiveGeometry.dock?.visible || responsiveGeometry.tools.length !== 5) {
          addFailure(failures, responsiveLabel, 'desktop shortcut rail is missing or incomplete', responsiveGeometry);
        }
        for (const tool of responsiveGeometry.tools) {
          if (!tool.visible || !tool.label || !tool.labelRect
            || tool.labelRect.left < tool.rect.left - 1
            || tool.labelRect.right > tool.rect.right + 1
            || tool.labelRect.top < tool.rect.top - 1
            || tool.labelRect.bottom > tool.rect.bottom + 1) {
            addFailure(failures, responsiveLabel, 'desktop shortcut label escapes or overlaps its tool', { tool, responsiveGeometry });
          }
        }
        if (responsiveGeometry.sidePanelVisible) {
          addFailure(failures, responsiveLabel, 'desktop right-side game panel remains visible beside the shortcut rail', responsiveGeometry);
        }
      } else if (responsiveGeometry.dock?.visible) {
        addFailure(failures, responsiveLabel, 'desktop shortcut dock appears below its supported breakpoint', responsiveGeometry);
      }
      if (responsiveGeometry.moveCardCount !== 0) {
        addFailure(failures, responsiveLabel, 'move-list panel remains mounted in the live game', responsiveGeometry);
      }
      const responsivePath = join(outputDir, `game-responsive-${responsiveCase.id}-${family}-${themeId}.png`);
      await page.screenshot({
        path: responsivePath,
        animations: 'disabled',
        fullPage: responsiveCase.width < 1340,
        timeout: 90_000,
      });
      screenshots.push(responsivePath);
    }

    // The post-game screen is used heavily in recorded desktop demos. Exercise
    // the exact 1080p viewport so a theme cannot donate most of the width to a
    // fixed-width coach card and squeeze the actual analysis into a side rail.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await page.getByRole('button', { name: 'Resign game', exact: true }).click();
    const resignDialog = page.locator('[role="dialog"][aria-labelledby="resign-title"]');
    await resignDialog.waitFor({ state: 'visible', timeout: 10_000 });
    const resignPath = join(outputDir, `game-desktop-${family}-${themeId}-resign-dialog.png`);
    await page.screenshot({ path: resignPath, animations: 'disabled' });
    screenshots.push(resignPath);
    await resignDialog.getByRole('button', { name: 'Resign', exact: true }).click();

    const gameOverDialog = page.locator('[role="dialog"][aria-labelledby="gameover-title"]');
    await gameOverDialog.waitFor({ state: 'visible', timeout: 30_000 });
    const gameOverPath = join(outputDir, `game-desktop-${family}-${themeId}-game-over.png`);
    await page.screenshot({ path: gameOverPath, animations: 'disabled' });
    screenshots.push(gameOverPath);
    const gameOverGeometry = await gameOverDialog.evaluate((element) => {
      const primary = element.querySelector('.gameover-actions .primary-action');
      const box = primary?.getBoundingClientRect();
      const styles = primary ? getComputedStyle(primary) : null;
      return {
        primary: box ? { width: box.width, height: box.height } : null,
        hasIcon: Boolean(primary?.querySelector('svg')),
        fontSize: styles ? Number.parseFloat(styles.fontSize) : 0,
        fontWeight: styles ? Number.parseFloat(styles.fontWeight) : 0,
      };
    });
    if (!gameOverGeometry.primary || !gameOverGeometry.hasIcon
      || gameOverGeometry.primary.width < 180 || gameOverGeometry.primary.height < 54
      || gameOverGeometry.fontSize < 14 || gameOverGeometry.fontWeight < 650) {
      addFailure(failures, `desktop/${themeId}/game-over`, 'View Analysis lacks a deliberate primary-action treatment', gameOverGeometry);
    }
    await gameOverDialog.getByRole('button', { name: 'View Analysis', exact: true }).click();

    const analysisScreen = page.locator('main[data-screen="analysis"]');
    await analysisScreen.waitFor({ state: 'visible', timeout: 30_000 });
    const measureAnalysis = () => analysisScreen.evaluate((element) => {
      const rect = (node) => {
        const box = node?.getBoundingClientRect();
        return box ? {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        } : null;
      };
      const shell = element.querySelector('.analysis-shell');
      const coach = shell?.querySelector(':scope > .coach-card');
      const boardStage = shell?.querySelector(':scope > .analysis-board-stage');
      const boardWrap = boardStage?.querySelector('.analysis-review-board');
      const board = boardStage?.querySelector('.chess-board');
      const panel = shell?.querySelector(':scope > .analysis-panel');
      const compactCard = panel?.querySelector('.perf-card, .moment-item');
      const guidanceButton = panel?.querySelector('.guidance-area .primary-action');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        shell: rect(shell),
        coach: rect(coach),
        boardStage: rect(boardStage),
        boardWrap: rect(boardWrap),
        board: rect(board),
        panel: rect(panel),
        compactCard: rect(compactCard),
        compactCardPaddingLeft: compactCard ? Number.parseFloat(getComputedStyle(compactCard).paddingLeft) : 0,
        guidanceButton: rect(guidanceButton),
        panelScrollHeight: panel?.scrollHeight ?? 0,
        panelClientHeight: panel?.clientHeight ?? 0,
        boardStagePadding: boardStage ? {
          left: Number.parseFloat(getComputedStyle(boardStage).paddingLeft),
          right: Number.parseFloat(getComputedStyle(boardStage).paddingRight),
        } : null,
      };
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1600, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1600 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const analysisGeometry = await measureAnalysis();
      const sizeLabel = `${viewport.width}x${viewport.height}`;
      if (analysisGeometry.scrollWidth > analysisGeometry.clientWidth + 1) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'post-game analysis has horizontal overflow', analysisGeometry);
      }
      if (!analysisGeometry.shell || !analysisGeometry.coach || !analysisGeometry.boardStage
        || !analysisGeometry.boardWrap || !analysisGeometry.board || !analysisGeometry.panel
        || analysisGeometry.panel.width < 520
        || analysisGeometry.board.width < (viewport.width < 1500 ? 320
          : viewport.width < 1580 ? 350
            : viewport.width < 1700 ? 380
              : viewport.width < 2200 ? 480 : 560)
        || Math.abs(analysisGeometry.board.width - analysisGeometry.board.height) > 2
        || analysisGeometry.coach.width < 260 || analysisGeometry.coach.width > 360) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'analysis is missing a usable coach, review board, and report layout', analysisGeometry);
      }
      if (analysisGeometry.boardStage && analysisGeometry.boardWrap && analysisGeometry.boardStagePadding
        && (analysisGeometry.boardWrap.left < analysisGeometry.boardStage.left + analysisGeometry.boardStagePadding.left - 1
          || analysisGeometry.boardWrap.right > analysisGeometry.boardStage.right - analysisGeometry.boardStagePadding.right + 1)) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'review board is clipped by its analysis column', analysisGeometry);
      }
      if (analysisGeometry.scrollHeight > analysisGeometry.clientHeight + 2
        || (analysisGeometry.panel && analysisGeometry.panel.bottom > analysisGeometry.viewport.height + 1)
        || (analysisGeometry.panel && analysisGeometry.shell
          && analysisGeometry.panel.height < analysisGeometry.shell.height * 0.88)) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'analysis does not keep its long report in a viewport-height scroller', analysisGeometry);
      }
      if (analysisGeometry.compactCard && analysisGeometry.compactCardPaddingLeft < 20) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'analysis cards do not have enough left padding', analysisGeometry);
      }
      if (analysisGeometry.guidanceButton
        && (analysisGeometry.guidanceButton.width < 180 || analysisGeometry.guidanceButton.height > 84)) {
        addFailure(failures, `desktop/${themeId}/analysis/${sizeLabel}`, 'Ask coach control is vertically crushed', analysisGeometry);
      }
      const analysisPath = join(outputDir, `game-desktop-${family}-${themeId}-analysis-${sizeLabel}.png`);
      await page.screenshot({ path: analysisPath, animations: 'disabled' });
      screenshots.push(analysisPath);
    }
  } catch (error) {
    addFailure(failures, contextLabel, error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
}

async function captureMobileGame(browser, family, themeId, screenshots, failures, errors) {
  const contextLabel = `mobile/${themeId}/game`;
  const { context, page } = await prepareContext(browser, { width: 390, height: 844 }, errors);
  try {
    await openMenu(page, themeId);
    await page.locator('.menu-play').click();
    await page.locator('.game-screen[data-screen="game"][data-screen-state="active"]').waitFor({ state: 'visible', timeout: 140_000 });
    await page.locator('.loading-screen').waitFor({ state: 'hidden', timeout: 140_000 });
    await page.locator('.chess-board').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.character-window').waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const geometry = await page.evaluate(() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
      };
      const board = document.querySelector('.chess-board');
      const boardWrap = document.querySelector('.board-wrap');
      const gameStage = document.querySelector('.game-stage');
      const chat = document.querySelector('.coach-chat-row');
      const chatInput = document.querySelector('.coach-chat-input');
      const header = document.querySelector('.game-navigation-rail');
      const sidePanel = document.querySelector('.side-panel');
      const boardStyle = board ? getComputedStyle(board) : null;
      return {
        board: board ? rect(board) : null,
        boardWrap: boardWrap ? rect(boardWrap) : null,
        gameStage: gameStage ? rect(gameStage) : null,
        boardBorder: boardStyle ? Number.parseFloat(boardStyle.borderTopWidth) : null,
        chat: chat ? rect(chat) : null,
        chatInput: chatInput ? rect(chatInput) : null,
        header: header ? rect(header) : null,
        sidePanel: sidePanel ? rect(sidePanel) : null,
        developerControls: document.querySelectorAll('.debug-copy-button, .dev-menu-wrap, [aria-label="Developer options"]').length,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
      };
    });
    if (geometry.documentWidth > geometry.viewportWidth + 1) addFailure(failures, contextLabel, 'mobile game has horizontal overflow', geometry);
    if (!geometry.header || geometry.header.height < 48 || geometry.header.width < 380) addFailure(failures, contextLabel, 'mobile navigation header is missing or undersized', geometry.header);
    if (!geometry.board || Math.abs(geometry.board.width - geometry.board.height) > 2 || geometry.board.width < 280) {
      addFailure(failures, contextLabel, 'mobile board is missing, collapsed, or not square', geometry.board);
    }
    if (
      !geometry.boardWrap
      || !geometry.gameStage
      || geometry.board.left < geometry.boardWrap.left - 1
      || geometry.board.right > geometry.boardWrap.right + 1
      || geometry.boardWrap.left < geometry.gameStage.left - 1
      || geometry.boardWrap.right > geometry.gameStage.right + 1
      || geometry.boardWrap.top < geometry.gameStage.top - 1
      || geometry.boardWrap.bottom > geometry.gameStage.bottom + 1
    ) {
      addFailure(failures, contextLabel, 'mobile board is clipped outside its game card', geometry);
    }
    if (geometry.boardBorder === null || geometry.boardBorder > 2) addFailure(failures, contextLabel, 'mobile board still uses a heavy outline', geometry.boardBorder);
    if (!geometry.chat || !geometry.chatInput || geometry.chat.height < 48 || geometry.chatInput.width < 190) addFailure(failures, contextLabel, 'mobile conversation controls are congested', geometry);
    if (geometry.documentHeight <= geometry.viewportHeight + 100 || !geometry.sidePanel || geometry.sidePanel.bottom > geometry.documentHeight + 1) {
      addFailure(failures, contextLabel, 'mobile game does not expose its full stacked content through vertical scrolling', geometry);
    }
    if (geometry.developerControls !== 0) addFailure(failures, contextLabel, 'developer controls remain in the mobile game', geometry.developerControls);

    const viewportPath = join(outputDir, `game-mobile-viewport-${family}-${themeId}.png`);
    await page.screenshot({ path: viewportPath, animations: 'disabled' });
    screenshots.push(viewportPath);

    const path = join(outputDir, `game-mobile-${family}-${themeId}.png`);
    await page.screenshot({ path, animations: 'disabled', fullPage: true });
    screenshots.push(path);
  } catch (error) {
    addFailure(failures, contextLabel, error instanceof Error ? error.message : String(error));
  } finally {
    await context.close();
  }
}

const options = parseArguments(process.argv.slice(2));
baseUrl = options.baseUrl;
const selectedThemes = options.all ? themeIds : [options.theme];
const runLabel = options.all ? 'all' : options.theme;
const resultPath = join(outputDir, `result-${runLabel}.json`);
const startedAt = Date.now();
const failures = [];
const browserErrors = [];
const menuScreenshots = [];
const gameScreenshots = [];
const secondaryScreenshots = [];
const secondaryResults = [];
const themeResults = [];
let browser;

await mkdir(outputDir, { recursive: true });

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    const scopedErrors = [];
    const { context, page } = await prepareContext(browser, viewport, scopedErrors);
    try {
      for (const themeId of selectedThemes) {
        const contextLabel = `${viewport.name}/${themeId}`;
        try {
          await openMenu(page, themeId);
          const metrics = await validateMenu(page, themeId, viewport.name, failures);
          themeResults.push({
            theme: themeId,
            family: metrics.family,
            variant: metrics.variant,
            title: metrics.title,
            copy: metrics.copy,
            copySignature: metrics.copySignature,
            viewport: viewport.name,
            modeRowPattern: metrics.modeRowPattern,
            controlsChecked: metrics.controls.length,
          });

          const expectedFamily = familyByTheme.get(themeId);
          const isRepresentative = representativeByFamily.get(expectedFamily) === themeId;
          if (!options.all || isRepresentative) {
            await captureMenu(page, viewport, expectedFamily, themeId, menuScreenshots);
          }
        } catch (error) {
          addFailure(failures, contextLabel, error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      browserErrors.push(...scopedErrors.map((message) => `${viewport.name}: ${message}`));
      await context.close();
    }
  }

  if (options.all) {
    const resultsByTheme = new Map(themeResults.filter((item) => item.viewport === 'desktop').map((item) => [item.theme, item]));
    const titles = new Map();
    for (const [themeId, result] of resultsByTheme) {
      const normalizedTitle = result.title.toLocaleLowerCase();
      const existingTheme = titles.get(normalizedTitle);
      if (existingTheme) {
        addFailure(failures, 'desktop/titles', `premium title "${result.title}" is duplicated by ${existingTheme} and ${themeId}`);
      } else if (normalizedTitle) {
        titles.set(normalizedTitle, themeId);
      }
    }
    if (titles.size !== 40) {
      addFailure(failures, 'desktop/titles', `expected 40 unique premium h1/title values, found ${titles.size}`);
    }
    for (const [family, ids] of Object.entries(layoutFamilies)) {
      const familyResults = ids.map((id) => resultsByTheme.get(id)).filter(Boolean);
      const variants = new Set(familyResults.map((item) => item.variant).filter(Boolean));
      if (familyResults.length !== 4) {
        addFailure(failures, `desktop/${family}`, `expected four family members, inspected ${familyResults.length}`);
      }
      if (variants.size !== 4) {
        addFailure(failures, `desktop/${family}`, `expected four distinct layout variants, found ${variants.size}`, [...variants]);
      }
    }
  }

  if (options.secondary) {
    for (const themeId of selectedThemes) {
      secondaryResults.push(...await captureTargetedSecondaryScreens(
        browser,
        themeId,
        secondaryScreenshots,
        failures,
        browserErrors,
      ));
    }
  }

  if (options.games) {
    const gameTargets = options.all
      ? [...representativeByFamily.entries()].map(([family, theme]) => ({ family, theme }))
      : [{ family: familyByTheme.get(options.theme), theme: options.theme }];
    for (const { family, theme } of gameTargets) {
      await captureRepresentativeGame(browser, family, theme, gameScreenshots, failures, browserErrors);
      await captureMobileGame(browser, family, theme, gameScreenshots, failures, browserErrors);
    }
  }
} catch (error) {
  addFailure(failures, 'runner', error instanceof Error ? error.message : String(error));
} finally {
  if (browser) await browser.close();
}

for (const error of browserErrors) addFailure(failures, 'browser', error);

const familiesObserved = [...new Set(themeResults.map((item) => item.family).filter(Boolean))];
const variantsByFamily = Object.fromEntries(Object.keys(layoutFamilies).map((family) => [
  family,
  [...new Set(themeResults.filter((item) => item.family === family).map((item) => item.variant).filter(Boolean))],
]));
const summary = {
  passed: failures.length === 0,
  baseUrl,
  scope: options.all ? 'all' : 'theme',
  requestedTheme: options.theme,
  themesExpected: selectedThemes.length,
  themesInspected: new Set(themeResults.map((item) => item.theme)).size,
  viewportCasesExpected: selectedThemes.length * viewports.length,
  viewportCasesInspected: themeResults.length,
  viewports,
  familiesExpected: options.all ? Object.keys(layoutFamilies) : [familyByTheme.get(options.theme)],
  familiesObserved,
  variantsByFamily,
  titleCopySignatures: Object.fromEntries(
    themeResults
      .filter((item) => item.viewport === 'desktop')
      .map((item) => [item.theme, { title: item.title, copy: item.copy, signature: item.copySignature }]),
  ),
  gameCaptureRequested: options.games,
  secondaryScreensRequested: options.secondary,
  menuScreenshots,
  gameScreenshots,
  secondaryScreenshots,
  secondaryResults,
  failures,
  durationMs: Date.now() - startedAt,
  outputDir,
};

await writeFile(resultPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;

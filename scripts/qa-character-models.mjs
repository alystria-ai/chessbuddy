/**
 * Render every Chess Avatar V2 through the real React/R3F game portrait path.
 * External Convai/auth traffic is blocked; this validates local model, shader,
 * lighting, post-processing, mobile selection and game/canvas continuity.
 *
 * Usage:
 *   node scripts/qa-character-models.mjs
 *   QA_BASE_URL=http://127.0.0.1:4173/ node scripts/qa-character-models.mjs --headed
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

// `?headless` is reserved for the static-image layout sweep in CoachCard.
// Character QA must exercise the real Canvas/GLB path.
const requestedBaseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/';
const legacyMenuUrl = new URL(requestedBaseUrl);
legacyMenuUrl.searchParams.set('legacy-menu', '1');
const baseUrl = legacyMenuUrl.toString();
const outputDir = fileURLToPath(new URL('../.verify-out/character-v2/', import.meta.url));
const headed = process.argv.includes('--headed');
const RESOURCE_DISPOSE_GRACE_MS = 1_800;
const coaches = ['Arjun', 'Leila', 'Magnus', 'Sofia'];
const variants = [
  { id: 'desktop', viewport: { width: 1440, height: 900 }, expectedSuffix: '.glb' },
  { id: 'mobile', viewport: { width: 390, height: 844 }, expectedSuffix: '.mobile.glb' },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function maximumHairPoseDelta(reference, sample) {
  assert(reference.length === sample.length && reference.length > 0, 'hair pose samples are incompatible');
  let maximum = 0;
  let source = '';
  for (let boneIndex = 0; boneIndex < reference.length; boneIndex += 1) {
    assert(reference[boneIndex].name === sample[boneIndex].name, 'hair pose bone order changed');
    const left = reference[boneIndex].matrixWorld;
    const right = sample[boneIndex].matrixWorld;
    assert(left.length === right.length, 'hair pose matrices are incompatible');
    for (let component = 0; component < left.length; component += 1) {
      const delta = Math.abs(left[component] - right[component]);
      if (delta > maximum) {
        maximum = delta;
        source = reference[boneIndex].name;
      }
    }
  }
  return { maximum, source };
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: !headed });
const results = [];
let mobileSwitchResult = null;
let responsiveResizeResult = null;
let responsiveMobileResizeResult = null;
let adaptivePerformanceResult = null;

try {
  for (const variant of variants) {
    for (const coach of coaches) {
      const context = await browser.newContext({
        viewport: variant.viewport,
        deviceScaleFactor: variant.id === 'mobile' ? 2 : 1,
        hasTouch: variant.id === 'mobile',
        isMobile: variant.id === 'mobile',
      });
      const requestedModels = [];
      const errors = [];

      await context.route('**/*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.pathname === '/api/auth/me') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
        } else if (requestUrl.hostname === '127.0.0.1') {
          if (/\.(?:mobile\.)?glb$/i.test(requestUrl.pathname)) requestedModels.push(requestUrl.pathname);
          await route.continue();
        } else {
          await route.abort();
        }
      });

      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (!text.includes('net::ERR_FAILED')) errors.push(`console: ${text}`);
      });

      try {
        await page.addInitScript(() => {
          localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
          localStorage.removeItem('classic-chess.convaiApiKey');
          window.__blinkOverride = 0;
        });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.locator('.menu-screen').waitFor({ timeout: 15_000 });
        await page.locator('.coach-picker button').filter({ hasText: coach }).click();
        await page.locator('.menu-play').click();
        await page.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
        const readyWindow = page.locator('.character-window.is-ready');
        await readyWindow.waitFor({ state: 'visible', timeout: 70_000 });
        await page.waitForFunction(
          () => document.querySelector('.character-window.is-ready')
            ?.getAttribute('data-portrait-performance-monitor') === 'active',
          undefined,
          { timeout: 30_000 },
        );
        // Let all three 500ms batches complete so this proves the steady-state
        // monitor, not only the pre-monitor warm-up render.
        await page.waitForTimeout(1_800);

        const metrics = await page.evaluate((coachId) => {
          const windowElement = document.querySelector('.character-window.is-ready');
          const canvas = windowElement?.querySelector('canvas');
          const canvasSurface = canvas?.parentElement?.parentElement;
          const fallback = windowElement?.querySelector('.character-fallback-img');
          const caption = document.querySelector('.character-caption strong')?.textContent?.trim() ?? '';
          const rect = canvas?.getBoundingClientRect();
          const diagnostics = window.__chessCharacterV2Diagnostics?.[coachId] ?? null;
          return {
            caption,
            fallback: Boolean(fallback),
            canvas: canvas instanceof HTMLCanvasElement,
            cssWidth: rect?.width ?? 0,
            cssHeight: rect?.height ?? 0,
            bufferWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
            bufferHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
            portraitAa: canvas instanceof HTMLCanvasElement ? canvas.dataset.portraitAa ?? '' : '',
            portraitMsaaSamples: canvas instanceof HTMLCanvasElement
              ? Number(canvas.dataset.portraitMsaaSamples ?? 0)
              : 0,
            portraitMsaaSupportedSamples: canvas instanceof HTMLCanvasElement
              ? Number(canvas.dataset.portraitMsaaSupportedSamples ?? 0)
              : 0,
            portraitFramebufferType: canvas instanceof HTMLCanvasElement
              ? canvas.dataset.portraitFramebufferType ?? ''
              : '',
            portraitBalancedRendering: canvas instanceof HTMLCanvasElement
              ? canvas.dataset.portraitBalancedRendering === 'true'
              : false,
            headYaw: canvas instanceof HTMLCanvasElement
              ? canvas.dataset[`${coachId}HeadYaw`] ?? ''
              : '',
            headPitch: canvas instanceof HTMLCanvasElement
              ? canvas.dataset[`${coachId}HeadPitch`] ?? ''
              : '',
            modelYaw: canvas instanceof HTMLCanvasElement
              ? canvas.dataset[`${coachId}ModelYaw`] ?? ''
              : '',
            portraitPerformanceMonitor: windowElement?.getAttribute(
              'data-portrait-performance-monitor',
            ) ?? '',
            portraitGradeFilter: canvasSurface instanceof HTMLElement
              ? canvasSurface.style.filter
              : '',
            contextLost: canvas instanceof HTMLCanvasElement
              ? Boolean(canvas.getContext('webgl2')?.isContextLost())
              : true,
            diagnostics,
          };
        }, coach.toLowerCase());

        const expectedStem = coach.toLowerCase();
        const expectedModel = variant.id === 'mobile'
          ? `/${expectedStem}.mobile.glb`
          : `/${expectedStem}.glb`;
        assert(metrics.caption === coach, `${coach}/${variant.id}: wrong live coach caption ${metrics.caption}`);
        assert(metrics.canvas, `${coach}/${variant.id}: portrait canvas missing`);
        assert(!metrics.fallback, `${coach}/${variant.id}: static image fallback was used`);
        assert(metrics.cssWidth > 0 && metrics.cssHeight > 0, `${coach}/${variant.id}: zero CSS canvas size`);
        assert(metrics.bufferWidth > 0 && metrics.bufferHeight > 0, `${coach}/${variant.id}: zero backing buffer`);
        assert(
          metrics.portraitMsaaSamples >= 2 && /msaa-[24]\+smaa/.test(metrics.portraitAa),
          `${coach}/${variant.id}: moving portrait lacks multisampled SMAA (${metrics.portraitAa})`,
        );
        assert(
          metrics.portraitMsaaSupportedSamples >= metrics.portraitMsaaSamples,
          `${coach}/${variant.id}: requested MSAA exceeds target-format support`,
        );
        assert(
          metrics.portraitFramebufferType === 'half-float'
            || metrics.portraitFramebufferType === 'unsigned-byte',
          `${coach}/${variant.id}: composer framebuffer format is unknown`,
        );
        const effectiveDpr = Math.min(
          metrics.bufferWidth / metrics.cssWidth,
          metrics.bufferHeight / metrics.cssHeight,
        );
        const expectedQualityDpr = variant.id === 'desktop' ? 1.24 : 0.99;
        assert(
          effectiveDpr >= expectedQualityDpr,
          `${coach}/${variant.id}: portrait quality DPR is too low (${effectiveDpr.toFixed(3)})`,
        );
        metrics.effectiveDpr = effectiveDpr;
        assert(
          metrics.portraitGradeFilter === 'brightness(98%) contrast(100%) saturate(88%)',
          `${coach}/${variant.id}: shadow-preserving grade is missing (${metrics.portraitGradeFilter})`,
        );
        assert(
          metrics.portraitPerformanceMonitor === 'active',
          `${coach}/${variant.id}: performance monitor did not pass its compile warm-up`,
        );
        assert(!metrics.contextLost, `${coach}/${variant.id}: WebGL context is lost`);
        assert(requestedModels.includes(expectedModel), `${coach}/${variant.id}: expected request ${expectedModel}; got ${requestedModels.join(', ')}`);
        const diagnostics = metrics.diagnostics;
        assert(diagnostics, `${coach}/${variant.id}: live V2 material diagnostics missing`);
        assert(diagnostics.matchedMorphChannels === 251, `${coach}/${variant.id}: live morph coverage is not 251/251`);
        assert(diagnostics.morphCoverage >= 0.95, `${coach}/${variant.id}: live morph coverage is below 95%`);
        assert(
          diagnostics.morphTargetSlotsAfter < diagnostics.morphTargetSlotsBefore,
          `${coach}/${variant.id}: zero-delta morph slots were not removed before activation`,
        );
        assert(
          diagnostics.sparseMorphMaterialCount > 0,
          `${coach}/${variant.id}: sparse active-morph shader was not applied`,
        );
        assert(diagnostics.pbrMaterialCount > 0, `${coach}/${variant.id}: no live PBR materials found`);
        assert(
          diagnostics.environmentBlurMaterialCount === diagnostics.pbrMaterialCount,
          `${coach}/${variant.id}: IBL blur missing on ${diagnostics.pbrMaterialCount - diagnostics.environmentBlurMaterialCount} material(s)`,
        );
        assert(
          diagnostics.environmentIntensities.length === diagnostics.pbrMaterialCount
            && diagnostics.environmentIntensities.every((value) => Math.abs(value - 0.25) < 1e-8),
          `${coach}/${variant.id}: live envMapIntensity is not exactly 0.25`,
        );
        assert(diagnostics.skinMaterialCount > 0, `${coach}/${variant.id}: Penner skin material was not matched`);
        assert(
          diagnostics.skinLightingPath === 'three-r160-direct-light-v2',
          `${coach}/${variant.id}: skin LUT is not installed in the direct-light path`,
        );
        const expectedGaze = { leftL: 0, leftR: 0, rightL: 0, rightR: 0, upL: 0, upR: 0, downL: 0, downR: 0 };
        assert(
          JSON.stringify(diagnostics.gazeBaseline) === JSON.stringify(expectedGaze),
          `${coach}/${variant.id}: wrong camera-facing gaze baseline ${JSON.stringify(diagnostics.gazeBaseline)}`,
        );
        if (coach === 'Sofia') {
          assert(
            diagnostics.hairMotionSource === 'authored-clip',
            `${coach}/${variant.id}: expected authored hair motion without a second runtime spring; got ${diagnostics.hairMotionSource}`,
          );
        }
        if (coach === 'Leila') {
          assert(
            diagnostics.hairMotionSource === 'static',
            `${coach}/${variant.id}: expected stable hair rig pose; got ${diagnostics.hairMotionSource}`,
          );
        }
        const expectedBodyPoseSource = coach === 'Arjun' || coach === 'Magnus'
          ? 'frontal-bind'
          : 'authored-frame-0';
        assert(
          diagnostics.bodyPoseSource === expectedBodyPoseSource,
          `${coach}/${variant.id}: expected body pose ${expectedBodyPoseSource}; got ${diagnostics.bodyPoseSource}`,
        );
        const expectedPresentationZoom = coach === 'Magnus' ? 1.3 : 1.5;
        assert(
          diagnostics.presentationZoom === expectedPresentationZoom,
          `${coach}/${variant.id}: expected ${expectedPresentationZoom.toFixed(2)}x character-window zoom; got ${diagnostics.presentationZoom}`,
        );
        if (coach === 'Magnus') {
          assert(
            metrics.headYaw === '1'
              && metrics.headPitch === '2'
              && metrics.modelYaw === '7',
            `Magnus/${variant.id}: requested live pose was not applied`,
          );
        }
        const expectedPresentationYaw = coach === 'Sofia' || coach === 'Leila' ? 3 : 0;
        assert(
          diagnostics.presentationModelYawDegrees === expectedPresentationYaw,
          `${coach}/${variant.id}: expected presentation yaw ${expectedPresentationYaw}; got ${diagnostics.presentationModelYawDegrees}`,
        );
        assert(
          diagnostics.dentalOcclusion?.upperChannel === 'CTRL_expressions_teethUpU'
            && diagnostics.dentalOcclusion?.upperMinimum === 0.12
            && diagnostics.dentalOcclusion?.lowerChannel === 'CTRL_expressions_teethDownD'
            && diagnostics.dentalOcclusion?.lowerMinimum === 0.3,
          `${coach}/${variant.id}: dental-row occlusion calibration is missing or stale`,
        );
        assert(
          diagnostics.lipsyncFadeOutSeconds === 0.12,
          `${coach}/${variant.id}: expected 0.12s app lip-sync release; got ${diagnostics.lipsyncFadeOutSeconds}`,
        );

        // Theme changes are allowed while a game is live, but may not remount
        // the character or reset board interaction state.
        await page.locator('.square[aria-label^="e2 white p"]').click();
        await page.waitForFunction(() => Boolean(document.querySelector('.square.selected')));
        await page.evaluate(() => {
          window.__characterV2QaCanvas = document.querySelector('.character-window canvas');
          window.__characterV2QaBoard = document.querySelector('.chess-board');
          window.__characterV2QaSelected = document.querySelector('.square.selected')?.getAttribute('aria-label');
          document.documentElement.dataset.theme = 'classic';
        });
        await page.waitForTimeout(100);
        const continuityAfter = await page.evaluate(() => ({
          sameCanvas: window.__characterV2QaCanvas === document.querySelector('.character-window canvas'),
          sameBoard: window.__characterV2QaBoard === document.querySelector('.chess-board'),
          selected: document.querySelector('.square.selected')?.getAttribute('aria-label') ?? '',
          expectedSelected: window.__characterV2QaSelected ?? '',
        }));
        assert(continuityAfter.sameCanvas, `${coach}/${variant.id}: portrait canvas remounted during style update`);
        assert(continuityAfter.sameBoard, `${coach}/${variant.id}: chess board remounted during style update`);
        assert(
          continuityAfter.selected === continuityAfter.expectedSelected,
          `${coach}/${variant.id}: selected board square reset during style update`,
        );

        let hairTemporalMaxTransformDelta = null;
        if (coach === 'Leila') {
          // Drive settle polling from Node/Playwright. Background/headless
          // Chromium may throttle in-page timers to several seconds, which
          // previously turned a stable real-GPU pose into a false timeout.
          const settleDeadline = Date.now() + 8_000;
          let previousSettleSample = null;
          let stableIntervals = 0;
          while (Date.now() < settleDeadline && stableIntervals < 2) {
            const currentSettleSample = await page.evaluate((coachId) => {
              const diagnostics = window.__chessCharacterV2Diagnostics?.[coachId];
              return typeof diagnostics?.sampleHairPose === 'function'
                ? diagnostics.sampleHairPose()
                : [];
            }, coach.toLowerCase());
            if (previousSettleSample?.length && currentSettleSample.length) {
              const settleDelta = maximumHairPoseDelta(previousSettleSample, currentSettleSample);
              stableIntervals = settleDelta.maximum < 1e-5 ? stableIntervals + 1 : 0;
            }
            previousSettleSample = currentSettleSample;
            if (stableIntervals < 2) await page.waitForTimeout(150);
          }
          const settled = stableIntervals >= 2;
          assert(settled, `${coach}/${variant.id}: head/hair anchor never reached a stable pose`);
          const temporalSamples = await page.evaluate(async (coachId) => {
            const samples = [];
            for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
              const diagnostics = window.__chessCharacterV2Diagnostics?.[coachId];
              if (typeof diagnostics?.sampleHairPose !== 'function') return [];
              samples.push(diagnostics.sampleHairPose());
              await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
            return samples;
          }, coach.toLowerCase());
          for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
            await readyWindow.screenshot({
              path: join(outputDir, `leila.${variant.id}.temporal-${sampleIndex}.png`),
            });
            await page.waitForTimeout(120);
          }
          assert(temporalSamples.length === 5, `${coach}/${variant.id}: live hair-pose sampler is unavailable`);
          assert(temporalSamples[0].length > 0, `${coach}/${variant.id}: no hair pose objects were sampled`);
          const temporalDeltas = temporalSamples.slice(1).map((sample) => (
            maximumHairPoseDelta(temporalSamples[0], sample)
          ));
          const worstTemporalDelta = temporalDeltas.reduce((worst, candidate) => (
            candidate.maximum > worst.maximum ? candidate : worst
          ));
          hairTemporalMaxTransformDelta = worstTemporalDelta.maximum;
          assert(
            hairTemporalMaxTransformDelta < 1e-5,
            `${coach}/${variant.id}: hair world transforms still jitter across frames (max delta ${hairTemporalMaxTransformDelta} on ${worstTemporalDelta.source})`,
          );
        }

        const screenshotPath = join(outputDir, `${expectedStem}.${variant.id}.png`);
        await readyWindow.screenshot({ path: screenshotPath, animations: 'disabled' });
        const imageStats = await sharp(screenshotPath).stats();
        const rgbDeviation = imageStats.channels.slice(0, 3)
          .reduce((sum, channel) => sum + channel.stdev, 0) / 3;
        assert(rgbDeviation >= 8, `${coach}/${variant.id}: portrait pixels appear blank/flat (RGB stdev ${rgbDeviation.toFixed(2)})`);
        assert(errors.length === 0, `${coach}/${variant.id}: browser errors:\n${errors.join('\n')}`);

        results.push({
          coach,
          variant: variant.id,
          expectedModel,
          requestedModels,
          metrics,
          rgbDeviation: Number(rgbDeviation.toFixed(2)),
          hairTemporalMaxTransformDelta: hairTemporalMaxTransformDelta === null
            ? null
            : hairTemporalMaxTransformDelta,
          screenshotPath,
          errors,
        });
        console.log(`PASS ${coach}/${variant.id}: ${expectedModel}, RGB stdev ${rgbDeviation.toFixed(2)} -> ${screenshotPath}`);
      } finally {
        await page.close();
        await context.close();
      }
    }
  }

  // Exercise the real React state transitions deterministically. This catches
  // a former DPR-2 -> DPR-1 monitor/display move that left a 0.5 adaptive scale
  // in place and silently rendered the moving portrait at half native density.
  const performanceContext = await browser.newContext({
    viewport: variants[0].viewport,
    deviceScaleFactor: 2,
  });
  const performanceErrors = [];
  await performanceContext.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (requestUrl.hostname === '127.0.0.1') {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const performancePage = await performanceContext.newPage();
  performancePage.on('pageerror', (error) => performanceErrors.push(`pageerror: ${error.message}`));
  performancePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.includes('net::ERR_FAILED')) performanceErrors.push(`console: ${text}`);
  });
  try {
    await performancePage.addInitScript(() => {
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      localStorage.removeItem('classic-chess.convaiApiKey');
      window.__blinkOverride = 0;
    });
    await performancePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await performancePage.locator('.menu-screen').waitFor({ timeout: 15_000 });
    await performancePage.locator('.coach-picker button').filter({ hasText: 'Arjun' }).click();
    await performancePage.locator('.menu-play').click();
    await performancePage.locator('.character-window.is-ready').waitFor({
      state: 'visible',
      timeout: 70_000,
    });
    await performancePage.waitForFunction(
      () => Boolean(window.__chessPortraitPerformanceQa?.arjun),
      undefined,
      { timeout: 30_000 },
    );
    const sample = () => performancePage.evaluate(() => {
      const canvas = document.querySelector('.character-window.is-ready canvas');
      const rect = canvas?.getBoundingClientRect();
      return {
        state: window.__chessPortraitPerformanceQa?.arjun?.sample() ?? null,
        effectiveDpr: canvas instanceof HTMLCanvasElement && rect?.width
          ? canvas.width / rect.width
          : 0,
        aa: canvas instanceof HTMLCanvasElement ? canvas.dataset.portraitAa ?? '' : '',
        ao: canvas instanceof HTMLCanvasElement ? canvas.dataset.portraitAoQuality ?? '' : '',
        shadow: canvas instanceof HTMLCanvasElement ? canvas.dataset.portraitShadowQuality ?? '' : '',
      };
    });
    const initial = await sample();
    assert(initial.effectiveDpr >= 1.99, 'adaptive QA: initial DPR-2 portrait is not full density');

    await performancePage.evaluate(() => window.__chessPortraitPerformanceQa.arjun.decline());
    await performancePage.waitForFunction(() => {
      const state = window.__chessPortraitPerformanceQa?.arjun?.sample();
      return state?.balancedRendering === true
        && Math.abs(state.adaptiveRenderScale - 1) < 1e-8;
    });
    const balanced = await sample();
    assert(
      balanced.aa === initial.aa,
      `adaptive QA: first-stage fallback rebuilt AA (${initial.aa} -> ${balanced.aa})`,
    );
    assert(balanced.ao === 'off-adaptive', `adaptive QA: AO was not disabled first (${balanced.ao})`);
    assert(balanced.shadow === '1', `adaptive QA: shadow did not fall back to 1024 (${balanced.shadow})`);
    assert(
      balanced.effectiveDpr >= 1.99,
      `adaptive QA: first-stage fallback reduced DPR (${balanced.effectiveDpr.toFixed(3)})`,
    );

    for (let decline = 0; decline < 4; decline += 1) {
      await performancePage.evaluate(() => window.__chessPortraitPerformanceQa.arjun.decline());
      await performancePage.waitForTimeout(100);
    }
    await performancePage.waitForFunction(() => {
      const state = window.__chessPortraitPerformanceQa?.arjun?.sample();
      return state?.balancedRendering === true
        && Math.abs(state.adaptiveRenderScale - 0.5) < 1e-8;
    });
    const degraded = await sample();
    assert(degraded.aa === initial.aa, 'adaptive QA: native-floor transition rebuilt AA');
    assert(
      degraded.effectiveDpr >= 0.99 && degraded.effectiveDpr <= 1.01,
      `adaptive QA: DPR-2 scale floor is not native (${degraded.effectiveDpr.toFixed(3)})`,
    );

    await performancePage.evaluate(() => {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: () => 1,
      });
      window.dispatchEvent(new Event('resize'));
    });
    await performancePage.waitForFunction(() => {
      const state = window.__chessPortraitPerformanceQa?.arjun?.sample();
      const canvas = document.querySelector('.character-window.is-ready canvas');
      const rect = canvas?.getBoundingClientRect();
      const ratio = canvas instanceof HTMLCanvasElement && rect?.width
        ? canvas.width / rect.width
        : 0;
      return Math.abs((state?.basePortraitDpr ?? 0) - 1.725) < 1e-8
        && Math.abs((state?.minimumAdaptiveRenderScale ?? 0) - (1 / 1.725)) < 1e-8
        && Math.abs((state?.adaptiveRenderScale ?? 0) - (1 / 1.725)) < 1e-8
        && ratio >= 0.99;
    });
    const restored = await sample();
    assert(
      restored.effectiveDpr >= 0.99,
      `adaptive QA: display move restored only ${restored.effectiveDpr.toFixed(3)} DPR`,
    );
    assert(performanceErrors.length === 0, `adaptive QA browser errors:\n${performanceErrors.join('\n')}`);
    adaptivePerformanceResult = { passed: true, initial, degraded, restored, errors: performanceErrors };
    console.log('Character V2 adaptive DPR/MSAA state QA passed');
  } finally {
    await performancePage.close();
    await performanceContext.close();
  }

  // CoachCard deliberately freezes the desktop/mobile asset choice for the
  // lifetime of its Canvas. Cross the breakpoint in both directions and force
  // React updates while narrow: the mounted desktop GLTF must never enter the
  // mobile-only disposal registry, swap URLs, or lose its active GPU objects.
  const resizeContext = await browser.newContext({
    viewport: variants[0].viewport,
    deviceScaleFactor: 1,
  });
  const resizeErrors = [];
  const resizeRequestedModels = [];
  await resizeContext.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (requestUrl.hostname === '127.0.0.1') {
      if (/\.(?:mobile\.)?glb$/i.test(requestUrl.pathname)) {
        resizeRequestedModels.push(requestUrl.pathname);
      }
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const resizePage = await resizeContext.newPage();
  resizePage.on('pageerror', (error) => resizeErrors.push(`pageerror: ${error.message}`));
  resizePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.includes('net::ERR_FAILED')) resizeErrors.push(`console: ${text}`);
  });
  try {
    await resizePage.addInitScript(() => {
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      localStorage.removeItem('classic-chess.convaiApiKey');
      window.__blinkOverride = 0;
    });
    await resizePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await resizePage.locator('.menu-screen').waitFor({ timeout: 15_000 });
    await resizePage.locator('.coach-picker button').filter({ hasText: 'Arjun' }).click();
    await resizePage.locator('.menu-play').click();
    await resizePage.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
    await resizePage.locator('.character-window.is-ready').waitFor({ state: 'visible', timeout: 70_000 });
    await resizePage.evaluate(() => {
      window.__characterV2ResizeCanvas = document.querySelector('.character-window.is-ready canvas');
    });

    await resizePage.setViewportSize(variants[1].viewport);
    await resizePage.locator('.square[aria-label^="e2 white p"]').click();
    await resizePage.waitForTimeout(250);
    const narrow = await resizePage.evaluate(() => ({
      sameCanvas: window.__characterV2ResizeCanvas === document.querySelector('.character-window canvas'),
      diagnostics: window.__chessCharacterV2Diagnostics?.arjun ?? null,
      lifecycle: window.__chessCharacterResourceLifecycle ?? [],
    }));
    assert(narrow.sameCanvas, 'desktop resize QA: Canvas remounted while crossing below 700px');
    assert(narrow.diagnostics?.modelUrl === '/arjun.glb', 'desktop resize QA: live model URL changed below 700px');
    assert(narrow.diagnostics?.mobile === false, 'desktop resize QA: live diagnostics changed to mobile below 700px');
    assert(
      !narrow.lifecycle.some((entry) => entry.key.includes('/arjun.glb')),
      'desktop resize QA: active desktop GLTF entered the mobile disposal registry',
    );

    await resizePage.setViewportSize(variants[0].viewport);
    await resizePage.locator('.square[aria-label^="e2 white p"]').click();
    await resizePage.waitForTimeout(RESOURCE_DISPOSE_GRACE_MS + 350);
    const restored = await resizePage.evaluate(() => {
      const canvas = document.querySelector('.character-window.is-ready canvas');
      const diagnostics = window.__chessCharacterV2Diagnostics?.arjun ?? null;
      return {
        sameCanvas: window.__characterV2ResizeCanvas === canvas,
        contextLost: !(canvas instanceof HTMLCanvasElement)
          || Boolean(canvas.getContext('webgl2')?.isContextLost()),
        diagnostics,
        lifecycle: window.__chessCharacterResourceLifecycle ?? [],
      };
    });
    assert(restored.sameCanvas, 'desktop resize QA: Canvas remounted after restoring desktop width');
    assert(!restored.contextLost, 'desktop resize QA: active WebGL context was lost');
    assert(restored.diagnostics?.matchedMorphChannels === 251, 'desktop resize QA: live model diagnostics disappeared');
    assert(
      !restored.lifecycle.some((entry) => entry.key.includes('/arjun.glb')),
      'desktop resize QA: active desktop resources were scheduled for disposal',
    );
    assert(restored.diagnostics?.modelUrl === '/arjun.glb', 'desktop resize QA: restored model URL is not desktop');
    assert(restored.diagnostics?.mobile === false, 'desktop resize QA: restored diagnostics changed to mobile');
    assert(resizeRequestedModels.includes('/arjun.glb'), 'desktop resize QA: desktop model was never requested');
    assert(
      !resizeRequestedModels.includes('/arjun.mobile.glb'),
      'desktop resize QA: frozen Canvas swapped to the mobile model after resize',
    );
    const resizeScreenshotPath = join(outputDir, 'arjun.desktop-breakpoint-restored.png');
    await resizePage.locator('.character-window.is-ready').screenshot({
      path: resizeScreenshotPath,
      animations: 'disabled',
    });
    const resizeImageStats = await sharp(resizeScreenshotPath).stats();
    const resizeRgbDeviation = resizeImageStats.channels.slice(0, 3)
      .reduce((sum, channel) => sum + channel.stdev, 0) / 3;
    assert(
      resizeRgbDeviation >= 8,
      `desktop resize QA: restored portrait is blank/flat (RGB stdev ${resizeRgbDeviation.toFixed(2)})`,
    );
    assert(resizeErrors.length === 0, `desktop resize browser errors:\n${resizeErrors.join('\n')}`);
    responsiveResizeResult = {
      passed: true,
      requestedModels: resizeRequestedModels,
      narrow,
      restored,
      rgbDeviation: Number(resizeRgbDeviation.toFixed(2)),
      screenshotPath: resizeScreenshotPath,
      errors: resizeErrors,
    };
    console.log('Character V2 desktop/mobile breakpoint stability QA passed');
  } finally {
    await resizePage.close();
    await resizeContext.close();
  }

  // Symmetric origin: a fine-pointer viewport starts narrow enough to select
  // the mobile GLB, then grows beyond the breakpoint. Mobile emulation is
  // intentionally not used because a coarse pointer would remain classified
  // mobile at every width and fail to exercise the former cleanup transition.
  const mobileResizeContext = await browser.newContext({
    viewport: variants[1].viewport,
    deviceScaleFactor: 1,
  });
  const mobileResizeErrors = [];
  const mobileResizeRequestedModels = [];
  await mobileResizeContext.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (requestUrl.hostname === '127.0.0.1') {
      if (/\.(?:mobile\.)?glb$/i.test(requestUrl.pathname)) {
        mobileResizeRequestedModels.push(requestUrl.pathname);
      }
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const mobileResizePage = await mobileResizeContext.newPage();
  mobileResizePage.on('pageerror', (error) => mobileResizeErrors.push(`pageerror: ${error.message}`));
  mobileResizePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.includes('net::ERR_FAILED')) mobileResizeErrors.push(`console: ${text}`);
  });
  try {
    await mobileResizePage.addInitScript(() => {
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      localStorage.removeItem('classic-chess.convaiApiKey');
      window.__blinkOverride = 0;
    });
    await mobileResizePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await mobileResizePage.locator('.menu-screen').waitFor({ timeout: 15_000 });
    await mobileResizePage.locator('.coach-picker button').filter({ hasText: 'Arjun' }).click();
    await mobileResizePage.locator('.menu-play').click();
    await mobileResizePage.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
    await mobileResizePage.locator('.character-window.is-ready').waitFor({ state: 'visible', timeout: 70_000 });
    await mobileResizePage.evaluate(() => {
      window.__characterV2MobileResizeCanvas = document.querySelector('.character-window.is-ready canvas');
    });

    await mobileResizePage.setViewportSize(variants[0].viewport);
    await mobileResizePage.locator('.square[aria-label^="e2 white p"]').click();
    await mobileResizePage.waitForTimeout(RESOURCE_DISPOSE_GRACE_MS + 350);
    const wide = await mobileResizePage.evaluate(() => {
      const canvas = document.querySelector('.character-window.is-ready canvas');
      return {
        sameCanvas: window.__characterV2MobileResizeCanvas === canvas,
        contextLost: !(canvas instanceof HTMLCanvasElement)
          || Boolean(canvas.getContext('webgl2')?.isContextLost()),
        diagnostics: window.__chessCharacterV2Diagnostics?.arjun ?? null,
        lifecycle: window.__chessCharacterResourceLifecycle ?? [],
      };
    });
    const liveMobileEntry = wide.lifecycle.find((entry) => entry.key.includes('/arjun.mobile.glb'));
    assert(wide.sameCanvas, 'mobile resize QA: Canvas remounted above 700px');
    assert(!wide.contextLost, 'mobile resize QA: active WebGL context was lost above 700px');
    assert(wide.diagnostics?.modelUrl === '/arjun.mobile.glb', 'mobile resize QA: model URL changed above 700px');
    assert(wide.diagnostics?.mobile === true, 'mobile resize QA: diagnostics changed to desktop above 700px');
    assert(wide.diagnostics?.matchedMorphChannels === 251, 'mobile resize QA: live model diagnostics disappeared');
    assert(
      liveMobileEntry?.retainCount === 1 && liveMobileEntry?.disposePending === false,
      'mobile resize QA: active mobile GLTF was released or scheduled for disposal',
    );
    assert(
      !mobileResizeRequestedModels.includes('/arjun.glb'),
      'mobile resize QA: frozen Canvas swapped to the desktop model after resize',
    );
    const mobileResizeScreenshotPath = join(outputDir, 'arjun.mobile-breakpoint-wide.png');
    await mobileResizePage.locator('.character-window.is-ready').screenshot({
      path: mobileResizeScreenshotPath,
      animations: 'disabled',
    });
    const mobileResizeImageStats = await sharp(mobileResizeScreenshotPath).stats();
    const mobileResizeRgbDeviation = mobileResizeImageStats.channels.slice(0, 3)
      .reduce((sum, channel) => sum + channel.stdev, 0) / 3;
    assert(
      mobileResizeRgbDeviation >= 8,
      `mobile resize QA: post-grace portrait is blank/flat (RGB stdev ${mobileResizeRgbDeviation.toFixed(2)})`,
    );

    await mobileResizePage.setViewportSize(variants[1].viewport);
    await mobileResizePage.locator('.square[aria-label^="e2 white p"]').click();
    await mobileResizePage.waitForTimeout(250);
    const restored = await mobileResizePage.evaluate(() => {
      const canvas = document.querySelector('.character-window.is-ready canvas');
      return {
        sameCanvas: window.__characterV2MobileResizeCanvas === canvas,
        contextLost: !(canvas instanceof HTMLCanvasElement)
          || Boolean(canvas.getContext('webgl2')?.isContextLost()),
        diagnostics: window.__chessCharacterV2Diagnostics?.arjun ?? null,
        lifecycle: window.__chessCharacterResourceLifecycle ?? [],
      };
    });
    const restoredMobileEntry = restored.lifecycle.find((entry) => entry.key.includes('/arjun.mobile.glb'));
    assert(restored.sameCanvas, 'mobile resize QA: Canvas remounted after restoring narrow width');
    assert(!restored.contextLost, 'mobile resize QA: active WebGL context was lost after restoring narrow width');
    assert(restored.diagnostics?.modelUrl === '/arjun.mobile.glb', 'mobile resize QA: restored model URL is not mobile');
    assert(restored.diagnostics?.mobile === true, 'mobile resize QA: restored diagnostics changed to desktop');
    assert(
      restoredMobileEntry?.retainCount === 1 && restoredMobileEntry?.disposePending === false,
      'mobile resize QA: restored mobile GLTF is not retained exactly once',
    );
    assert(mobileResizeErrors.length === 0, `mobile resize browser errors:\n${mobileResizeErrors.join('\n')}`);
    responsiveMobileResizeResult = {
      passed: true,
      requestedModels: mobileResizeRequestedModels,
      wide,
      restored,
      rgbDeviation: Number(mobileResizeRgbDeviation.toFixed(2)),
      screenshotPath: mobileResizeScreenshotPath,
      errors: mobileResizeErrors,
    };
    console.log('Character V2 mobile/desktop breakpoint stability QA passed');
  } finally {
    await mobileResizePage.close();
    await mobileResizeContext.close();
  }

  // Reuse one mobile browser context while mounting and releasing all four
  // coaches. This catches the cache-only cleanup bug that isolated renders
  // cannot see, and records live renderer memory/context state at each stop.
  const switchContext = await browser.newContext({
    viewport: variants[1].viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const switchErrors = [];
  const switchRequestedModels = [];
  await switchContext.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === '/api/auth/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    } else if (requestUrl.hostname === '127.0.0.1') {
      if (/\.(?:mobile\.)?glb$/i.test(requestUrl.pathname)) {
        switchRequestedModels.push(requestUrl.pathname);
      }
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const switchPage = await switchContext.newPage();
  switchPage.on('pageerror', (error) => switchErrors.push(`pageerror: ${error.message}`));
  switchPage.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.includes('net::ERR_FAILED')) switchErrors.push(`console: ${text}`);
  });
  const switchSamples = [];
  try {
    await switchPage.addInitScript(() => {
      localStorage.setItem('classic-chess.theme.v1', 'japanese-minimal');
      localStorage.removeItem('classic-chess.convaiApiKey');
      window.__blinkOverride = 0;
    });
    await switchPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await switchPage.locator('.menu-screen').waitFor({ timeout: 15_000 });

    for (const coach of coaches) {
      const coachId = coach.toLowerCase();
      await switchPage.locator('.coach-picker button').filter({ hasText: coach }).click();
      await switchPage.locator('.menu-play').click();
      await switchPage.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
      await switchPage.locator('.character-window.is-ready').waitFor({ state: 'visible', timeout: 70_000 });
      await switchPage.waitForTimeout(300);
      const active = await switchPage.evaluate((id) => {
        const canvas = document.querySelector('.character-window.is-ready canvas');
        const diagnostics = window.__chessCharacterV2Diagnostics?.[id] ?? null;
        return {
          contextLost: !(canvas instanceof HTMLCanvasElement)
            || Boolean(canvas.getContext('webgl2')?.isContextLost()),
          rendererMemory: diagnostics?.rendererMemory ?? null,
          lifecycle: window.__chessCharacterResourceLifecycle ?? [],
        };
      }, coachId);
      assert(!active.contextLost, `${coach}/mobile-switch: active WebGL context lost`);
      assert(active.rendererMemory, `${coach}/mobile-switch: renderer memory diagnostics missing`);
      assert(
        Number.isFinite(active.rendererMemory.geometries) && Number.isFinite(active.rendererMemory.textures),
        `${coach}/mobile-switch: invalid renderer memory diagnostics`,
      );
      assert(
        active.lifecycle.some((entry) => entry.key.includes(`/${coachId}.mobile.glb`) && entry.retainCount === 1),
        `${coach}/mobile-switch: active asset is not retained exactly once`,
      );

      await switchPage.locator('.topbar button').filter({ hasText: 'Menu' }).click();
      await switchPage.getByRole('dialog').getByRole('button', { name: 'Leave Game' }).click();
      await switchPage.locator('.menu-screen').waitFor({ state: 'visible', timeout: 15_000 });
      await switchPage.waitForFunction(
        (id) => (
          !window.__chessCharacterV2Diagnostics?.[id]
          && !(window.__chessCharacterResourceLifecycle ?? [])
            .some((entry) => entry.key.includes(`/${id}.mobile.glb`))
        ),
        coachId,
        { timeout: 15_000 },
      );
      const released = await switchPage.evaluate((id) => ({
        diagnosticsGone: !window.__chessCharacterV2Diagnostics?.[id],
        lifecycle: window.__chessCharacterResourceLifecycle ?? [],
      }), coachId);
      assert(released.diagnosticsGone, `${coach}/mobile-switch: runtime diagnostics survived unmount`);
      assert(
        !released.lifecycle.some((entry) => entry.key.includes(`/${coachId}.mobile.glb`)),
        `${coach}/mobile-switch: GPU/cache resources survived the 1.8s disposal grace period`,
      );
      let sameCoachReentry = null;
      if (coach === 'Arjun') {
        const modelUrl = '/arjun.mobile.glb';
        const idleUrl = '/arjun-animations.glb';
        await switchPage.waitForFunction(
          ({ model, idle }) => {
            const preload = window.__chessCoachAssetPreload;
            return (preload?.attempts?.[model] ?? 0) >= 2
              && (preload?.attempts?.[idle] ?? 0) >= 2
              && preload?.warmed?.includes(model)
              && preload?.warmed?.includes(idle);
          },
          { model: modelUrl, idle: idleUrl },
          { timeout: 70_000 },
        );
        const preloaded = await switchPage.evaluate(() => window.__chessCoachAssetPreload ?? null);
        await switchPage.locator('.menu-play').click();
        await switchPage.locator('.game-screen').waitFor({ state: 'visible', timeout: 70_000 });
        await switchPage.locator('.character-window.is-ready').waitFor({ state: 'visible', timeout: 70_000 });
        const remounted = await switchPage.evaluate(() => {
          const canvas = document.querySelector('.character-window.is-ready canvas');
          const diagnostics = window.__chessCharacterV2Diagnostics?.arjun ?? null;
          return {
            contextLost: !(canvas instanceof HTMLCanvasElement)
              || Boolean(canvas.getContext('webgl2')?.isContextLost()),
            diagnostics,
            lifecycle: window.__chessCharacterResourceLifecycle ?? [],
          };
        });
        assert(!remounted.contextLost, 'Arjun/mobile-reentry: active WebGL context lost');
        assert(remounted.diagnostics?.modelUrl === modelUrl, 'Arjun/mobile-reentry: wrong model URL');
        assert(remounted.diagnostics?.matchedMorphChannels === 251, 'Arjun/mobile-reentry: morph diagnostics missing');
        assert(
          remounted.lifecycle.some((entry) => (
            entry.key.includes(modelUrl)
            && entry.retainCount === 1
            && entry.disposePending === false
          )),
          'Arjun/mobile-reentry: re-preloaded asset is not retained exactly once',
        );
        assert(
          switchRequestedModels.filter((url) => url === modelUrl).length >= 2,
          'Arjun/mobile-reentry: disposed model was not requested by the second menu warm-up',
        );
        sameCoachReentry = { preloaded, remounted };

        await switchPage.locator('.topbar button').filter({ hasText: 'Menu' }).click();
        await switchPage.getByRole('dialog').getByRole('button', { name: 'Leave Game' }).click();
        await switchPage.locator('.menu-screen').waitFor({ state: 'visible', timeout: 15_000 });
        await switchPage.waitForFunction(
          () => (
            !window.__chessCharacterV2Diagnostics?.arjun
            && !(window.__chessCharacterResourceLifecycle ?? [])
              .some((entry) => entry.key.includes('/arjun.mobile.glb'))
          ),
          undefined,
          { timeout: 15_000 },
        );
      }
      switchSamples.push({ coach, active, released, sameCoachReentry });
    }
    assert(switchErrors.length === 0, `mobile coach-switch browser errors:\n${switchErrors.join('\n')}`);
    mobileSwitchResult = {
      passed: true,
      requestedModels: switchRequestedModels,
      samples: switchSamples,
      errors: switchErrors,
    };
    console.log(`Character V2 repeated mobile coach-switch QA passed: ${switchSamples.length}/${coaches.length}`);
  } finally {
    await switchPage.close();
    await switchContext.close();
  }
} finally {
  await browser.close();
}

const report = {
  passed: results.length === coaches.length * variants.length
    && adaptivePerformanceResult?.passed === true
    && responsiveResizeResult?.passed === true
    && responsiveMobileResizeResult?.passed === true
    && mobileSwitchResult?.passed === true,
  results,
  adaptivePerformanceResult,
  responsiveResizeResult,
  responsiveMobileResizeResult,
  mobileSwitchResult,
};
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
assert(report.passed, `expected ${coaches.length * variants.length} character renders, got ${results.length}`);
console.log(`Character V2 browser QA passed: ${results.length}/${coaches.length * variants.length}`);

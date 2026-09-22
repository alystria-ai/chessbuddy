/**
 * Per-device portrait quality for the compact (phone / tablet) path.
 *
 * Mobile is not one class of screen. A 196 px cutout on an iPhone 15 Pro is a
 * few hundred thousand pixels; the same cutout on a 1× Android Go phone is a
 * fill-rate and memory problem. One mobile cap made every phone look like the
 * weakest one. These tiers pick the best settings the hardware and panel can
 * hold, then the existing adaptive monitor can still step down if a frame
 * budget is missed.
 *
 * Device examples (CSS × CSS @ devicePixelRatio):
 *   economy  — 360×640 @1, ≤2 GB, Data Saver, 2G
 *   standard — 360–400 × ~800 @2 with 4–6 cores (mid Android, older iPhone)
 *   retina   — 390×844 @3, 430×932 @3, Pixel @2.625 (flagship phone panels)
 *   tablet   — 768–834 short side (iPad / large fold inner)
 */

export type MobilePortraitTier = 'economy' | 'standard' | 'retina' | 'tablet';

export type MobilePortraitSignals = {
  dpr: number;
  width: number;
  height: number;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  saveData?: boolean;
  reducedMotion?: boolean;
  pointerCoarse?: boolean;
};

export type MobilePortraitQuality = {
  tier: MobilePortraitTier;
  /** Half-res mobile GLB vs the authored desktop mesh. */
  useMobileModel: boolean;
  /** Authored performance clips + desktop lighting, not the mobile fallback. */
  useAuthoredPerformance: boolean;
  maxDpr: number;
  aoQualityLevel: number;
  msaaQualityLevel: number;
  smaaQualityLevel: number;
  shadowQualityLevel: number;
  textureAnisotropy: number;
  enablePostProcessing: boolean;
  enableEnvironment: boolean;
  usePennerSkin: boolean;
};

export function readMobilePortraitSignals(
  source: Window = window,
): MobilePortraitSignals {
  const nav = source.navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    dpr: source.devicePixelRatio || 1,
    width: source.innerWidth || 1,
    height: source.innerHeight || 1,
    hardwareConcurrency: nav.hardwareConcurrency || 4,
    deviceMemoryGb: nav.deviceMemory,
    saveData: Boolean(nav.connection?.saveData),
    reducedMotion: source.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pointerCoarse: source.matchMedia('(pointer: coarse)').matches,
  };
}

function shortestSide(signals: MobilePortraitSignals): number {
  return Math.min(signals.width, signals.height);
}

function longestSide(signals: MobilePortraitSignals): number {
  return Math.max(signals.width, signals.height);
}

function physicalShortSide(signals: MobilePortraitSignals): number {
  return shortestSide(signals) * Math.max(signals.dpr, 1);
}

function memoryAtLeast(signals: MobilePortraitSignals, gb: number): boolean {
  return signals.deviceMemoryGb === undefined || signals.deviceMemoryGb >= gb;
}

function capDpr(dpr: number, cap: number, floor = 1): number {
  const safe = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(Math.max(safe, floor), cap);
}

function isConstrained(signals: MobilePortraitSignals): boolean {
  return Boolean(
    signals.saveData
    || (signals.deviceMemoryGb !== undefined && signals.deviceMemoryGb <= 2)
    || (signals.hardwareConcurrency <= 4 && (signals.deviceMemoryGb ?? 4) <= 3)
    || (signals.dpr <= 1.25 && shortestSide(signals) <= 380),
  );
}

function isTabletClass(signals: MobilePortraitSignals): boolean {
  const short = shortestSide(signals);
  const long = longestSide(signals);
  return short >= 700 && long >= 900;
}

/**
 * Flagship phone panels: 3× iPhones, 2.6× Pixels, and plus-sized 2× screens
 * whose physical short side is already past ~900 px.
 */
function isRetinaPhone(signals: MobilePortraitSignals): boolean {
  if (isTabletClass(signals)) return false;
  if (!memoryAtLeast(signals, 4) || signals.hardwareConcurrency < 6) return false;
  const short = shortestSide(signals);
  if (signals.dpr >= 2.25 && short >= 360) return true;
  if (signals.dpr >= 2 && short >= 414) return true;
  return physicalShortSide(signals) >= 900;
}

function capableForFullModel(signals: MobilePortraitSignals): boolean {
  return signals.dpr >= 2
    && signals.hardwareConcurrency >= 6
    && memoryAtLeast(signals, 4);
}

export function shouldPreloadMobilePortrait(quality: MobilePortraitQuality): boolean {
  return quality.tier !== 'economy';
}

export function resolveMobilePortraitQuality(
  signals: MobilePortraitSignals,
): MobilePortraitQuality {
  const reduceAo = signals.reducedMotion;

  if (isConstrained(signals)) {
    return {
      tier: 'economy',
      useMobileModel: true,
      useAuthoredPerformance: false,
      maxDpr: 1,
      aoQualityLevel: 0,
      msaaQualityLevel: 0,
      smaaQualityLevel: reduceAo ? 0 : 1,
      shadowQualityLevel: 0,
      textureAnisotropy: 1,
      enablePostProcessing: false,
      enableEnvironment: false,
      usePennerSkin: false,
    };
  }

  if (isTabletClass(signals)) {
    return {
      tier: 'tablet',
      useMobileModel: false,
      useAuthoredPerformance: true,
      maxDpr: capDpr(signals.dpr, 2.25, 1.5),
      aoQualityLevel: reduceAo ? 0 : 2,
      msaaQualityLevel: 2,
      smaaQualityLevel: 3,
      shadowQualityLevel: 2,
      textureAnisotropy: 8,
      enablePostProcessing: true,
      enableEnvironment: true,
      // Penner SSS on a transparent phone canvas drops the head program on
      // several mobile GPUs, leaving floating eyes, teeth and hair.
      usePennerSkin: false,
    };
  }

  if (isRetinaPhone(signals)) {
    return {
      tier: 'retina',
      useMobileModel: false,
      useAuthoredPerformance: true,
      maxDpr: capDpr(signals.dpr, 2.75),
      aoQualityLevel: reduceAo ? 0 : 1,
      msaaQualityLevel: 1,
      smaaQualityLevel: 3,
      shadowQualityLevel: 1,
      textureAnisotropy: 8,
      enablePostProcessing: true,
      enableEnvironment: true,
      // Penner SSS on a transparent phone canvas drops the head program on
      // several mobile GPUs, leaving floating eyes, teeth and hair.
      usePennerSkin: false,
    };
  }

  const fullModel = capableForFullModel(signals);
  return {
    tier: 'standard',
    useMobileModel: !fullModel,
    useAuthoredPerformance: fullModel,
    maxDpr: capDpr(signals.dpr, 2, 1.25),
    aoQualityLevel: 0,
    msaaQualityLevel: 0,
    smaaQualityLevel: 2,
    shadowQualityLevel: 1,
    textureAnisotropy: fullModel ? 8 : 4,
    enablePostProcessing: true,
    enableEnvironment: true,
    usePennerSkin: false,
  };
}

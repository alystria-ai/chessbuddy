import { useGLTF } from '@react-three/drei';
import { getCoach, type CoachConfig, type CoachId } from './coachConfig';
import { debugLog } from './debugLog';
import { isMobilePortrait } from './isMobilePortrait';
import {
  readMobilePortraitSignals,
  resolveMobilePortraitQuality,
} from './mobilePortraitQuality';

/**
 * Coach model preloading.
 *
 * The portrait GLBs are ~4MB each and the download only used to start when the
 * game screen mounted — i.e. after the player pressed Play — so the whole
 * transfer sat on the critical path of the loading screen. The menu is idle
 * time we already have: warming the selected coach there means the model is
 * usually parsed and cached in drei's GLTF cache by the time Play is pressed,
 * and the loading screen goes straight to the voice link.
 *
 * Same URL derivation as CoachCard so the warmed entry is the one it asks for
 * (a mismatched URL would silently double-download).
 */

const DEFAULT_CHARACTER_ASSET_BASE = import.meta.env.BASE_URL;
const CHARACTER_ASSET_BASE = import.meta.env.VITE_CHARACTER_ASSET_BASE_URL || DEFAULT_CHARACTER_ASSET_BASE;

export const coachAssetUrl = (fileName: string) =>
  `${CHARACTER_ASSET_BASE.replace(/\/?$/, '/')}${fileName}`;

/** Phones get the half-resolution build (matches CoachCard). */
export const mobileModelFile = (fileName: string) => fileName.replace(/\.glb$/i, '.mobile.glb');

export function portraitModelFile(fileName: string): string {
  if (typeof window === 'undefined' || !isMobilePortrait()) return fileName;
  const quality = resolveMobilePortraitQuality(readMobilePortraitSignals());
  return quality.useMobileModel ? mobileModelFile(fileName) : fileName;
}

export function coachAssetUrls(coach: CoachConfig): { modelUrl: string; idleUrl: string } {
  return {
    modelUrl: coachAssetUrl(portraitModelFile(coach.modelFile)),
    idleUrl: coachAssetUrl(coach.idleFile),
  };
}

/** URLs already warmed this session — preloading twice is wasted bandwidth. */
const warmed = new Set<string>();
const preloadAttempts = new Map<string, number>();

function publishPreloadDiagnostics(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const debugWindow = window as typeof window & {
    __chessCoachAssetPreload?: {
      warmed: string[];
      attempts: Record<string, number>;
    };
  };
  debugWindow.__chessCoachAssetPreload = {
    warmed: [...warmed],
    attempts: Object.fromEntries(preloadAttempts),
  };
}

/**
 * Clear Drei's parsed GLTF cache and the matching warm-up marker together.
 * A later menu warm-up must be allowed to repopulate a model disposed by the
 * mobile GPU-resource lifecycle instead of trusting a stale session marker.
 */
export function clearCoachAssetCache(url: string): void {
  warmed.delete(url);
  useGLTF.clear(url);
  publishPreloadDiagnostics();
}

/** Clear every URL participating in one portrait load/retry boundary. */
export function clearCoachAssetCaches(urls: Iterable<string>): void {
  for (const url of urls) clearCoachAssetCache(url);
}

/**
 * Start fetching a coach's model + idle animation in the background.
 * Safe to call repeatedly; each URL is only fetched once per session, and
 * drei's cache is what CoachCard reads from later.
 */
export function preloadCoachAssets(coachId: CoachId): void {
  const coach = getCoach(coachId);
  if (!coach) return;
  const { modelUrl, idleUrl } = coachAssetUrls(coach);
  for (const url of [modelUrl, idleUrl]) {
    if (warmed.has(url)) continue;
    warmed.add(url);
    try {
      preloadAttempts.set(url, (preloadAttempts.get(url) ?? 0) + 1);
      useGLTF.preload(url);
    } catch {
      // A failed warm-up must never block the menu — the real load retries.
      warmed.delete(url);
    }
  }
  publishPreloadDiagnostics();
  debugLog('Preload', `Warming ${coach.name}'s portrait assets in the background`);
}

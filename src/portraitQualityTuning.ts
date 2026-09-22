export type PortraitAoQuality =
  | 'low'
  | 'medium'
  | 'high'
  | 'ultra';

/**
 * Stock mobile PBR avoids the optional Penner skin shader for driver safety,
 * but ACES exposure 1.0 then underexposes the complete light rig on physical
 * Samsung GPUs. Preserve ACES and compensate before tone mapping rather than
 * washing the final canvas with a CSS brightness filter.
 */
export const MOBILE_PORTRAIT_TONE_MAPPING_EXPOSURE = 1;
export const MOBILE_PORTRAIT_LIGHT_INTENSITY_SCALE = 1.25;

export function resolvePortraitToneMappingExposure(
  mobileVariant: boolean,
  exportedExposure = 1,
): number {
  return mobileVariant ? MOBILE_PORTRAIT_TONE_MAPPING_EXPOSURE : exportedExposure;
}

export function resolvePortraitLightIntensityScale(mobileVariant: boolean): number {
  return mobileVariant ? MOBILE_PORTRAIT_LIGHT_INTENSITY_SCALE : 1;
}

export function resolvePortraitAoQuality(level: number): PortraitAoQuality | null {
  const rounded = Math.round(Number.isFinite(level) ? level : 2);
  if (rounded <= 0) return null;
  if (rounded === 1) return 'low';
  if (rounded === 2) return 'medium';
  if (rounded === 3) return 'high';
  return 'ultra';
}

export function resolvePortraitAoQualityForRenderer(
  level: number,
  halfFloatRenderable: boolean,
): PortraitAoQuality | null {
  if (!halfFloatRenderable) return null;
  return resolvePortraitAoQuality(level);
}

export function resolveRequestedMsaaSamples(level: number): 0 | 2 | 4 {
  const rounded = Math.round(Number.isFinite(level) ? level : 2);
  if (rounded <= 0) return 0;
  return rounded === 1 ? 2 : 4;
}

/** Numeric values match postprocessing's stable SMAAPreset enum. */
export function resolveSmaaPreset(level: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(Number.isFinite(level) ? level : 3))) as 0 | 1 | 2 | 3;
}

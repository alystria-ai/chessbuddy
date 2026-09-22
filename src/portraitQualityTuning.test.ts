import { describe, expect, it } from 'vitest';
import {
  resolvePortraitAoQuality,
  resolvePortraitAoQualityForRenderer,
  resolveRequestedMsaaSamples,
  resolvePortraitToneMappingExposure,
  resolvePortraitLightIntensityScale,
  resolveSmaaPreset,
} from './portraitQualityTuning';

describe('portrait quality tuning', () => {
  it('maps numeric developer values to stable quality presets', () => {
    expect([0, 1, 2, 3, 4, 5].map(resolvePortraitAoQuality)).toEqual([
      null, 'low', 'medium', 'high', 'ultra', 'ultra',
    ]);
    expect([0, 1, 2].map(resolveRequestedMsaaSamples)).toEqual([0, 2, 4]);
    expect([-1, 0, 1, 2, 3, 8].map(resolveSmaaPreset)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(resolvePortraitAoQualityForRenderer(2, true)).toBe('medium');
    expect(resolvePortraitAoQualityForRenderer(4, true)).toBe('ultra');
    expect(resolvePortraitAoQualityForRenderer(4, false)).toBeNull();
  });

  it('keeps exported desktop exposure and lifts the safe mobile PBR path', () => {
    expect(resolvePortraitToneMappingExposure(false, 1)).toBe(1);
    expect(resolvePortraitToneMappingExposure(true, 1)).toBe(1);
    expect(resolvePortraitLightIntensityScale(false)).toBe(1);
    expect(resolvePortraitLightIntensityScale(true)).toBe(1.25);
  });
});

import { describe, expect, it } from 'vitest';
import {
  resolveMobilePortraitQuality,
  shouldPreloadMobilePortrait,
  type MobilePortraitSignals,
} from './mobilePortraitQuality';

function signals(partial: Partial<MobilePortraitSignals>): MobilePortraitSignals {
  return {
    dpr: 2,
    width: 390,
    height: 844,
    hardwareConcurrency: 6,
    deviceMemoryGb: 6,
    saveData: false,
    reducedMotion: false,
    pointerCoarse: true,
    ...partial,
  };
}

describe('mobile portrait quality tiers', () => {
  it('uses the half-res model and a 1× buffer on constrained phones', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 1,
      width: 360,
      height: 640,
      hardwareConcurrency: 4,
      deviceMemoryGb: 2,
    }));
    expect(quality.tier).toBe('economy');
    expect(quality.useMobileModel).toBe(true);
    expect(quality.maxDpr).toBe(1);
    expect(quality.usePennerSkin).toBe(false);
    expect(quality.enablePostProcessing).toBe(false);
    expect(shouldPreloadMobilePortrait(quality)).toBe(false);
  });

  it('treats Data-Saver as economy even on a retina panel', () => {
    const quality = resolveMobilePortraitQuality(signals({ dpr: 3, saveData: true }));
    expect(quality.tier).toBe('economy');
    expect(quality.useMobileModel).toBe(true);
  });

  it('keeps a 2× mid-range phone on the mobile mesh', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2,
      width: 360,
      height: 760,
      hardwareConcurrency: 4,
      deviceMemoryGb: 4,
    }));
    expect(quality.tier).toBe('standard');
    expect(quality.useMobileModel).toBe(true);
    expect(quality.maxDpr).toBe(2);
    expect(quality.smaaQualityLevel).toBe(2);
    expect(quality.usePennerSkin).toBe(false);
  });

  it('gives a capable 2× phone the authored mesh at native 2×', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2,
      hardwareConcurrency: 8,
      deviceMemoryGb: 4,
    }));
    expect(quality.tier).toBe('standard');
    expect(quality.useMobileModel).toBe(false);
    expect(quality.useAuthoredPerformance).toBe(true);
    expect(quality.maxDpr).toBe(2);
    expect(quality.usePennerSkin).toBe(false);
  });

  it('gives a 3× flagship phone the authored mesh, Penner skin and a denser buffer', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 3,
      width: 390,
      height: 844,
      hardwareConcurrency: 6,
      deviceMemoryGb: 6,
    }));
    expect(quality.tier).toBe('retina');
    expect(quality.useMobileModel).toBe(false);
    expect(quality.maxDpr).toBe(2.75);
    expect(quality.usePennerSkin).toBe(false);
    expect(quality.enableEnvironment).toBe(true);
    expect(quality.aoQualityLevel).toBe(1);
    expect(quality.msaaQualityLevel).toBe(1);
    expect(shouldPreloadMobilePortrait(quality)).toBe(true);
  });

  it('treats a plus-sized 2× phone as retina because the cutout is physically large', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2,
      width: 430,
      height: 932,
      hardwareConcurrency: 6,
      deviceMemoryGb: 6,
    }));
    expect(quality.tier).toBe('retina');
    expect(quality.useMobileModel).toBe(false);
    expect(quality.maxDpr).toBe(2);
  });

  it('treats a Pixel-class 2.625× panel as retina', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2.625,
      width: 412,
      height: 915,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
    }));
    expect(quality.tier).toBe('retina');
    expect(quality.maxDpr).toBe(2.625);
    expect(quality.textureAnisotropy).toBe(8);
  });

  it('treats a coarse-pointer tablet as near-desktop quality', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2,
      width: 820,
      height: 1180,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
    }));
    expect(quality.tier).toBe('tablet');
    expect(quality.useMobileModel).toBe(false);
    expect(quality.maxDpr).toBe(2);
    expect(quality.shadowQualityLevel).toBe(2);
    expect(quality.msaaQualityLevel).toBe(2);
    expect(quality.usePennerSkin).toBe(false);
  });

  it('lets a retina iPad raise the buffer above 2×', () => {
    const quality = resolveMobilePortraitQuality(signals({
      dpr: 2.5,
      width: 834,
      height: 1194,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
    }));
    expect(quality.tier).toBe('tablet');
    expect(quality.maxDpr).toBe(2.25);
  });

  it('drops ambient occlusion when the user asks for reduced motion', () => {
    const retina = resolveMobilePortraitQuality(signals({ dpr: 3, reducedMotion: true }));
    expect(retina.tier).toBe('retina');
    expect(retina.aoQualityLevel).toBe(0);
  });
});

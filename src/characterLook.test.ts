import { describe, expect, it } from 'vitest';
import {
  CHARACTER_COLOR_GRADE_FILTER,
  CHARACTER_LOOK,
  CHARACTER_LOOK_TECHNIQUE,
  clampPortraitRenderScale,
  getCharacterLight,
  minimumPortraitRenderScale,
  nextPortraitPerformanceState,
  portraitPerformanceBounds,
  preferredDesktopPortraitDevicePixelRatio,
  resolvePortraitComposerCapabilities,
  resolvePortraitMsaaSamples,
} from './characterLook';

describe('Chess Avatars V2 exact look contract', () => {
  it('keeps the exported renderer, environment, camera, grade and skin values', () => {
    expect(CHARACTER_LOOK.renderer).toMatchObject({
      toneMapping: 'ACESFilmic',
      toneMappingExposure: 1,
      outputColorSpace: 'sRGB',
      shadows: true,
    });
    expect(CHARACTER_LOOK.environment).toEqual({
      preset: 'studio', intensity: 0.25, blur: 0.6, showAsBackground: false,
    });
    expect(CHARACTER_LOOK.whiteBalance).toEqual({
      temperatureKelvin: 7800, appliedColor: '#e0e8ff',
    });
    expect(CHARACTER_LOOK.rigRotationDegrees).toBe(31);
    expect(CHARACTER_LOOK.camera).toEqual({
      fov: 20,
      position: [0.25, 1.487, 2.431],
      lookAt: [-0.032, 1.485, -0.011],
    });
    expect(CHARACTER_LOOK.colorGrade).toEqual({ brightness: 98, contrast: 127, saturation: 88 });
    expect(CHARACTER_COLOR_GRADE_FILTER).toBe('brightness(98%) contrast(100%) saturate(88%)');
    expect(CHARACTER_LOOK.skinShading.strength).toBe(1.3);
  });

  it('keeps the exact four-light and post-processing rig', () => {
    expect(getCharacterLight('key')).toMatchObject({
      type: 'DirectionalLight', position: [3.259, 4, 1.541], color: '#fff1e0',
      intensity: 1.9, castShadow: true, shadowBias: -0.0001,
    });
    expect(getCharacterLight('rim')).toMatchObject({
      type: 'DirectionalLight', position: [-2.744, 3, -0.684], color: '#cfe8ff', intensity: 3,
    });
    expect(getCharacterLight('catchlight')).toMatchObject({
      type: 'PointLight', position: [0.515, 1.6, 0.857], intensity: 3, distance: 3,
    });
    expect(getCharacterLight('ambient')).toMatchObject({ type: 'AmbientLight', intensity: 1 });
    expect(CHARACTER_LOOK.postProcessing).toMatchObject({
      ambientOcclusion: { effect: 'N8AO', aoRadius: 0.02, intensity: 3, halfRes: false },
      bloom: { intensity: 0.27, luminanceThreshold: 0.9 },
      vignette: { offset: 0.25, darkness: 0 },
    });
    expect(CHARACTER_LOOK_TECHNIQUE).toMatchObject({
      maxDevicePixelRatio: 2,
      preferredDesktopDevicePixelRatio: 1.5,
      preferredMsaaSamples: 4,
      balancedMsaaSamples: 2,
      minimumEffectiveDevicePixelRatio: 1,
      appliedCssContrastPercent: 100,
      colorGradeTransfer: 'shadow-preserving-css',
      n8aoDistanceFalloff: 1,
      n8aoQuality: 'medium',
      smaa: true,
      skinLutSize: 64,
      skinTransmittanceColor: '#ff4d33',
      skinTransmittanceWeight: 0.25,
    });
    expect(CHARACTER_LOOK_TECHNIQUE.environmentUrl).toBe(
      `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}character-assets/chess-avatars-v2/potsdamer_platz_1k.hdr`,
    );
  });

  it('keeps moving hair multisampled while adaptive scaling stays at native density', () => {
    expect(resolvePortraitMsaaSamples(8, false)).toBe(4);
    expect(resolvePortraitMsaaSamples(8, true)).toBe(2);
    expect(resolvePortraitMsaaSamples(3, false)).toBe(2);
    expect(resolvePortraitMsaaSamples(1, false)).toBe(0);
    expect(resolvePortraitMsaaSamples(Number.NaN, false)).toBe(0);
    expect(minimumPortraitRenderScale(1)).toBe(1);
    expect(minimumPortraitRenderScale(1.5)).toBeCloseTo(2 / 3);
    expect(minimumPortraitRenderScale(2)).toBe(0.5);
    expect(minimumPortraitRenderScale(0.8)).toBe(1.25);
    expect(preferredDesktopPortraitDevicePixelRatio(0.8)).toBe(1.5);
    expect(preferredDesktopPortraitDevicePixelRatio(1)).toBe(1.5);
    expect(preferredDesktopPortraitDevicePixelRatio(1.5)).toBe(1.5);
    expect(preferredDesktopPortraitDevicePixelRatio(3)).toBe(2);
  });

  it('degrades post effects before scale and restores the floor after DPR changes', () => {
    expect(nextPortraitPerformanceState(1, false, 0.5)).toEqual({
      scale: 1,
      balanced: true,
    });
    expect(nextPortraitPerformanceState(1, true, 0.5)).toEqual({
      scale: 0.75,
      balanced: true,
    });
    expect(nextPortraitPerformanceState(0.55, true, 0.5)).toEqual({
      scale: 0.5,
      balanced: true,
    });
    expect(clampPortraitRenderScale(0.5, 1)).toBe(1);
    expect(clampPortraitRenderScale(1, 1.25)).toBe(1.25);
  });

  it('preserves the mobile tier pixel density through repeated performance declines', () => {
    for (const dpr of [1, 2, 2.625, 2.75]) {
      const minimum = minimumPortraitRenderScale(dpr, dpr);
      let state = { scale: 1, balanced: false };
      for (let i = 0; i < 8; i++) state = nextPortraitPerformanceState(state.scale, state.balanced, minimum);
      expect(state.balanced).toBe(true);
      expect(state.scale * dpr).toBe(dpr);
    }
  });

  it('adapts at visibly low frame rates relative to the display refresh rate', () => {
    expect(portraitPerformanceBounds(60)).toEqual([42, 54]);
    expect(portraitPerformanceBounds(30)).toEqual([40, 50]);
    expect(portraitPerformanceBounds(144)).toEqual([45, 60]);
    expect(portraitPerformanceBounds(Number.NaN)).toEqual([42, 54]);
  });

  it('selects MSAA from the exact composer color and depth attachment support', () => {
    expect(resolvePortraitComposerCapabilities({
      generalMaximum: 8,
      depth24Maximum: 4,
      halfFloatMaximum: 4,
      rgba8Maximum: 8,
    }, false)).toEqual({ label: 'half-float', multisampling: 4, supportedSamples: 4 });
    expect(resolvePortraitComposerCapabilities({
      generalMaximum: 8,
      depth24Maximum: 2,
      halfFloatMaximum: 4,
      rgba8Maximum: 8,
    }, false)).toEqual({ label: 'half-float', multisampling: 2, supportedSamples: 2 });
    expect(resolvePortraitComposerCapabilities({
      generalMaximum: 4,
      depth24Maximum: 4,
      halfFloatMaximum: 0,
      rgba8Maximum: 4,
    }, false)).toEqual({ label: 'unsigned-byte', multisampling: 4, supportedSamples: 4 });
    expect(resolvePortraitComposerCapabilities({
      generalMaximum: 4,
      depth24Maximum: 1,
      halfFloatMaximum: 4,
      rgba8Maximum: 4,
    }, false)).toEqual({ label: 'unsigned-byte', multisampling: 0, supportedSamples: 1 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ToneMappingMode } from 'postprocessing';
import {
  configurePortraitN8AO,
  createPortraitToneMappingEffect,
  disposePortraitN8AO,
} from './PortraitPostEffects';

describe('portrait post effects', () => {
  it('uses explicit ACES filmic instead of the postprocessing default', () => {
    const effect = createPortraitToneMappingEffect();
    expect(effect.mode).toBe(ToneMappingMode.ACES_FILMIC);
    effect.dispose();
  });

  it('applies modern N8AO falloff and leaves gamma/output conversion to ACES', () => {
    const pass = {
      configuration: {},
      setQualityMode: vi.fn(),
    } as any;
    configurePortraitN8AO(pass, {
      quality: 'medium',
      aoRadius: 0.02,
      distanceFalloff: 1,
      intensity: 3,
      halfRes: false,
    });
    expect(pass.setQualityMode).toHaveBeenCalledWith('Medium');
    expect(pass.configuration).toMatchObject({
      aoRadius: 0.02,
      distanceFalloff: 1,
      intensity: 3,
      halfRes: false,
      depthAwareUpsampling: true,
      gammaCorrection: false,
    });
  });

  it('idempotently frees N8AO-owned GPU resources but not the composer depth input', () => {
    const sharedTarget = { dispose: vi.fn() };
    const transparencyDepth = { dispose: vi.fn() };
    const transparencyTarget = {
      dispose: vi.fn(() => transparencyDepth.dispose()),
      depthTexture: transparencyDepth,
    };
    const beautyTarget = { dispose: vi.fn() };
    const quad = { dispose: vi.fn() };
    const blueNoise = { dispose: vi.fn() };
    const composerDepth = { dispose: vi.fn() };
    const pass = {
      beautyRenderTarget: beautyTarget,
      depthDownsampleTarget: sharedTarget,
      transparencyRenderTargetDWFalse: { dispose: vi.fn() },
      transparencyRenderTargetDWTrue: transparencyTarget,
      writeTargetInternal: sharedTarget,
      readTargetInternal: { dispose: vi.fn() },
      outputTargetInternal: { dispose: vi.fn() },
      accumulationRenderTarget: { dispose: vi.fn() },
      effectCompositerQuad: quad,
      effectShaderQuad: quad,
      poissonBlurQuad: { dispose: vi.fn() },
      depthDownsampleQuad: { dispose: vi.fn() },
      depthCopyPass: { dispose: vi.fn() },
      copyQuad: { dispose: vi.fn() },
      accumulationQuad: { dispose: vi.fn() },
      bluenoise: blueNoise,
      depthTexture: composerDepth,
    } as any;

    disposePortraitN8AO(pass);
    disposePortraitN8AO(pass);

    expect(sharedTarget.dispose).toHaveBeenCalledTimes(1);
    expect(beautyTarget.dispose).toHaveBeenCalledTimes(1);
    expect(transparencyTarget.dispose).toHaveBeenCalledTimes(1);
    expect(transparencyDepth.dispose).toHaveBeenCalledTimes(1);
    expect(quad.dispose).toHaveBeenCalledTimes(1);
    expect(blueNoise.dispose).toHaveBeenCalledTimes(1);
    expect(composerDepth.dispose).not.toHaveBeenCalled();
    expect(pass.writeTargetInternal).toBeNull();
    expect(pass.bluenoise).toBeNull();
  });
});

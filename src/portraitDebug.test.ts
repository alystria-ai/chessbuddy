import { describe, expect, it } from 'vitest';
import { classifyPortraitFaceSamples, classifyPortraitPixel, shouldRecoverPortraitFrame, shouldUseBakedPortraitAfterProbes } from './portraitDebug';

describe('mobile portrait frame recovery', () => {
  it('recovers both blank-background and black render failures', () => {
    const background = '#c3cbc6';
    expect(classifyPortraitPixel([195, 203, 198], background)).toBe('empty_frame');
    expect(classifyPortraitPixel([3, 4, 2], background)).toBe('black_frame');
    expect(shouldRecoverPortraitFrame('empty_frame')).toBe(true);
    expect(shouldRecoverPortraitFrame('black_frame')).toBe(true);
    expect(shouldUseBakedPortraitAfterProbes('black_frame', 'black_frame')).toBe(true);
    expect(shouldUseBakedPortraitAfterProbes('empty_frame', 'black_frame')).toBe(true);
  });

  it('leaves a visible portrait on the authored material path', () => {
    expect(shouldRecoverPortraitFrame('visible_frame')).toBe(false);
    expect(shouldUseBakedPortraitAfterProbes('black_frame', 'visible_frame')).toBe(false);
  });

  it('rejects floating eyes or lips when the skin surface is missing', () => {
    const background = '#c3cbc6';
    expect(classifyPortraitFaceSamples([
      [84, 54, 42],
      [195, 203, 198],
      [195, 203, 198],
    ], background).classify).toBe('empty_frame');
    expect(classifyPortraitFaceSamples([
      [132, 86, 67],
      [145, 93, 74],
      [195, 203, 198],
    ], background).classify).toBe('visible_frame');
  });
});

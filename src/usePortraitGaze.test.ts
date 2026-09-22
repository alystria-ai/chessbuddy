import { describe, expect, it } from 'vitest';
import { getPortraitGazeBaseline } from './portraitGazeCalibration';
import { TUNED_LIPSYNC_VALUES } from './lipsyncTuning';
import { resolvePortraitEyeLook } from './usePortraitGaze';

describe('portrait gaze developer offsets', () => {
  it('leaves the artist-authored live Sofia eye pose untouched at zero offsets', () => {
    const baseline = getPortraitGazeBaseline('Sofia');
    expect(resolvePortraitEyeLook(baseline, TUNED_LIPSYNC_VALUES)).toEqual(baseline);
  });

  it('applies separate signed horizontal and vertical offsets per eye', () => {
    const baseline = getPortraitGazeBaseline('Sofia');
    const look = resolvePortraitEyeLook(baseline, {
      eyeHorizontalL: 0.1,
      eyeHorizontalR: -0.05,
      eyeVerticalL: 0.08,
      eyeVerticalR: -0.04,
    });
    expect(look.rightL).toBeCloseTo(0.1, 6);
    expect(look.leftL).toBeCloseTo(0, 6);
    expect(look.leftR).toBeCloseTo(0.05, 6);
    expect(look.upL).toBeCloseTo(0.08, 6);
    expect(look.downR).toBeCloseTo(0.04, 6);
  });
});

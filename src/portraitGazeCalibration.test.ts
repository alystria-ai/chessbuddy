import { describe, expect, it } from 'vitest';
import {
  getPortraitGazeBaseline,
  PORTRAIT_GAZE_BASELINES,
  PORTRAIT_GAZE_CALIBRATIONS,
} from './portraitGazeCalibration';

describe('Chess Avatars V2 camera-facing gaze calibration', () => {
  it('pins the exact headed-render calibration for all four production rigs', () => {
    expect(PORTRAIT_GAZE_BASELINES).toEqual({
      Tyler: { leftL: 0, leftR: 0, rightL: 0, rightR: 0, upL: 0, upR: 0, downL: 0, downR: 0 },
      Vincent: { leftL: 0, leftR: 0, rightL: 0, rightR: 0, upL: 0, upR: 0, downL: 0, downR: 0 },
      Leila: { leftL: 0, leftR: 0, rightL: 0, rightR: 0, upL: 0, upR: 0, downL: 0, downR: 0 },
      Sofia: { leftL: 0, leftR: 0, rightL: 0, rightR: 0, upL: 0, upR: 0, downL: 0, downR: 0 },
    });
  });

  it('keeps unknown/custom legacy rigs neutral instead of guessing', () => {
    expect(getPortraitGazeBaseline('Cassandra')).toEqual({
      leftL: 0, leftR: 0, rightL: 0, rightR: 0,
      upL: 0, upR: 0, downL: 0, downR: 0,
    });
  });

  it('keeps every portrait renderer calibration normalized and tied to a production asset', () => {
    expect(PORTRAIT_GAZE_CALIBRATIONS).toEqual({
      arjun: { assetName: 'Tyler', runtimeEnabled: false, values: { leftL: 0.25, leftR: 0.25 } },
      leila: { assetName: 'Leila', runtimeEnabled: false, values: { rightL: 0.12, leftR: 0.12, downL: 0.4, downR: 0.4 } },
      magnus: { assetName: 'Vincent', runtimeEnabled: false, values: { leftL: 0.25, leftR: 0.25 } },
      sofia: { assetName: 'Sofia', runtimeEnabled: false, values: { rightL: 0.12, leftR: 0.12, downL: 0.4, downR: 0.4 } },
    });
  });
});

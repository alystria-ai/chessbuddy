import calibrationJson from '../docs/character-models/chess-avatars-v2/portrait-gaze-calibration.json';

export type PortraitGazeBaseline = Readonly<{
  leftL: number;
  leftR: number;
  rightL: number;
  rightR: number;
  upL: number;
  upR: number;
  downL: number;
  downR: number;
}>;

const NEUTRAL: PortraitGazeBaseline = Object.freeze({
  leftL: 0, leftR: 0, rightL: 0, rightR: 0,
  upL: 0, upR: 0, downL: 0, downR: 0,
});

type GazeChannel = keyof PortraitGazeBaseline;
type GazeCalibration = Readonly<{
  assetName: string;
  runtimeEnabled?: boolean;
  values: Readonly<Partial<Record<GazeChannel, number>>>;
}>;

export const PORTRAIT_GAZE_CALIBRATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(calibrationJson).map(([coachId, raw]) => {
      const entry = raw as GazeCalibration;
      const values = Object.entries(entry.values ?? {});
      if (!entry.assetName
        || values.length === 0
        || values.some(([direction, value]) => (
          !/^(?:left|right|up|down)[LR]$/.test(direction)
          || !Number.isFinite(value)
          || Number(value) < 0
          || Number(value) > 1
        ))) {
        throw new Error(`Invalid Chess Avatars V2 gaze calibration for ${coachId}`);
      }
      return [coachId, Object.freeze({ ...entry, values: Object.freeze({ ...entry.values }) })];
    }),
  ) as Record<string, GazeCalibration>,
);

/**
 * Optional live baselines derived from the still-portrait calibration file.
 * V2 rigs currently opt out so authored animation and NeuroSync own the eyes;
 * the stored values remain available to the separate still renderer.
 */
export const PORTRAIT_GAZE_BASELINES: Readonly<Record<string, PortraitGazeBaseline>> = Object.freeze(
  Object.fromEntries(Object.values(PORTRAIT_GAZE_CALIBRATIONS).map((entry) => [
    entry.assetName,
    entry.runtimeEnabled === false
      ? NEUTRAL
      : Object.freeze({ ...NEUTRAL, ...entry.values }),
  ])),
);

export function getPortraitGazeBaseline(assetName?: string): PortraitGazeBaseline {
  return (assetName && PORTRAIT_GAZE_BASELINES[assetName]) || NEUTRAL;
}

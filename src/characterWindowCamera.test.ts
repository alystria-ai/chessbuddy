import { describe, expect, it } from 'vitest';
import {
  CHARACTER_WINDOW_PRESENTATION_ZOOM,
  dollyCharacterCamera,
} from './characterWindowCamera';

describe('character-window presentation camera', () => {
  it('dollies toward the authored look-at point without changing the view ray', () => {
    const position = [0.009, 1.428, 2.431] as const;
    const lookAt = [-0.032, 1.485, -0.011] as const;
    const zoomed = dollyCharacterCamera(position, lookAt);

    expect(CHARACTER_WINDOW_PRESENTATION_ZOOM).toBe(1.5);
    for (let axis = 0; axis < 3; axis += 1) {
      const originalOffset = position[axis] - lookAt[axis];
      const zoomedOffset = zoomed[axis] - lookAt[axis];
      expect(zoomedOffset).toBeCloseTo(originalOffset / 1.5, 12);
    }
  });

  it('rejects an invalid zoom instead of producing a broken camera', () => {
    expect(() => dollyCharacterCamera([0, 0, 1], [0, 0, 0], 0)).toThrow(/finite positive/);
  });
});

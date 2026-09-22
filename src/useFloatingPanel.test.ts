import { describe, expect, it } from 'vitest';
import { clampFloatingPanelPosition, positionFloatingPanelBesideAnchor } from './useFloatingPanel';

describe('floating panel geometry', () => {
  it('keeps dragged panels entirely inside the viewport', () => {
    expect(clampFloatingPanelPosition(
      { left: 1400, top: -80 },
      { width: 400, height: 600 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 1028, top: 12 });
  });

  it('opens beside the rail and flips when the right side cannot fit', () => {
    const leftRail = { left: 16, right: 76, top: 420 } as DOMRect;
    expect(positionFloatingPanelBesideAnchor(
      leftRail,
      { width: 360, height: 500 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 88, top: 348 });

    const rightRail = { left: 1360, right: 1420, top: 420 } as DOMRect;
    expect(positionFloatingPanelBesideAnchor(
      rightRail,
      { width: 360, height: 500 },
      { width: 1440, height: 900 },
    )).toEqual({ left: 988, top: 348 });
  });
});

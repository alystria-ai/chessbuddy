import { describe, expect, it } from 'vitest';
import { computeTooltipPosition } from './Tooltip';

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
}) as DOMRect;

describe('tooltip positioning', () => {
  it('anchors a left tooltip to the actual trigger rect', () => {
    expect(computeTooltipPosition(
      rect(300, 120, 34, 34),
      rect(0, 0, 140, 30),
      'left',
      { width: 1440, height: 900 },
    )).toEqual({ left: 152, top: 122 });
  });

  it('tries another side rather than pinning a tooltip to the viewport edge', () => {
    expect(computeTooltipPosition(
      rect(12, 120, 34, 34),
      rect(0, 0, 140, 30),
      'left',
      { width: 390, height: 844 },
    )).toEqual({ left: 54, top: 122 });
  });
});

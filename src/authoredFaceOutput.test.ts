import { describe, expect, it } from 'vitest';
import { commitAuthoredFaceOutput } from './CoachChessPerformance';

describe('authored face output ownership', () => {
  it('clears a stale eye pose when no authored face clip owns the frame', () => {
    const influences = [0.82, 0.76, 0.4];
    const slots = new Int16Array([0, 1, 2]);
    const output = new Float32Array([0.25, 0.2, 0.1]);

    commitAuthoredFaceOutput([{ influences, slots }], output, false);

    expect(output).toEqual(new Float32Array([0, 0, 0]));
    expect(influences).toEqual([0, 0, 0]);
  });

  it('writes the current authored face when the frame has an owner', () => {
    const influences = [0.82, 0.76, 0.4];
    const slots = new Int16Array([0, 1, -1]);
    const output = new Float32Array([0.3, 0.4, 0.9]);

    commitAuthoredFaceOutput([{ influences, slots }], output, true);

    expect(influences).toEqual([expect.closeTo(0.3), expect.closeTo(0.4), 0.4]);
  });
});

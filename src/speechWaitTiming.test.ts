import { describe, expect, it } from 'vitest';
import { elapsedSince, updateQuietSince } from './speechWaitTiming';

describe('speech wait timing', () => {
  it('counts wall-clock silence across a delayed main-thread poll', () => {
    const quietSince = updateQuietSince(null, true, true, 1_000);

    // A busy mobile render can delay the nominal 50ms poll by several seconds.
    expect(elapsedSince(quietSince, 5_000)).toBe(4_000);
  });

  it('resets the clock whenever activity resumes', () => {
    const quietSince = updateQuietSince(null, true, true, 1_000);
    expect(updateQuietSince(quietSince, false, true, 1_150)).toBeNull();
    expect(updateQuietSince(quietSince, true, false, 1_150)).toBeNull();
  });
});

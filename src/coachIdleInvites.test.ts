import { describe, expect, it } from 'vitest';
import { COACH_IDLE_INVITES, pickCoachIdleInvite } from './coachIdleInvites';

describe('coach idle invites', () => {
  it('returns every authored line for a matching roll', () => {
    const seen = COACH_IDLE_INVITES.map((_, index) => (
      pickCoachIdleInvite(() => (index + 0.01) / COACH_IDLE_INVITES.length)
    ));
    expect(seen).toEqual([...COACH_IDLE_INVITES]);
  });

  it('stays inside the list for 0 and 1', () => {
    expect(pickCoachIdleInvite(() => 0)).toBe(COACH_IDLE_INVITES[0]);
    expect(COACH_IDLE_INVITES).toContain(pickCoachIdleInvite(() => 0.999));
  });
});

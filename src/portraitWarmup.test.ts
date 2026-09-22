import { describe, expect, it } from 'vitest';
import presentation from '../docs/character-models/chess-avatars-v2/portrait-presentation.json';
import { mobileWarmupObjectPosition } from './portraitWarmup';

describe('mobileWarmupObjectPosition', () => {
  it('keeps Sofia at the shared reference crop', () => {
    const sofia = presentation.coaches.sofia;
    const horizontalOffset = sofia.framing.horizontalOffset + (sofia.mobileCompact?.horizontalOffset ?? -0.01);
    expect(mobileWarmupObjectPosition(horizontalOffset, sofia.mobileCompact?.cameraZoom ?? 0.94)).toBe('46.0% 6.0%');
  });

  it('calculates the generic fallback before per-coach crop overrides', () => {
    const leila = presentation.coaches.leila;
    const horizontalOffset = leila.framing.horizontalOffset + (leila.mobileCompact?.horizontalOffset ?? -0.01);
    expect(mobileWarmupObjectPosition(horizontalOffset, leila.mobileCompact?.cameraZoom ?? 0.94)).toBe('31.0% 6.0%');
  });

  it('allows explicit per-coach warmup crop overrides', () => {
    expect(presentation.coaches.leila.mobileCompact?.warmupObjectPosition).toBe('70% 6%');
  });
});

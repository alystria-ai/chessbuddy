import { describe, expect, it } from 'vitest';
import presentation from '../docs/character-models/chess-avatars-v2/portrait-presentation.json';
import { CHARACTER_WINDOW_PRESENTATION_ZOOM } from './characterWindowCamera';
import { TUNED_LIPSYNC_VALUES } from './lipsyncTuning';

describe('shared live and baked portrait presentation', () => {
  it('uses a light smile at the live resting-expression strength', () => {
    expect(presentation.expression).toEqual({
      name: 'light-live-smile',
      smileIntensity: 0.45,
      eyePoseSource: 'authored-runtime-neutral',
    });
  });

  it('widens the live and baked crop while keeping the same head pose', () => {
    expect(CHARACTER_WINDOW_PRESENTATION_ZOOM).toBe(1.5);
    expect(TUNED_LIPSYNC_VALUES.portraitCameraZoom).toBe(1.5);
    expect(TUNED_LIPSYNC_VALUES.headYawDegrees).toBe(presentation.headYawDegrees);
    expect(TUNED_LIPSYNC_VALUES.headPitchDegrees).toBe(presentation.headPitchDegrees);
  });

  it('records the measured per-coach runtime poses used by live and baked portraits', () => {
    expect(presentation.headYawDegrees).toBe(7);
    expect(presentation.headPitchDegrees).toBe(7);
    expect(presentation.coaches.sofia.runtimePose).toEqual({
      modelOffsetX: 0.03,
      modelYawDegrees: -10,
      headYawDegrees: 11,
      headPitchDegrees: 7,
    });
    expect(presentation.coaches.magnus.runtimePose).toEqual({
      modelOffsetX: 0,
      modelYawDegrees: 7,
      headYawDegrees: 1,
      headPitchDegrees: 2,
    });
    expect(presentation.coaches.leila.runtimePose).toEqual({
      modelOffsetX: 0.03,
      modelYawDegrees: -10,
      headYawDegrees: 11,
      headPitchDegrees: 7,
    });
    expect(presentation.coaches.arjun.runtimePose).toEqual({
      modelOffsetX: 0,
      modelYawDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 6,
    });
  });

  it('uses measured women-specific shoulder-plane corrections', () => {
    expect(presentation.coaches.sofia.framing.horizontalOffset).toBe(-0.035);
    expect(presentation.coaches.leila.framing.horizontalOffset).toBe(-0.035);
    expect(presentation.coaches.magnus.framing.horizontalOffset).toBe(-0.032);
    expect(presentation.coaches.arjun.framing.horizontalOffset).toBe(-0.032);
    expect(presentation.coaches.sofia.framing.modelYawDegrees).toBe(3);
    expect(presentation.coaches.leila.framing.modelYawDegrees).toBe(3);
    expect(presentation.coaches.magnus.framing.modelYawDegrees).toBe(0);
    expect(presentation.coaches.arjun.framing.modelYawDegrees).toBe(0);
    expect(presentation.coaches.magnus.framing.liveCameraZoom).toBe(1.3);
    expect('liveCameraZoom' in presentation.coaches.sofia.framing).toBe(false);
    expect('liveCameraZoom' in presentation.coaches.leila.framing).toBe(false);
    expect('liveCameraZoom' in presentation.coaches.arjun.framing).toBe(false);
    expect(presentation.coaches.arjun.framing.modelScale).toBe(0.009);
    for (const coach of [presentation.coaches.sofia, presentation.coaches.leila, presentation.coaches.magnus]) {
      expect(coach.framing.modelScale).toBe(0.01);
      expect(Number.isFinite(coach.framing.horizontalOffset)).toBe(true);
    }
    expect(Number.isFinite(presentation.coaches.arjun.framing.horizontalOffset)).toBe(true);
  });

  it('keeps portrait and live mobile framing left-biased together', () => {
    expect(presentation.coaches.sofia.mobileCompact?.horizontalOffset).toBe(-0.012);
    expect(presentation.coaches.leila.mobileCompact?.horizontalOffset).toBe(-0.036);
    expect(presentation.coaches.leila.mobileCompact?.warmupObjectPosition).toBe('70% 6%');
  });
});

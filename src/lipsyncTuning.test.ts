import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLipsyncTuningSnapshot,
  getLipsyncTuningValuesForCoach,
  PURE_NEUROSYNC_VALUES,
  resetLipsyncTuning,
  setLipsyncTuningMode,
  setLipsyncTuningValue,
  setLipsyncTuningValueForCoach,
  TUNED_LIPSYNC_VALUES,
} from './lipsyncTuning';

describe('lipsync developer tuning state', () => {
  beforeEach(() => resetLipsyncTuning());

  it('ships in the established Chessbuddy tuned mode', () => {
    expect(getLipsyncTuningSnapshot()).toEqual({ mode: 'tuned', values: TUNED_LIPSYNC_VALUES });
    expect(getLipsyncTuningSnapshot().values).toMatchObject({
      mouthGain: 1,
      mouthSymmetry: 0.8,
      lateralMouthGain: 0.15,
      upperLipRaiseGain: 0.6,
      lowerLipDepressGain: 0.45,
      mouthBaseAdditive: 0,
      jawGain: 0.75,
      jawMax: 0.28,
      headYawDegrees: 7,
      headPitchDegrees: 7,
      portraitResolutionScale: 1.15,
      aoQualityLevel: 2,
      msaaQualityLevel: 2,
      smaaQualityLevel: 3,
      hairAlphaCoverage: 1,
      textureAnisotropy: 16,
      portraitCameraZoom: 1.5,
      toneMappingEnabled: 1,
      portraitContrastPercent: 100,
      environmentRoughnessFloor: 0,
      skinSssStrength: 1.3,
      adaptiveQualityEnabled: 1,
      shadowQualityLevel: 2,
      studioBackdropStrength: 0.65,
      environmentIntensity: 0.25,
    });
  });

  it('isolates the measured player-facing pose for every coach', () => {
    expect(getLipsyncTuningValuesForCoach('arjun')).toMatchObject({
      modelYawDegrees: 0,
      modelOffsetX: 0,
      modelPitchDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 6,
    });
    expect(getLipsyncTuningValuesForCoach('sofia')).toMatchObject({
      modelYawDegrees: -10,
      modelOffsetX: 0.03,
      modelPitchDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 7,
    });
    expect(getLipsyncTuningValuesForCoach('magnus')).toMatchObject({
      modelYawDegrees: 7,
      modelOffsetX: 0,
      modelPitchDegrees: 0,
      headYawDegrees: 1,
      headPitchDegrees: 2,
    });
    expect(getLipsyncTuningValuesForCoach('leila')).toMatchObject({
      modelYawDegrees: -10,
      modelOffsetX: 0.03,
      modelPitchDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 7,
    });

    setLipsyncTuningValueForCoach('arjun', 'modelYawDegrees', 12);
    setLipsyncTuningValueForCoach('arjun', 'headPitchDegrees', 9);
    expect(getLipsyncTuningValuesForCoach('arjun')).toMatchObject({
      modelYawDegrees: 12,
      headPitchDegrees: 9,
    });
    expect(getLipsyncTuningValuesForCoach('sofia')).toMatchObject({
      modelYawDegrees: -10,
      headPitchDegrees: 7,
    });
  });

  it('switches to pure NeuroSync values without touching locked runtime safety', () => {
    setLipsyncTuningMode('pure');
    expect(getLipsyncTuningSnapshot()).toEqual({ mode: 'pure', values: PURE_NEUROSYNC_VALUES });
    expect(getLipsyncTuningSnapshot().values).toMatchObject({
      jawGain: 1,
      jawMax: 1,
      mouthSymmetry: 0,
      lateralMouthGain: 1,
      upperLipRaiseGain: 1,
      lowerLipDepressGain: 1,
      mouthBaseAdditive: 1,
      upperTeethTuck: 0,
      lowerTeethTuck: 0,
      smoothing: 0,
      streamedEyeLookGain: 1,
      emotionStrength: 0,
      blinkStrength: 0,
      headYawDegrees: 0,
      headPitchDegrees: 0,
    });
    expect(getLipsyncTuningValuesForCoach('sofia')).toMatchObject({
      modelOffsetX: 0,
      modelYawDegrees: 0,
      headYawDegrees: 0,
      headPitchDegrees: 0,
    });
  });

  it('marks numeric slider changes as a custom comparison and snaps to declared steps', () => {
    setLipsyncTuningMode('pure');
    setLipsyncTuningValue('jawMax', 0.437);
    setLipsyncTuningValue('upperTeethTuck', 9);
    expect(getLipsyncTuningSnapshot().mode).toBe('custom');
    expect(getLipsyncTuningSnapshot().values.jawMax).toBe(0.44);
    expect(getLipsyncTuningSnapshot().values.upperTeethTuck).toBe(0.5);
  });

  it('keeps the minimum and maximum blink gaps internally ordered', () => {
    setLipsyncTuningValue('blinkMinIntervalSeconds', 4);
    setLipsyncTuningValue('blinkMaxIntervalSeconds', 1);
    expect(getLipsyncTuningSnapshot().values.blinkMinIntervalSeconds).toBe(1);
    expect(getLipsyncTuningSnapshot().values.blinkMaxIntervalSeconds).toBe(1);
  });

  it('migrates legacy pure plus custom render settings without enabling mouth tuning', async () => {
    const legacyValues = { ...PURE_NEUROSYNC_VALUES } as Record<string, number>;
    delete legacyValues.mouthSymmetry;
    delete legacyValues.lateralMouthGain;
    delete legacyValues.upperLipRaiseGain;
    delete legacyValues.lowerLipDepressGain;
    delete legacyValues.mouthBaseAdditive;
    legacyValues.portraitContrastPercent = 95;
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ version: 4, values: legacyValues }),
      setItem: vi.fn(),
    });
    vi.resetModules();
    const migrated = await import('./lipsyncTuning');
    expect(migrated.getLipsyncTuningSnapshot().mode).toBe('custom');
    expect(migrated.getLipsyncTuningSnapshot().values).toMatchObject({
      portraitContrastPercent: 95,
      mouthSymmetry: 0,
      lateralMouthGain: 1,
      upperLipRaiseGain: 1,
      lowerLipDepressGain: 1,
      mouthBaseAdditive: 1,
    });
    vi.unstubAllGlobals();
  });

  it('removes leaked v6 global pose edits while preserving non-pose tuning', async () => {
    const versionSixValues = {
      ...TUNED_LIPSYNC_VALUES,
      modelYawDegrees: 13,
      modelPitchDegrees: 10,
      headYawDegrees: 13,
      headPitchDegrees: 10,
      portraitResolutionScale: 1.2,
    };
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'chessbuddy-lipsync-tuning-v1'
        ? JSON.stringify({ version: 6, values: versionSixValues })
        : null,
      setItem: vi.fn(),
    });
    vi.resetModules();
    const migrated = await import('./lipsyncTuning');
    expect(migrated.getLipsyncTuningValuesForCoach('sofia')).toMatchObject({
      modelYawDegrees: -10,
      modelOffsetX: 0.03,
      modelPitchDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 7,
      portraitResolutionScale: 1.2,
    });
    expect(migrated.getLipsyncTuningValuesForCoach('arjun')).toMatchObject({
      modelYawDegrees: 0,
      modelPitchDegrees: 0,
      headYawDegrees: 11,
      headPitchDegrees: 6,
    });
    vi.unstubAllGlobals();
  });

  it('replaces only retired per-coach defaults while preserving real overrides', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'chessbuddy-lipsync-coach-pose-v1'
        ? JSON.stringify({
          sofia: { headYawDegrees: 9, modelOffsetX: 0.08 },
          magnus: { headYawDegrees: 5, headPitchDegrees: -2, modelOffsetX: 0.05 },
          leila: { modelYawDegrees: -11, headYawDegrees: 8, headPitchDegrees: 4 },
        })
        : null,
      setItem: vi.fn(),
    });
    vi.resetModules();
    const migrated = await import('./lipsyncTuning');
    expect(migrated.getLipsyncTuningValuesForCoach('sofia')).toMatchObject({
      headYawDegrees: 11,
      modelOffsetX: 0.08,
    });
    expect(migrated.getLipsyncTuningValuesForCoach('magnus')).toMatchObject({
      headYawDegrees: 1,
      headPitchDegrees: 2,
      modelOffsetX: 0.05,
    });
    expect(migrated.getLipsyncTuningValuesForCoach('leila')).toMatchObject({
      modelYawDegrees: -10,
      headYawDegrees: 11,
      headPitchDegrees: 4,
    });
    vi.unstubAllGlobals();
  });

  it('moves the former rigid tuned mouth preset to the flexible restrained preset', async () => {
    const versionFiveValues = {
      ...TUNED_LIPSYNC_VALUES,
      mouthSymmetry: 1,
      lateralMouthGain: 0,
    };
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ version: 5, values: versionFiveValues }),
      setItem: vi.fn(),
    });
    vi.resetModules();
    const migrated = await import('./lipsyncTuning');
    expect(migrated.getLipsyncTuningSnapshot()).toEqual({
      mode: 'tuned',
      values: migrated.TUNED_LIPSYNC_VALUES,
    });
    expect(migrated.getLipsyncTuningSnapshot().values).toMatchObject({
      mouthSymmetry: 0.8,
      lateralMouthGain: 0.15,
    });
    vi.unstubAllGlobals();
  });
});

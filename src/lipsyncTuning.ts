import portraitPresentation from '../docs/character-models/chess-avatars-v2/portrait-presentation.json';

export type LipsyncTuningValues = Readonly<{
  overallGain: number;
  mouthGain: number;
  mouthSymmetry: number;
  lateralMouthGain: number;
  upperLipRaiseGain: number;
  lowerLipDepressGain: number;
  mouthBaseAdditive: number;
  jawGain: number;
  jawMax: number;
  upperTeethTuck: number;
  lowerTeethTuck: number;
  smoothing: number;
  streamedEyeLookGain: number;
  emotionStrength: number;
  blinkStrength: number;
  blinkMinIntervalSeconds: number;
  blinkMaxIntervalSeconds: number;
  blinkRestingDroop: number;
  eyeWidenDamping: number;
  modelYawDegrees: number;
  modelPitchDegrees: number;
  modelOffsetX: number;
  modelOffsetY: number;
  modelOffsetZ: number;
  modelScale: number;
  headYawDegrees: number;
  headPitchDegrees: number;
  eyeHorizontalL: number;
  eyeHorizontalR: number;
  eyeVerticalL: number;
  eyeVerticalR: number;
  portraitResolutionScale: number;
  aoQualityLevel: number;
  aoIntensity: number;
  aoRadius: number;
  msaaQualityLevel: number;
  smaaQualityLevel: number;
  hairAlphaCoverage: number;
  textureAnisotropy: number;
  portraitCameraZoom: number;
  toneMappingEnabled: number;
  portraitContrastPercent: number;
  environmentRoughnessFloor: number;
  skinSssStrength: number;
  adaptiveQualityEnabled: number;
  shadowQualityLevel: number;
  studioBackdropStrength: number;
  environmentIntensity: number;
}>;

export type LipsyncTuningKey = keyof LipsyncTuningValues;
export const COACH_POSE_TUNING_KEYS = Object.freeze([
  'modelYawDegrees',
  'modelPitchDegrees',
  'modelOffsetX',
  'modelOffsetY',
  'modelOffsetZ',
  'modelScale',
  'headYawDegrees',
  'headPitchDegrees',
  'eyeHorizontalL',
  'eyeHorizontalR',
  'eyeVerticalL',
  'eyeVerticalR',
] as const);
export type CoachPoseTuningKey = (typeof COACH_POSE_TUNING_KEYS)[number];
export type LipsyncTuningMode = 'tuned' | 'pure' | 'custom';
export type LipsyncTuningSnapshot = Readonly<{
  mode: LipsyncTuningMode;
  values: LipsyncTuningValues;
}>;

export type LipsyncTuningControl = Readonly<{
  key: LipsyncTuningKey;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  unit?: string;
  section: 'face' | 'blink' | 'pose' | 'render';
}>;

const STORAGE_KEY = 'chessbuddy-lipsync-tuning-v1';
const POSE_STORAGE_KEY = 'chessbuddy-lipsync-coach-pose-v1';
const STORAGE_VERSION = 7;
const COACH_POSE_KEY_SET = new Set<LipsyncTuningKey>(COACH_POSE_TUNING_KEYS);

export const TUNED_LIPSYNC_VALUES: LipsyncTuningValues = Object.freeze({
  overallGain: 1,
  mouthGain: 1,
  mouthSymmetry: 0.8,
  lateralMouthGain: 0.15,
  upperLipRaiseGain: 0.6,
  lowerLipDepressGain: 0.45,
  mouthBaseAdditive: 0,
  jawGain: 0.75,
  jawMax: 0.28,
  upperTeethTuck: 0.12,
  lowerTeethTuck: 0.3,
  smoothing: 0.9,
  streamedEyeLookGain: 1,
  emotionStrength: 1,
  blinkStrength: 1,
  blinkMinIntervalSeconds: 0.9,
  blinkMaxIntervalSeconds: 2.2,
  blinkRestingDroop: 0.3,
  eyeWidenDamping: 0.18,
  modelYawDegrees: 0,
  modelPitchDegrees: 0,
  modelOffsetX: 0,
  modelOffsetY: 0,
  modelOffsetZ: 0,
  modelScale: 1,
  headYawDegrees: 7,
  headPitchDegrees: 7,
  eyeHorizontalL: 0,
  eyeHorizontalR: 0,
  eyeVerticalL: 0,
  eyeVerticalR: 0,
  portraitResolutionScale: 1.15,
  aoQualityLevel: 2,
  aoIntensity: 3,
  aoRadius: 0.02,
  msaaQualityLevel: 2,
  smaaQualityLevel: 3,
  hairAlphaCoverage: 1,
  textureAnisotropy: 16,
  portraitCameraZoom: portraitPresentation.cameraZoom,
  toneMappingEnabled: 1,
  portraitContrastPercent: 100,
  environmentRoughnessFloor: 0,
  skinSssStrength: 1.3,
  adaptiveQualityEnabled: 1,
  shadowQualityLevel: 2,
  studioBackdropStrength: 0.65,
  environmentIntensity: 0.25,
});

/**
 * Raw comparison values. Transport pacing/interpolation and runtime safety are
 * deliberately not represented here: exact MHA order, finite/clamp checks,
 * additive restoration, reset handling, and the final-frame release remain
 * mandatory in every mode.
 */
export const PURE_NEUROSYNC_VALUES: LipsyncTuningValues = Object.freeze({
  overallGain: 1,
  mouthGain: 1,
  mouthSymmetry: 0,
  lateralMouthGain: 1,
  upperLipRaiseGain: 1,
  lowerLipDepressGain: 1,
  mouthBaseAdditive: 1,
  jawGain: 1,
  jawMax: 1,
  upperTeethTuck: 0,
  lowerTeethTuck: 0,
  smoothing: 0,
  streamedEyeLookGain: 1,
  emotionStrength: 0,
  blinkStrength: 0,
  blinkMinIntervalSeconds: 0.9,
  blinkMaxIntervalSeconds: 2.2,
  blinkRestingDroop: 0,
  eyeWidenDamping: 0,
  modelYawDegrees: 0,
  modelPitchDegrees: 0,
  modelOffsetX: 0,
  modelOffsetY: 0,
  modelOffsetZ: 0,
  modelScale: 1,
  headYawDegrees: 0,
  headPitchDegrees: 0,
  eyeHorizontalL: 0,
  eyeHorizontalR: 0,
  eyeVerticalL: 0,
  eyeVerticalR: 0,
  portraitResolutionScale: 1.15,
  aoQualityLevel: 2,
  aoIntensity: 3,
  aoRadius: 0.02,
  msaaQualityLevel: 2,
  smaaQualityLevel: 3,
  hairAlphaCoverage: 1,
  textureAnisotropy: 16,
  portraitCameraZoom: portraitPresentation.cameraZoom,
  toneMappingEnabled: 1,
  portraitContrastPercent: 100,
  environmentRoughnessFloor: 0,
  skinSssStrength: 1.3,
  adaptiveQualityEnabled: 1,
  shadowQualityLevel: 2,
  studioBackdropStrength: 0.65,
  environmentIntensity: 0.25,
});

const LEGACY_TUNED_LIPSYNC_VALUES: LipsyncTuningValues = Object.freeze({
  ...TUNED_LIPSYNC_VALUES,
  headYawDegrees: 0,
  headPitchDegrees: 0,
  portraitCameraZoom: 1.7,
});

const PRE_WIDE_CROP_TUNED_VALUES: LipsyncTuningValues = Object.freeze({
  ...TUNED_LIPSYNC_VALUES,
  portraitCameraZoom: 1.7,
});

const PRE_MOUTH_RESTRAINT_TUNED_VALUES: LipsyncTuningValues = Object.freeze({
  ...TUNED_LIPSYNC_VALUES,
  mouthGain: 1,
  jawGain: 0.9,
  jawMax: 0.35,
});

const PRE_MOUTH_FLEXIBILITY_TUNED_VALUES: LipsyncTuningValues = Object.freeze({
  ...TUNED_LIPSYNC_VALUES,
  mouthSymmetry: 1,
  lateralMouthGain: 0,
});

const PRE_MOUTH_SYMMETRY_PURE_VALUES: LipsyncTuningValues = Object.freeze({
  ...PURE_NEUROSYNC_VALUES,
  mouthSymmetry: 1,
  lateralMouthGain: 0,
  upperLipRaiseGain: 0.6,
  lowerLipDepressGain: 0.45,
  mouthBaseAdditive: 0,
});

export const LIPSYNC_TUNING_CONTROLS: readonly LipsyncTuningControl[] = Object.freeze([
  {
    key: 'overallGain', label: 'Overall face gain', description: 'Scales every incoming MHA channel.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'mouthGain', label: 'Mouth gain', description: 'Scales mouth, jaw, tongue and teeth channels.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'mouthSymmetry', label: 'Mouth symmetry', description: 'Balances paired left/right speech controls; 0 preserves the raw stream and 1 fully balances it.',
    min: 0, max: 1, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'lateralMouthGain', label: 'Sideways mouth motion', description: 'Scales raw mouth-left/right and jaw-left/right drift.',
    min: 0, max: 1, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'upperLipRaiseGain', label: 'Upper-lip opening', description: 'Scales upper-lip raise using the Convai naturalness recommendation.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'lowerLipDepressGain', label: 'Lower-lip opening', description: 'Scales lower-lip depression to prevent wide side openings and excess lower teeth.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'mouthBaseAdditive', label: 'Mouth expression stacking', description: '0 prevents the app smile from adding onto speech; 1 restores fully additive raw composition.',
    min: 0, max: 1, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'jawGain', label: 'Jaw-open gain', description: 'Multiplies the NeuroSync jawOpen channel.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'jawMax', label: 'Jaw-open ceiling', description: 'Caps the normalized jaw opening.',
    min: 0.1, max: 1, step: 0.01, digits: 2, section: 'face',
  },
  {
    key: 'upperTeethTuck', label: 'Upper teeth tuck', description: 'Minimum upper-row occlusion behind the lip.',
    min: 0, max: 0.5, step: 0.01, digits: 2, section: 'face',
  },
  {
    key: 'lowerTeethTuck', label: 'Lower teeth tuck', description: 'Minimum lower-row occlusion behind the lip.',
    min: 0, max: 0.6, step: 0.01, digits: 2, section: 'face',
  },
  {
    key: 'smoothing', label: 'Input response speed', description: '0 disables the smoothing layer; higher values follow incoming facial frames faster.',
    min: 0, max: 0.99, step: 0.01, digits: 2, section: 'face',
  },
  {
    key: 'streamedEyeLookGain', label: 'Streamed eye-look gain', description: 'Scales NeuroSync eye-look channels over the camera-facing base.',
    min: 0, max: 1.5, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'emotionStrength', label: 'App emotion layer', description: 'Scales the procedural smile, cheek and brow layer.',
    min: 0, max: 1.2, step: 0.05, digits: 2, section: 'face',
  },
  {
    key: 'blinkStrength', label: 'Procedural blink strength', description: '0 leaves blinking entirely to NeuroSync.',
    min: 0, max: 1.2, step: 0.05, digits: 2, section: 'blink',
  },
  {
    key: 'blinkMinIntervalSeconds', label: 'Minimum blink gap', description: 'Shortest random interval between blinks.',
    min: 0.4, max: 5, step: 0.1, digits: 1, unit: 's', section: 'blink',
  },
  {
    key: 'blinkMaxIntervalSeconds', label: 'Maximum blink gap', description: 'Longest random interval between blinks.',
    min: 0.6, max: 8, step: 0.1, digits: 1, unit: 's', section: 'blink',
  },
  {
    key: 'blinkRestingDroop', label: 'Resting upper-lid droop', description: 'Adds a softer resting upper lid.',
    min: 0, max: 0.6, step: 0.01, digits: 2, section: 'blink',
  },
  {
    key: 'eyeWidenDamping', label: 'Eye-widen damping', description: 'Reduces streamed lid-raise while blinking.',
    min: 0, max: 0.6, step: 0.01, digits: 2, section: 'blink',
  },
  {
    key: 'modelYawDegrees', label: 'Model yaw', description: 'Rotates the full character left or right.',
    min: -45, max: 45, step: 1, digits: 0, unit: '°', section: 'pose',
  },
  {
    key: 'modelPitchDegrees', label: 'Model pitch', description: 'Tilts the full character forward or back.',
    min: -15, max: 15, step: 1, digits: 0, unit: '°', section: 'pose',
  },
  {
    key: 'modelOffsetX', label: 'Model horizontal position', description: 'Moves the full character left or right.',
    min: -0.5, max: 0.5, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'modelOffsetY', label: 'Model vertical position', description: 'Moves the full character up or down.',
    min: -0.5, max: 0.5, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'modelOffsetZ', label: 'Model depth position', description: 'Moves the full character toward or away from camera.',
    min: -0.5, max: 0.5, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'modelScale', label: 'Model scale', description: 'Scales the framed character around its root.',
    min: 0.75, max: 1.25, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'headYawDegrees', label: 'Head yaw', description: 'Turns the head left or right from its stable base pose.',
    min: -20, max: 20, step: 1, digits: 0, unit: '°', section: 'pose',
  },
  {
    key: 'headPitchDegrees', label: 'Head pitch', description: 'Tilts the head up or down from its stable base pose.',
    min: -15, max: 15, step: 1, digits: 0, unit: '°', section: 'pose',
  },
  {
    key: 'eyeHorizontalL', label: 'Left eye horizontal offset', description: 'Negative looks left; positive looks right.',
    min: -0.4, max: 0.4, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'eyeHorizontalR', label: 'Right eye horizontal offset', description: 'Negative looks left; positive looks right.',
    min: -0.4, max: 0.4, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'eyeVerticalL', label: 'Left eye vertical offset', description: 'Negative looks down; positive looks up.',
    min: -0.4, max: 0.4, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'eyeVerticalR', label: 'Right eye vertical offset', description: 'Negative looks down; positive looks up.',
    min: -0.4, max: 0.4, step: 0.01, digits: 2, section: 'pose',
  },
  {
    key: 'portraitResolutionScale', label: 'Portrait resolution scale', description: 'Multiplies desktop render density before the adaptive native-DPR floor.',
    min: 0.65, max: 1.3, step: 0.05, digits: 2, section: 'render',
  },
  {
    key: 'aoQualityLevel', label: 'AO quality level', description: '0 off; 1 low, 2 medium, 3 high, 4 ultra.',
    min: 0, max: 4, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'aoIntensity', label: 'AO intensity', description: 'Controls contact-shadow strength without changing the supplied light rig.',
    min: 0, max: 5, step: 0.1, digits: 1, section: 'render',
  },
  {
    key: 'aoRadius', label: 'AO radius', description: 'World-space radius of ambient contact shadows.',
    min: 0.005, max: 0.08, step: 0.005, digits: 3, section: 'render',
  },
  {
    key: 'msaaQualityLevel', label: 'MSAA quality level', description: '0 disabled, 1 requests 2x, 2 requests 4x multisampling.',
    min: 0, max: 2, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'smaaQualityLevel', label: 'SMAA quality level', description: '0 low, 1 medium, 2 high, 3 ultra edge search.',
    min: 0, max: 3, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'hairAlphaCoverage', label: 'Hair alpha coverage', description: '1 smooths clipped hair cards through multisample coverage; 0 shows raw alpha test.',
    min: 0, max: 1, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'textureAnisotropy', label: 'Texture anisotropy', description: 'Sharpens hair, cloth and skin maps at oblique angles, capped by the GPU.',
    min: 1, max: 16, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'portraitCameraZoom', label: 'Portrait camera zoom', description: 'Tightens the crop without changing the authored FOV, light rig or model scale.',
    min: 1.1, max: 1.8, step: 0.05, digits: 2, section: 'render',
  },
  {
    key: 'toneMappingEnabled', label: 'Explicit ACES tone mapping', description: '1 applies ACES in the offscreen post chain; 0 shows the untone-mapped composer output.',
    min: 0, max: 1, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'portraitContrastPercent', label: 'Portrait contrast', description: 'Final presentation contrast; the artist export is 127 percent.',
    min: 90, max: 135, step: 1, digits: 0, unit: '%', section: 'render',
  },
  {
    key: 'environmentRoughnessFloor', label: 'IBL roughness floor', description: '0 keeps authored glossy reflections; 0.6 reproduces the prior custom blur interpretation.',
    min: 0, max: 0.8, step: 0.05, digits: 2, section: 'render',
  },
  {
    key: 'skinSssStrength', label: 'Skin SSS strength', description: '0 is stock PBR; 1.3 is the reconstructed Penner export strength.',
    min: 0, max: 2, step: 0.1, digits: 1, section: 'render',
  },
  {
    key: 'adaptiveQualityEnabled', label: 'Adaptive quality', description: '1 disables AO and reduces shadows first, then lowers DPR to its native floor; 0 locks comparison settings.',
    min: 0, max: 1, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'shadowQualityLevel', label: 'Shadow quality level', description: '0 off, 1 uses 1024px, 2 uses the offline-parity 2048px key shadow.',
    min: 0, max: 2, step: 1, digits: 0, section: 'render',
  },
  {
    key: 'studioBackdropStrength', label: 'Studio backdrop depth', description: 'Adds a subtle cool radial falloff without reverting to the artist demo black background.',
    min: 0, max: 1, step: 0.05, digits: 2, section: 'render',
  },
  {
    key: 'environmentIntensity', label: 'Environment intensity', description: '0.25 is the exact JSON export; 0.65 is the prose guide and stronger video-like IBL.',
    min: 0, max: 1, step: 0.05, digits: 2, section: 'render',
  },
]);

const CONTROL_BY_KEY = new Map(LIPSYNC_TUNING_CONTROLS.map((control) => [control.key, control]));
const listeners = new Set<() => void>();

function sameValues(left: LipsyncTuningValues, right: LipsyncTuningValues): boolean {
  return LIPSYNC_TUNING_CONTROLS.every(({ key }) => Math.abs(left[key] - right[key]) < 1e-6);
}

function deriveMode(values: LipsyncTuningValues): LipsyncTuningMode {
  if (sameValues(values, TUNED_LIPSYNC_VALUES)) return 'tuned';
  if (sameValues(values, PURE_NEUROSYNC_VALUES)) return 'pure';
  return 'custom';
}

function normalizedValue(key: LipsyncTuningKey, value: number): number {
  const control = CONTROL_BY_KEY.get(key);
  if (!control || !Number.isFinite(value)) return TUNED_LIPSYNC_VALUES[key];
  const clamped = Math.max(control.min, Math.min(control.max, value));
  const steps = Math.round((clamped - control.min) / control.step);
  return Number((control.min + steps * control.step).toFixed(control.digits));
}

function normalizeValues(candidate: Partial<Record<LipsyncTuningKey, unknown>>): LipsyncTuningValues {
  const values = { ...TUNED_LIPSYNC_VALUES } as Record<LipsyncTuningKey, number>;
  for (const { key } of LIPSYNC_TUNING_CONTROLS) {
    const value = candidate[key];
    values[key] = normalizedValue(key, typeof value === 'number' ? value : values[key]);
  }
  if (values.blinkMinIntervalSeconds > values.blinkMaxIntervalSeconds) {
    values.blinkMaxIntervalSeconds = values.blinkMinIntervalSeconds;
  }
  return Object.freeze(values) as LipsyncTuningValues;
}

function usedLegacyPureMouth(candidate: Partial<Record<LipsyncTuningKey, unknown>>): boolean {
  return candidate.mouthGain === 1
    && candidate.jawGain === 1
    && candidate.jawMax === 1
    && candidate.upperTeethTuck === 0
    && candidate.lowerTeethTuck === 0
    && candidate.smoothing === 0
    && candidate.emotionStrength === 0;
}

function readStoredSnapshot(): LipsyncTuningSnapshot {
  try {
    if (typeof localStorage === 'undefined') throw new Error('storage unavailable');
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('no stored tuning');
    const parsed = JSON.parse(raw) as {
      version?: number;
      values?: Partial<Record<LipsyncTuningKey, unknown>>;
    };
    const candidate = { ...(parsed.values ?? {}) };
    // Pose controls were global through v6, so changing Arjun in the developer
    // panel also rotated every other coach. Discard only those ambiguous shared
    // pose values during migration; face, blink and rendering choices survive.
    if ((parsed.version ?? 1) < 7) {
      const posePreset = usedLegacyPureMouth(candidate)
        ? PURE_NEUROSYNC_VALUES
        : TUNED_LIPSYNC_VALUES;
      for (const key of COACH_POSE_TUNING_KEYS) candidate[key] = posePreset[key];
    }
    // v4 had no symmetry/aperture/composition controls. Preserve raw mouth
    // semantics for both the exact old Pure preset and Pure plus unrelated
    // custom render/pose sliders instead of silently applying tuned shaping.
    if ((parsed.version ?? 1) < STORAGE_VERSION && usedLegacyPureMouth(candidate)) {
      candidate.mouthSymmetry ??= PURE_NEUROSYNC_VALUES.mouthSymmetry;
      candidate.lateralMouthGain ??= PURE_NEUROSYNC_VALUES.lateralMouthGain;
      candidate.upperLipRaiseGain ??= PURE_NEUROSYNC_VALUES.upperLipRaiseGain;
      candidate.lowerLipDepressGain ??= PURE_NEUROSYNC_VALUES.lowerLipDepressGain;
      candidate.mouthBaseAdditive ??= PURE_NEUROSYNC_VALUES.mouthBaseAdditive;
    }
    const values = normalizeValues(candidate);
    if ((parsed.version ?? 1) < STORAGE_VERSION) {
      if (sameValues(values, PRE_MOUTH_SYMMETRY_PURE_VALUES)) {
        return Object.freeze({ mode: 'pure', values: PURE_NEUROSYNC_VALUES });
      }
      if (sameValues(values, LEGACY_TUNED_LIPSYNC_VALUES)
        || sameValues(values, PRE_WIDE_CROP_TUNED_VALUES)
        || sameValues(values, PRE_MOUTH_RESTRAINT_TUNED_VALUES)
        || sameValues(values, PRE_MOUTH_FLEXIBILITY_TUNED_VALUES)) {
        return Object.freeze({ mode: 'tuned', values: TUNED_LIPSYNC_VALUES });
      }
    }
    return Object.freeze({ mode: deriveMode(values), values });
  } catch {
    return Object.freeze({ mode: 'tuned', values: TUNED_LIPSYNC_VALUES });
  }
}

let snapshot = readStoredSnapshot();

type CoachPoseOverrides = Record<string, Partial<Record<CoachPoseTuningKey, number>>>;
type RetiredCoachPoseDefaults = Record<
  string,
  Partial<Record<CoachPoseTuningKey, readonly number[]>>
>;

// Exact values that were previously shipped as coach defaults can be present
// in the per-coach developer store. Treat only those exact stale defaults as
// inherited values so a release calibration reaches returning browsers; any
// genuinely custom value remains authoritative.
const RETIRED_COACH_POSE_DEFAULTS: RetiredCoachPoseDefaults = Object.freeze({
  sofia: Object.freeze({ headYawDegrees: Object.freeze([3, 9]) }),
  magnus: Object.freeze({
    headYawDegrees: Object.freeze([5]),
    headPitchDegrees: Object.freeze([-2]),
  }),
  leila: Object.freeze({
    modelYawDegrees: Object.freeze([-11, 3]),
    headYawDegrees: Object.freeze([8, 1]),
    headPitchDegrees: Object.freeze([3]),
  }),
});

function readCoachPoseOverrides(): CoachPoseOverrides {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed = JSON.parse(localStorage.getItem(POSE_STORAGE_KEY) ?? '{}') as CoachPoseOverrides;
    const normalized: CoachPoseOverrides = {};
    for (const [coachId, values] of Object.entries(parsed)) {
      if (!values || typeof values !== 'object') continue;
      const coachValues: Partial<Record<CoachPoseTuningKey, number>> = {};
      for (const key of COACH_POSE_TUNING_KEYS) {
        const value = values[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          if (RETIRED_COACH_POSE_DEFAULTS[coachId]?.[key]?.includes(value)) continue;
          coachValues[key] = normalizedValue(key, value);
        }
      }
      if (Object.keys(coachValues).length) normalized[coachId] = coachValues;
    }
    return normalized;
  } catch {
    return {};
  }
}

let coachPoseOverrides = readCoachPoseOverrides();
const coachValuesCache = new Map<string, LipsyncTuningValues>();

function tunedCoachPose(coachId: string): Partial<Record<CoachPoseTuningKey, number>> {
  const coach = portraitPresentation.coaches[
    coachId as keyof typeof portraitPresentation.coaches
  ];
  return coach?.runtimePose ?? {};
}

function persistCoachPoseOverrides(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(POSE_STORAGE_KEY, JSON.stringify(coachPoseOverrides));
    }
  } catch {
    // In-memory coach isolation remains active when storage is blocked.
  }
}

function clearCoachPoseOverrides(): void {
  coachPoseOverrides = {};
  coachValuesCache.clear();
  persistCoachPoseOverrides();
}

function publish(values: LipsyncTuningValues): void {
  snapshot = Object.freeze({ mode: deriveMode(values), values });
  coachValuesCache.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, values }));
    }
  } catch {
    // In-memory settings remain usable when storage is blocked.
  }
  for (const listener of listeners) listener();
}

export function getLipsyncTuningSnapshot(): LipsyncTuningSnapshot {
  return snapshot;
}

export function getLipsyncTuningValuesForCoach(coachId: string): LipsyncTuningValues {
  const key = coachId.trim().toLowerCase();
  const cached = coachValuesCache.get(key);
  if (cached) return cached;
  const values = { ...snapshot.values } as Record<LipsyncTuningKey, number>;
  // Apply the measured player-facing pose only to untouched Chessbuddy-tuned
  // controls. Pure NeuroSync remains truly raw, global custom pose values are
  // respected, and the developer panel's per-coach overrides still win below.
  if (!usedLegacyPureMouth(values)) {
    for (const [poseKey, poseValue] of Object.entries(tunedCoachPose(key))) {
      const typedKey = poseKey as CoachPoseTuningKey;
      if (values[typedKey] === TUNED_LIPSYNC_VALUES[typedKey]) {
        values[typedKey] = poseValue;
      }
    }
  }
  Object.assign(values, coachPoseOverrides[key] ?? {});
  const resolved = Object.freeze(values) as LipsyncTuningValues;
  coachValuesCache.set(key, resolved);
  return resolved;
}

export function hasCoachPoseTuningOverrides(coachId: string): boolean {
  return Object.keys(coachPoseOverrides[coachId.trim().toLowerCase()] ?? {}).length > 0;
}

export function subscribeLipsyncTuning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLipsyncTuningMode(mode: 'tuned' | 'pure'): void {
  clearCoachPoseOverrides();
  publish(mode === 'tuned' ? TUNED_LIPSYNC_VALUES : PURE_NEUROSYNC_VALUES);
}

export function setLipsyncTuningValue(key: LipsyncTuningKey, value: number): void {
  const next = { ...snapshot.values, [key]: normalizedValue(key, value) };
  if (key === 'blinkMinIntervalSeconds' && next.blinkMinIntervalSeconds > next.blinkMaxIntervalSeconds) {
    next.blinkMaxIntervalSeconds = next.blinkMinIntervalSeconds;
  }
  if (key === 'blinkMaxIntervalSeconds' && next.blinkMaxIntervalSeconds < next.blinkMinIntervalSeconds) {
    next.blinkMinIntervalSeconds = next.blinkMaxIntervalSeconds;
  }
  publish(Object.freeze(next));
}

export function setLipsyncTuningValueForCoach(
  coachId: string,
  key: LipsyncTuningKey,
  value: number,
): void {
  if (!COACH_POSE_KEY_SET.has(key)) {
    setLipsyncTuningValue(key, value);
    return;
  }
  const id = coachId.trim().toLowerCase();
  if (!id) return;
  coachPoseOverrides = {
    ...coachPoseOverrides,
    [id]: {
      ...(coachPoseOverrides[id] ?? {}),
      [key]: normalizedValue(key, value),
    },
  };
  coachValuesCache.clear();
  persistCoachPoseOverrides();
  for (const listener of listeners) listener();
}

/** Test/QA helper; production callers should use the explicit mode controls. */
export function resetLipsyncTuning(): void {
  clearCoachPoseOverrides();
  publish(TUNED_LIPSYNC_VALUES);
}

export function formatLipsyncTuningValue(control: LipsyncTuningControl, value: number): string {
  return `${value.toFixed(control.digits)}${control.unit ?? ''}`;
}

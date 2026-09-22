import { CONVAI_MHA_CHANNEL_ORDER } from './convaiMhaLipsync';
import { coachAssetUrl } from './coachAssetPreload';

export type ArjunAttentionState = 'board' | 'user';
export type ArjunAnimationId =
  | 'boardIdle'
  | 'boardPostureShift'
  | 'boardHead'
  | 'boardNeck'
  | 'boardShoulder'
  | 'toUser'
  | 'userIdle'
  | 'userHead'
  | 'userLike'
  | 'userShoulder'
  | 'toBoard';

export type ArjunAnimationDefinition = Readonly<{
  id: ArjunAnimationId;
  bodyFile: string;
  faceFile: string;
  state: ArjunAttentionState;
  kind: 'idle' | 'gesture' | 'transition';
  loop: boolean;
  weight?: number;
}>;

const BASE_PATH = 'character-assets/chess-avatars-v2/arjun-chess-animations';

export const ARJUN_CHESS_ANIMATIONS: readonly ArjunAnimationDefinition[] = Object.freeze([
  { id: 'boardIdle', bodyFile: 'Anim_M01_BoardIdle.glb', faceFile: 'Anim_M01_Face_BoardIdle.json', state: 'board', kind: 'idle', loop: true },
  { id: 'boardPostureShift', bodyFile: 'Anim_M01_IdlePostureShift.glb', faceFile: 'Anim_M01_Face_BoardPostureShift.json', state: 'board', kind: 'gesture', loop: false, weight: 0 },
  { id: 'boardHead', bodyFile: 'Anim_M01_BoardHead.glb', faceFile: 'Anim_M01_Face_BoardHead.json', state: 'board', kind: 'gesture', loop: false, weight: 2 },
  { id: 'boardNeck', bodyFile: 'Anim_M01_BoardNeck.glb', faceFile: 'Anim_M01_Face_BoardNeck.json', state: 'board', kind: 'gesture', loop: false, weight: 2 },
  { id: 'boardShoulder', bodyFile: 'Anim_M01_BoardShoulder.glb', faceFile: 'Anim_M01_Face_BoardShoulder.json', state: 'board', kind: 'gesture', loop: false, weight: 2 },
  { id: 'toUser', bodyFile: 'Anim_M01_TransBoardToUser.glb', faceFile: 'Anim_M01_Face_TransBoardToUser.json', state: 'user', kind: 'transition', loop: false },
  { id: 'userIdle', bodyFile: 'Anim_M01_UserIdle.glb', faceFile: 'Anim_M01_Face_UserIdle.json', state: 'user', kind: 'idle', loop: true },
  { id: 'userHead', bodyFile: 'Anim_M01_UserHead.glb', faceFile: 'Anim_M01_Face_UserHead.json', state: 'user', kind: 'gesture', loop: false, weight: 1 },
  { id: 'userLike', bodyFile: 'Anim_M01_UserLike.glb', faceFile: 'Anim_M01_Face_UserLike.json', state: 'user', kind: 'gesture', loop: false, weight: 3 },
  { id: 'userShoulder', bodyFile: 'Anim_M01_UserShoulder.glb', faceFile: 'Anim_M01_Face_UserShoulder.json', state: 'user', kind: 'gesture', loop: false, weight: 3 },
  { id: 'toBoard', bodyFile: 'Anim_M01_TransUserToBoard.glb', faceFile: 'Anim_M01_Face_TransUserToBoard.json', state: 'board', kind: 'transition', loop: false },
]);

export const ARJUN_GESTURE_GAP_MIN_SECONDS = 10;
export const ARJUN_GESTURE_GAP_MAX_SECONDS = 18;

export type ArjunWinReactionSignals = Readonly<{
  playerWon: boolean;
  alreadyPlayed: boolean;
  stableState: ArjunAttentionState;
  currentKind: ArjunAnimationDefinition['kind'] | undefined;
  isSpeaking: boolean;
  responseThinking: boolean;
  userSpeaking: boolean;
  userEngaged: boolean;
}>;

/** Victory waits until Arjun is front-facing and the conversation is quiet. */
export function shouldPlayArjunWinReaction(signals: ArjunWinReactionSignals): boolean {
  return signals.playerWon
    && !signals.alreadyPlayed
    && signals.stableState === 'user'
    && signals.currentKind === 'idle'
    && !signals.isSpeaking
    && !signals.responseThinking
    && !signals.userSpeaking
    && !signals.userEngaged;
}

/** Exponential, frame-rate-independent handoff between authored and live face. */
export function stepArjunAuthoredFaceStrength(
  current: number,
  speaking: boolean,
  deltaSeconds: number,
): number {
  const target = speaking ? 0 : 1;
  const tau = speaking ? 0.12 : 0.18;
  const delta = Math.min(Math.max(deltaSeconds, 0), 0.1);
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}

export function arjunBodyUrl(definition: ArjunAnimationDefinition): string {
  return coachAssetUrl(`${BASE_PATH}/body/${definition.bodyFile}`);
}

export function arjunFaceUrl(definition: ArjunAnimationDefinition): string {
  return coachAssetUrl(`${BASE_PATH}/face/${definition.faceFile}`);
}

export function selectWeightedArjunAmbientGesture(
  randomValue: number,
): ArjunAnimationDefinition {
  const candidates = ARJUN_CHESS_ANIMATIONS.filter(
    (definition) => definition.kind === 'gesture'
      && definition.state === 'user'
      && definition.id !== 'userLike'
      && (definition.weight ?? 1) > 0,
  );
  const total = candidates.reduce((sum, definition) => sum + (definition.weight ?? 1), 0);
  let cursor = Math.min(Math.max(randomValue, 0), 0.999999) * total;
  for (const definition of candidates) {
    cursor -= definition.weight ?? 1;
    if (cursor < 0) return definition;
  }
  return candidates[candidates.length - 1];
}

export type ArjunFaceClip = Readonly<{
  fps: number;
  frameCount: number;
  duration: number;
  data: Float32Array;
}>;

type RawArjunFaceClip = {
  fps?: unknown;
  frameCount?: unknown;
  targetCount?: unknown;
  curves?: unknown;
};

export function parseArjunFaceClip(raw: RawArjunFaceClip): ArjunFaceClip {
  const fps = Number(raw.fps);
  const frameCount = Number(raw.frameCount);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('Authored face clip has an invalid fps');
  if (!Number.isInteger(frameCount) || frameCount <= 1) throw new Error('Authored face clip has an invalid frame count');
  if (!raw.curves || typeof raw.curves !== 'object' || Array.isArray(raw.curves)) {
    throw new Error('Authored face clip is missing its named curve map');
  }
  const curves = raw.curves as Record<string, unknown>;
  const names = Object.keys(curves);
  const expected = new Set<string>(CONVAI_MHA_CHANNEL_ORDER);
  const missing = CONVAI_MHA_CHANNEL_ORDER.filter(
    (name) => !Object.prototype.hasOwnProperty.call(curves, name),
  );
  const extra = names.filter((name) => !expected.has(name));
  if (names.length !== CONVAI_MHA_CHANNEL_ORDER.length || missing.length || extra.length) {
    throw new Error(`Authored face clip channel mismatch: missing=${missing.length}, extra=${extra.length}`);
  }

  const width = CONVAI_MHA_CHANNEL_ORDER.length;
  const data = new Float32Array(frameCount * width);
  for (let channel = 0; channel < width; channel += 1) {
    const name = CONVAI_MHA_CHANNEL_ORDER[channel];
    const values = curves[name];
    if (!Array.isArray(values) || values.length !== frameCount) {
      throw new Error(`Authored face curve ${name} has ${Array.isArray(values) ? values.length : 0}/${frameCount} frames`);
    }
    // The authored face export carries a rig-calibration mouth baseline (for
    // example jawOpen ~= 0.14 even in a visibly closed idle). Chessbuddy's V2
    // model uses zero as its neutral influence, so rebase only the oral family
    // to frame zero. This preserves relative smiles/presses while preventing a
    // silent tooth row, and live Convai owns all channels during speech anyway.
    const oralBaseline = isArjunSpeechChannel(name) ? Number(values[0]) : 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const value = Number(values[frame]);
      if (!Number.isFinite(value)) throw new Error(`Authored face curve ${name} contains a non-finite value`);
      data[frame * width + channel] = Math.min(1, Math.max(0, value - oralBaseline));
    }
  }
  return { fps, frameCount, duration: (frameCount - 1) / fps, data };
}

export function sampleArjunFaceClip(
  clip: ArjunFaceClip,
  timeSeconds: number,
  output: Float32Array,
): Float32Array {
  const width = CONVAI_MHA_CHANNEL_ORDER.length;
  if (output.length !== width) throw new Error(`Authored face output must contain ${width} channels`);
  const frame = Math.min(Math.max(timeSeconds * clip.fps, 0), clip.frameCount - 1);
  const first = Math.floor(frame);
  const second = Math.min(clip.frameCount - 1, first + 1);
  const alpha = frame - first;
  for (let channel = 0; channel < width; channel += 1) {
    const a = clip.data[first * width + channel];
    output[channel] = a + (clip.data[second * width + channel] - a) * alpha;
  }
  return output;
}

export function isArjunSpeechChannel(name: string): boolean {
  return /mouth|jaw|tongue|teeth/i.test(name);
}

const DIRECTIONAL_EYE_CHANNELS = Object.freeze(
  CONVAI_MHA_CHANNEL_ORDER.flatMap((name, index) => (
    /eyeLook(?:Left|Right|Up|Down)[LR]$/i.test(name) ? [index] : []
  )),
);
const BLINK_CHANNELS = Object.freeze([
  CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkL'),
  CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkR'),
].filter((index) => index >= 0));
const ARJUN_PLAYER_EYE_CENTER_CHANNELS = new Set([
  CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeLookLeftL'),
  CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeLookLeftR'),
]);
const ARJUN_PLAYER_EYE_CENTER_BIAS = 0.25;

/**
 * Scale only authored directional gaze. This deliberately leaves blinks,
 * squints, lid shape, cheeks, brows, and every non-eye channel untouched.
 * A gain of zero restores neutral eye direction between speech turns; live
 * MHA lip-sync can still take ownership later in the render frame.
 */
export function scaleAuthoredDirectionalEyeLook(
  clip: ArjunFaceClip,
  gain: number,
): ArjunFaceClip {
  const safeGain = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
  const data = clip.data.slice();
  const width = CONVAI_MHA_CHANNEL_ORDER.length;
  for (let frame = 0; frame < clip.frameCount; frame += 1) {
    const frameOffset = frame * width;
    for (const channel of DIRECTIONAL_EYE_CHANNELS) {
      data[frameOffset + channel] *= safeGain;
    }
  }
  return { ...clip, data };
}

/**
 * Scale the authored direct blink drivers without touching lids, squints, or
 * any other facial expression. Sofia uses zero because her supplied clips peak
 * at a visibly incomplete closure; the full procedural blink owns these two
 * channels between speech frames instead.
 */
export function scaleAuthoredBlink(
  clip: ArjunFaceClip,
  gain: number,
): ArjunFaceClip {
  const safeGain = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0));
  const data = clip.data.slice();
  const width = CONVAI_MHA_CHANNEL_ORDER.length;
  for (let frame = 0; frame < clip.frameCount; frame += 1) {
    const frameOffset = frame * width;
    for (const channel of BLINK_CHANNELS) data[frameOffset + channel] *= safeGain;
  }
  return { ...clip, data };
}

/**
 * Keep the supplied long UserIdle performance, but reduce its large deliberate
 * side glances to subtle eye life. Blinks, lids, brows, smiles, and every body
 * track remain authored; live MHA-251 frames take over unchanged during speech.
 */
export function dampenArjunPlayerFacingEyeLook(
  clip: ArjunFaceClip,
  gain = 0.05,
): ArjunFaceClip {
  const safeGain = Math.min(1, Math.max(0, Number.isFinite(gain) ? gain : 0.05));
  const data = clip.data.slice();
  const width = CONVAI_MHA_CHANNEL_ORDER.length;
  for (let frame = 0; frame < clip.frameCount; frame += 1) {
    const frameOffset = frame * width;
    for (const channel of DIRECTIONAL_EYE_CHANNELS) {
      data[frameOffset + channel] = Math.min(
        1,
        data[frameOffset + channel] * safeGain
          + (ARJUN_PLAYER_EYE_CENTER_CHANNELS.has(channel) ? ARJUN_PLAYER_EYE_CENTER_BIAS : 0),
      );
    }
  }
  return { ...clip, data };
}

const ARJUN_LIGHT_SMILE_PAIRS = Object.freeze([
  ['CTRL_expressions_mouthCornerPullL', 'CTRL_expressions_mouthCornerPullR', 0.10, 0.14],
  ['CTRL_expressions_mouthDimpleL', 'CTRL_expressions_mouthDimpleR', 0.06, 0.10],
  ['CTRL_expressions_mouthCornerUpL', 'CTRL_expressions_mouthCornerUpR', 0.025, 0.045],
  ['CTRL_expressions_mouthSharpCornerPullL', 'CTRL_expressions_mouthSharpCornerPullR', 0.025, 0.06],
  ['CTRL_expressions_eyeCheekRaiseL', 'CTRL_expressions_eyeCheekRaiseR', 0.10, 0.14],
  ['CTRL_expressions_eyeSquintInnerL', 'CTRL_expressions_eyeSquintInnerR', 0.025, 0.05],
] as const);

/** Derive a restrained, symmetric player-facing smile from the supplied UserLike performance. */
export function createArjunLightSmile(
  userLikeClip: ArjunFaceClip,
  strength = 0.35,
): Float32Array {
  const output = new Float32Array(CONVAI_MHA_CHANNEL_ORDER.length);
  const sample = new Float32Array(CONVAI_MHA_CHANNEL_ORDER.length);
  sampleArjunFaceClip(userLikeClip, userLikeClip.duration * 0.5, sample);
  for (const [leftName, rightName, minimum, maximum] of ARJUN_LIGHT_SMILE_PAIRS) {
    const left = CONVAI_MHA_CHANNEL_ORDER.indexOf(leftName);
    const right = CONVAI_MHA_CHANNEL_ORDER.indexOf(rightName);
    if (left < 0 || right < 0) continue;
    const leftDelta = Math.max(0, sample[left] - userLikeClip.data[left]);
    const rightDelta = Math.max(0, sample[right] - userLikeClip.data[right]);
    const authoredSignal = Math.max(leftDelta, rightDelta);
    if (authoredSignal <= 0.001) continue;
    // The supplied UserLike take is strongly one-sided. Mirror its stronger
    // signal rather than averaging the weak side down, then use restrained
    // floors/caps so cheeks and inner-eye squint support the mouth naturally.
    const symmetric = Math.min(
      maximum,
      Math.max(minimum, authoredSignal * Math.max(0, strength)),
    );
    output[left] = symmetric;
    output[right] = symmetric;
  }
  return output;
}

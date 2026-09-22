import type { BuiltinCoachId } from './coachConfig';
import { coachAssetUrl } from './coachAssetPreload';
import {
  ARJUN_CHESS_ANIMATIONS,
  type ArjunAnimationDefinition,
} from './arjunChessAnimations';

export type CoachAttentionState = 'board' | 'user';
export type CoachPerformanceAnimationDefinition = Readonly<{
  id: string;
  bodyFile: string;
  faceFile: string;
  state: CoachAttentionState;
  kind: 'idle' | 'gesture' | 'transition';
  loop: boolean;
  weight?: number;
}>;

export type CoachPerformanceManifest = Readonly<{
  coachId: BuiltinCoachId;
  basePath: string;
  animations: readonly CoachPerformanceAnimationDefinition[];
  boardIdleId: string;
  userIdleId: string;
  toBoardId: string;
  toUserId: string;
  victoryGestureId?: string;
  smileSourceId?: string;
  /** Supplied user-state clips that visibly rotate away from the player. */
  disabledRuntimeIds?: readonly string[];
  /** Only Arjun's supplied long idle needs its deliberate side glances reduced. */
  playerFacingEyeGain?: number;
  /** Optional gain for directional eye curves in every authored face clip. */
  authoredEyeLookGain?: number;
  /** Per-animation override for a supplied clip whose gaze is unsafe on its rig. */
  authoredEyeLookGainById?: Readonly<Record<string, number>>;
  /** Optional gain for direct blink curves in every authored face clip. */
  authoredBlinkGain?: number;
  /** Keep central body/head tracks at bind pose while retaining limb gestures. */
  lockPlayerFacingBody?: boolean;
  headRollDegrees?: number;
}>;

const animation = (
  id: string,
  bodyFile: string,
  faceFile: string,
  state: CoachAttentionState,
  kind: CoachPerformanceAnimationDefinition['kind'],
  loop: boolean,
  weight?: number,
): CoachPerformanceAnimationDefinition => ({ id, bodyFile, faceFile, state, kind, loop, weight });

const arjunManifest: CoachPerformanceManifest = {
  coachId: 'arjun',
  basePath: 'character-assets/chess-avatars-v2/arjun-chess-animations',
  animations: ARJUN_CHESS_ANIMATIONS as readonly ArjunAnimationDefinition[],
  boardIdleId: 'boardIdle',
  userIdleId: 'userIdle',
  toBoardId: 'toBoard',
  toUserId: 'toUser',
  victoryGestureId: 'userLike',
  smileSourceId: 'userLike',
  playerFacingEyeGain: 0.05,
  headRollDegrees: -1.5,
};

const sofiaManifest: CoachPerformanceManifest = {
  coachId: 'sofia',
  basePath: 'character-assets/chess-avatars-v2/sofia-chess-animations',
  animations: Object.freeze([
    animation('boardIdle', 'Anim_F02_BoardIdle.glb', 'Anim_F02_Face_BoardIdle.json', 'board', 'idle', true),
    animation('boardArm', 'Anim_F02_BoardArm.glb', 'Anim_F02_Face_BoardArm.json', 'board', 'gesture', false, 2),
    animation('boardShoulder', 'Anim_F02_BoardShoulder.glb', 'Anim_F02_Face_BoardShoulder.json', 'board', 'gesture', false, 2),
    animation('boardThink', 'Anim_F02_BoardThink.glb', 'Anim_F02_Face_BoardThink.json', 'board', 'gesture', false, 3),
    animation('postureShift', 'Anim_F02_IdlePostureShift.glb', 'Anim_F02_Face_IdlePostureShift.json', 'user', 'gesture', false, 2),
    animation('toUser', 'Anim_F02_TransBoardToUser.glb', 'Anim_F02_Face_TransBoardToUser.json', 'user', 'transition', false),
    animation('toBoard', 'Anim_F02_TransUserToBoard.glb', 'Anim_F02_Face_TransUserToBoard.json', 'board', 'transition', false),
    animation('userIdle', 'Anim_F02_UserIdle.glb', 'Anim_F02_Face_UserIdle.json', 'user', 'idle', true),
    animation('userArm', 'Anim_F02_UserArm.glb', 'Anim_F02_Face_UserArm.json', 'user', 'gesture', false, 2),
    animation('userNails', 'Anim_F02_UserNails.glb', 'Anim_F02_Face_UserNails.json', 'user', 'gesture', false, 1),
  ]),
  boardIdleId: 'boardIdle',
  userIdleId: 'userIdle',
  toBoardId: 'toBoard',
  toUserId: 'toUser',
  disabledRuntimeIds: Object.freeze(['postureShift']),
  authoredEyeLookGain: 0,
  authoredBlinkGain: 0,
};

const leilaManifest: CoachPerformanceManifest = {
  coachId: 'leila',
  basePath: 'character-assets/chess-avatars-v2/leila-chess-animations',
  animations: Object.freeze([
    animation('boardIdle', 'Anim_F01_BoardIdle.glb', 'Anim_F01_Face_BoardIdle.json', 'board', 'idle', true),
    animation('boardHead', 'Anim_F01_BoardHead.glb', 'Anim_F01_Face_BoardHead.json', 'board', 'gesture', false, 2),
    animation('boardShoulder', 'Anim_F01_BoardShoulder.glb', 'Anim_F01_Face_BoardShoulder.json', 'board', 'gesture', false, 2),
    animation('postureShift', 'Anim_F01_IdlePostureShift.glb', 'Anim_F01_Face_IdlePostureShift.json', 'user', 'gesture', false, 2),
    animation('toUser', 'Anim_F01_TransBoardToUser.glb', 'Anim_F01_Face_TransBoardToUser.json', 'user', 'transition', false),
    animation('toBoard', 'Anim_F01_TransUserToBoard.glb', 'Anim_F01_Face_TransUserToBoard.json', 'board', 'transition', false),
    animation('userIdle', 'Anim_F01_UserIdle.glb', 'Anim_F01_Face_UserIdle.json', 'user', 'idle', true),
    animation('userHead', 'Anim_F01_UserHead.glb', 'Anim_F01_Face_UserHead.json', 'user', 'gesture', false, 2),
    animation('userShoulder', 'Anim_F01_UserShoulder.glb', 'Anim_F01_Face_UserShoulder.json', 'user', 'gesture', false, 2),
    animation('userThink', 'Anim_F01_UserThink.glb', 'Anim_F01_Face_UserThink01.json', 'user', 'gesture', false, 3),
  ]),
  boardIdleId: 'boardIdle',
  userIdleId: 'userIdle',
  toBoardId: 'toBoard',
  toUserId: 'toUser',
  disabledRuntimeIds: Object.freeze(['postureShift']),
  authoredEyeLookGain: 0,
};

const magnusManifest: CoachPerformanceManifest = {
  coachId: 'magnus',
  basePath: 'character-assets/chess-avatars-v2/magnus-chess-animations',
  animations: Object.freeze([
    animation('boardIdle', 'Anim_M02_BoardIdle.glb', 'Anim_M02_Face_BoardIdle.json', 'board', 'idle', true),
    animation('boardNeck', 'Anim_M02_BoardNeck.glb', 'Anim_M02_Face_BoardNeck.json', 'board', 'gesture', false, 2),
    animation('boardThink01', 'Anim_M02_BoardThink01.glb', 'Anim_M02_Face_BoardThink01.json', 'board', 'gesture', false, 3),
    animation('boardThink02', 'Anim_M02_BoardThink02.glb', 'Anim_M02_Face_BoardThink02.json', 'board', 'gesture', false, 3),
    animation('postureShift', 'Anim_M02_IdlePostureShift.glb', 'Anim_M02_Face_BoardPostureShift.json', 'user', 'gesture', false, 2),
    animation('toUser', 'Anim_M02_TransBoardToUser.glb', 'Anim_M02_Face_TransBoardToUser.json', 'user', 'transition', false),
    animation('toBoard', 'Anim_M02_TransUserToBoard.glb', 'Anim_M02_Face_TransUserToBoard.json', 'board', 'transition', false),
    animation('userIdle', 'Anim_M02_UserIdle.glb', 'Anim_M02_Face_UserIdle.json', 'user', 'idle', true),
    animation('userThink01', 'Anim_M02_UserThink01.glb', 'Anim_M02_Face_UserThink01.json', 'user', 'gesture', false, 3),
    animation('userThink02', 'Anim_M02_UserThink02.glb', 'Anim_M02_Face_UserThink02.json', 'user', 'gesture', false, 2),
    animation('userThink03', 'Anim_M02_UserThink03.glb', 'Anim_M02_Face_UserThink03.json', 'user', 'gesture', false, 2),
  ]),
  boardIdleId: 'boardIdle',
  userIdleId: 'userIdle',
  toBoardId: 'toBoard',
  toUserId: 'toUser',
  authoredEyeLookGain: 0,
  authoredBlinkGain: 0,
  lockPlayerFacingBody: true,
};

export const BUILTIN_COACH_PERFORMANCE_MANIFESTS: Readonly<Record<BuiltinCoachId, CoachPerformanceManifest>> = Object.freeze({
  magnus: magnusManifest,
  sofia: sofiaManifest,
  arjun: arjunManifest,
  leila: leilaManifest,
});

export function getCoachPerformanceManifest(coachId: string): CoachPerformanceManifest | null {
  return Object.prototype.hasOwnProperty.call(BUILTIN_COACH_PERFORMANCE_MANIFESTS, coachId)
    ? BUILTIN_COACH_PERFORMANCE_MANIFESTS[coachId as BuiltinCoachId]
    : null;
}

export function getAuthoredEyeLookGain(
  manifest: CoachPerformanceManifest,
  animationId: string,
): number | undefined {
  return manifest.authoredEyeLookGainById?.[animationId] ?? manifest.authoredEyeLookGain;
}

/**
 * Runtime-safe subset of the supplied package. Board-facing clips remain in
 * the manifest for provenance/asset validation, but Chessbuddy never loads or
 * schedules them: every live coach presentation stays oriented to the player.
 */
export function getPlayerFacingPerformanceAnimations(
  manifest: CoachPerformanceManifest,
): readonly CoachPerformanceAnimationDefinition[] {
  return manifest.animations.filter(
    (definition) => definition.state === 'user'
      && definition.kind !== 'transition'
      && !manifest.disabledRuntimeIds?.includes(definition.id),
  );
}

export function coachPerformanceBodyUrl(
  manifest: CoachPerformanceManifest,
  definition: CoachPerformanceAnimationDefinition,
): string {
  return coachAssetUrl(`${manifest.basePath}/body/${definition.bodyFile}`);
}

export function coachPerformanceFaceUrl(
  manifest: CoachPerformanceManifest,
  definition: CoachPerformanceAnimationDefinition,
): string {
  return coachAssetUrl(`${manifest.basePath}/face/${definition.faceFile}`);
}

export function validateCoachPerformanceManifest(manifest: CoachPerformanceManifest): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const definition of manifest.animations) {
    if (ids.has(definition.id)) errors.push(`duplicate id ${definition.id}`);
    ids.add(definition.id);
    if (!definition.bodyFile.endsWith('.glb')) errors.push(`${definition.id} body is not GLB`);
    if (!definition.faceFile.endsWith('.json')) errors.push(`${definition.id} face is not JSON`);
  }
  const required: Array<[string, string, CoachAttentionState, CoachPerformanceAnimationDefinition['kind']]> = [
    ['userIdleId', manifest.userIdleId, 'user', 'idle'],
    ['boardIdleId', manifest.boardIdleId, 'board', 'idle'],
    ['toUserId', manifest.toUserId, 'user', 'transition'],
    ['toBoardId', manifest.toBoardId, 'board', 'transition'],
  ];
  for (const [field, id, state, kind] of required) {
    const definition = manifest.animations.find((candidate) => candidate.id === id);
    if (!definition) errors.push(`missing ${field} ${id}`);
    else if (definition.state !== state || definition.kind !== kind) {
      errors.push(`${field} ${id} must be ${state} ${kind}`);
    }
  }
  return errors;
}

export function selectWeightedCoachGesture(
  manifest: CoachPerformanceManifest,
  state: CoachAttentionState,
  randomValue: number,
): CoachPerformanceAnimationDefinition | null {
  const candidates = manifest.animations.filter(
    (definition) => definition.kind === 'gesture'
      && definition.state === state
      && definition.id !== manifest.victoryGestureId
      && !manifest.disabledRuntimeIds?.includes(definition.id)
      && (definition.weight ?? 1) > 0,
  );
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, definition) => sum + (definition.weight ?? 1), 0);
  let cursor = Math.min(Math.max(randomValue, 0), 0.999999) * total;
  for (const definition of candidates) {
    cursor -= definition.weight ?? 1;
    if (cursor < 0) return definition;
  }
  return candidates[candidates.length - 1];
}

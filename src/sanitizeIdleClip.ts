import * as THREE from 'three';
import { debugLog } from './debugLog';

const EYE_BONE = /^CC_Base_(L_|R_)Eye$/i;
/**
 * Jaw/teeth/tongue tracks are REMOVED (not locked): the bones must sit at bind
 * pose so the MHA jaw-bone open (mhaJawBones.ts) applies its tuned deltas from
 * rest — matching the neurosync example (Sofia.tsx strips JawRoot|Teeth0|Tongue0).
 * Locking to the clip's frame-0 pose left the mixer writing a jaw/teeth pose
 * that differs from bind, shifting the teeth out of their tuned placement.
 */
const STRIP_ORAL_BONE = /JawRoot|Teeth0|Tongue0/i;
/**
 * V2 animation exports contain static scene-root TRS tracks. In the female
 * file the root scale is 0.01: it binds to Sofia's `root` but not Leila's
 * `root.001`, producing a 100x inconsistency when the required 0.01 outer
 * wrapper is also applied. Scene scale belongs exclusively to that wrapper.
 */
const STRIP_SCENE_ROOT = /^(root|root\.001)$/i;
/**
 * The shared male idle opens in a permanent three-quarter stance. The portrait
 * camera is head-on, so Tyler (Arjun) and Vincent (Magnus) keep the model's
 * frontal bind pose for the central body chain while retaining authored arm,
 * hand, cloth and secondary motion.
 */
const FRONTAL_BIND_POSE_ASSET = /^(Tyler|Vincent)$/i;
const FRONTAL_BIND_POSITION_BONE = /^(CC_Base_BoneRoot|CC_Base_Hip|CC_Base_Pelvis|root|pelvis)$/i;
const FRONTAL_BIND_ROTATION_BONE = /^(CC_Base_Head|CC_Base_(Spine\d*|Waist|Pelvis)|head|neck_0\d|spine_0\d|pelvis)$/i;
/**
 * Leila's idle contains sub-threshold motion on every central-chain link. Each
 * individual rotation looks harmless, but the accumulated head transform moves
 * her fully head-weighted hair mesh by visible pixels in the tight portrait.
 * Preserve her authored frame-0 stance while making that central anchor rigid.
 */
const STABLE_HEAD_ANCHOR_ASSET = /^Leila$/i;
const STABLE_HEAD_ANCHOR_BONE = /^(CC_Base_BoneRoot|CC_Base_Hip|CC_Base_Pelvis|CC_Base_Head|CC_Base_(Spine\d*|Waist)|root|pelvis|spine_0\d|neck_0\d|head)$/i;
/**
 * Portrait idle sways on hip/pelvis translation and spine/waist rotation — lock
 * for stable framing. CC4 rigs use CC_Base_*; the MetaHuman rig (Sofia) uses the
 * UE bone names (root/pelvis translation, head/neck_0x/spine_0x rotation).
 */
const LOCK_POSITION_BONE = /^(CC_Base_BoneRoot|CC_Base_Hip|CC_Base_Pelvis|CC_Base_UpperJaw|root|pelvis)$/i;
const LOCK_ROTATION_BONE = /^(CC_Base_Head|CC_Base_(Spine\d*|Waist|Pelvis|UpperJaw)|head|neck_0\d|spine_0\d|pelvis)$/i;
const LOCK_SCALE_BONE = /^(CC_Base_UpperJaw)$/i;
const POSITION_LOCK_MIN_DELTA = 0.01;
const ROTATION_LOCK_MIN_DELTA = 0.01;

/** Only strip eye slides when the track actually moves (avoids touching static exports). */
const EYE_TRANSLATION_MIN_DELTA = 0.01;

function splitTrackName(name: string): { nodeName: string; property: string } {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return { nodeName: name, property: '' };
  return { nodeName: name.slice(0, dot), property: name.slice(dot + 1) };
}

function trackAxisRange(values: ArrayLike<number>, stride: number, axis: number): number {
  const count = values.length / stride;
  if (!count) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const value = values[i * stride + axis];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return max - min;
}

function trackMaxDelta(values: ArrayLike<number>, stride: number): number {
  let max = 0;
  for (let axis = 0; axis < stride; axis++) {
    max = Math.max(max, trackAxisRange(values, stride, axis));
  }
  return max;
}

function freezeQuaternionToFirstFrame(track: THREE.QuaternionKeyframeTrack): THREE.QuaternionKeyframeTrack {
  const values = track.values.slice();
  const q0 = [values[0], values[1], values[2], values[3]];
  for (let i = 1; i < track.times.length; i++) {
    values[i * 4] = q0[0];
    values[i * 4 + 1] = q0[1];
    values[i * 4 + 2] = q0[2];
    values[i * 4 + 3] = q0[3];
  }
  return new THREE.QuaternionKeyframeTrack(track.name, track.times.slice(), values);
}

function freezeVectorToFirstFrame(track: THREE.VectorKeyframeTrack, stride: number): THREE.VectorKeyframeTrack {
  const values = track.values.slice();
  const first = values.slice(0, stride);
  for (let i = 1; i < track.times.length; i++) {
    for (let j = 0; j < stride; j++) values[i * stride + j] = first[j];
  }
  return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values);
}

function shouldRemoveEyeTranslation(track: THREE.VectorKeyframeTrack): boolean {
  return trackMaxDelta(track.values, 3) >= EYE_TRANSLATION_MIN_DELTA;
}

function shouldLockPositionTrack(track: THREE.VectorKeyframeTrack): boolean {
  return trackMaxDelta(track.values, 3) >= POSITION_LOCK_MIN_DELTA;
}

function shouldLockRotationTrack(track: THREE.VectorKeyframeTrack): boolean {
  return trackMaxDelta(track.values, 3) >= ROTATION_LOCK_MIN_DELTA;
}

function shouldLockQuaternionTrack(track: THREE.QuaternionKeyframeTrack): boolean {
  const values = track.values;
  if (values.length < 8) return false;
  const q0 = [values[0], values[1], values[2], values[3]];
  for (let i = 1; i < track.times.length; i++) {
    const dx = Math.abs(values[i * 4] - q0[0]);
    const dy = Math.abs(values[i * 4 + 1] - q0[1]);
    const dz = Math.abs(values[i * 4 + 2] - q0[2]);
    const dw = Math.abs(values[i * 4 + 3] - q0[3]);
    if (Math.max(dx, dy, dz, dw) >= ROTATION_LOCK_MIN_DELTA) return true;
  }
  return false;
}

/**
 * Portrait-safe idle cleanup for all bundled coach animation GLBs.
 * Locks hip/pelvis translation, spine/waist rotation, and jaw/oral bones so nostrils stay stable.
 */
export function sanitizePortraitIdleClip(clip: THREE.AnimationClip, assetName?: string): THREE.AnimationClip {
  const removed: string[] = [];
  const modified: string[] = [];
  const useFrontalBindPose = getPortraitBodyPoseSource(assetName) === 'frontal-bind';
  const useStableHeadAnchor = STABLE_HEAD_ANCHOR_ASSET.test(assetName ?? '');

  const tracks = clip.tracks.flatMap((track) => {
    const { nodeName, property } = splitTrackName(track.name);

    if (STRIP_ORAL_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property}`);
      return [];
    }

    if (STRIP_SCENE_ROOT.test(nodeName)
      && (property === 'position' || property === 'quaternion' || property === 'rotation' || property === 'scale')) {
      removed.push(`${nodeName}.${property}`);
      return [];
    }

    if (useFrontalBindPose
      && property === 'position'
      && FRONTAL_BIND_POSITION_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property} (frontal bind pose)`);
      return [];
    }

    if (useFrontalBindPose
      && (property === 'quaternion' || property === 'rotation')
      && FRONTAL_BIND_ROTATION_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property} (frontal bind pose)`);
      return [];
    }

    if (useStableHeadAnchor
      && STABLE_HEAD_ANCHOR_BONE.test(nodeName)
      && property === 'position'
      && track instanceof THREE.VectorKeyframeTrack) {
      modified.push(`${nodeName}.position (Leila stable head anchor)`);
      return [freezeVectorToFirstFrame(track, 3)];
    }

    if (useStableHeadAnchor
      && STABLE_HEAD_ANCHOR_BONE.test(nodeName)
      && property === 'quaternion'
      && track instanceof THREE.QuaternionKeyframeTrack) {
      modified.push(`${nodeName}.quaternion (Leila stable head anchor)`);
      return [freezeQuaternionToFirstFrame(track)];
    }

    if (useStableHeadAnchor
      && STABLE_HEAD_ANCHOR_BONE.test(nodeName)
      && property === 'rotation'
      && track instanceof THREE.VectorKeyframeTrack) {
      modified.push(`${nodeName}.rotation (Leila stable head anchor)`);
      return [freezeVectorToFirstFrame(track, 3)];
    }

    if (property === 'position' && track instanceof THREE.VectorKeyframeTrack) {
      if (EYE_BONE.test(nodeName)) {
        if (!shouldRemoveEyeTranslation(track)) return [track];
        removed.push(`${nodeName}.position`);
        return [];
      }

      if (LOCK_POSITION_BONE.test(nodeName)) {
        if (!shouldLockPositionTrack(track)) return [track];
        const delta = trackMaxDelta(track.values, 3);
        modified.push(`${nodeName}.position (locked to frame 0, Δ=${delta.toFixed(2)})`);
        return [freezeVectorToFirstFrame(track, 3)];
      }

      return [track];
    }

    if (LOCK_ROTATION_BONE.test(nodeName) && property === 'quaternion' && track instanceof THREE.QuaternionKeyframeTrack) {
      if (!shouldLockQuaternionTrack(track)) return [track];
      modified.push(`${nodeName}.quaternion (locked to frame 0)`);
      return [freezeQuaternionToFirstFrame(track)];
    }

    if (LOCK_ROTATION_BONE.test(nodeName) && property === 'rotation' && track instanceof THREE.VectorKeyframeTrack) {
      if (!shouldLockRotationTrack(track)) return [track];
      modified.push(`${nodeName}.rotation (locked to frame 0)`);
      return [freezeVectorToFirstFrame(track, 3)];
    }

    if (LOCK_SCALE_BONE.test(nodeName) && property === 'scale' && track instanceof THREE.VectorKeyframeTrack) {
      if (!shouldLockRotationTrack(track)) return [track];
      modified.push(`${nodeName}.scale (locked to frame 0)`);
      return [freezeVectorToFirstFrame(track, 3)];
    }

    return [track];
  });

  if (removed.length || modified.length) {
    const label = assetName ? `${clip.name} [${assetName}]` : clip.name;
    debugLog(
      'ReallusionCharacter',
      `Sanitized idle ${label} — modified: ${modified.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}`,
    );
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function trackHasNonFinite(values: ArrayLike<number>): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return true;
  }
  return false;
}

export type AuthoredPerformanceSanitizeOptions = Readonly<{
  lockPlayerFacingBody?: boolean;
}>;

/**
 * Safety cleanup for authored chess performances. Central body movement is
 * preserved by default, but a coach can opt into the frontal bind pose when
 * its supplied user-facing clips turn away from the portrait camera.
 */
export function sanitizeAuthoredPerformanceClip(
  clip: THREE.AnimationClip,
  name: string,
  targetRoot?: THREE.Object3D,
  options: AuthoredPerformanceSanitizeOptions = {},
): THREE.AnimationClip {
  const removed: string[] = [];
  const tracks = clip.tracks.flatMap((track) => {
    const { nodeName, property } = splitTrackName(track.name);
    if (trackHasNonFinite(track.values)) {
      removed.push(`${nodeName}.${property} (non-finite)`);
      return [];
    }
    if (STRIP_ORAL_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property}`);
      return [];
    }
    if (options.lockPlayerFacingBody
      && property === 'position'
      && FRONTAL_BIND_POSITION_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property} (player-facing bind pose)`);
      return [];
    }
    if (options.lockPlayerFacingBody
      && (property === 'quaternion' || property === 'rotation')
      && FRONTAL_BIND_ROTATION_BONE.test(nodeName)) {
      removed.push(`${nodeName}.${property} (player-facing bind pose)`);
      return [];
    }
    if (targetRoot && !targetRoot.getObjectByName(nodeName)) {
      removed.push(`${nodeName}.${property} (not in target rig)`);
      return [];
    }
    if (STRIP_SCENE_ROOT.test(nodeName)
      && (property === 'position' || property === 'quaternion' || property === 'rotation' || property === 'scale')) {
      removed.push(`${nodeName}.${property}`);
      return [];
    }
    if (EYE_BONE.test(nodeName)
      && property === 'position'
      && track instanceof THREE.VectorKeyframeTrack
      && shouldRemoveEyeTranslation(track)) {
      removed.push(`${nodeName}.${property}`);
      return [];
    }
    return [track];
  });
  debugLog(
    'CoachAnimation',
    `Prepared ${name}: ${tracks.length}/${clip.tracks.length} body tracks, removed=${removed.join(',') || 'none'}`,
  );
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export type PortraitBodyPoseSource = 'frontal-bind' | 'authored-frame-0';

export function getPortraitBodyPoseSource(assetName?: string): PortraitBodyPoseSource {
  return assetName && FRONTAL_BIND_POSE_ASSET.test(assetName)
    ? 'frontal-bind'
    : 'authored-frame-0';
}

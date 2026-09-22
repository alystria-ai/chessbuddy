// Ported from the convai-web-sdk neurosync-visual-react example (src/hooks/useHeadTracking.ts) — keep the two in sync.
import { useRef, useEffect, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Configuration options for head tracking
 */
export interface HeadTrackingConfig {
  /** Angle (radians) for head-only zone - default: PI/3 (60 degrees each side) */
  headOnlyAngle?: number;
  /** Max tracking angle (radians) - beyond this, return to animation - default: PI/2 (90 degrees) */
  maxTrackAngle?: number;
  /** Max vertical pitch angle (radians) - default: PI/4 (45 degrees) */
  maxPitchAngle?: number;
  /** Smoothing factor for natural movement (0-1, per frame at 60fps; dt-corrected at runtime) - default: 0.08 */
  lerpSpeed?: number;
  /** How much of pitch goes to head (0-1) - default: 0.7 */
  headPitchFactor?: number;
  /** How much of pitch goes to neck (0-1) - default: 0.3 */
  neckPitchFactor?: number;
  /** How much of extra yaw goes to neck (0-1) - default: 0.7 */
  neckYawFactor?: number;
  /** Idle drift amplitude on yaw (radians) — always-on micro-motion. ~2.3° */
  idleYawAmp?: number;
  /** Idle drift amplitude on pitch (radians). ~1.4° */
  idlePitchAmp?: number;
  /** Idle drift amplitude on roll/head-tilt (radians). ~2.9° */
  idleRollAmp?: number;
  /** Time multiplier for the idle drift (1 = base slow drift). */
  idleSpeed?: number;
  /** Roll added per radian of look-yaw — "banks" the head into a turn. */
  turnBank?: number;
  /** Max yaw (radians) of an occasional look-around gaze shift. */
  gazeYawRange?: number;
  /** Max pitch (radians) of a gaze shift. */
  gazePitchRange?: number;
  /** Max roll (radians) of a gaze shift. */
  gazeRollRange?: number;
  /** Ease toward the current gaze-shift target (per frame at 60fps; dt-corrected at runtime). */
  gazeEase?: number;
  /** Min/max seconds to hold a gaze target before re-picking. */
  gazeDwellMin?: number;
  gazeDwellMax?: number;
  /**
   * Idle camera-lock strength (0-1). Low values let the animation clip's
   * head motion (the body's sideways sway) flow through; the deviation
   * pull-back below still stops her from facing away. Default 0.45.
   */
  idleLock?: number;
  /** Camera-lock strength while speaking — focused on the viewer. Default 0.85. */
  talkLock?: number;
  /**
   * Animated-pose deviation (radians from the locked pose) where the
   * pull-back starts / saturates. Within devLo the clip flows freely; by
   * devHi the head is fully locked back to camera. Defaults 0.12 / 0.5.
   */
  deviationLo?: number;
  deviationHi?: number;
  /** Whether tracking is active - default: true */
  enabled?: boolean;
}

/**
 * Return type for useHeadTracking hook
 */
export interface UseHeadTrackingReturn {
  /** Reference to the head bone */
  headBoneRef: React.MutableRefObject<THREE.Bone | null>;
  /** Reference to neck twist bone 1 */
  neckBone1Ref: React.MutableRefObject<THREE.Bone | null>;
  /** Reference to neck twist bone 2 */
  neckBone2Ref: React.MutableRefObject<THREE.Bone | null>;
  /** Reference to spine bone */
  spineBoneRef: React.MutableRefObject<THREE.Bone | null>;
  /** Set a custom target position (null = track camera) */
  setTarget: (position: THREE.Vector3 | null) => void;
}

// Default configuration values
const DEFAULT_CONFIG: Required<HeadTrackingConfig> = {
  headOnlyAngle: Math.PI / 3, // 60 degrees each side - head only zone
  maxTrackAngle: Math.PI / 2, // 90 degrees each side (180 total)
  maxPitchAngle: Math.PI / 4, // 45 degrees - max vertical angle
  lerpSpeed: 0.08, // Smoothing factor for natural movement
  headPitchFactor: 0.7, // How much of pitch goes to head
  neckPitchFactor: 0.3, // How much of pitch goes to neck
  neckYawFactor: 0.7, // How much of extra yaw goes to neck
  idleYawAmp: 0.03, // ~1.7° fast micro-drift yaw
  idlePitchAmp: 0.02, // ~1.1° fast micro-drift pitch
  idleRollAmp: 0.035, // ~2° fast micro-drift roll
  idleSpeed: 1.0,
  turnBank: 0.2, // tilt the head into yaw turns
  // Gaze-shift ("looking around"): larger, occasional reorientations the head
  // eases to and holds. This is the main thing that made it feel stagnant.
  gazeYawRange: 0.15, // up to ~8.6° yaw glance
  gazePitchRange: 0.09, // up to ~5.2° pitch glance
  gazeRollRange: 0.09, // up to ~5.2° tilt on a glance
  gazeEase: 0.035, // per-frame ease toward the current gaze target
  gazeDwellMin: 1.4, // seconds to hold before re-picking
  gazeDwellMax: 4.0,
  idleLock: 0.45, // idle: let the clip's sway flow, softly oriented to camera
  talkLock: 0.85, // speaking: focused on the viewer
  deviationLo: 0.12, // ~7° — clip motion below this flows untouched
  deviationHi: 0.35, // ~20° — by here the head is pulled fully back
  enabled: true,
};

/**
 * Smooth, non-repeating drift in ~[-1, 1] — three incommensurate sines (an
 * fbm-lite). Cheap, dependency-free, and organic (no obvious period), so the
 * head is always gently moving instead of locking dead-still onto the camera.
 */
function drift(t: number, seed: number): number {
  return (
    Math.sin(t * 0.47 + seed) * 0.55 +
    Math.sin(t * 0.83 + seed * 2.13) * 0.3 +
    Math.sin(t * 1.71 + seed * 4.7) * 0.15
  );
}

/**
 * Convert a per-frame smoothing factor (tuned at 60fps) into a delta-time
 * corrected alpha, so easing speed stays uniform under dropped frames and on
 * high-refresh displays instead of stepping unevenly (which reads as jitter).
 */
function dtAlpha(perFrame60: number, delta: number): number {
  return 1 - Math.pow(1 - perFrame60, delta * 60);
}

// Head/neck/spine bone names. CC4 ExpressionPlus rigs use CC_Base_*; the
// MetaHuman rig (Sofia) uses the UE bone names (head, neck_01/02, spine_02).
const HEAD_BONES = new Set(["CC_Base_Head", "head"]);
const NECK1_BONES = new Set(["CC_Base_NeckTwist01", "neck_01"]);
const NECK2_BONES = new Set(["CC_Base_NeckTwist02", "neck_02"]);
const SPINE_BONES = new Set(["CC_Base_Spine02", "spine_02"]);

/**
 * useHeadTracking - React hook for head tracking towards a target (default: camera)
 *
 * Handles:
 * - Finding head, neck, and spine bones in the skeleton
 * - Calculating look direction to target
 * - Distributing rotation between head and neck bones
 * - Smooth blending between animation and tracking
 * - Supporting custom target or camera tracking
 *
 * @param skeletonRoot - The root bone of the skeleton (e.g., nodes.CC_Base_BoneRoot)
 * @param config - Configuration options
 * @param isSpeaking - Whether character is currently speaking (affects tracking strength)
 * @param isListening - When true, uses lerp 0.9 for more responsive head tracking (user is speaking)
 *
 * @example
 * ```tsx
 * const { headBoneRef, setTarget } = useHeadTracking(
 *   nodes.CC_Base_BoneRoot,
 *   { lerpSpeed: 0.1 },
 *   isSpeaking,
 *   isListening
 * );
 * ```
 */
export function useHeadTracking(
  skeletonRoot: THREE.Object3D | null | undefined,
  config: HeadTrackingConfig = {},
  isSpeaking: boolean = false,
  isListening: boolean = false,
): UseHeadTrackingReturn {
  const options = { ...DEFAULT_CONFIG, ...config };

  // Bone references
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBone1Ref = useRef<THREE.Bone | null>(null);
  const neckBone2Ref = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);

  // Custom target (if not using camera)
  const customTarget = useRef<THREE.Vector3 | null>(null);

  // Store REST pose quaternions (captured once when bones are found)
  const restPose = useRef({
    head: new THREE.Quaternion(),
    neck1: new THREE.Quaternion(),
    neck2: new THREE.Quaternion(),
  });

  // Store the character's base forward direction (in world space)
  const characterForward = useRef(new THREE.Vector3(0, 0, 1));

  // Smoothed ANGLES (we smooth the angles, not quaternions, for stable results)
  const smoothedAngles = useRef({
    headYaw: 0,
    headPitch: 0,
    neckYaw: 0,
    neckPitch: 0,
  });

  // Occasional "gaze shift" — a wandering look-around target the head eases
  // toward, re-picked after a random dwell. This layered on top of the fast
  // micro-drift is what reads as a person glancing around and settling, rather
  // than a uniform sine wobble.
  const gaze = useRef({
    curYaw: 0,
    curPitch: 0,
    curRoll: 0,
    tgtYaw: 0,
    tgtPitch: 0,
    tgtRoll: 0,
    nextAt: 0,
  });

  // Smoothed camera-lock strength (eases between idleLock and talkLock so
  // speech start/end doesn't pop the head).
  const lockRef = useRef(DEFAULT_CONFIG.idleLock);

  // What we wrote last frame, per bone — used to detect whether the mixer
  // actually re-animated the bone this frame (the bone only holds new
  // animation data if it changed since our last write).
  const lastWritten = useRef({
    has: false,
    head: new THREE.Quaternion(),
    neck1: new THREE.Quaternion(),
    neck2: new THREE.Quaternion(),
  });

  // Last pose the mixer actually wrote, per bone. The blend below always
  // starts from this latched pose, never from the live quaternion — after our
  // write the live value is our own output, and blending from it fed back:
  // the old code branch-flipped between a partial blend and a full lock as
  // the poses crossed the detection threshold, twitching the whole head (the
  // same feedback jitter that was removed from useEyeTracking).
  const clipPose = useRef({
    head: new THREE.Quaternion(),
    neck1: new THREE.Quaternion(),
    neck2: new THREE.Quaternion(),
  });

  const { camera } = useThree();

  // Temp vectors for calculations (avoid GC)
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const tempVec2 = useMemo(() => new THREE.Vector3(), []);
  const tempVec3 = useMemo(() => new THREE.Vector3(), []);
  const tempVec4 = useMemo(() => new THREE.Vector3(), []);
  const tempVec5 = useMemo(() => new THREE.Vector3(), []);
  const tempQuat = useMemo(() => new THREE.Quaternion(), []);
  const tempQuat2 = useMemo(() => new THREE.Quaternion(), []);
  const tempEuler = useMemo(() => new THREE.Euler(), []);

  // Find and store bone references
  useEffect(() => {
    if (!skeletonRoot) return;

    skeletonRoot.traverse((child) => {
      if (child instanceof THREE.Bone) {
        if (HEAD_BONES.has(child.name)) {
          headBoneRef.current = child;
          restPose.current.head.copy(child.quaternion);
        } else if (NECK1_BONES.has(child.name)) {
          neckBone1Ref.current = child;
          restPose.current.neck1.copy(child.quaternion);
        } else if (NECK2_BONES.has(child.name)) {
          neckBone2Ref.current = child;
          restPose.current.neck2.copy(child.quaternion);
        } else if (SPINE_BONES.has(child.name)) {
          spineBoneRef.current = child;
        }
      }
    });

    return () => {
      // The GLTF scene is cached and shared across mounts (not cloned), so
      // put the bones back at the captured rest pose — otherwise the next
      // mount captures our last written pose as its "rest" and the locked
      // baseline shifts between visits.
      headBoneRef.current?.quaternion.copy(restPose.current.head);
      neckBone1Ref.current?.quaternion.copy(restPose.current.neck1);
      neckBone2Ref.current?.quaternion.copy(restPose.current.neck2);
    };
  }, [skeletonRoot]);

  // Head tracking update
  useFrame((state, delta) => {
    if (!options.enabled || !headBoneRef.current) return;

    const head = headBoneRef.current;
    const neck1 = neckBone1Ref.current;
    const neck2 = neckBone2Ref.current;

    // Get head world position (using parent's world matrix for stability).
    // updateWorldMatrix(true, false) refreshes the ancestor chain only — the
    // old updateMatrixWorld(true) also recursed into every descendant bone,
    // which the read below never needed.
    const headWorldPos = tempVec.set(0, 0, 0);
    if (head.parent) {
      head.parent.updateWorldMatrix(true, false);
      headWorldPos.copy(head.position).applyMatrix4(head.parent.matrixWorld);
    }

    // Get target position (custom target or camera)
    const targetPos = tempVec2.copy(
      customTarget.current ? customTarget.current : camera.position,
    );

    // Calculate direction from head to target in world space
    const dirToTarget = tempVec3.subVectors(targetPos, headWorldPos).normalize();

    // Get the character's forward direction in world space from spine
    const spineWorldQuat = tempQuat.set(0, 0, 0, 1);
    if (spineBoneRef.current) {
      spineBoneRef.current.getWorldQuaternion(spineWorldQuat);
    } else if (neck1 && neck1.parent) {
      neck1.parent.getWorldQuaternion(spineWorldQuat);
    }

    // Character's forward is Z-axis transformed by spine's world rotation
    const charForward = characterForward.current
      .set(0, 0, 1)
      .applyQuaternion(spineWorldQuat);

    // Project both onto XZ plane for horizontal angle
    const charForwardFlat = tempVec4.copy(charForward).setY(0).normalize();
    const dirToTargetFlat = tempVec5.copy(dirToTarget).setY(0).normalize();

    // Check if target is within viewable range using dot product
    const dotProduct = charForwardFlat.dot(dirToTargetFlat);

    // Cap maxTrackAngle to 170 degrees to ensure there's always a blind spot behind
    const effectiveMaxAngle = Math.min(options.maxTrackAngle, Math.PI * 0.944);
    const maxAngleCos = Math.cos(effectiveMaxAngle);
    const isInTrackingRange = dotProduct >= maxAngleCos;

    let angleToTarget = charForwardFlat.angleTo(dirToTargetFlat);

    // Determine if target is to the left or right (for signed angle) —
    // only the Y component of the cross product is needed.
    const crossY =
      charForwardFlat.z * dirToTargetFlat.x - charForwardFlat.x * dirToTargetFlat.z;
    const sign = crossY >= 0 ? 1 : -1;
    angleToTarget *= sign;

    // Calculate vertical angle (pitch)
    const verticalAngle = Math.asin(Math.max(-1, Math.min(1, dirToTarget.y)));

    // Calculate TARGET rotation distribution between head and neck
    let targetHeadYaw = 0;
    let targetNeckYaw = 0;
    let targetHeadPitch = 0;
    let targetNeckPitch = 0;

    if (isInTrackingRange) {
      // Clamp angles to max tracking range
      const clampedHorizontal = Math.max(
        -options.maxTrackAngle,
        Math.min(options.maxTrackAngle, angleToTarget),
      );
      const clampedVertical = Math.max(
        -options.maxPitchAngle,
        Math.min(options.maxPitchAngle, verticalAngle),
      );

      const absAngle = Math.abs(clampedHorizontal);

      // Negate pitch because positive X rotation tilts head down
      targetHeadPitch = -clampedVertical * options.headPitchFactor;
      targetNeckPitch = -clampedVertical * options.neckPitchFactor;

      if (absAngle <= options.headOnlyAngle) {
        // Within head-only zone: head only
        targetHeadYaw = clampedHorizontal;
        targetNeckYaw = 0;
      } else {
        // Beyond head-only zone: distribute between neck and head
        const extraAngle = absAngle - options.headOnlyAngle;
        targetHeadYaw = options.headOnlyAngle * Math.sign(clampedHorizontal);
        targetNeckYaw =
          extraAngle * Math.sign(clampedHorizontal) * options.neckYawFactor;
      }
    }

    // Smoothing toward the target angles (stable — we smooth angles, never
    // quaternions). isListening makes it snappier.
    const lerp = dtAlpha(isListening ? 0.5 : options.lerpSpeed, delta);
    smoothedAngles.current.headYaw +=
      (targetHeadYaw - smoothedAngles.current.headYaw) * lerp;
    smoothedAngles.current.headPitch +=
      (targetHeadPitch - smoothedAngles.current.headPitch) * lerp;
    smoothedAngles.current.neckYaw +=
      (targetNeckYaw - smoothedAngles.current.neckYaw) * lerp;
    smoothedAngles.current.neckPitch +=
      (targetNeckPitch - smoothedAngles.current.neckPitch) * lerp;

    const t = state.clock.elapsedTime * options.idleSpeed;

    // Gaze-shift: an occasional look-around target the head eases toward and
    // holds for a random dwell, then re-picks. This "glance and settle" is the
    // main thing that reads as alive vs. a uniform sine wobble.
    const g = gaze.current;
    if (t >= g.nextAt) {
      g.tgtYaw = (Math.random() * 2 - 1) * options.gazeYawRange;
      g.tgtPitch = (Math.random() * 2 - 1) * options.gazePitchRange;
      g.tgtRoll = (Math.random() * 2 - 1) * options.gazeRollRange;
      g.nextAt =
        t +
        options.gazeDwellMin +
        Math.random() * (options.gazeDwellMax - options.gazeDwellMin);
    }
    const gazeAlpha = dtAlpha(options.gazeEase, delta);
    g.curYaw += (g.tgtYaw - g.curYaw) * gazeAlpha;
    g.curPitch += (g.tgtPitch - g.curPitch) * gazeAlpha;
    g.curRoll += (g.tgtRoll - g.curRoll) * gazeAlpha;

    // While speaking, calm the procedural glances/drift — a focused speaker
    // holds the listener's gaze; micro-life stays but the look-arounds go.
    // Derived from the eased lock so it fades in/out with speech transitions.
    const speakBlend = THREE.MathUtils.clamp(
      (lockRef.current - options.idleLock) /
        Math.max(0.001, options.talkLock - options.idleLock),
      0,
      1,
    );
    const calm = 1 - 0.65 * speakBlend;

    // Fast micro-drift (never perfectly still) + the gaze-shift offset. The
    // head-application below consumes these, so both layers propagate.
    const idleYaw = (drift(t, 1.0) * options.idleYawAmp + g.curYaw) * calm;
    const idlePitch =
      (drift(t, 7.3) * options.idlePitchAmp + g.curPitch) * calm;
    const idleRoll = (drift(t, 13.1) * options.idleRollAmp + g.curRoll) * calm;
    // Bank the head into yaw (camera look + gaze glance) — tilt toward it.
    const bankRoll =
      -(smoothedAngles.current.headYaw + g.curYaw * calm) * options.turnBank;
    // Neck follows the head's idle+gaze with a slight lag and smaller amplitude
    // (per bone; two neck bones stack), so the head-neck chain reads connected.
    const tn = t - 0.18;
    const neckIdleYaw =
      (drift(tn, 1.0) * options.idleYawAmp + g.curYaw) * 0.3 * calm;
    const neckIdlePitch =
      (drift(tn, 7.3) * options.idlePitchAmp + g.curPitch) * 0.3 * calm;
    const neckIdleRoll =
      (drift(tn, 13.1) * options.idleRollAmp + g.curRoll) * 0.3 * calm +
      bankRoll * 0.25;

    // BLEND the clip's animated pose with the camera-locked pose instead of
    // overriding it: the idle animation's sideways flow comes through at low
    // lock strength, while a deviation pull-back stops the clip from turning
    // her away from the viewer, and speaking raises the lock so she reads
    // focused on the camera. The blend always starts from the latched clip
    // pose (see clipPose above), so its inputs move smoothly frame-to-frame
    // and there is no feedback on our own output.
    const lockTarget = isSpeaking ? options.talkLock : options.idleLock;
    lockRef.current += (lockTarget - lockRef.current) * dtAlpha(0.04, delta);

    const lw = lastWritten.current;
    const cp = clipPose.current;

    // Latch the mixer's pose per bone: the bone only holds new animation data
    // if it changed since our last write; otherwise it still holds our own
    // output, so we keep the previous latched pose (head tracks are frozen to
    // frame 0 by sanitizeIdleClip, so it's constant anyway).
    if (!lw.has || head.quaternion.angleTo(lw.head) > 1e-4) {
      cp.head.copy(head.quaternion);
    }

    const headLook = tempQuat2.setFromEuler(
      tempEuler.set(
        smoothedAngles.current.headPitch + idlePitch,
        smoothedAngles.current.headYaw + idleYaw,
        idleRoll + bankRoll,
        "YXZ",
      ),
    );
    const lockedHead = tempQuat
      .copy(restPose.current.head)
      .multiply(headLook);

    // Pull-back: the further the animated pose strays from the camera-locked
    // pose (a glance away, a gesture clip turning the head "backwards"), the
    // harder we lock. Small sways stay untouched.
    const deviation = cp.head.angleTo(lockedHead);
    const boost = THREE.MathUtils.smoothstep(
      deviation,
      options.deviationLo,
      options.deviationHi,
    );
    const lock = lockRef.current + (1 - lockRef.current) * boost;
    head.quaternion.copy(cp.head).slerp(lockedHead, lock);
    lw.head.copy(head.quaternion);

    if (neck2) {
      if (!lw.has || neck2.quaternion.angleTo(lw.neck2) > 1e-4) {
        cp.neck2.copy(neck2.quaternion);
      }
      const neck2Look = tempQuat2.setFromEuler(
        tempEuler.set(
          smoothedAngles.current.neckPitch * 0.5 + neckIdlePitch,
          smoothedAngles.current.neckYaw * 0.5 + neckIdleYaw,
          neckIdleRoll,
          "YXZ",
        ),
      );
      const lockedNeck2 = tempQuat.copy(restPose.current.neck2).multiply(neck2Look);
      neck2.quaternion.copy(cp.neck2).slerp(lockedNeck2, lock);
      lw.neck2.copy(neck2.quaternion);
    }

    if (neck1) {
      if (!lw.has || neck1.quaternion.angleTo(lw.neck1) > 1e-4) {
        cp.neck1.copy(neck1.quaternion);
      }
      const neck1Look = tempQuat2.setFromEuler(
        tempEuler.set(
          smoothedAngles.current.neckPitch * 0.5 + neckIdlePitch,
          smoothedAngles.current.neckYaw * 0.5 + neckIdleYaw,
          neckIdleRoll,
          "YXZ",
        ),
      );
      const lockedNeck1 = tempQuat.copy(restPose.current.neck1).multiply(neck1Look);
      neck1.quaternion.copy(cp.neck1).slerp(lockedNeck1, lock);
      lw.neck1.copy(neck1.quaternion);
    }

    lw.has = true;
  });

  // Function to set a custom target position
  const setTarget = useCallback((position: THREE.Vector3 | null) => {
    if (position) {
      if (!customTarget.current) {
        customTarget.current = new THREE.Vector3();
      }
      customTarget.current.copy(position);
    } else {
      customTarget.current = null; // Reset to camera tracking
    }
  }, []);

  return {
    headBoneRef,
    neckBone1Ref,
    neckBone2Ref,
    spineBoneRef,
    setTarget,
  };
}

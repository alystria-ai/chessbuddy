// Ported from the convai-web-sdk neurosync-visual-react example (src/hooks/useEyeTracking.ts) — keep the two in sync.
import { useRef, useEffect, useMemo, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Configuration options for eye/pupil tracking
 */
export interface EyeTrackingConfig {
  /** Max horizontal eye movement angle (radians) - default: PI/6 (30 degrees) */
  maxHorizontalAngle?: number;
  /** Max vertical eye movement angle (radians) - default: PI/8 (22.5 degrees) */
  maxVerticalAngle?: number;
  /** Smoothing factor - pupils move quickly - default: 0.2 */
  lerpSpeed?: number;
  /** Vertical offset to make pupils look slightly lower by default - default: -0.15 */
  verticalOffset?: number;
  /** Whether tracking is active - default: true */
  enabled?: boolean;
  /**
   * Root to search for meshes carrying the eye-look morphs (lids follow the
   * gaze). Pass the character root — the morphs live on several meshes
   * (face, brows, eye occlusion, tearline AND the eyelash meshes), not just
   * the body. Falls back to `meshRef` when omitted.
   */
  morphRoot?: THREE.Object3D | null;
}

/**
 * Gaze direction for a single eye
 */
export interface EyeGazeDirection {
  /** Horizontal gaze: -1 (left) to 1 (right) */
  horizontal: number;
  /** Vertical gaze: -1 (down) to 1 (up) */
  vertical: number;
}

/**
 * Combined gaze direction state
 */
export interface GazeDirection {
  /** Left eye gaze */
  left: EyeGazeDirection;
  /** Right eye gaze */
  right: EyeGazeDirection;
  /** Average horizontal (for backward compatibility) */
  horizontal: number;
  /** Average vertical (for backward compatibility) */
  vertical: number;
}

/**
 * Return type for useEyeTracking hook
 */
export interface UseEyeTrackingReturn {
  /** Set a custom target position (null = track camera) */
  setTarget: (position: THREE.Vector3 | null) => void;
  /** Reference to left eye bone */
  leftEyeBoneRef: React.MutableRefObject<THREE.Bone | null>;
  /** Reference to right eye bone */
  rightEyeBoneRef: React.MutableRefObject<THREE.Bone | null>;
  /** Reference to head bone */
  headBoneRef: React.MutableRefObject<THREE.Bone | null>;
  /** Current gaze direction state */
  gazeDirection: React.MutableRefObject<GazeDirection>;
}

// Default configuration values
const DEFAULT_CONFIG: Required<Omit<EyeTrackingConfig, "morphRoot">> = {
  maxHorizontalAngle: Math.PI / 6, // 30 degrees
  maxVerticalAngle: Math.PI / 8, // 22.5 degrees
  lerpSpeed: 0.2, // Pupils move quickly
  verticalOffset: -0.15, // Offset to make pupils look slightly lower
  enabled: true,
};

// CC4 bone names for eyes
const BONE_NAMES = {
  HEAD: "CC_Base_Head",
  LEFT_EYE: "CC_Base_L_Eye",
  RIGHT_EYE: "CC_Base_R_Eye",
} as const;

// Logical eye-look channels (per eye, per direction). The lids/socket
// deformation morphs are driven from these so the eyelids travel with the
// gaze — look up and the upper lid lifts, look down and both lids drop —
// which also covers gaze changes caused by head pitch (eyes counter-rotate
// relative to the head, and these angles are head-relative).
const CHANNELS = [
  "upL",
  "downL",
  "leftL",
  "rightL",
  "upR",
  "downR",
  "leftR",
  "rightR",
] as const;
type Channel = (typeof CHANNELS)[number];

// Both naming schemes are resolved per mesh; a rig carries one or the other.
// CC4 ExpressionPlus (Sofia): Eye_Look_*_L/R. ARKit exports: A06–A13
// (in/out per eye rather than left/right).
const MORPH_NAME_TO_CHANNEL: Record<string, Channel> = {
  Eye_Look_Up_L: "upL",
  Eye_Look_Down_L: "downL",
  Eye_Look_Left_L: "leftL",
  Eye_Look_Right_L: "rightL",
  Eye_Look_Up_R: "upR",
  Eye_Look_Down_R: "downR",
  Eye_Look_Left_R: "leftR",
  Eye_Look_Right_R: "rightR",
  A06_Eye_Look_Up_Left: "upL",
  A07_Eye_Look_Up_Right: "upR",
  A08_Eye_Look_Down_Left: "downL",
  A09_Eye_Look_Down_Right: "downR",
  A10_Eye_Look_Out_Left: "leftL",
  A11_Eye_Look_In_Left: "rightL",
  A12_Eye_Look_In_Right: "leftR",
  A13_Eye_Look_Out_Right: "rightR",
};

interface LookMorphTarget {
  infl: number[];
  /** [morph influence slot, channel index] pairs present on this mesh. */
  slots: Array<[number, number]>;
}

/**
 * useEyeTracking - React hook for pupil tracking by rotating eye bones
 *
 * Handles:
 * - Finding head and eye bones in the skeleton
 * - Calculating gaze direction to target with convergence
 * - Rotating eye bones for realistic tracking
 * - Applying morph targets for natural eye deformation
 * - Smooth blending between animation and tracking
 *
 * @param meshRef - Ref to the skinned mesh (for morph targets)
 * @param skeletonRoot - The root bone to find head and eye bones
 * @param config - Configuration options
 * @param isSpeaking - Whether character is currently speaking (affects tracking strength)
 * @param isListening - When true, uses lerp 1 for more responsive eye tracking (user is speaking)
 *
 * @example
 * ```tsx
 * const { setTarget, gazeDirection } = useEyeTracking(
 *   bodyMeshRef,
 *   nodes.CC_Base_BoneRoot,
 *   { lerpSpeed: 0.15 },
 *   isSpeaking,
 *   isListening
 * );
 * ```
 */
export function useEyeTracking(
  meshRef: React.MutableRefObject<THREE.SkinnedMesh | null> | null | undefined,
  skeletonRoot: THREE.Object3D | null | undefined,
  config: EyeTrackingConfig = {},
  _isSpeaking: boolean = false,
  isListening: boolean = false,
): UseEyeTrackingReturn {
  const options = { ...DEFAULT_CONFIG, ...config };

  // Bone references
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const leftEyeBoneRef = useRef<THREE.Bone | null>(null);
  const rightEyeBoneRef = useRef<THREE.Bone | null>(null);

  // Custom target (if not using camera)
  const customTarget = useRef<THREE.Vector3 | null>(null);

  // Meshes carrying eye-look morphs (lids follow gaze).
  const lookTargetsRef = useRef<LookMorphTarget[]>([]);
  // Per-frame channel values (order matches CHANNELS); reused to avoid GC.
  const channelValues = useRef(new Float32Array(CHANNELS.length));

  // Store rest pose rotations
  const restPose = useRef({
    leftEye: new THREE.Quaternion(),
    rightEye: new THREE.Quaternion(),
  });

  // Gaze direction state
  const gazeDirection = useRef<GazeDirection>({
    left: { horizontal: 0, vertical: 0 },
    right: { horizontal: 0, vertical: 0 },
    horizontal: 0,
    vertical: 0,
  });

  // Saccades: real eyes don't hold a target — they dart to a new point and
  // hold briefly, over and over. A quickly-eased offset (normalized H/V) added
  // on top of the smooth camera-gaze gives that flick-and-hold aliveness.
  const saccade = useRef({
    curH: 0,
    curV: 0,
    tgtH: 0,
    tgtV: 0,
    nextAt: 0,
  });

  const { camera, clock } = useThree();

  // Temp vectors for calculations (avoid GC)
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const tempVec2 = useMemo(() => new THREE.Vector3(), []);
  const tempTargetPos = useMemo(() => new THREE.Vector3(), []);
  const tempForward = useMemo(() => new THREE.Vector3(), []);
  const tempUp = useMemo(() => new THREE.Vector3(), []);
  const tempRight = useMemo(() => new THREE.Vector3(), []);
  const tempMid = useMemo(() => new THREE.Vector3(), []);
  const tempEuler = useMemo(() => new THREE.Euler(), []);
  const tempQuat = useMemo(() => new THREE.Quaternion(), []);
  const tempQuat2 = useMemo(() => new THREE.Quaternion(), []);
  const tempQuat3 = useMemo(() => new THREE.Quaternion(), []);

  // Find head and eye bones
  useEffect(() => {
    if (!skeletonRoot) return;

    skeletonRoot.traverse((child) => {
      if (child instanceof THREE.Bone) {
        if (child.name === BONE_NAMES.HEAD) {
          headBoneRef.current = child;
        } else if (child.name === BONE_NAMES.LEFT_EYE) {
          leftEyeBoneRef.current = child;
          restPose.current.leftEye.copy(child.quaternion);
        } else if (child.name === BONE_NAMES.RIGHT_EYE) {
          rightEyeBoneRef.current = child;
          restPose.current.rightEye.copy(child.quaternion);
        }
      }
    });
  }, [skeletonRoot]);

  // Collect every mesh with eye-look morphs under morphRoot (or meshRef).
  const morphRoot = config.morphRoot;
  useEffect(() => {
    const targets: LookMorphTarget[] = [];
    const collect = (o: THREE.Object3D) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.morphTargetDictionary || !m.morphTargetInfluences)
        return;
      const slots: Array<[number, number]> = [];
      for (const [name, channel] of Object.entries(MORPH_NAME_TO_CHANNEL)) {
        const idx = m.morphTargetDictionary[name];
        if (idx !== undefined) slots.push([idx, CHANNELS.indexOf(channel)]);
      }
      if (slots.length) targets.push({ infl: m.morphTargetInfluences, slots });
    };
    if (morphRoot) morphRoot.traverse(collect);
    else if (meshRef?.current) collect(meshRef.current);
    lookTargetsRef.current = targets;
  }, [morphRoot, meshRef]);

  useFrame((_, delta) => {
    if (!options.enabled) return;
    if (!leftEyeBoneRef.current || !rightEyeBoneRef.current) return;

    const leftEye = leftEyeBoneRef.current;
    const rightEye = rightEyeBoneRef.current;

    // Get eye positions separately for convergence calculation
    const leftEyePos = tempVec.set(0, 0, 0);
    const rightEyePos = tempVec2.set(0, 0, 0);
    leftEye.getWorldPosition(leftEyePos);
    rightEye.getWorldPosition(rightEyePos);

    // Get target position
    const targetPos = tempTargetPos.copy(
      customTarget.current ? customTarget.current : camera.position,
    );

    // Get head's forward direction for calculating gaze
    const headWorldQuat = tempQuat.set(0, 0, 0, 1);
    if (headBoneRef.current) {
      headBoneRef.current.getWorldQuaternion(headWorldQuat);
    }

    const headForward = tempForward.set(0, 0, 1).applyQuaternion(headWorldQuat);
    const headUp = tempUp.set(0, 1, 0).applyQuaternion(headWorldQuat);
    const headRight = tempRight.set(1, 0, 0).applyQuaternion(headWorldQuat);

    // Gaze from a single "cyclopean" eye (midpoint) plus explicit vergence.
    // Computing each eye's direction separately breaks down when the camera
    // is close: the per-eye forward component collapses toward the 0.1 clamp
    // and the atan2 blows the horizontal angles apart, so one eye slews to
    // its clamp and the pair reads cross-eyed/divergent. The conjugate
    // (shared) angle from the midpoint is stable at any distance; the inward
    // vergence is added per-eye analytically and capped.
    const midPos = tempMid.copy(leftEyePos).add(rightEyePos).multiplyScalar(0.5);
    midPos.subVectors(targetPos, midPos);
    const targetDist = midPos.length();
    const dirToTarget =
      targetDist > 1e-6 ? midPos.multiplyScalar(1 / targetDist) : headForward;

    // Check if target is roughly in front
    const isInView = headForward.dot(dirToTarget) > -0.3;

    // When isListening (user speaking), use lerp 1 for more responsive eye tracking
    const effectiveLerpSpeed = isListening ? 1 : options.lerpSpeed;

    // Calculate the shared gaze angle + per-eye vergence
    let leftTargetH = 0,
      leftTargetV = 0;
    let rightTargetH = 0,
      rightTargetV = 0;

    if (isInView) {
      const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
      const forwardComp = Math.max(0.2, dirToTarget.dot(headForward));
      const horizAngle = Math.atan2(dirToTarget.dot(headRight), forwardComp);
      const vertAngle = Math.atan2(dirToTarget.dot(headUp), forwardComp);

      // Each eye rotates inward by atan(ipd/2 / distance); the cap keeps a
      // camera pressed against the face from crossing the eyes.
      const MAX_VERGENCE = THREE.MathUtils.degToRad(6.5);
      const ipd = leftEyePos.distanceTo(rightEyePos);
      const vergence = Math.min(
        Math.atan2(ipd / 2, Math.max(targetDist, 0.1)),
        MAX_VERGENCE,
      );

      // Left eye inward = toward the nose = +H (look right); right eye = -H.
      leftTargetH = clamp1(
        (horizAngle + vergence) / options.maxHorizontalAngle,
      );
      rightTargetH = clamp1(
        (horizAngle - vergence) / options.maxHorizontalAngle,
      );
      const v = clamp1(
        vertAngle / options.maxVerticalAngle + options.verticalOffset,
      );
      leftTargetV = v;
      rightTargetV = v;
    }

    // Smooth the gaze direction values for each eye independently
    gazeDirection.current.left.horizontal +=
      (leftTargetH - gazeDirection.current.left.horizontal) * effectiveLerpSpeed;
    gazeDirection.current.left.vertical +=
      (leftTargetV - gazeDirection.current.left.vertical) * effectiveLerpSpeed;

    gazeDirection.current.right.horizontal +=
      (rightTargetH - gazeDirection.current.right.horizontal) *
      effectiveLerpSpeed;
    gazeDirection.current.right.vertical +=
      (rightTargetV - gazeDirection.current.right.vertical) * effectiveLerpSpeed;

    // Update legacy average values for backward compatibility
    gazeDirection.current.horizontal =
      (gazeDirection.current.left.horizontal +
        gazeDirection.current.right.horizontal) /
      2;
    gazeDirection.current.vertical =
      (gazeDirection.current.left.vertical +
        gazeDirection.current.right.vertical) /
      2;

    // Advance the saccade: dart to a new random point, hold, repeat. Fast ease
    // makes the flick crisp; a longer random dwell holds it between flicks.
    // Reference (MetaHuman idle) keeps steady soft eye contact — darts are
    // small and infrequent, with an occasional return-to-center bias.
    const sc = saccade.current;
    const now = clock.elapsedTime;
    if (now >= sc.nextAt) {
      // Mostly small darts, occasionally a larger one (square keeps them small).
      const r = () => Math.sign(Math.random() * 2 - 1) * Math.random() ** 2;
      if (Math.random() < 0.3) {
        // Re-fixate on the viewer: eye contact is the default state.
        sc.tgtH = 0;
        sc.tgtV = 0;
      } else {
        sc.tgtH = r() * 0.15;
        sc.tgtV = r() * 0.09;
      }
      sc.nextAt = now + 0.8 + Math.random() * 2.6;
    }
    // Frame-rate independent flick (~equiv to 0.4/frame at 60fps).
    const scEase = 1 - Math.exp(-30 * Math.min(delta, 0.1));
    sc.curH += (sc.tgtH - sc.curH) * scEase;
    sc.curV += (sc.tgtV - sc.curV) * scEase;
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

    // === BONE ROTATION - LEFT EYE (smooth camera gaze + saccade) ===
    const leftH = clamp1(gazeDirection.current.left.horizontal + sc.curH);
    const leftV = clamp1(gazeDirection.current.left.vertical + sc.curV);
    const leftYawAngle = leftH * options.maxHorizontalAngle;
    const leftPitchAngle = -leftV * options.maxVerticalAngle;

    const leftLookRotation = tempQuat2.setFromEuler(
      tempEuler.set(leftPitchAngle, 0, leftYawAngle, "XYZ"),
    );

    // === BONE ROTATION - RIGHT EYE (smooth camera gaze + saccade) ===
    const rightH = clamp1(gazeDirection.current.right.horizontal + sc.curH);
    const rightV = clamp1(gazeDirection.current.right.vertical + sc.curV);
    const rightYawAngle = rightH * options.maxHorizontalAngle;
    const rightPitchAngle = -rightV * options.maxVerticalAngle;

    const rightLookRotation = tempQuat3.setFromEuler(
      tempEuler.set(rightPitchAngle, 0, rightYawAngle, "XYZ"),
    );

    // OVERRIDE the animation entirely: eye = rest pose * smoothed gaze. We do
    // not read/blend the animated quaternion (that feedback was the jitter).
    leftEye.quaternion.copy(restPose.current.leftEye).multiply(leftLookRotation);
    rightEye.quaternion
      .copy(restPose.current.rightEye)
      .multiply(rightLookRotation);

    // === EYE-LOOK MORPHS: the lids travel with the gaze ===
    // Channel order: upL downL leftL rightL upR downR leftR rightR.
    // These fire on every mesh that carries the shapes (face, brows, eye
    // occlusion, tearline, lashes) so the whole lid assembly moves together —
    // look up and the upper lids lift, look down and the lids drop. Head
    // pitch is covered too: the gaze angles are head-relative, so when the
    // head tilts and the eyes counter-rotate the lids follow that as well.
    const ch = channelValues.current;
    ch[0] = Math.max(0, leftV); // upL
    ch[1] = Math.max(0, -leftV); // downL
    ch[2] = Math.max(0, -leftH); // leftL
    ch[3] = Math.max(0, leftH); // rightL
    ch[4] = Math.max(0, rightV); // upR
    ch[5] = Math.max(0, -rightV); // downR
    ch[6] = Math.max(0, -rightH); // leftR
    ch[7] = Math.max(0, rightH); // rightR
    for (const tgt of lookTargetsRef.current) {
      for (const [slot, channel] of tgt.slots) {
        tgt.infl[slot] = ch[channel];
      }
    }
  });

  // Function to set custom target
  const setTarget = useCallback((position: THREE.Vector3 | null) => {
    if (position) {
      if (!customTarget.current) {
        customTarget.current = new THREE.Vector3();
      }
      customTarget.current.copy(position);
    } else {
      customTarget.current = null;
    }
  }, []);

  return {
    setTarget,
    leftEyeBoneRef,
    rightEyeBoneRef,
    headBoneRef,
    gazeDirection,
  };
}

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { normalizeName } from './mhaToMorphMap';
import { getPortraitGazeBaseline, type PortraitGazeBaseline } from './portraitGazeCalibration';
import { getLipsyncTuningValuesForCoach, type LipsyncTuningValues } from './lipsyncTuning';

/**
 * usePortraitGaze — idle "looking around" for the portrait characters.
 *
 * The old CC4 head/eye tracking (useHeadTracking/useEyeTracking) assumed CC4
 * bone axis conventions and eye BONES; the MetaHuman rigs have neither, so it
 * was disabled and the coaches ended up staring dead ahead forever. This hook
 * replaces it with two rig-agnostic layers:
 *
 * - **Eyes** — the MHA `eyeLook{Left,Right,Up,Down}{L,R}` morphs receive the
 *   headed-render camera-facing correction for their specific V2 rig. Convai
 *   owns the remaining expressive range as an additive priority-1 layer.
 * - **Head** — a small yaw/pitch on the head bone, rotated about the WORLD up
 *   and right axes mapped into the bone's parent space. Deriving the axes from
 *   world space means we never have to know whether a given rig's head bone
 *   points down +Y or -Z (the bug that broke the old tracking).
 *
 * Motion model: a gaze target re-picked every few seconds (mostly small
 * offsets, occasionally re-centering), eased with time-based smoothing, plus a
 * slow incommensurate-sine drift so it never repeats or freezes. The head
 * follows the synthetic target, and while
 * speaking the wander is damped toward the viewer (a speaker holds your gaze)
 * without locking completely.
 */

/** Eye-look morph keys, normalized (CC4 + MetaHuman both resolve here). */
const EYE_LOOK = {
  leftL: normalizeName('CTRL_expressions_eyeLookLeftL'),
  leftR: normalizeName('CTRL_expressions_eyeLookLeftR'),
  rightL: normalizeName('CTRL_expressions_eyeLookRightL'),
  rightR: normalizeName('CTRL_expressions_eyeLookRightR'),
  upL: normalizeName('CTRL_expressions_eyeLookUpL'),
  upR: normalizeName('CTRL_expressions_eyeLookUpR'),
  downL: normalizeName('CTRL_expressions_eyeLookDownL'),
  downR: normalizeName('CTRL_expressions_eyeLookDownR'),
} as const;

/** Synthetic eye wandering stays off; only the measured neutral base is used. */
const EYE_GAIN = 0;
/** Ease time constant (s) for the head; the eyes snap faster (saccades). */
const HEAD_TAU = 0.55;
const EYE_TAU = 0.12;
/** Seconds between gaze re-targets. */
const GAZE_GAP_MIN = 1.8;
const GAZE_GAP_MAX = 5.2;
/** While speaking the wander shrinks toward the viewer. */
const SPEAKING_DAMP = 0.45;

type GazeMorphs = {
  infl: number[] | Float32Array;
  slots: Partial<Record<keyof typeof EYE_LOOK, number>>;
};

type HeadBinding = {
  bone: THREE.Object3D;
  /**
   * Pose we compose onto, captured lazily once the idle clip has faded in
   * (BASE_CAPTURE_DELAY). It must be the pose the MIXER settles at, not the
   * bind pose: most rigs have their head track locked to clip frame 0, so
   * capturing early (or reading the live value each frame) would either snap
   * the head off the clip pose or compound our own rotation every frame —
   * the head-spin bug that got procedural tracking disabled in the first place.
   */
  baseQuat: THREE.Quaternion | null;
  /** World up/right mapped into the bone's parent space (yaw/pitch axes). */
  yawAxis: THREE.Vector3;
  pitchAxis: THREE.Vector3;
};

/** Seconds to let the idle clip's 0.3s fade-in settle before capturing the base. */
const BASE_CAPTURE_DELAY = 0.6;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Smooth non-repeating drift in ~[-1,1]. */
function drift(t: number, seed: number): number {
  return Math.sin(t * 0.27 + seed) * 0.6 + Math.sin(t * 0.61 + seed * 2.3) * 0.4;
}

export interface PortraitGazeConfig {
  isSpeaking?: boolean;
  enabled?: boolean;
  assetName?: string;
  coachId?: string;
}

export function resolvePortraitEyeLook(
  baseline: PortraitGazeBaseline,
  tuning: Pick<LipsyncTuningValues, 'eyeHorizontalL' | 'eyeHorizontalR' | 'eyeVerticalL' | 'eyeVerticalR'>,
  syntheticX = 0,
  syntheticY = 0,
): PortraitGazeBaseline {
  const eyeXL = tuning.eyeHorizontalL + syntheticX;
  const eyeXR = tuning.eyeHorizontalR + syntheticX;
  const eyeYL = tuning.eyeVerticalL + syntheticY;
  const eyeYR = tuning.eyeVerticalR + syntheticY;
  return {
    rightL: THREE.MathUtils.clamp(baseline.rightL + Math.max(0, eyeXL), 0, 1),
    rightR: THREE.MathUtils.clamp(baseline.rightR + Math.max(0, eyeXR), 0, 1),
    leftL: THREE.MathUtils.clamp(baseline.leftL + Math.max(0, -eyeXL), 0, 1),
    leftR: THREE.MathUtils.clamp(baseline.leftR + Math.max(0, -eyeXR), 0, 1),
    upL: THREE.MathUtils.clamp(baseline.upL + Math.max(0, eyeYL), 0, 1),
    upR: THREE.MathUtils.clamp(baseline.upR + Math.max(0, eyeYR), 0, 1),
    downL: THREE.MathUtils.clamp(baseline.downL + Math.max(0, -eyeYL), 0, 1),
    downR: THREE.MathUtils.clamp(baseline.downR + Math.max(0, -eyeYR), 0, 1),
  };
}

export function usePortraitGaze(
  root: THREE.Object3D | null | undefined,
  { isSpeaking = false, enabled = true, assetName, coachId = '' }: PortraitGazeConfig = {},
): void {
  const morphsRef = useRef<GazeMorphs[]>([]);
  const headRef = useRef<HeadBinding | null>(null);
  const clock = useRef(0);
  /** Current + target gaze in normalized [-1,1] (x = right, y = up). */
  const gaze = useRef({ x: 0, y: 0, tx: 0, ty: 0, nextAt: rand(2.5, 5) });
  const headAngles = useRef({ yaw: 0, pitch: 0 });
  const scratch = useRef({
    quat: new THREE.Quaternion(),
    yawQuat: new THREE.Quaternion(),
    pitchQuat: new THREE.Quaternion(),
  });

  useEffect(() => {
    if (!root) {
      morphsRef.current = [];
      headRef.current = null;
      return;
    }

    const morphs: GazeMorphs[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      const byNorm = new Map<string, number>();
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        byNorm.set(normalizeName(name), index);
      }
      const slots: GazeMorphs['slots'] = {};
      let found = false;
      for (const [key, normKey] of Object.entries(EYE_LOOK) as Array<[keyof typeof EYE_LOOK, string]>) {
        const index = byNorm.get(normKey);
        if (index !== undefined) {
          slots[key] = index;
          found = true;
        }
      }
      if (found) morphs.push({ infl: mesh.morphTargetInfluences, slots });
    });
    morphsRef.current = morphs;

    // Head bone: MetaHuman rigs use "head", CC4 uses CC_Base_Head.
    let head: THREE.Object3D | null = null;
    root.traverse((obj) => {
      if (head) return;
      if (/^(head|CC_Base_Head)$/i.test(obj.name)) head = obj;
    });
    if (head) {
      const bone = head as THREE.Object3D;
      bone.updateWorldMatrix(true, false);
      const parentWorld = new THREE.Quaternion();
      (bone.parent ?? bone).getWorldQuaternion(parentWorld);
      const toParent = parentWorld.clone().invert();
      headRef.current = {
        bone,
        baseQuat: null,
        // World up (yaw) and world right (pitch) expressed in parent space.
        yawAxis: new THREE.Vector3(0, 1, 0).applyQuaternion(toParent).normalize(),
        pitchAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(toParent).normalize(),
      };
    } else {
      headRef.current = null;
    }
  }, [root]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const morphs = morphsRef.current;
    const head = headRef.current;
    if (!morphs.length && !head) return;

    const dt = Math.min(delta, 0.1);
    clock.current += dt;
    const t = clock.current;
    const g = gaze.current;

    // Re-target: mostly small glances, sometimes a re-fixation dead ahead.
    if (t >= g.nextAt) {
      if (Math.random() < 0.35) {
        g.tx = 0;
        g.ty = 0;
      } else {
        g.tx = rand(-0.55, 0.55) * rand(0.25, 1);
        // Looking down slightly is more natural than up (reading the board),
        // but keep the V2 iris comfortably inside the lids at all times.
        g.ty = rand(-0.35, 0.25) * rand(0.2, 1);
      }
      g.nextAt = t + rand(GAZE_GAP_MIN, GAZE_GAP_MAX);
    }

    const damp = isSpeaking ? SPEAKING_DAMP : 1;
    // Target + slow drift so the eyes never sit perfectly still.
    const targetX = THREE.MathUtils.clamp((g.tx + drift(t, 1.7) * 0.05) * damp, -1, 1);
    const targetY = THREE.MathUtils.clamp((g.ty + drift(t, 4.2) * 0.035) * damp, -1, 1);

    const eyeAlpha = 1 - Math.exp(-dt / EYE_TAU);
    g.x += (targetX - g.x) * eyeAlpha;
    g.y += (targetY - g.y) * eyeAlpha;

    // Eyes: split the signed gaze across the directional morph pairs.
    const baseline = getPortraitGazeBaseline(assetName);
    const tuning = getLipsyncTuningValuesForCoach(coachId);
    const look = resolvePortraitEyeLook(baseline, tuning, g.x * EYE_GAIN, g.y * EYE_GAIN);
    for (const entry of morphs) {
      const { infl, slots } = entry;
      if (slots.rightL !== undefined) infl[slots.rightL] = look.rightL;
      if (slots.rightR !== undefined) infl[slots.rightR] = look.rightR;
      if (slots.leftL !== undefined) infl[slots.leftL] = look.leftL;
      if (slots.leftR !== undefined) infl[slots.leftR] = look.leftR;
      if (slots.upL !== undefined) infl[slots.upL] = look.upL;
      if (slots.upR !== undefined) infl[slots.upR] = look.upR;
      if (slots.downL !== undefined) infl[slots.downL] = look.downL;
      if (slots.downR !== undefined) infl[slots.downR] = look.downR;
    }

    // Head: follows a fraction of the gaze, eased slower than the eyes.
    if (head) {
      // Capture the mixer's settled pose once, then always compose onto that
      // copy (never onto the live value — see HeadBinding.baseQuat).
      if (!head.baseQuat) {
        if (t < BASE_CAPTURE_DELAY) return;
        head.baseQuat = head.bone.quaternion.clone();
      }
      const ha = headAngles.current;
      const headAlpha = 1 - Math.exp(-dt / HEAD_TAU);
      const yawTarget = THREE.MathUtils.degToRad(tuning.headYawDegrees);
      const pitchTarget = THREE.MathUtils.degToRad(tuning.headPitchDegrees);
      ha.yaw += (yawTarget - ha.yaw) * headAlpha;
      ha.pitch += (pitchTarget - ha.pitch) * headAlpha;

      const { quat, yawQuat, pitchQuat } = scratch.current;
      yawQuat.setFromAxisAngle(head.yawAxis, ha.yaw);
      pitchQuat.setFromAxisAngle(head.pitchAxis, ha.pitch);
      // Apply in the PARENT frame (pre-multiply the captured pose) so the
      // baked head pitch and the idle clip's pose survive underneath.
      quat.copy(yawQuat).multiply(pitchQuat).multiply(head.baseQuat);
      head.bone.quaternion.copy(quat);
    }
  });
}

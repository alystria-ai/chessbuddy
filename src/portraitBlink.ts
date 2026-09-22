import * as THREE from 'three';
import { normalizeName } from './mhaToMorphMap';
import { getLipsyncTuningSnapshot, TUNED_LIPSYNC_VALUES } from './lipsyncTuning';

/** Exported for scripts/portrait-morph-keep.json sync check (coachModelKeepList.test.ts). */
export const BLINK_MORPHS = ['Eye_Blink_L', 'Eye_Blink_R'] as const;
/**
 * Normalized blink keys — matched against each mesh's morph dictionary so the
 * blink resolves on both CC4 ExpressionPlus rigs (Eye_Blink_L/R) and the
 * MetaHuman rig (CTRL_expressions_eyeBlinkL/R), which normalize to the same key.
 */
const BLINK_KEYS = new Set(BLINK_MORPHS.map(normalizeName));
/**
 * Channels that RAISE the upper lid (eye-widen / upper-lid-up). Morph targets
 * are additive: when the streamed performance holds the eyes widened during
 * speech, a full procedural blink sums with the raised lid and reads as a
 * barely-visible flutter — "she didn't blink". While a blink is in progress
 * these channels are scaled down by the blink amount so the close reads full.
 * Keys are normalized, covering CC4 (Eye_Widen_L) and MetaHuman
 * (CTRL_expressions_eyeWidenL) names.
 */
const LID_RAISE_KEYS = new Set(
  ['Eye_Widen_L', 'Eye_Widen_R', 'Eye_UpperLid_Up_L', 'Eye_UpperLid_Up_R'].map(normalizeName),
);
/**
 * MetaHuman eyeRelax — lowers ONLY the upper lid (the rig's sleepy-lid
 * control). Carries the resting droop; absent on CC4 rigs (droop no-ops).
 */
const DROOP_KEYS = new Set(
  ['CTRL_expressions_eyeRelaxL', 'CTRL_expressions_eyeRelaxR'].map(normalizeName),
);
const CLOSE_MS = 85;
const OPEN_MS = 100;
// Blink cadence: erring toward frequent reads better on camera (sparse blinks
// read as staring in video) — vendor feedback 2026-07-29 asked for more.
const READY_DELAY_MIN_MS = 1200;
const READY_DELAY_SPREAD_MS = 1500;
/**
 * Resting upper-lid droop: with the lids fully raised the characters read
 * wide-eyed/startled (vendor feedback). Driven through the MetaHuman
 * eyeRelax channel — NOT a held partial blink: the blink shape closes from
 * BOTH lids, so holding it pushed the lower lid up permanently and read as
 * under-eye bags ("she hasn't been sleeping"). eyeRelax lowers only the
 * upper lid. It fades out while an actual blink runs so the two shapes
 * never over-close additively.
 */
export const RESTING_LID_DROOP = TUNED_LIPSYNC_VALUES.blinkRestingDroop;
export type PortraitBlinkState = {
  phase: 'idle' | 'closing' | 'opening';
  phaseStartMs: number;
  nextBlinkMs: number;
};

function smoothstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function randomBlinkInterval(): number {
  const { blinkMinIntervalSeconds, blinkMaxIntervalSeconds } = getLipsyncTuningSnapshot().values;
  const min = blinkMinIntervalSeconds * 1000;
  const max = Math.max(min, blinkMaxIntervalSeconds * 1000);
  return min + Math.random() * (max - min);
}

export function createPortraitBlinkState(
  now = performance.now(),
  firstBlinkDelayMs = READY_DELAY_MIN_MS + Math.random() * READY_DELAY_SPREAD_MS,
): PortraitBlinkState {
  return {
    phase: 'idle',
    phaseStartMs: now,
    nextBlinkMs: now + firstBlinkDelayMs,
  };
}

export function getPortraitBlinkAmount(now: number, state: PortraitBlinkState): number {
  if (state.phase === 'idle') return 0;
  const elapsed = now - state.phaseStartMs;
  if (state.phase === 'closing') return smoothstep(elapsed / CLOSE_MS);
  return 1 - smoothstep(elapsed / OPEN_MS);
}

export function advancePortraitBlink(now: number, state: PortraitBlinkState): void {
  if (state.phase === 'idle') {
    if (now >= state.nextBlinkMs) {
      state.phase = 'closing';
      state.phaseStartMs = now;
    }
    return;
  }

  if (state.phase === 'closing' && now - state.phaseStartMs >= CLOSE_MS) {
    state.phase = 'opening';
    // Preserve elapsed time across missed frames (shader compile, tab resume).
    // Restarting at `now` would present fully closed eyes after a completed blink.
    state.phaseStartMs += CLOSE_MS;
  }

  if (state.phase === 'opening' && now - state.phaseStartMs >= OPEN_MS) {
    state.phase = 'idle';
    state.nextBlinkMs = now + randomBlinkInterval();
  }
}

type BlinkBinding = {
  influences: number[] | Float32Array;
  indices: number[];
  /** Slots of lid-raising morphs (eye-widen etc.) damped while blinking. */
  raiseIndices: number[];
  /** Slots of the eyeRelax morphs that carry the resting droop. */
  droopIndices: number[];
  isBody: boolean;
};

/** Blink meshes never change after load — cache them instead of traversing every frame. */
const blinkBindingsByRoot = new WeakMap<THREE.Object3D, BlinkBinding[]>();

/** Read the final combined lids, including authored and streamed blinks. */
export function getPortraitLidClosure(root: THREE.Object3D): number {
  let amount = 0;
  for (const binding of getBlinkBindings(root)) {
    for (const index of binding.indices) amount = Math.max(amount, binding.influences[index]);
  }
  return amount;
}

function getBlinkBindings(root: THREE.Object3D): BlinkBinding[] {
  const cached = blinkBindingsByRoot.get(root);
  if (cached) return cached;
  const bindings: BlinkBinding[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const indices: number[] = [];
    const raiseIndices: number[] = [];
    const droopIndices: number[] = [];
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary!)) {
      const key = normalizeName(name);
      if (BLINK_KEYS.has(key)) indices.push(index);
      else if (LID_RAISE_KEYS.has(key)) raiseIndices.push(index);
      else if (DROOP_KEYS.has(key)) droopIndices.push(index);
    }
    if (!indices.length) return;
    bindings.push({
      influences: mesh.morphTargetInfluences,
      indices,
      raiseIndices,
      droopIndices,
      isBody: /CC_Base_Body/i.test(mesh.name),
    });
  });
  blinkBindingsByRoot.set(root, bindings);
  return bindings;
}

/** Clears procedural blink morphs on eye meshes (body is driven each frame by applyPortraitBlink). */
export function resetPortraitBlinkMorphs(root: THREE.Object3D): void {
  for (const binding of getBlinkBindings(root)) {
    if (binding.isBody) continue;
    for (const index of binding.indices) binding.influences[index] = 0;
  }
}

/**
 * Drive the blink morphs. When `combine` is true the procedural blink is
 * max-combined with whatever blink level is already on the morphs this frame
 * (the Convai/neurosync performance's own eyeBlink), so the character keeps
 * blinking at the procedural rate during speech — the streamed blinks are kept
 * and procedural ones are added on top. When false (idle) it owns the morphs
 * with an absolute write.
 */
export function applyPortraitBlink(root: THREE.Object3D, now: number, state: PortraitBlinkState, combine = false): void {
  advancePortraitBlink(now, state);
  let amount = getPortraitBlinkAmount(now, state);
  const tuning = getLipsyncTuningSnapshot().values;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    // Deterministic visual-QA handle: 0 forces a fully open inspection frame,
    // 1 forces fully closed. This never exists in production builds.
    const override = (window as unknown as { __blinkOverride?: number }).__blinkOverride;
    // Dev handle: window.__blinkHold = 0.6 holds the lids partially closed
    // for eyelid inspection/screenshots; delete it to release.
    const hold = (window as unknown as { __blinkHold?: number }).__blinkHold;
    if (typeof override === 'number') amount = THREE.MathUtils.clamp(override, 0, 1);
    else if (typeof hold === 'number') amount = Math.max(amount, hold);
  }
  // Resting droop rides on eyeRelax (upper lid only) and fades out while a
  // blink runs so the two shapes never over-close additively.
  amount = THREE.MathUtils.clamp(amount * tuning.blinkStrength, 0, 1);
  const droop = tuning.blinkRestingDroop * (1 - amount);
  const dampLevel = Math.max(amount, tuning.eyeWidenDamping);

  for (const binding of getBlinkBindings(root)) {
    for (const index of binding.indices) {
      binding.influences[index] = combine
        ? Math.max(amount, binding.influences[index])
        : amount;
    }
    for (const index of binding.droopIndices) {
      binding.influences[index] = combine
        ? Math.max(droop, binding.influences[index])
        : droop;
    }
    // Damp lid-raising channels while the lid is lowered so the streamed
    // eye-widen can't additively cancel the blink — and, via the constant
    // floor, so full-strength widen never reads startled (see LID_RAISE_KEYS).
    for (const index of binding.raiseIndices) {
      binding.influences[index] *= 1 - dampLevel;
    }
  }
}

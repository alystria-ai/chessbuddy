// Ported from the convai-web-sdk neurosync-visual-react example (src/hooks/useEmotion.ts) — keep the two in sync.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { normalizeName } from "./mhaToMorphMap";
import { getLipsyncTuningSnapshot } from "./lipsyncTuning";

/**
 * useEmotion — procedural facial emotion layer for a CC4 character.
 *
 * A neutral resting face reads lifeless; real people carry a low-level
 * expression that ebbs and flows. This hook drives an emotion "recipe"
 * (a weighted set of expression morphs) with three stacked behaviours:
 *
 * - **Baseline** — a resting intensity (default: gently pleasant) that
 *   drifts slowly (fbm-ish incommensurate sines) so the face never freezes.
 * - **Moments** — every 6–14s the emotion swells toward a stronger peak,
 *   holds 1.5–3.5s and settles back: the "remembering something nice" beat
 *   that reads as inner life. Onset is faster than release (real smiles
 *   bloom quickly, fade slowly).
 * - **Speech awareness** — while talking, mouth-region channels are damped
 *   so visemes stay legible, and all channels combine with `max()` against
 *   the lipsync frame instead of overwriting it (NeuroSync's own brow/cheek
 *   motion survives; she can smile *through* speech without fighting it).
 *
 * Recipes are per-emotion morph weight tables — add new emotions (thoughtful,
 * surprised, concerned…) by adding a recipe; intensity/dynamics are shared.
 * Asymmetric L/R weights are deliberate: symmetric expressions read fake.
 *
 * Runs in a useFrame registered AFTER the lipsync hook so the max-combine
 * sees the current frame's viseme values. Owns its channels while idle
 * (absolute writes), cooperates during speech (max).
 */

export type EmotionName = "happy";

/** Morph weight tables at intensity 1. Tuned live against the CC4 rig. */
const RECIPES: Record<EmotionName, Record<string, number>> = {
  happy: {
    Mouth_Corner_Pull_L: 0.55,
    Mouth_Corner_Pull_R: 0.5,
    Mouth_Corner_Up_L: 0.2,
    Mouth_Corner_Up_R: 0.18,
    Mouth_Dimple_L: 0.25,
    Mouth_Dimple_R: 0.22,
    Eye_Cheek_Raise_L: 0.35,
    Eye_Cheek_Raise_R: 0.32,
    Brow_Raise_In_L: 0.15,
    Brow_Raise_In_R: 0.13,
    Brow_Raise_Outer_L: 0.1,
    Brow_Raise_Outer_R: 0.08,
  },
};

/** Channels that carry speech shapes — damped while talking. */
const MOUTH_RE = /^Mouth_/;

export interface EmotionConfig {
  /** Which recipe to play. */
  emotion?: EmotionName;
  /** Resting intensity the face returns to between moments (0-1). */
  baseline?: number;
  /** Slow drift amplitude around the baseline. */
  ebbAmount?: number;
  /** Min/max seconds between emotion "moments". */
  momentGapMin?: number;
  momentGapMax?: number;
  /** Intensity range a moment swells to. */
  momentPeakMin?: number;
  momentPeakMax?: number;
  /** Seconds a moment holds at peak. */
  momentHoldMin?: number;
  momentHoldMax?: number;
  /** Ease time constants (s): onset faster than release. */
  tauUp?: number;
  tauDown?: number;
  /** Multiplier on mouth-region channels while speaking. */
  talkingMouthDamp?: number;
  /** Ease (s) onto the speaking damp when speech starts. */
  speakAttack?: number;
  /**
   * Ease (s) off the speaking damp when speech ends. Slow on purpose: this is
   * the crossfade back to the resting smile, and a hard switch made the smile
   * snap on the instant lipsync finished.
   */
  speakRelease?: number;
  /** Whether the character is currently speaking. */
  isSpeaking?: boolean;
  /**
   * Shared overlay (morph name → value), max-combined by the lipsync tick
   * path. Needed because the blendshape queue applies frames on its own
   * timer — direct writes from this hook lose that race during speech.
   */
  overlayRef?: React.MutableRefObject<Map<string, number> | null>;
  enabled?: boolean;
}

interface EmotionTarget {
  infl: number[];
  /** [morph slot, recipe weight, is mouth channel] */
  slots: Array<[number, number, boolean]>;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Smooth non-repeating drift in ~[-1,1] (incommensurate sines). */
function drift(t: number, seed: number): number {
  return (
    Math.sin(t * 0.31 + seed) * 0.6 +
    Math.sin(t * 0.73 + seed * 2.7) * 0.4
  );
}

export function useEmotion(
  root: THREE.Object3D | null | undefined,
  config: EmotionConfig = {},
): void {
  const {
    emotion = "happy",
    baseline = 0.28,
    ebbAmount = 0.1,
    momentGapMin = 6,
    momentGapMax = 14,
    momentPeakMin = 0.55,
    momentPeakMax = 0.8,
    momentHoldMin = 1.5,
    momentHoldMax = 3.5,
    tauUp = 0.7,
    tauDown = 1.8,
    talkingMouthDamp = 0.35,
    speakAttack = 0.15,
    speakRelease = 0.55,
    isSpeaking = false,
    overlayRef,
    enabled = true,
  } = config;

  const targetsRef = useRef<EmotionTarget[]>([]);
  const clock = useRef(0);
  const intensity = useRef(baseline);
  /** Eased 0..1 "is speaking" so the mouth damp never steps (see useFrame). */
  const speakWeight = useRef(0);
  const moment = useRef({ peak: 0, until: 0, nextAt: rand(3, momentGapMax) });

  useEffect(() => {
    const recipe = RECIPES[emotion];
    const targets: EmotionTarget[] = [];
    root?.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.morphTargetDictionary || !m.morphTargetInfluences)
        return;
      // Match by NORMALIZED name, not the raw key: the recipe is written in
      // CC4 naming (Mouth_Corner_Pull_L) while the MetaHuman rigs expose the
      // same shapes as CTRL_expressions_mouthCornerPullL. An exact lookup
      // bound zero slots on every MetaHuman coach, so the whole emotion layer
      // was dead and the faces read permanently serious.
      const byNorm = new Map<string, number>();
      for (const [morphName, index] of Object.entries(m.morphTargetDictionary)) {
        byNorm.set(normalizeName(morphName), index);
      }
      const slots: Array<[number, number, boolean]> = [];
      for (const [name, weight] of Object.entries(recipe)) {
        const idx = byNorm.get(normalizeName(name));
        if (idx !== undefined) slots.push([idx, weight, MOUTH_RE.test(name)]);
      }
      if (slots.length) targets.push({ infl: m.morphTargetInfluences, slots });
    });
    targetsRef.current = targets;
  }, [root, emotion]);

  // Run after authored idle/gesture faces (priority 0.75) but before the live
  // Convai frame (priority 1). This preserves the established light smile on
  // the new synchronized chess performances without competing with speech.
  useFrame((_, delta) => {
    if (!enabled || !targetsRef.current.length) return;
    clock.current += delta;
    const t = clock.current;
    const mo = moment.current;

    // Schedule/expire emotion moments.
    if (mo.until <= t && t >= mo.nextAt) {
      mo.peak = rand(momentPeakMin, momentPeakMax);
      mo.until = t + rand(momentHoldMin, momentHoldMax);
      mo.nextAt = t + rand(momentGapMin, momentGapMax);
    }
    const inMoment = t < mo.until;

    // Target intensity: baseline + slow ebb, or the current moment's peak.
    const ebb = drift(t, 5.1) * ebbAmount;
    const target = THREE.MathUtils.clamp(
      inMoment ? mo.peak : baseline + ebb,
      0,
      1,
    );

    // Ease toward it — quick bloom, slow fade.
    const tau = target > intensity.current ? tauUp : tauDown;
    intensity.current +=
      (target - intensity.current) * (1 - Math.exp(-delta / tau));

    // Speech weight: eased, never a hard switch. The mouth damp used to flip
    // between talkingMouthDamp and 1 on the frame speech ended, so the resting
    // smile SNAPPED on the instant the lipsync tail finished. Easing it (fast
    // in, slow out) crossfades the smile back in over ~half a second, which is
    // also roughly how long the lipsync envelope takes to settle — the two
    // overlap instead of stepping.
    const speakTau = isSpeaking ? speakAttack : speakRelease;
    speakWeight.current += ((isSpeaking ? 1 : 0) - speakWeight.current)
      * (1 - Math.exp(-delta / speakTau));
    const sw = speakWeight.current;
    const mouthDamp = 1 + (talkingMouthDamp - 1) * sw;

    const k = intensity.current;
    const appStrength = getLipsyncTuningSnapshot().values.emotionStrength;
    for (const tgt of targetsRef.current) {
      for (const [slot, weight, isMouth] of tgt.slots) {
        const v = (isMouth ? weight * k * mouthDamp : weight * k) * appStrength;
        // While any speech weight remains, cooperate with the lipsync frame
        // (max) instead of overwriting it; once it has fully decayed the
        // emotion owns the channel outright. Both agree at the crossover
        // because the lipsync frame is already at rest by then.
        tgt.infl[slot] = sw > 0.01 ? Math.max(tgt.infl[slot], v) : v;
      }
    }

    // Publish the current values for the lipsync tick path to max-combine
    // (its frames apply outside the r3f loop and would overwrite us).
    if (overlayRef?.current) {
      const overlay = overlayRef.current;
      const recipe = RECIPES[emotion];
      for (const [name, weight] of Object.entries(recipe)) {
        const isMouth = MOUTH_RE.test(name);
        overlay.set(name, (isMouth ? weight * k * mouthDamp : weight * k) * appStrength);
      }
    }
  }, 0.8);
}

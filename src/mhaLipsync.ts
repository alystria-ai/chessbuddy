import * as THREE from 'three';
import {
  METAHUMAN_ORDER_251,
  applyMhaLimits,
  createMhaGainMask,
  symmetrizeMhaMouth,
} from '@convai/web-sdk/lipsync-helpers';
import { buildMhaMeshMap, type MhaMeshMap } from './mhaToMorphMap';
import { buildMhaCorrectives, type MhaCorrectiveSet } from './mhaCorrectives';
import {
  CHANNEL_COUNT,
  JAW_CHANNELS,
  MOUTH_INDICES,
  TEETH_INDICES,
  TONGUE_INDICES,
} from './mhaChannels';
import {
  applyJawTeeth,
  DEFAULT_TEETH_Y_OFFSETS,
  findJawTeethBones,
  JAW_OPEN_MAX_Z,
  JAW_OPEN_MHA_INDEX,
  type JawTeethBones,
  type TeethYOffsets,
} from './mhaJawBones';
import { isRawNeurosyncPassthrough } from './lipsyncRawMode';

/**
 * MHA-251 → CC4 lipsync application, ported from the convai-web-sdk
 * neurosync-visual-react example (src/lipsync/useSofiaLipsync.ts). The Convai
 * connection streams MHA frames (blendshapeConfig.format 'mha'); each frame is
 * applied 1:1 onto ExpressionPlus morphs by normalized name, then the Unreal
 * limit drivers and C_* combination correctives run on top, and the jaw/teeth
 * bones open from the raw jawOpen channel.
 *
 * The React-hook state of the example is flattened into an explicit state
 * object so the chess portrait component can drive it from useFrame.
 */

/**
 * Smooth incoming frames before applying. Light per the SDK naturalness guide
 * (§1.7 transient preservation): heavy temporal smoothing melts hard-consonant
 * attacks into mush, and the bloom/settle envelope already guards the start
 * and end of speech — 0.92/frame @60fps is "barely smoothing".
 */
export const LIPSYNC_LERP_FACTOR = 0.92;
/** Ease jaw bone open/close (example JAW_OPEN_SMOOTH), per 60fps tick. */
const JAW_OPEN_SMOOTH = 0.35;
/** Sofia production default: non-mouth channels attenuated to 0.8. */
const NON_MOUTH_GAIN = 0.8;
/**
 * After speech, lerp morphs back to 0 at a flat 0.18 per display frame —
 * EXACTLY like the example's normalize phase (per-rAF, not dt-corrected).
 * A dt-corrected variant closed the mouth twice as slowly on 120Hz displays,
 * which read as the lips writhing through the close.
 */
const NORMALIZE_LERP = 0.18;
const NORMALIZE_THRESHOLD = 0.005;

/**
 * Assets whose jaw opens via the jawOpen MORPH rather than a jaw bone.
 * Since the all-MetaHuman model drop (2026-07-24) EVERY coach is a MetaHuman
 * rig with no jaw bone — jawOpen is a morph target on all of them. The CC4
 * bone-jaw path (mhaJawBones) remains for any future CC4 asset.
 */
const DRIVE_JAW_VIA_MORPH = new Set(['Sofia', 'Vincent', 'Tyler', 'Leila']);

/**
 * SDK naturalness-stack constants (docs: "MetaHuman limit drivers — REQUIRED
 * for mha", adopted 2026-07-28 at the vendor's request). The old soft-knee
 * jaw compressor and hand-tuned METAHUMAN_GAINS are replaced by the SDK's
 * production gain table (createMhaGainMask: jawOpen 0.72, jawOpenExtreme
 * 0.42, lateral shifts 0, upperLipRaise 0.6, lowerLipDepress 0.45,
 * lipsTogether 0.8, funnel/purse 1.15) plus the pieces below that the
 * table alone can't express.
 */
/** §1.5 hard jaw cap — kills rare peak excursions, leaves articulation alone.
 * 0.5 on our heads (the guide's 0.55 read too wide on peaks: jawOpenExtreme
 * stacks on top — see the gain override in buildChannelGains). */
const JAW_APPLIED_CAP = 0.5;
/** §1.4 bloom & settle envelope time constants (seconds). */
const ENVELOPE_ATTACK_TAU = 0.09;
const ENVELOPE_RELEASE_TAU = 0.18;
/**
 * §1.6 bilabial closure floor: lipsTogether* comes from jawOpen via the limit
 * coupling — near zero exactly when the jaw closes for /p/ /b/ /m/. Drive the
 * contact directly as the jaw closes (0.5 ceiling = "lips touching";
 * 0.65+ read over-pressed on camera per the guide).
 */
const BILABIAL_JAW_FLOOR = 0.02;
const BILABIAL_JAW_RANGE = 0.16;
const BILABIAL_THRESHOLD = 0.45;
const BILABIAL_SEAL_CEILING = 0.5;

/** MHA indices of the four mouthLipsTogether* channels (bilabial floor targets). */
const LIPS_TOGETHER_INDICES: readonly number[] = METAHUMAN_ORDER_251.flatMap(
  (ctrl, i) => (/^CTRL_expressions_mouthLipsTogether/.test(ctrl) ? [i] : []),
);

/**
 * Directional eye-look controls. On CC4 rigs useEyeTracking rotates the eye
 * bones (locking the gaze to the viewer) and overwrites these every frame. The
 * MetaHuman rig (Sofia) has no eye bones, so that hook bails out and the
 * streamed eye-look would drive the eyeball morphs directly — the eyes wander.
 * For bone-less rigs we skip these so the eyes rest forward on the viewer.
 * (Blink channels are NOT skipped — she keeps blinking while speaking.)
 */
const EYE_LOOK_CONTROLS = [
  'eyeLookLeftL', 'eyeLookRightL', 'eyeLookUpL', 'eyeLookDownL',
  'eyeLookLeftR', 'eyeLookRightR', 'eyeLookUpR', 'eyeLookDownR',
  'eyeParallelLookDirection',
];

/**
 * Per-asset channel skip mask. teeth channels are always off (held at the
 * static tuck instead); the jawOpen morphs are skipped only for bone-jaw
 * assets, and the eye-look channels only for bone-less rigs (see
 * DRIVE_JAW_VIA_MORPH). Tongue channels are OFF for CC4 rigs (their tongue
 * was bone-driven/absent) but LIVE on the MetaHuman rigs: the drop ships
 * working tongue morphs (verified with a forced tongueOut/tongueUp render),
 * and masking them played L/TH/D/N sounds with a dead tongue — the "few
 * sounds not lip-synced correctly" the vendor's artist flagged.
 */
function buildSkipMask(assetName?: string): Uint8Array {
  // The mask describes the TUNED pipeline; raw passthrough ignores it at
  // apply time (per-frame check, so the dev-menu toggle works live).
  const mask = new Uint8Array(CHANNEL_COUNT);
  for (const i of TEETH_INDICES) mask[i] = 1;
  if (!DRIVE_JAW_VIA_MORPH.has(assetName ?? '')) {
    // Legacy CC4 path: bone-driven jaw/tongue, and jawFwd read as an
    // unnatural jut on those rigs.
    const jawFwd = CHANNEL_INDEX.jawFwd;
    if (jawFwd !== undefined) mask[jawFwd] = 1;
    for (const i of TONGUE_INDICES) mask[i] = 1;
    for (const ch of JAW_CHANNELS) {
      if (ch.key === 'jawOpen' || ch.key === 'jawOpenExtreme') mask[ch.index] = 1;
    }
  } else {
    // MetaHuman rigs follow the SDK naturalness stack: jawOpenExtreme and
    // jawFwd are LIVE (the SDK gain table scales the extreme to 0.42), and
    // only the eye channels are held for the procedural blink/gaze systems
    // (the stack's skipEyeChannels — two writers race into flicker).
    for (const control of EYE_LOOK_CONTROLS) {
      const idx = CHANNEL_INDEX[control];
      if (idx !== undefined) mask[idx] = 1;
    }
    // The stream blinks sparsely and at partial amplitude; the portrait's
    // procedural blink overlays every frame and owns the eyes on this rig.
    for (const control of ['eyeBlinkL', 'eyeBlinkR', 'eyeLidPressL', 'eyeLidPressR']) {
      const idx = CHANNEL_INDEX[control];
      if (idx !== undefined) mask[idx] = 1;
    }
  }
  return mask;
}

/**
 * Constant values held on SKIPPED channels (instead of 0) per asset. Sofia's
 * teeth are morph-driven (no CC_Base_Teeth bones to offset like the CC4
 * coaches' ASSET_TEETH_Y_OFFSETS): the MetaHuman teethUpU/teethDownD shapes
 * tuck the upper row up / lower row down behind the lips. These shapes travel
 * a LONG way per unit — 0.2 already hides the teeth completely (reads
 * toothless), while ~0.05 turns the bright white band at a wide-open jaw into
 * a faint natural hint. Verified against portrait renders at jawOpen 0.55
 * (teethUpD/teethDownU are the swapped-row channels and bare the teeth).
 */
// teethDownD is much higher than teethUpU because the lower row is the one
// that over-exposes (molars/premolars showing on lower-lip-depress shapes) —
// pairs with the mouthLowerLipDepress gain damp in METAHUMAN_GAINS. At 0.2,
// a heavy depress+stretch shape shows only the crown tips and the row ends
// stay under the lip corners (verified against Sofia portrait renders; the
// other coaches share the MetaHuman shape semantics since the 2026-07-24
// all-MetaHuman drop, so they start from the same tuck).
const METAHUMAN_TEETH_TUCK = { teethUpU: 0.05, teethDownD: 0.2 } as const;

const ASSET_STATIC_CHANNELS: Record<string, Record<string, number>> = {
  Sofia: METAHUMAN_TEETH_TUCK,
  Vincent: METAHUMAN_TEETH_TUCK,
  Tyler: METAHUMAN_TEETH_TUCK,
  Leila: METAHUMAN_TEETH_TUCK,
};

function buildStaticValues(assetName?: string): Float32Array | null {
  const overrides = assetName ? ASSET_STATIC_CHANNELS[assetName] : undefined;
  if (!overrides) return null;
  const values = new Float32Array(CHANNEL_COUNT);
  for (const [control, value] of Object.entries(overrides)) {
    const idx = CHANNEL_INDEX[control];
    if (idx !== undefined) values[idx] = value;
  }
  return values;
}

const DEFAULT_GAIN: Float32Array = (() => {
  const mask = new Float32Array(CHANNEL_COUNT);
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    mask[i] = MOUTH_INDICES.has(i) ? 1 : NON_MOUTH_GAIN;
  }
  return mask;
})();

/** short control name (e.g. "mouthLipsTogetherUL") → MHA-251 frame index. */
const CHANNEL_INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  METAHUMAN_ORDER_251.forEach((ctrl, i) => {
    map[ctrl.replace(/^CTRL_expressions_/, '')] = i;
  });
  return map;
})();

/**
 * Per-head channel-gain tweaks for legacy CC4 assets (asset name → control →
 * multiplier on top of the default gain). MetaHuman rigs do NOT use this —
 * they take the SDK's production gain table (createMhaGainMask), which
 * replaced the old hand-tuned METAHUMAN_GAINS damps at the vendor's request:
 * the table's lowerLipDepress 0.45 / upperLipRaise 0.6 / lipsTogether 0.8
 * handle teeth exposure, and cornerPull/stretch stay at 1.0 (the SDK guide:
 * amplified corner spread reads as a grimace, but damping it isn't needed
 * once the mouth is symmetrized and the limits run on the raw frame).
 */
const ASSET_CHANNEL_GAINS: Record<string, Record<string, number>> = {};

/**
 * Per-head teeth Y offsets (bone-local, from rest). Magnus's teeth show
 * through the lips at the example's default 0.35 — tuck his upper row up and
 * lower row down a little further.
 */
const ASSET_TEETH_Y_OFFSETS: Record<string, TeethYOffsets> = {
  // Magnus: raise the upper row so it peeks naturally under the upper lip,
  // and drop the lower row slightly. NOTE the sign convention: bone
  // position.y moves in the PARENT frame, whose +Y points world-DOWN on these
  // rigs (measured from the GLB) — negative = up. A/B'd live with a
  // forced-open jaw: +0.35 (example default) dangles the row mid-mouth
  // showing gums, -0.8 hides it fully behind the lip, -0.45 shows a natural
  // band of upper teeth.
  Vincent: { upper: -0.45, lower: 0.25 },
  // Leila: same tuck as Magnus, verified at her full jaw range.
  Leila: { upper: -0.45, lower: 0.25 },
};

/**
 * Per-head jaw-bone range (radians of local Z at jawOpen 1). The cc-female
 * rig (Leila) opens far less per radian than the others — at the default 0.25
 * her mouth barely parts; 0.78 (the value the old ARKit pipeline shipped for
 * her) gives a full natural opening, A/B'd live with a forced-open jaw.
 */
const ASSET_JAW_OPEN_MAX_Z: Record<string, number> = {
  Leila: 0.78,
};

function buildChannelGains(assetName?: string): Float32Array {
  // MetaHuman rigs: the SDK's production-tuned table (jawOpen 0.72,
  // lateral 0, upperLipRaise 0.6, lowerLipDepress 0.45, lipsTogether 0.8,
  // funnel/purse 1.15, everything else 1) with per-character overrides:
  // - jawOpenExtreme 0.42 → 0.28: both jaw morphs deform the mandible on
  //   these heads and the jawOpen→jawOpenExtreme coupling fires the extreme
  //   whenever jawOpen peaks, so at the table value the two stacked into a
  //   too-wide open on loud vowels ("her jaw opens too much sometimes").
  // - brow raise cluster 1.0 → 0.55: the table leaves non-mouth channels at
  //   full strength, but the stream's brow-raise beats shove the brows and
  //   forehead up too far on emphasis ("eyebrows move up too much
  //   sometimes"; the old pipeline's 0.8 non-mouth damp also covered this).
  //   browDown/browLateral stay at 1 — only the upward move overshoots.
  if (DRIVE_JAW_VIA_MORPH.has(assetName ?? '')) {
    return createMhaGainMask({
      jawOpenExtreme: 0.28,
      browRaiseInL: 0.55,
      browRaiseInR: 0.55,
      browRaiseOuterL: 0.55,
      browRaiseOuterR: 0.55,
    });
  }
  const overrides = assetName ? ASSET_CHANNEL_GAINS[assetName] : undefined;
  if (!overrides) return DEFAULT_GAIN;
  const gain = new Float32Array(DEFAULT_GAIN);
  for (const [control, multiplier] of Object.entries(overrides)) {
    const index = CHANNEL_INDEX[control];
    if (index !== undefined) gain[index] *= multiplier;
  }
  return gain;
}

type MeshBinding = {
  mesh: THREE.SkinnedMesh;
  map: MhaMeshMap;
  corr: MhaCorrectiveSet;
};

export type MhaLipsyncState = {
  bindings: MeshBinding[];
  jawTeeth: JawTeethBones;
  /** Per-channel gain (default gain × per-asset overrides). */
  gain: Float32Array;
  /** Per-channel skip mask (teeth/tongue always; jawOpen for bone-jaw assets). */
  skip: Uint8Array;
  /** Constant values held on skipped channels (per-asset teeth tuck etc.). */
  staticValues: Float32Array | null;
  /** True when the jawOpen MORPH drives the mouth (bone-less rig) — its channel gets the soft-knee compressor. */
  jawViaMorph: boolean;
  /** Teeth bone Y offsets (per-asset; example default 0.35/0.35). */
  teethOffsets: TeethYOffsets;
  /** Jaw-bone Z range at jawOpen 1 (per-asset; example default 0.25). */
  jawOpenMaxZ: number;
  /** Lerped copy of the incoming MHA frame; reapplied after the mixer. */
  smoothedFrame: Float32Array | null;
  /** Scratch copy of the incoming frame for in-place SDK shaping (symmetrize/limits). */
  shapeScratch: Float32Array | null;
  /** §1.4 bloom/settle envelope (0..1) — scales every applied channel on MetaHuman rigs. */
  envelope: number;
  /** Raw (pre-shaping) jawOpen of the latest frame — drives the bilabial floor. */
  lastRawJawOpen: number;
  jawOpenTarget: number;
  jawOpenSmooth: number;
  isActive: boolean;
  lastLerpAtMs: number;
  /** Total matched MHA controls across bindings (constant after bind). */
  matchedCount: number;
  /** Total combination correctives across bindings (constant after bind). */
  correctiveCount: number;
};

export type MhaLipsyncApplyStats = {
  jawOpen: number;
  matched: number;
  correctives: number;
};

export function createMhaLipsyncState(assetName?: string): MhaLipsyncState {
  return {
    bindings: [],
    jawTeeth: { jaw: null, teeth: [] },
    gain: buildChannelGains(assetName),
    skip: buildSkipMask(assetName),
    staticValues: buildStaticValues(assetName),
    jawViaMorph: DRIVE_JAW_VIA_MORPH.has(assetName ?? ''),
    teethOffsets: (assetName && ASSET_TEETH_Y_OFFSETS[assetName]) || DEFAULT_TEETH_Y_OFFSETS,
    jawOpenMaxZ: (assetName && ASSET_JAW_OPEN_MAX_Z[assetName]) || JAW_OPEN_MAX_Z,
    smoothedFrame: null,
    shapeScratch: null,
    envelope: 0,
    lastRawJawOpen: 0,
    jawOpenTarget: 0,
    jawOpenSmooth: 0,
    isActive: false,
    lastLerpAtMs: 0,
    matchedCount: 0,
    correctiveCount: 0,
  };
}

/** Bind every skinned mesh whose morphs match MHA controls (face, brows, lashes…). */
export function bindMhaLipsyncMeshes(state: MhaLipsyncState, root: THREE.Object3D): number {
  if (state.bindings.length) return state.bindings.length;
  const bindings: MeshBinding[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const map = buildMhaMeshMap(mesh.morphTargetDictionary);
    if (map.matched > 0) {
      bindings.push({ mesh, map, corr: buildMhaCorrectives(mesh.morphTargetDictionary) });
    }
  });
  state.bindings = bindings;
  state.matchedCount = bindings.reduce((sum, b) => sum + b.map.matched, 0);
  state.correctiveCount = bindings.reduce((sum, b) => sum + b.corr.correctives.length, 0);
  state.jawTeeth = findJawTeethBones(root);
  // Seed the per-asset static channel values (teeth tuck) at bind time so the
  // pose is right from the first rendered frame, not only once speech starts.
  if (state.staticValues) snapMhaLipsyncNeutral(state);
  // Dev handle: force the jaw open from the console to inspect teeth
  // placement (state.jawOpenTarget = 0.7 while idle holds the mouth open).
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    ((window as unknown as { __mhaStates?: MhaLipsyncState[] }).__mhaStates ??= []).push(state);
  }
  return bindings.length;
}

export function getMhaMatchedCount(state: MhaLipsyncState): number {
  return state.matchedCount;
}

/**
 * Core per-frame write. MetaHuman rigs: the frame arrives already shaped by
 * the SDK stack (symmetrize → limit couplings → smoothing happens around
 * this call), so the write is gains × envelope with the §1.5 jaw cap and the
 * §1.6 bilabial floor on top. CC4 rigs keep the legacy path (gains, then the
 * hand-ported limit drivers, then correctives).
 */
function applyFrameToBindings(state: MhaLipsyncState, frame: Float32Array): void {
  const raw = isRawNeurosyncPassthrough();
  const env = state.jawViaMorph ? state.envelope : 1;
  for (const b of state.bindings) {
    const infl = b.mesh.morphTargetInfluences;
    if (!infl) continue;
    const map = b.map.indexByMha;
    const statics = state.staticValues;
    for (let i = 0; i < map.length; i++) {
      const slot = map[i];
      if (slot < 0) continue;
      if (raw) {
        // Raw passthrough: streamed value 1:1 — no skip mask, no statics,
        // no gains, no envelope, no cap.
        infl[slot] = frame[i];
      } else if (state.skip[i]) {
        infl[slot] = statics ? statics[i] : 0;
      } else {
        let v = frame[i] * state.gain[i] * env;
        // §1.5: the gain scales everything; the cap kills only the rare
        // peak excursions that read exaggerated on camera.
        if (state.jawViaMorph && i === JAW_OPEN_MHA_INDEX && v > JAW_APPLIED_CAP) {
          v = JAW_APPLIED_CAP;
        }
        infl[slot] = v;
      }
    }

    // Raw passthrough: nothing synthesized on top of the stream.
    if (raw) continue;

    if (state.jawViaMorph) {
      // §1.6 bilabial closure floor: lipsTogether* is coupled FROM jawOpen,
      // which is near zero exactly when the jaw closes for /p/ /b/ /m/ —
      // drive the lip contact directly as the jaw closes.
      const bilabial = 1 - clamp01((state.lastRawJawOpen - BILABIAL_JAW_FLOOR) / BILABIAL_JAW_RANGE);
      if (bilabial > BILABIAL_THRESHOLD && state.isActive) {
        const seal = ((bilabial - BILABIAL_THRESHOLD) / (1 - BILABIAL_THRESHOLD))
          * BILABIAL_SEAL_CEILING * env;
        for (const li of LIPS_TOGETHER_INDICES) {
          const tslot = map[li];
          if (tslot >= 0 && infl[tslot] < seal) infl[tslot] = seal;
        }
      }
    } else {
      // Legacy CC4: limit ("in-between") drivers — target = max(target, source).
      for (const lm of b.corr.limits) {
        if (state.skip[lm.targetIdx]) continue;
        const tslot = map[lm.targetIdx];
        if (tslot < 0) continue;
        const v = frame[lm.sourceIdx] * state.gain[lm.targetIdx];
        if (v > infl[tslot]) infl[tslot] = v;
      }
    }

    // Combination correctives (Unreal table): C_* morph = PRODUCT of its
    // input controls, valued as the face actually DISPLAYS them — gains,
    // envelope, and static held channels included.
    for (const c of b.corr.correctives) {
      let v = 1;
      for (const idx of c.inputs) v *= correctiveInputValue(state, frame, idx, env);
      infl[c.slot] = v;
    }
  }
}

/**
 * The value a corrective input channel is effectively driven to on screen:
 * - jawOpen on bone-jaw rigs: the raw channel (the bone opens from it);
 * - skipped channels: their static held value (teeth tuck) or 0;
 * - everything else: the gained, envelope-weighted channel value.
 */
function correctiveInputValue(state: MhaLipsyncState, frame: Float32Array, i: number, env: number): number {
  if (i === JAW_OPEN_MHA_INDEX && !state.jawViaMorph) return frame[i];
  if (state.skip[i]) return state.staticValues ? state.staticValues[i] : 0;
  return frame[i] * state.gain[i] * env;
}

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

function lerpFrame(state: MhaLipsyncState, target: Float32Array): Float32Array {
  // Raw passthrough: no input smoothing — the streamed frame applies as-is.
  // (smoothedFrame still tracks it so the post-speech decay has a start pose.)
  if (isRawNeurosyncPassthrough()) {
    if (!state.smoothedFrame || state.smoothedFrame.length !== target.length) {
      state.smoothedFrame = new Float32Array(target);
    } else {
      state.smoothedFrame.set(target);
    }
    state.lastLerpAtMs = performance.now();
    return state.smoothedFrame;
  }
  const now = performance.now();
  const dtMs = state.lastLerpAtMs > 0 ? Math.min(100, Math.max(4, now - state.lastLerpAtMs)) : 1000 / 60;
  state.lastLerpAtMs = now;
  // Frame-rate independent smoothing: LIPSYNC_LERP_FACTOR is calibrated for 60fps ticks.
  const alpha = 1 - Math.pow(1 - LIPSYNC_LERP_FACTOR, dtMs / (1000 / 60));
  if (!state.smoothedFrame || state.smoothedFrame.length !== target.length) {
    state.smoothedFrame = new Float32Array(target);
    return state.smoothedFrame;
  }
  for (let i = 0; i < target.length; i++) {
    const lerped = state.smoothedFrame[i] + (target[i] - state.smoothedFrame[i]) * alpha;
    state.smoothedFrame[i] = Math.max(0, Math.min(1, lerped));
  }
  return state.smoothedFrame;
}

/**
 * Apply one incoming MHA-251 frame to all bound meshes.
 * MetaHuman rigs run the SDK naturalness order first — symmetrize L/R mouth
 * pairs, apply the rig limit couplings — on a scratch copy (queue frames are
 * shared, never mutate them), then light smoothing, then the gains/envelope
 * write in applyFrameToBindings.
 */
export function applyMhaLipsyncFrame(
  state: MhaLipsyncState,
  frame: Float32Array,
): MhaLipsyncApplyStats {
  const raw = isRawNeurosyncPassthrough();
  state.lastRawJawOpen = clamp01(frame[JAW_OPEN_MHA_INDEX]);

  let shaped = frame;
  if (!raw && state.jawViaMorph && frame.length >= CHANNEL_COUNT) {
    if (!state.shapeScratch || state.shapeScratch.length !== frame.length) {
      state.shapeScratch = new Float32Array(frame.length);
    }
    state.shapeScratch.set(frame);
    symmetrizeMhaMouth(state.shapeScratch);
    applyMhaLimits(state.shapeScratch);
    shaped = state.shapeScratch;

    // §1.4 bloom: ramp the envelope in over ~0.25s at speech start so the
    // first frame doesn't pop the mouth open.
    const now = performance.now();
    const dtSec = state.lastLerpAtMs > 0
      ? Math.min(0.1, Math.max(0.004, (now - state.lastLerpAtMs) / 1000))
      : 1 / 60;
    state.envelope += (1 - state.envelope) * (1 - Math.exp(-dtSec / ENVELOPE_ATTACK_TAU));
  }

  const smoothed = lerpFrame(state, shaped);
  state.isActive = true;
  applyFrameToBindings(state, smoothed);
  // Jaw bone target from the RAW frame: the bone already has its own easing
  // in applyMhaJawMotion (JAW_OPEN_SMOOTH). Sourcing it from the smoothed
  // frame filtered the jaw TWICE, so on bone-jaw rigs the jaw trailed the
  // lips by ~90-150ms — the mouth read floppy.
  state.jawOpenTarget = state.lastRawJawOpen;
  return {
    jawOpen: state.jawOpenTarget,
    matched: state.matchedCount,
    correctives: state.correctiveCount,
  };
}

/** Reapply the current smoothed frame after the animation mixer so lipsync wins. */
export function reapplyMhaLipsyncFrame(state: MhaLipsyncState): void {
  if (!state.isActive || !state.smoothedFrame) return;
  applyFrameToBindings(state, state.smoothedFrame);
}

/**
 * Ease the smoothed jawOpen toward its target and rotate the jaw/teeth bones.
 * Call from a useFrame registered LAST so it's the final write of the frame
 * and the idle mixer can't overwrite it (example applyJaw).
 * `deltaSeconds` makes the ease frame-rate independent — the flat 0.35/rAF
 * doubled the jaw lag on 30fps renders and halved it at 120Hz.
 */
export function applyMhaJawMotion(state: MhaLipsyncState, deltaSeconds: number = 1 / 60): void {
  const alpha = 1 - Math.pow(1 - JAW_OPEN_SMOOTH, Math.min(deltaSeconds, 0.1) * 60);
  state.jawOpenSmooth += (state.jawOpenTarget - state.jawOpenSmooth) * alpha;
  applyJawTeeth(state.jawTeeth, state.jawOpenSmooth, state.teethOffsets, state.jawOpenMaxZ);
}

/**
 * Post-speech normalization. MetaHuman rigs settle via the §1.4 envelope
 * (time-based, release τ 0.18s — the held pose fades in amplitude instead of
 * each channel racing to zero); CC4 and raw mode keep the example's flat
 * per-rAF lerp. Deactivates once everything is near rest.
 */
export function decayMhaLipsyncMorphs(state: MhaLipsyncState, deltaSeconds: number = 1 / 60): void {
  if (!state.smoothedFrame) {
    state.jawOpenTarget = 0;
    state.isActive = false;
    return;
  }
  state.lastLerpAtMs = performance.now();

  if (state.jawViaMorph && !isRawNeurosyncPassthrough()) {
    const dt = Math.min(0.1, Math.max(0, deltaSeconds));
    state.envelope *= Math.exp(-dt / ENVELOPE_RELEASE_TAU);
    // The bilabial floor must not hold the lips sealed through the settle.
    state.lastRawJawOpen = 1;
    applyFrameToBindings(state, state.smoothedFrame);
    state.jawOpenTarget = clamp01(state.smoothedFrame[JAW_OPEN_MHA_INDEX] * state.envelope);
    if (state.envelope <= 0.02) snapMhaLipsyncNeutral(state);
    return;
  }

  const keep = 1 - NORMALIZE_LERP;
  let maxValue = 0;
  for (let i = 0; i < state.smoothedFrame.length; i++) {
    state.smoothedFrame[i] *= keep;
    if (state.smoothedFrame[i] > maxValue) maxValue = state.smoothedFrame[i];
  }
  applyFrameToBindings(state, state.smoothedFrame);
  // The jaw follows the decaying frame back to rest.
  state.jawOpenTarget = clamp01(state.smoothedFrame[JAW_OPEN_MHA_INDEX]);
  if (maxValue <= NORMALIZE_THRESHOLD) {
    snapMhaLipsyncNeutral(state);
  }
}

/** Snap all driven morphs to rest and hand the jaw back to its eased close. */
export function snapMhaLipsyncNeutral(state: MhaLipsyncState): void {
  // Raw passthrough holds nothing at rest (no teeth tuck statics).
  const statics = isRawNeurosyncPassthrough() ? null : state.staticValues;
  for (const b of state.bindings) {
    const infl = b.mesh.morphTargetInfluences;
    if (!infl) continue;
    const map = b.map.indexByMha;
    for (let i = 0; i < map.length; i++) {
      if (map[i] >= 0) infl[map[i]] = state.skip[i] && statics ? statics[i] : 0;
    }
    for (const c of b.corr.correctives) infl[c.slot] = 0;
  }
  state.smoothedFrame = null;
  state.envelope = 0;
  state.lastRawJawOpen = 0;
  state.jawOpenTarget = 0;
  state.isActive = false;
  state.lastLerpAtMs = 0;
}

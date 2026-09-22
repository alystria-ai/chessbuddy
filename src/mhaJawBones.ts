import * as THREE from "three";
import { METAHUMAN_ORDER_251 } from "@convai/web-sdk/lipsync-helpers";

/**
 * Jaw / teeth bone control, fully driven by the neurosync `jawOpen` channel
 * (no manual sliders). The jaw bone is `CC_Base_JawRoot`, opened on local Z;
 * the teeth bones (`CC_Base_Teeth01` upper, `CC_Base_Teeth02` lower) track the
 * opening on x/y/z. All rotations are deltas from each bone's captured rest.
 */
// Ported from the convai-web-sdk neurosync-visual-react example (src/lipsync/jawBones.ts) — keep in sync.

/** Index of CTRL_expressions_jawOpen (0..1) in an MHA-251 frame. */
export const JAW_OPEN_MHA_INDEX = METAHUMAN_ORDER_251.indexOf(
  "CTRL_expressions_jawOpen",
);

/** Jaw-bone local-Z rotation (radians) at a full (1.0) jawOpen. */
export const JAW_OPEN_MAX_Z = 0.25;

/**
 * Teeth-bone rotation (radians, x/y/z) at a full (1.0) jawOpen — tune to taste.
 * The lower-teeth bone is a child of the jaw, so it already follows the jaw's Z
 * open; these are the extra per-axis deltas applied on top.
 */
export const TEETH_OPEN_ROT = { x: 0, y: 0, z: -0.042 };

/** Fixed teeth-bone vertical (local-Y) position offset from rest. */
export const TEETH_Y_OFFSET = 0.35;

const JAW_BONE_NAMES = ["CC_Base_JawRoot", "JawRoot"];
const TEETH_BONE_NAMES = [
  "CC_Base_Teeth01",
  "CC_Base_Teeth02",
  "Teeth01",
  "Teeth02",
];

interface BoneRest {
  bone: THREE.Bone;
  restX: number;
  restY: number;
  restZ: number;
  /** Rest local position Y — baseline for the manual teeth up/down offset. */
  posY: number;
}

export interface JawTeethBones {
  jaw: BoneRest | null;
  teeth: BoneRest[];
}

function captureRest(o: THREE.Bone): BoneRest {
  return {
    bone: o,
    restX: o.rotation.x,
    restY: o.rotation.y,
    restZ: o.rotation.z,
    posY: o.position.y,
  };
}

export function findJawTeethBones(root: THREE.Object3D): JawTeethBones {
  const out: JawTeethBones = { jaw: null, teeth: [] };
  root.traverse((o) => {
    if (!(o instanceof THREE.Bone)) return;
    if (!out.jaw && JAW_BONE_NAMES.includes(o.name)) out.jaw = captureRest(o);
    if (TEETH_BONE_NAMES.includes(o.name)) out.teeth.push(captureRest(o));
  });
  return out;
}

/**
 * Per-bone teeth Y offsets. `upper` moves CC_Base_Teeth01, `lower` moves
 * CC_Base_Teeth02, both along the bone's local Y from rest — the example's
 * single TEETH_Y_OFFSET tucks each row away from the lip line; heads whose
 * teeth still show through (Magnus) pass larger values per bone.
 */
export interface TeethYOffsets {
  upper: number;
  lower: number;
}

export const DEFAULT_TEETH_Y_OFFSETS: TeethYOffsets = {
  upper: TEETH_Y_OFFSET,
  lower: TEETH_Y_OFFSET,
};

/**
 * Open the jaw + teeth bones from a single jawOpen value (0..1). The jaw rotates
 * on local Z up to JAW_OPEN_MAX_Z; the teeth rotate on x/y/z up to
 * TEETH_OPEN_ROT and sit at a fixed Y offset up/down (per bone, default
 * TEETH_Y_OFFSET like the example). All relative to each bone's captured rest.
 */
export function applyJawTeeth(
  bones: JawTeethBones,
  jawOpen: number,
  offsets: TeethYOffsets = DEFAULT_TEETH_Y_OFFSETS,
  jawOpenMaxZ: number = JAW_OPEN_MAX_Z,
): void {
  // Guard against non-finite input — writing NaN to a bone's rotation poisons
  // its skinning matrix and the mesh disappears.
  const o = Number.isFinite(jawOpen) ? jawOpen : 0;
  const j = bones.jaw;
  if (j) {
    j.bone.rotation.x = j.restX;
    j.bone.rotation.y = j.restY;
    j.bone.rotation.z = j.restZ + o * jawOpenMaxZ;
  }
  for (const t of bones.teeth) {
    const isUpper = /01$/.test(t.bone.name);
    if (isUpper) {
      // Upper teeth are fixed to the skull (Teeth01 < UpperJaw < Head) — they
      // must not follow the jaw open; only the static tuck offset applies.
      t.bone.rotation.x = t.restX;
      t.bone.rotation.y = t.restY;
      t.bone.rotation.z = t.restZ;
      t.bone.position.y = t.posY + offsets.upper;
    } else {
      // Lower teeth ride the jaw (child of JawRoot); these are the extra
      // per-axis deltas on top of the jaw's own open rotation.
      t.bone.rotation.x = t.restX + o * TEETH_OPEN_ROT.x;
      t.bone.rotation.y = t.restY + o * TEETH_OPEN_ROT.y;
      t.bone.rotation.z = t.restZ + o * TEETH_OPEN_ROT.z;
      t.bone.position.y = t.posY + offsets.lower;
    }
  }
}

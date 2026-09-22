import { METAHUMAN_ORDER_251 } from '@convai/web-sdk/lipsync-helpers';

/**
 * Maps the Convai MHA-251 blendshape stream (CTRL_expressions_* controls) onto
 * a Character-Creator-4 "ExpressionPlus" mesh whose morph names mirror
 * MetaHuman, e.g. CTRL_expressions_browDownL ↔ Brow_Down_L.
 *
 * Rather than hand-author 251 pairs, we match by a normalized key (strip the
 * CTRL_expressions_ prefix, drop underscores, lowercase). This makes
 * `mouthUpperLipRaiseL` ↔ `Mouth_UpperLip_Raise_L` line up despite CC4 keeping
 * compound words (UpperLip) joined.
 *
 * Ported verbatim from the convai-web-sdk neurosync-visual-react example
 * (src/lipsync/mhaToMorphMap.ts) — keep the two in sync.
 */

/** Normalize a control/morph name to a comparison key. */
export function normalizeName(name: string): string {
  return name
    // Sofia V5's export drops the underscore after the prefix
    // ("CTRL_expressionseyeBlinkL") — make it optional or none of her 251
    // morphs match and lipsync binds zero controls.
    .replace(/^CTRL_expressions_?/i, '')
    .replace(/_/g, '')
    .toLowerCase();
}

// (jawFwd suppression moved to mhaLipsync's tuned skip mask so the raw-
// passthrough dev toggle can drive every bound channel without a re-bind.)

/**
 * Explicit aliases for MHA controls whose CC4 morph doesn't normalize to the
 * same key. The CC4 heads name the mouth-press shapes `Mouth_Mouth_Press_*` (a
 * doubled "Mouth" prefix), so `mouthPressUL` (→ "mouthpressul") never matched
 * "Mouth_Mouth_Press_UL" (→ "mouthmouthpressul"). Map MHA key → morph key.
 */
const MHA_MORPH_ALIASES: Record<string, string> = {
  mouthpressul: 'mouthmouthpressul',
  mouthpressur: 'mouthmouthpressur',
  mouthpressdl: 'mouthmouthpressdl',
  mouthpressdr: 'mouthmouthpressdr',
};

export interface MhaMeshMap {
  /** mha frame index (0..250) → this mesh's morphTargetInfluences index, or -1. */
  indexByMha: Int32Array;
  /** how many of the 251 controls resolved to a morph on this mesh. */
  matched: number;
}

/**
 * Build the per-mesh map from MHA-251 indices to a mesh's morph influence slots.
 */
export function buildMhaMeshMap(
  morphTargetDictionary: Record<string, number>,
): MhaMeshMap {
  // normalized morph name → influence index
  const byNorm = new Map<string, number>();
  for (const [name, idx] of Object.entries(morphTargetDictionary)) {
    byNorm.set(normalizeName(name), idx);
  }

  const indexByMha = new Int32Array(METAHUMAN_ORDER_251.length).fill(-1);
  let matched = 0;
  for (let i = 0; i < METAHUMAN_ORDER_251.length; i++) {
    const key = normalizeName(METAHUMAN_ORDER_251[i]);
    let target = byNorm.get(key);
    if (target === undefined && key in MHA_MORPH_ALIASES) {
      target = byNorm.get(MHA_MORPH_ALIASES[key]);
    }
    if (target !== undefined) {
      indexByMha[i] = target;
      matched++;
    }
  }
  return { indexByMha, matched };
}

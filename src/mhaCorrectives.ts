import { METAHUMAN_ORDER_251 } from "@convai/web-sdk/lipsync-helpers";

/**
 * Explicit MHA → CC combination-corrective + limit ("in-between") mappings,
 * transcribed from Unreal's MetaHuman→CC rig setup. This replaces the heuristic
 * token-matching in correctives.ts with the authoritative definitions.
 *
 * Combination correctives: the `C_*` morph is driven by the PRODUCT of its input
 * control values (Unreal's combination weight), applied on top of the base
 * shapes. Driven from the RAW control signal so they fire correctly regardless
 * of our skip/gain/jaw-bone display tweaks (e.g. jaw correctives still shape the
 * mouth even though we render the jaw via the teeth bone, not the Jaw_Open morph).
 *
 * Limit mappings: a control also drives a second control (`B = max(B, A)`),
 * Unreal's curve-driven "lips stay together as the jaw opens" etc.
 */
// Ported from the convai-web-sdk neurosync-visual-react example (src/lipsync/mhaCorrectives.ts) — keep in sync.

// [ C_morphName, ...inputControlShortNames ]
export const CORRECTIVE_DEFS: readonly (readonly string[])[] = [
  ["C_NoseWrinkleL_BrowDownL", "noseWrinkleL", "browDownL"],
  ["C_NoseWrinkleR_BrowDownR", "noseWrinkleR", "browDownR"],
  ["C_BlinkL", "eyeBlinkL"],
  ["C_BlinkR", "eyeBlinkR"],
  ["C_BlinkL_LookDownL", "eyeBlinkL", "eyeLookDownL"],
  ["C_BlinkR_LookDownR", "eyeBlinkR", "eyeLookDownR"],
  ["C_BlinkL_LookUpL", "eyeBlinkL", "eyeLookUpL"],
  ["C_BlinkR_LookUpR", "eyeBlinkR", "eyeLookUpR"],
  ["C_BlinkL_SquintInnerL", "eyeBlinkL", "eyeSquintInnerL"],
  ["C_BlinkR_SquintInnerR", "eyeBlinkR", "eyeSquintInnerR"],
  ["C_BlinkL_CheekRaiseL", "eyeBlinkL", "eyeCheekRaiseL"],
  ["C_BlinkR_CheekRaiseR", "eyeBlinkR", "eyeCheekRaiseR"],
  ["C_BlinkL_LookLeftL", "eyeBlinkL", "eyeLookLeftL"],
  ["C_BlinkR_LookLeftR", "eyeBlinkR", "eyeLookLeftR"],
  ["C_BlinkL_LookRightL", "eyeBlinkL", "eyeLookRightL"],
  ["C_BlinkR_LookRightR", "eyeBlinkR", "eyeLookRightR"],
  ["C_BlinkL_SquintInnerL_CheekRaiseL", "eyeCheekRaiseL", "eyeSquintInnerL", "eyeBlinkL"],
  ["C_BlinkR_SquintInnerR_CheekRaiseR", "eyeCheekRaiseR", "eyeSquintInnerR", "eyeBlinkR"],
  ["C_WidenL_LookDownL", "eyeLookDownL", "eyeWidenL"],
  ["C_WidenR_LookDownR", "eyeLookDownR", "eyeWidenR"],
  ["C_CheekRaiseL_SquintInnerL", "eyeCheekRaiseL", "eyeSquintInnerL"],
  ["C_CheekRaiseR_SquintInnerR", "eyeCheekRaiseR", "eyeSquintInnerR"],
  ["C_CheekBlowL_CheekBlowR", "mouthCheekBlowL", "mouthCheekBlowR"],
  ["C_CheekRaiseL_CornerPullL", "eyeCheekRaiseL", "mouthCornerPullL"],
  ["C_CheekRaiseR_CornerPullR", "eyeCheekRaiseR", "mouthCornerPullR"],
  ["C_WrinkleL_UpperLipRaiseL", "noseWrinkleL", "mouthUpperLipRaiseL"],
  ["C_WrinkleR_UpperLipRaiseR", "noseWrinkleR", "mouthUpperLipRaiseR"],
  ["C_WrinkleL_MouthCornerPullL", "noseWrinkleL", "mouthCornerPullL"],
  ["C_WrinkleR_MouthCornerPullR", "noseWrinkleR", "mouthCornerPullR"],
  ["C_CornerPullL_CornerPullR", "mouthCornerPullL", "mouthCornerPullR"],
  ["C_CornerPullL_LowerLipDepressL", "mouthCornerPullL", "mouthLowerLipDepressL"],
  ["C_CornerPullR_LowerLipDepressR", "mouthCornerPullR", "mouthLowerLipDepressR"],
  ["C_CornerPullL_UpperLipRaiseL", "mouthCornerPullL", "mouthUpperLipRaiseL"],
  ["C_CornerPullR_UpperLipRaiseR", "mouthCornerPullR", "mouthUpperLipRaiseR"],
  ["C_CornerPullL_StretchL", "mouthCornerPullL", "mouthStretchL"],
  ["C_CornerPullR_StretchR", "mouthCornerPullR", "mouthStretchR"],
  ["C_StretchL_CornerPullL_LowerLipDepressL", "mouthStretchL", "mouthCornerPullL", "mouthLowerLipDepressL"],
  ["C_StretchR_CornerPullR_LowerLipDepressR", "mouthStretchR", "mouthCornerPullR", "mouthLowerLipDepressR"],
  ["C_CornerPullL_DimpleL", "mouthCornerPullL", "mouthDimpleL"],
  ["C_CornerPullR_DimpleR", "mouthCornerPullR", "mouthDimpleR"],
  ["C_CornerPullL_SharpCornerPullL", "mouthCornerPullL", "mouthSharpCornerPullL"],
  ["C_CornerPullR_SharpCornerPullR", "mouthCornerPullR", "mouthSharpCornerPullR"],
  ["C_FunnelUL_CornerPullL", "mouthCornerPullL", "mouthFunnelUL"],
  ["C_FunnelUR_CornerPullR", "mouthCornerPullR", "mouthFunnelUR"],
  ["C_FunnelDL_CornerPullL", "mouthCornerPullL", "mouthFunnelDL"],
  ["C_FunnelDR_CornerPullR", "mouthCornerPullR", "mouthFunnelDR"],
  ["C_LipsPurseUL_CornerPullL", "mouthCornerPullL", "mouthLipsPurseUL"],
  ["C_LipsPurseUR_CornerPullR", "mouthCornerPullR", "mouthLipsPurseUR"],
  ["C_LipsPurseDL_CornerPullL", "mouthCornerPullL", "mouthLipsPurseDL"],
  ["C_LipsPurseDR_CornerPullR", "mouthCornerPullR", "mouthLipsPurseDR"],
  ["C_FunnelUL_LipsPurseUL_CornerPullL", "mouthCornerPullL", "mouthLipsPurseUL", "mouthFunnelUL"],
  ["C_FunnelUR_LipsPurseUR_CornerPullR", "mouthCornerPullR", "mouthLipsPurseUR", "mouthFunnelUR"],
  ["C_FunnelDL_LipsPurseDL_CornerPullL", "mouthCornerPullL", "mouthLipsPurseDL", "mouthFunnelDL"],
  ["C_FunnelDR_LipsPurseDR_CornerPullR", "mouthCornerPullR", "mouthLipsPurseDR", "mouthFunnelDR"],
  ["C_LipsPurseUL_FunnelUL", "mouthLipsPurseUL", "mouthFunnelUL"],
  ["C_LipsPurseUR_FunnelUR", "mouthLipsPurseUR", "mouthFunnelUR"],
  ["C_LipsPurseDL_FunnelDL", "mouthLipsPurseDL", "mouthFunnelDL"],
  ["C_LipsPurseDR_FunnelDR", "mouthLipsPurseDR", "mouthFunnelDR"],
  ["C_FunnelUL_ChinRaiseUL", "mouthFunnelUL", "jawChinRaiseUL"],
  ["C_FunnelUR_ChinRaiseUR", "mouthFunnelUR", "jawChinRaiseUR"],
  ["C_LipsPurseUL_LipsTowardsUL", "mouthLipsPurseUL", "mouthLipsTowardsUL"],
  ["C_LipsPurseUR_LipsTowardsUR", "mouthLipsPurseUR", "mouthLipsTowardsUR"],
  ["C_LipsPurseDL_LipsTowardsDL", "mouthLipsPurseDL", "mouthLipsTowardsDL"],
  ["C_LipsPurseDR_LipsTowardsDR", "mouthLipsPurseDR", "mouthLipsTowardsDR"],
  ["C_LipsPurseUL_LipsTowardsUL_FunnelUL", "mouthLipsPurseUL", "mouthLipsTowardsUL", "mouthFunnelUL"],
  ["C_LipsPurseUR_LipsTowardsUR_FunnelUR", "mouthLipsPurseUR", "mouthLipsTowardsUR", "mouthFunnelUR"],
  ["C_LipsPurseDL_LipsTowardsDL_FunnelDL", "mouthLipsPurseDL", "mouthLipsTowardsDL", "mouthFunnelDL"],
  ["C_LipsPurseDR_LipsTowardsDR_FunnelDR", "mouthLipsPurseDR", "mouthLipsTowardsDR", "mouthFunnelDR"],
  ["C_LipsPurseUL_LipsTogetherUL", "mouthLipsPurseUL", "mouthLipsTogetherUL", "jawOpen"],
  ["C_LipsPurseUR_LipsTogetherUR", "mouthLipsPurseUR", "mouthLipsTogetherUR", "jawOpen"],
  ["C_LipsPurseDL_LipsTogetherDL", "mouthLipsPurseDL", "mouthLipsTogetherDL", "jawOpen"],
  ["C_LipsPurseDR_LipsTogetherDR", "mouthLipsPurseDR", "mouthLipsTogetherDR", "jawOpen"],
  ["C_FunnelUL_UpperLipRaiseL", "mouthFunnelUL", "mouthUpperLipRaiseL"],
  ["C_FunnelUR_UpperLipRaiseR", "mouthFunnelUR", "mouthUpperLipRaiseR"],
  ["C_FunnelDL_LowerLipDepressL", "mouthFunnelDL", "mouthLowerLipDepressL"],
  ["C_FunnelDR_LowerLipDepressR", "mouthFunnelDR", "mouthLowerLipDepressR"],
  ["C_FunnelUL_LipsTowardsUL", "mouthFunnelUL", "mouthLipsTowardsUL"],
  ["C_FunnelUR_LipsTowardsUR", "mouthFunnelUR", "mouthLipsTowardsUR"],
  ["C_FunnelDL_LipsTowardsDL", "mouthFunnelDL", "mouthLipsTowardsDL"],
  ["C_FunnelDR_LipsTowardsDR", "mouthFunnelDR", "mouthLipsTowardsDR"],
  ["C_StretchL_LowerLipDepressL", "mouthStretchL", "mouthLowerLipDepressL"],
  ["C_StretchR_LowerLipDepressR", "mouthStretchR", "mouthLowerLipDepressR"],
  ["C_StretchL_StretchR", "mouthStretchL", "mouthStretchR"],
  ["C_StretchL_LowerLipBite_L", "mouthStretchL", "mouthLowerLipBiteL"],
  ["C_StretchR_LowerLipBite_R", "mouthStretchR", "mouthLowerLipBiteR"],
  ["C_CornerPullL_JawOpen", "jawOpen", "mouthCornerPullL"],
  ["C_CornerPullR_JawOpen", "jawOpen", "mouthCornerPullR"],
  ["C_CornerPullL_JawOpen_LowerLipDepressL", "mouthCornerPullL", "jawOpen", "mouthLowerLipDepressL"],
  ["C_CornerPullR_JawOpen_LowerLipDepressR", "mouthCornerPullR", "jawOpen", "mouthLowerLipDepressR"],
  ["C_LipsPurseDL_JawOpen", "mouthLipsPurseDL", "jawOpen"],
  ["C_LipsPurseDR_JawOpen", "mouthLipsPurseDR", "jawOpen"],
  ["C_LipsPurseUL_JawOpen", "mouthLipsPurseUL", "jawOpen"],
  ["C_LipsPurseUR_JawOpen", "mouthLipsPurseUR", "jawOpen"],
  ["C_StretchL_LowerLipDepressL_JawOpen", "mouthStretchL", "mouthLowerLipDepressL", "jawOpen"],
  ["C_StretchR_LowerLipDepressR_JawOpen", "mouthStretchR", "mouthLowerLipDepressR", "jawOpen"],
  ["C_StretchL_JawOpen", "mouthStretchL", "jawOpen"],
  ["C_StretchR_JawOpen", "mouthStretchR", "jawOpen"],
  ["C_LowerLipDepressL_LowerLipDepressR", "mouthLowerLipDepressL", "mouthLowerLipDepressR"],
  ["C_UpperLipRaiseL_UpperLipRaiseR", "mouthUpperLipRaiseL", "mouthUpperLipRaiseR"],
  ["C_CornerPullL_StretchL_JawOpen", "mouthCornerPullL", "mouthStretchL", "jawOpen"],
  ["C_CornerPullR_StretchR_JawOpen", "mouthCornerPullR", "mouthStretchR", "jawOpen"],
  ["C_CornerPullRL_StretchRL_JawOpen", "mouthCornerPullR", "mouthStretchR", "jawOpen", "mouthStretchL", "mouthCornerPullL"],
  ["C_CornerPullRL_StretchRL_JawOpen_LowerLipDepressRL", "mouthCornerPullR", "mouthStretchR", "jawOpen", "mouthStretchL", "mouthCornerPullL", "mouthLowerLipDepressL", "mouthLowerLipDepressR"],
  ["C_UpperLipBiteL_JawOpen", "mouthUpperLipBiteL", "jawOpen"],
  ["C_UpperLipBiteR_JawOpen", "mouthUpperLipBiteR", "jawOpen"],
  ["C_LowerLipBiteL_JawOpen", "mouthLowerLipBiteL", "jawOpen"],
  ["C_LowerLipBiteR_JawOpen", "mouthLowerLipBiteR", "jawOpen"],
  ["C_PressUL_JawOpen", "mouthPressUL", "jawOpen"],
  ["C_PressUR_JawOpen", "mouthPressUR", "jawOpen"],
  ["C_PressDL_JawOpen", "mouthPressDL", "jawOpen"],
  ["C_PressDR_JawOpen", "mouthPressDR", "jawOpen"],
  ["C_DimpleL_UpperLipRaiseL", "mouthDimpleL", "mouthUpperLipRaiseL"],
  ["C_DimpleR_UpperLipRaiseR", "mouthDimpleR", "mouthUpperLipRaiseR"],
  ["C_DimpleL_LowerLipDepressL", "mouthDimpleL", "mouthLowerLipDepressL"],
  ["C_DimpleR_LowerLipDepressR", "mouthDimpleR", "mouthLowerLipDepressR"],
  ["C_DimpleL_JawOpen", "jawOpen", "mouthDimpleL"],
  ["C_DimpleR_JawOpen", "jawOpen", "mouthDimpleR"],
] as const;

// [ sourceControlShort, targetControlShort ] — target B = max(B, A)
export const LIMIT_DEFS: readonly (readonly [string, string])[] = [
  ["eyeBlinkL", "eyeLidPressL"],
  ["eyeBlinkR", "eyeLidPressR"],
  ["noseWrinkleL", "noseWrinkleUpperL"],
  ["noseWrinkleR", "noseWrinkleUpperR"],
  ["mouthStretchL", "mouthStretchLipsCloseL"],
  ["mouthStretchR", "mouthStretchLipsCloseR"],
  ["jawOpen", "jawOpenExtreme"],
  ["jawOpen", "mouthLipsTogetherUL"],
  ["jawOpen", "mouthLipsTogetherUR"],
  ["jawOpen", "mouthLipsTogetherDL"],
  ["jawOpen", "mouthLipsTogetherDR"],
] as const;

/** short control name (e.g. "jawOpen") -> MHA-251 frame index. */
const MHA_INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  METAHUMAN_ORDER_251.forEach((ctrl, i) => {
    m[ctrl.replace(/^CTRL_expressions_/, "")] = i;
  });
  return m;
})();

/** A resolved combination corrective on a specific mesh. */
export interface MhaCorrective {
  /** morphTargetInfluences index of the C_* morph. */
  slot: number;
  /** MHA-251 frame indices whose RAW values multiply to the corrective weight. */
  inputs: number[];
}

/** A resolved limit driver: target MHA channel driven by a source MHA channel. */
export interface MhaLimit {
  sourceIdx: number;
  targetIdx: number;
}

export interface MhaCorrectiveSet {
  correctives: MhaCorrective[];
  limits: MhaLimit[];
}

/**
 * Resolve the explicit defs against one mesh. Correctives whose C_* morph isn't
 * on the mesh (or whose inputs don't exist) are skipped; limits keep only the
 * source/target channels that exist.
 */
export function buildMhaCorrectives(
  morphTargetDictionary: Record<string, number>,
): MhaCorrectiveSet {
  const correctives: MhaCorrective[] = [];
  for (const def of CORRECTIVE_DEFS) {
    const morph = def[0];
    const slot = morphTargetDictionary[morph];
    if (slot === undefined) continue;
    const inputs: number[] = [];
    let ok = true;
    for (let i = 1; i < def.length; i++) {
      const idx = MHA_INDEX[def[i]];
      if (idx === undefined) {
        ok = false;
        break;
      }
      inputs.push(idx);
    }
    if (ok && inputs.length) correctives.push({ slot, inputs });
  }

  const limits: MhaLimit[] = [];
  for (const [src, tgt] of LIMIT_DEFS) {
    const sourceIdx = MHA_INDEX[src];
    const targetIdx = MHA_INDEX[tgt];
    if (sourceIdx !== undefined && targetIdx !== undefined) {
      limits.push({ sourceIdx, targetIdx });
    }
  }
  return { correctives, limits };
}

import { METAHUMAN_ORDER_251 } from "@convai/web-sdk/lipsync-helpers";

/**
 * MHA-251 channel groups used to build the default skip/gain masks (see
 * mhaLipsync.ts). Skipping a channel means zeroing that index so the morph
 * stays at rest.
 *
 * Ported from the convai-web-sdk neurosync-visual-react example
 * (src/lipsync/skippableChannels.ts) — keep the two in sync.
 */

export interface SkippableChannel {
  /** index into an MHA-251 frame (0..250) */
  index: number;
  /** short control name, e.g. "jawChinRaiseDL" — used as the Leva key */
  key: string;
  /** sub-region folder label */
  group: string;
}

const shortName = (ctrl: string): string =>
  ctrl.replace(/^CTRL_expressions_/, "");

/** Bucket a `jaw*` control into a readable sub-region folder. */
function jawGroup(short: string): string {
  const body = short.replace(/^jaw/, "");
  if (/^Chin/.test(body)) return "Chin";
  if (/^Clench/.test(body)) return "Clench";
  if (/^Open/.test(body)) return "Open";
  return "Move"; // Back, Fwd, Left, Right
}

/** All `jaw*` channels, individually skippable, grouped by sub-region. */
export const JAW_CHANNELS: readonly SkippableChannel[] =
  METAHUMAN_ORDER_251.flatMap((ctrl, index) => {
    const key = shortName(ctrl);
    if (!/^jaw/.test(key)) return [];
    return [{ index, key, group: jawGroup(key) }];
  });

/** Indices of all `teeth*` controls (ignored as a group). */
export const TEETH_INDICES: readonly number[] = METAHUMAN_ORDER_251.flatMap(
  (ctrl, i) => (/^CTRL_expressions_teeth/.test(ctrl) ? [i] : []),
);

/** Indices of all `tongue*` controls (ignored as a group). */
export const TONGUE_INDICES: readonly number[] = METAHUMAN_ORDER_251.flatMap(
  (ctrl, i) => (/^CTRL_expressions_tongue/.test(ctrl) ? [i] : []),
);

/** Indices of all `mouth*` controls — everything else is "non-mouth". */
export const MOUTH_INDICES: ReadonlySet<number> = new Set(
  METAHUMAN_ORDER_251.flatMap((ctrl, i) =>
    /^CTRL_expressions_mouth/.test(ctrl) ? [i] : [],
  ),
);

/** Total channel count (251) — for sizing the skip/gain masks. */
export const CHANNEL_COUNT = METAHUMAN_ORDER_251.length;

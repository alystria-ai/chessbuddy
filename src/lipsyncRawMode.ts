/**
 * RAW NEUROSYNC PASSTHROUGH — evaluation switch for the vendor's artist,
 * toggleable at runtime from the in-game dev menu (wrench button next to
 * Copy Logs). DEFAULT OFF: the tuned pipeline (all effects) ships.
 *
 * When on, every client-side lipsync effect is bypassed and each streamed
 * MHA-251 frame is applied 1:1 to the model's morphs, exactly as neurosync
 * sent it. The tuned pipeline it bypasses is the SDK 1.7 naturalness stack
 * (mouth symmetrization, rig limit couplings, the production gain table,
 * bloom/settle envelope, hard jaw cap, bilabial closure floor) plus our
 * teeth tuck and procedural blink:
 *   - no symmetrize, no limit couplings, no per-channel gains
 *   - no skip mask (teeth/eye-look/blink channels all live)
 *   - no static teeth tuck (teethUpU/teethDownD held values)
 *   - no envelope, no jaw cap, no bilabial floor
 *   - no input smoothing lerp (raw frame straight through; playback pacing/
 *     interpolation between stream frames still applies — that's timing, not
 *     filtering)
 *   - no combination correctives
 *   - no procedural blink overlay while speaking (the streamed blinks own the
 *     eyes; idle blink between utterances stays)
 *
 * Every effect above was added against a specific observed artifact (grin
 * stacking, bared molars, wandering eyes) — expect those to return while raw
 * mode is on. The choice persists in localStorage across reloads.
 */
const STORAGE_KEY = 'lipsync-raw-passthrough';

function readStored(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let rawNeurosyncPassthrough = readStored();

export function isRawNeurosyncPassthrough(): boolean {
  return rawNeurosyncPassthrough;
}

/** Live toggle — the apply path checks the flag per frame, no reload needed. */
export function setRawNeurosyncPassthrough(value: boolean): void {
  rawNeurosyncPassthrough = value;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    }
  } catch {
    // Storage unavailable (tests, private mode) — in-memory toggle still works.
  }
}

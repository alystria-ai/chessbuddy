// Reasons that describe a persistent positional state (not a one-off tactical event).
// Once spoken about, we hold off repeating them for a few moves.
const PERSISTENT_POSITIONAL_REASONS = new Set([
  'uncastled-open-center',
  'too-many-pawn-moves',
  'repeated-piece-move',
  'opened-king-file',
  'king-pawn-shield',
]);
const PERSISTENT_REPEAT_WINDOW = 5;

export function recentlySpokenTopics(spoken: Map<string, number>, currentMoveNo: number): string[] {
  const out: string[] = [];
  for (const [reason, moveNo] of spoken) {
    if (PERSISTENT_POSITIONAL_REASONS.has(reason) && currentMoveNo - moveNo < PERSISTENT_REPEAT_WINDOW) {
      out.push(reason);
    }
  }
  return out;
}

export function applyRepeatSuppression(
  speech: { shouldSpeak: boolean; reasons: string[] },
  spoken: Map<string, number>,
  currentMoveNo: number,
): { shouldSpeak: boolean; suppressed: boolean; suppressedReasons: string[] } {
  if (!speech.shouldSpeak) return { shouldSpeak: false, suppressed: false, suppressedReasons: [] };
  const fresh = speech.reasons.filter((r) => {
    if (!PERSISTENT_POSITIONAL_REASONS.has(r)) return true;
    const last = spoken.get(r);
    return last === undefined || currentMoveNo - last >= PERSISTENT_REPEAT_WINDOW;
  });
  // If every reason that fired is a recently-spoken persistent one, suppress.
  if (fresh.length === 0) {
    return { shouldSpeak: false, suppressed: true, suppressedReasons: speech.reasons };
  }
  return { shouldSpeak: true, suppressed: false, suppressedReasons: [] };
}

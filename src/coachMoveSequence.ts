export type CoachMoveSequenceResult<T> = Readonly<{
  committed: boolean;
  spoken: T | undefined;
  speechError: unknown | null;
}>;

type CoachMoveSequenceOptions<T> = Readonly<{
  shouldSpeak: boolean;
  speak: () => Promise<T>;
  isCurrent: () => boolean;
  commit: () => void;
  onSpeechError?: (error: unknown) => void;
}>;

/**
 * Hold the visual board commit behind a selected speech turn. Silent turns
 * commit immediately; a failed speech turn still unlocks the game; stale
 * sessions never commit a move calculated for an abandoned board.
 */
export async function sequenceCoachMove<T>({
  shouldSpeak,
  speak,
  isCurrent,
  commit,
  onSpeechError,
}: CoachMoveSequenceOptions<T>): Promise<CoachMoveSequenceResult<T>> {
  if (!isCurrent()) return { committed: false, spoken: undefined, speechError: null };

  let spoken: T | undefined;
  let speechError: unknown | null = null;
  if (shouldSpeak) {
    try {
      spoken = await speak();
    } catch (error) {
      speechError = error;
      // Diagnostics are observers, never part of the move transaction. A
      // logging/telemetry failure must not strand the board after speech has
      // already failed.
      try {
        onSpeechError?.(error);
      } catch {
        // Keep the original speech error and continue to the guarded commit.
      }
    }
  }

  if (!isCurrent()) return { committed: false, spoken, speechError };
  commit();
  return { committed: true, spoken, speechError };
}

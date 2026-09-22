/** Start or retain a monotonic quiet-period clock. */
export function updateQuietSince(
  previous: number | null,
  quiet: boolean,
  enabled: boolean,
  now: number,
): number | null {
  if (!enabled || !quiet) return null;
  return previous ?? now;
}

/** Real elapsed quiet time; unlike poll counters, this survives throttled frames. */
export function elapsedSince(since: number | null, now: number): number {
  return since === null ? 0 : Math.max(0, now - since);
}

export type WelcomeLifecycleState = {
  botReady: boolean;
  alreadyStarted: boolean;
  loadingCoverVisible: boolean;
};

export type CoachStatusState = {
  coachName: string;
  sessionStarted: boolean;
  speaking: boolean;
  calculating: boolean;
  preparing: boolean;
  connecting: boolean;
  connected: boolean;
  botReady: boolean;
  recentCoachSpeech: boolean;
  resigned: boolean;
  fallbackStatus: string;
};

/**
 * Keep a response-generating turn semantically stable while its transport is
 * recovering. A reconnect inside an active welcome is still "thinking" from
 * the player's perspective; exposing the lower-level "joining" phase creates
 * the misleading Thinking -> Joining -> Thinking loop.
 */
export function resolveCoachStatusLabel(state: CoachStatusState): string {
  if (!state.sessionStarted) return 'Ready when you are.';
  if (state.speaking) return `${state.coachName} is speaking...`;
  if (state.calculating && !state.recentCoachSpeech) return `${state.coachName} is calculating...`;
  if (state.preparing && !state.recentCoachSpeech) return `${state.coachName} is thinking...`;
  if (state.connecting || (!state.connected && !state.botReady)) return `${state.coachName} is joining...`;
  if (state.resigned) return `You resigned. ${state.coachName} wins.`;
  return state.fallbackStatus;
}

/**
 * Claim the once-per-game greeting as soon as Convai is ready. The loading
 * cover is deliberately diagnostic-only: a late ready event must still speak
 * over the revealed board instead of silently losing the greeting forever.
 */
export function shouldStartWelcome({
  botReady,
  alreadyStarted,
}: WelcomeLifecycleState): boolean {
  return botReady && !alreadyStarted;
}

/**
 * A room can finish connecting without ever becoming bot-ready. Retry that
 * stale first room once while the loading cover is still visible so the board
 * does not reveal quietly and receive its welcome several seconds later.
 */
export function shouldRetryInitialVoiceConnection({
  connected,
  botReady,
}: {
  connected: boolean;
  botReady: boolean;
}): boolean {
  return connected && !botReady;
}

/** One bounded reconnect after the board reveals gives a stale voice room a
 * second chance without trapping the player behind loading or looping. */
export function shouldRetryWelcomeConnection({
  botReady,
  alreadyStarted,
  loadingCoverVisible,
  retryAlreadyAttempted,
}: WelcomeLifecycleState & { retryAlreadyAttempted: boolean }): boolean {
  return !loadingCoverVisible && !botReady && !alreadyStarted && !retryAlreadyAttempted;
}

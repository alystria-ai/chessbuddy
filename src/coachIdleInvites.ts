/**
 * Short invitations shown beside the coach on the ready screen, before Play.
 * The spoken welcome after Play is a separate line and must not be replaced.
 */

export const COACH_IDLE_INVITES = [
  "Shall we play?",
  "Let's play.",
  "Come, let's begin.",
  "Whenever you're ready.",
  "I'm ready.",
  "A game, then?",
  "Your move.",
  "White's yours.",
  "Let's start.",
  "Ready when you are.",
] as const;

export function pickCoachIdleInvite(random: () => number = Math.random): string {
  const roll = Math.abs(random()) % 1;
  const index = Math.min(
    COACH_IDLE_INVITES.length - 1,
    Math.floor(roll * COACH_IDLE_INVITES.length),
  );
  return COACH_IDLE_INVITES[index] ?? COACH_IDLE_INVITES[0];
}

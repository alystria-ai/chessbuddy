export type MutableAudioMuteTarget = Pick<HTMLAudioElement, 'muted' | 'defaultMuted'>;

/**
 * Apply both the live and default mute flags. `muted` silences the current
 * stream; `defaultMuted` prevents a newly attached/reloaded media source from
 * silently reverting to audible before the manager sees another status event.
 */
export function applyVoiceMuteToElement(target: MutableAudioMuteTarget, muted: boolean): void {
  if (target.defaultMuted !== muted) target.defaultMuted = muted;
  if (target.muted !== muted) target.muted = muted;
}

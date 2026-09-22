import type { CoachConnection } from './convaiConnection';

/**
 * Tracks live coach <audio> playback for a connection: which element carries the
 * coach's voice, whether it is audible, and whether currentTime is genuinely
 * advancing (vs an audible-but-frozen element that should not count as speech).
 */
export class CoachAudioMonitor {
  /** Per-<audio> last sampled currentTime — detect real playback vs stuck elements. */
  private coachAudioSamples = new WeakMap<HTMLAudioElement, number>();
  /** Wall-clock time when coach <audio> last advanced — frozen elements are not "playing". */
  private coachAudioLastAdvanceAt = 0;
  /** When audible <audio> was first seen without currentTime advancing. */
  private coachAudioAudibleSince = 0;
  private static readonly COACH_AUDIO_STUCK_MS = 450;

  private coachAudioAdvancingCachedAt = 0;
  private coachAudioAdvancingCached = false;

  resolveElement(audioRenderer: any): HTMLAudioElement | null {
    if (!audioRenderer) return null;
    const candidates = [
      audioRenderer.element,
      audioRenderer.audioElement,
      audioRenderer._audioElement,
      audioRenderer.audio,
    ];
    for (const candidate of candidates) {
      if (candidate instanceof HTMLAudioElement) return candidate;
    }
    return null;
  }

  getElements(conn: CoachConnection): HTMLAudioElement[] {
    if (conn.coachAudioEl && document.contains(conn.coachAudioEl)) {
      return [conn.coachAudioEl];
    }
    if (conn.audioRenderer) {
      const resolved = this.resolveElement(conn.audioRenderer);
      if (resolved) {
        conn.coachAudioEl = resolved;
        return [resolved];
      }
    }
    return Array.from(document.querySelectorAll('audio'));
  }

  /**
   * True when a coach <audio> element is actively playing back.
   *
   * NOTE: `muted` is deliberately NOT a disqualifier. The voice-mute toggle
   * (convaiManager.setVoiceMuted) mutes these elements while leaving playback
   * running, and this monitor drives speech-completion/turn pacing — treating
   * muted as "not playing" would end every turn the moment the user muted.
   * A muted element still advances currentTime, which is the signal we want.
   */
  isAudible(conn: CoachConnection): boolean {
    for (const el of this.getElements(conn)) {
      if (el.volume === 0 || el.readyState < 2) continue;
      if (!el.paused && !el.ended && el.currentTime > 0.01) return true;
    }
    return false;
  }

  isPlaying(conn: CoachConnection): boolean {
    if (!this.isAudible(conn)) {
      this.coachAudioLastAdvanceAt = 0;
      this.coachAudioAudibleSince = 0;
      return false;
    }
    const now = Date.now();
    if (this.isAdvancing(conn)) {
      this.coachAudioLastAdvanceAt = now;
      this.coachAudioAudibleSince = 0;
      return true;
    }
    if (this.coachAudioLastAdvanceAt > 0) {
      return now - this.coachAudioLastAdvanceAt < CoachAudioMonitor.COACH_AUDIO_STUCK_MS;
    }
    if (this.coachAudioAudibleSince <= 0) {
      this.coachAudioAudibleSince = now;
    }
    return now - this.coachAudioAudibleSince < CoachAudioMonitor.COACH_AUDIO_STUCK_MS;
  }

  /**
   * True only when coach <audio> currentTime advanced since the prior sample.
   * The sample is taken at most once per 40ms window: the speech-wait helpers
   * call this several times within one 50ms poll tick, and re-sampling each
   * call meant every caller after the first saw a ~0 delta — silently
   * disabling the "audio still playing" completion guards.
   */
  isAdvancing(conn: CoachConnection): boolean {
    const nowMs = Date.now();
    if (nowMs - this.coachAudioAdvancingCachedAt < 40) return this.coachAudioAdvancingCached;

    let anyAdvancing = false;
    let sawCandidate = false;
    for (const el of this.getElements(conn)) {
      // `muted` is not a disqualifier here either — see isAudible().
      if (el.volume === 0 || el.readyState < 2) continue;
      if (el.paused || el.ended) continue;
      sawCandidate = true;
      const t = el.currentTime;
      const prev = this.coachAudioSamples.get(el);
      if (prev === undefined) {
        this.coachAudioSamples.set(el, t);
        continue;
      }
      if (t >= prev + 0.03) anyAdvancing = true;
      this.coachAudioSamples.set(el, t);
    }
    if (anyAdvancing) {
      this.coachAudioLastAdvanceAt = nowMs;
    }
    this.coachAudioAdvancingCachedAt = nowMs;
    this.coachAudioAdvancingCached = sawCandidate && anyAdvancing;
    return this.coachAudioAdvancingCached;
  }
}

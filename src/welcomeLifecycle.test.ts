import { describe, expect, it } from 'vitest';
import {
  resolveCoachStatusLabel,
  shouldRetryInitialVoiceConnection,
  shouldRetryWelcomeConnection,
  shouldStartWelcome,
} from './welcomeLifecycle';

describe('welcome lifecycle', () => {
  it('keeps an active welcome labelled as thinking during a recovery reconnect', () => {
    expect(resolveCoachStatusLabel({
      coachName: 'Sofia',
      sessionStarted: true,
      speaking: false,
      calculating: false,
      preparing: true,
      connecting: true,
      connected: false,
      botReady: false,
      recentCoachSpeech: false,
      resigned: false,
      fallbackStatus: 'Your move.',
    })).toBe('Sofia is thinking...');
  });

  it('starts once when botReady arrives while the loading cover is visible', () => {
    expect(shouldStartWelcome({
      botReady: true,
      alreadyStarted: false,
      loadingCoverVisible: true,
    })).toBe(true);
  });

  it('still starts once when botReady arrives after the board was revealed', () => {
    expect(shouldStartWelcome({
      botReady: true,
      alreadyStarted: false,
      loadingCoverVisible: false,
    })).toBe(true);
  });

  it('does not duplicate a greeting already claimed by startup or New Game', () => {
    expect(shouldStartWelcome({
      botReady: true,
      alreadyStarted: true,
      loadingCoverVisible: false,
    })).toBe(false);
  });

  it('waits when Convai is not ready yet', () => {
    expect(shouldStartWelcome({
      botReady: false,
      alreadyStarted: false,
      loadingCoverVisible: false,
    })).toBe(false);
  });

  it('retries a connected first room that never became bot-ready', () => {
    expect(shouldRetryInitialVoiceConnection({ connected: true, botReady: false })).toBe(true);
    expect(shouldRetryInitialVoiceConnection({ connected: true, botReady: true })).toBe(false);
    expect(shouldRetryInitialVoiceConnection({ connected: false, botReady: false })).toBe(false);
  });

  it('retries one stale connection after the board reveals without a welcome', () => {
    expect(shouldRetryWelcomeConnection({
      botReady: false,
      alreadyStarted: false,
      loadingCoverVisible: false,
      retryAlreadyAttempted: false,
    })).toBe(true);
    expect(shouldRetryWelcomeConnection({
      botReady: false,
      alreadyStarted: false,
      loadingCoverVisible: false,
      retryAlreadyAttempted: true,
    })).toBe(false);
  });

  it('never reconnects while loading or after the greeting was claimed', () => {
    expect(shouldRetryWelcomeConnection({
      botReady: false,
      alreadyStarted: false,
      loadingCoverVisible: true,
      retryAlreadyAttempted: false,
    })).toBe(false);
    expect(shouldRetryWelcomeConnection({
      botReady: false,
      alreadyStarted: true,
      loadingCoverVisible: false,
      retryAlreadyAttempted: false,
    })).toBe(false);
  });
});

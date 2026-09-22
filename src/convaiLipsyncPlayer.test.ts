import { describe, expect, it } from 'vitest';
import {
  advanceLipsyncFrame,
  createLipsyncPlayerState,
  drainLipsyncQueueRemaining,
  resetLipsyncPlayerState,
  shouldPlayLipsyncFrames,
} from './convaiLipsyncPlayer';

function mockQueue(overrides: Partial<{
  isBotSpeaking: boolean;
  hasEndSignal: boolean;
  frames: Float32Array[];
  playbackFps: number;
}> = {}) {
  let frames = [...(overrides.frames ?? [new Float32Array([0.1]), new Float32Array([0.2])])];
  return {
    isBotSpeaking: () => overrides.isBotSpeaking ?? false,
    hasReceivedEndSignal: () => overrides.hasEndSignal ?? false,
    hasFrames: () => frames.length > 0,
    isConversationEnded: () => frames.length === 0,
    get length() { return frames.length; },
    getFrameWithAlpha: (index: number) => frames[Math.min(index, frames.length - 1)] ?? null,
    consumeFrames: (count: number) => { frames = frames.slice(count); },
    reset: () => { frames = []; },
    ...(overrides.playbackFps ? { getPlaybackFps: () => overrides.playbackFps! } : {}),
  };
}

describe('convaiLipsyncPlayer', () => {
  it('shouldPlayLipsyncFrames matches reference condition', () => {
    expect(shouldPlayLipsyncFrames(mockQueue({ isBotSpeaking: true }))).toBe(true);
    expect(shouldPlayLipsyncFrames(mockQueue({ hasEndSignal: true }))).toBe(true);
    expect(shouldPlayLipsyncFrames(mockQueue())).toBe(false);
    expect(shouldPlayLipsyncFrames(mockQueue({ hasEndSignal: true, frames: [] }))).toBe(false);
  });

  it('advanceLipsyncFrame consumes frames at 60fps when bot speaks', () => {
    const state = createLipsyncPlayerState();
    const queue = mockQueue({ isBotSpeaking: true, frames: [
      new Float32Array([0.1]),
      new Float32Array([0.2]),
      new Float32Array([0.3]),
    ] });

    state.lastFrameTime = 1000;
    const f1 = advanceLipsyncFrame(state, queue, 1000 + 20);
    expect(f1).not.toBeNull();
    expect(state.lastPlayedFrameIndex).toBeGreaterThanOrEqual(0);

    const f2 = advanceLipsyncFrame(state, queue, 1000 + 40);
    expect(f2).not.toBeNull();
  });

  it('paces consumption by the stream playback fps instead of assuming 60', () => {
    const frames = Array.from({ length: 10 }, (_, i) => new Float32Array([i / 10]));

    // 30fps stream: after 40ms only ONE 33.3ms slot has elapsed — a 60fps
    // clock would already have burned two frames and starved the queue early.
    const slowState = createLipsyncPlayerState();
    const slowQueue = mockQueue({ isBotSpeaking: true, frames: [...frames], playbackFps: 30 });
    advanceLipsyncFrame(slowState, slowQueue, 1000); // starts the clock, consumes frame 0
    advanceLipsyncFrame(slowState, slowQueue, 1020);
    advanceLipsyncFrame(slowState, slowQueue, 1040);
    expect(slowState.lastPlayedFrameIndex).toBe(1);
    expect(slowQueue.length).toBe(8); // frames 0 and 1 consumed, not 3

    // 120fps stream: the same 40ms spans four 8.3ms slots.
    const fastState = createLipsyncPlayerState();
    const fastQueue = mockQueue({ isBotSpeaking: true, frames: [...frames], playbackFps: 120 });
    advanceLipsyncFrame(fastState, fastQueue, 1000);
    advanceLipsyncFrame(fastState, fastQueue, 1020);
    advanceLipsyncFrame(fastState, fastQueue, 1040);
    expect(fastState.lastPlayedFrameIndex).toBe(4);
    expect(fastQueue.length).toBe(5);
  });

  it('interpolates between stream frames on display ticks between slots', () => {
    const state = createLipsyncPlayerState();
    // 30fps stream (33.3ms slots), values 0.0 and 1.0 for easy blend reading.
    const queue = mockQueue({ isBotSpeaking: true, playbackFps: 30, frames: [
      new Float32Array([0]),
      new Float32Array([1]),
    ] });

    // First tick consumes frame 0; display = frame 0 exactly (frac 0).
    const f0 = advanceLipsyncFrame(state, queue, 1000);
    expect(f0).not.toBeNull();
    expect(f0![0]).toBeCloseTo(0, 5);

    // Halfway through the 33.3ms slot: blended halfway toward frame 1.
    const mid = advanceLipsyncFrame(state, queue, 1016.5);
    expect(mid![0]).toBeGreaterThan(0.4);
    expect(mid![0]).toBeLessThan(0.6);

    // Past the slot boundary: frame 1 is consumed; with nothing left to blend
    // toward, the display holds frame 1 exactly.
    const f1 = advanceLipsyncFrame(state, queue, 1040);
    expect(f1![0]).toBeCloseTo(1, 5);
  });

  it('resetLipsyncPlayerState clears playback', () => {
    const state = createLipsyncPlayerState();
    state.lastFrame = new Float32Array([1]);
    state.lastPlayedFrameIndex = 5;
    resetLipsyncPlayerState(state);
    expect(state.lastFrame).toBeNull();
    expect(state.lastPlayedFrameIndex).toBe(-1);
  });

  it('drops the unplayed tail at utterance end instead of replaying it', () => {
    const state = createLipsyncPlayerState();
    const queue = mockQueue({ isBotSpeaking: true, frames: [
      new Float32Array([0.1]),
      new Float32Array([0.2]),
      new Float32Array([0.9]), // the end "smile beat" pacing never reached
    ] });

    // Bot speaks: player arms and consumes normally.
    advanceLipsyncFrame(state, queue, 1000);
    advanceLipsyncFrame(state, queue, 1020);
    expect(state.wasConversationActive).toBe(true);

    // Bot stops with the end signal while frames remain: the leftovers must be
    // dropped (not replayed later as a silent expression pop).
    const stopped = {
      ...queue,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => true,
    };
    const frame = advanceLipsyncFrame(state, stopped, 1400);
    expect(frame).toBeNull();
    expect(stopped.hasFrames()).toBe(false);

    // Subsequent ticks stay null — nothing left to replay.
    expect(advanceLipsyncFrame(state, stopped, 1700)).toBeNull();
  });

  it('drainLipsyncQueueRemaining consumes leftover frames', () => {
    const state = createLipsyncPlayerState();
    state.lastFrame = new Float32Array([0.5]);
    let frames = [new Float32Array([0.1]), new Float32Array([0.2])];
    const queue = {
      hasFrames: () => frames.length > 0,
      get length() { return frames.length; },
      consumeFrames: (count: number) => { frames = frames.slice(count); },
    };
    drainLipsyncQueueRemaining(state, queue);
    expect(frames.length).toBe(0);
    expect(state.lastFrame).toBeNull();
  });

  it('lipsync tail frames alone do not imply speech signal is active', () => {
    const queue = mockQueue({ hasEndSignal: true, isBotSpeaking: false });
    expect(shouldPlayLipsyncFrames(queue)).toBe(true);
    const speechSignalActive = false;
    expect(speechSignalActive).toBe(false);
  });

  it('clears held lastFrame when conversation ended and queue drained', () => {
    const state = createLipsyncPlayerState();
    state.lastFrame = new Float32Array([0.4]);
    state.wasConversationActive = true;
    const queue = mockQueue({ hasEndSignal: true, frames: [] });
    const frame = advanceLipsyncFrame(state, queue, 1000);
    expect(frame).toBeNull();
    expect(state.lastFrame).toBeNull();
  });

  it('releases the held frame when the queue runs dry even if isBotSpeaking stays stuck', () => {
    const state = createLipsyncPlayerState();
    const queue = mockQueue({ isBotSpeaking: true, frames: [new Float32Array([0.3])] });

    // Consume the only frame, then keep "speaking" with a dry queue (audioStuck).
    advanceLipsyncFrame(state, queue, 1000);
    const held = advanceLipsyncFrame(state, queue, 1020);
    expect(held).not.toBeNull();

    const withinHold = advanceLipsyncFrame(state, queue, 1150);
    expect(withinHold).not.toBeNull();

    const released = advanceLipsyncFrame(state, queue, 1020 + 2000);
    expect(released).toBeNull();
    expect(state.lastFrame).toBeNull();
  });

  it('releases the held frame after the bot goes silent with no end signal (thinking pause)', () => {
    const state = createLipsyncPlayerState();
    const queue = mockQueue({ isBotSpeaking: true, frames: [new Float32Array([0.3])] });
    advanceLipsyncFrame(state, queue, 1000);
    advanceLipsyncFrame(state, queue, 1020);
    expect(state.lastFrame).not.toBeNull();

    const silentQueue = mockQueue({ isBotSpeaking: false, frames: [] });
    state.wasConversationActive = false;
    const released = advanceLipsyncFrame(state, silentQueue, 1020 + 2000);
    expect(released).toBeNull();
  });
});

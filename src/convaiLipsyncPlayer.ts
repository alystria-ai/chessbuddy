/** Per-coach lipsync playback state — consume clock paced by the stream's playback fps (Convai reference pattern). */

export type ConvaiLipsyncPlayerState = {
  lastFrameTime: number;
  accumulatedTimeMs: number;
  lastPlayedFrameIndex: number;
  wasConversationActive: boolean;
  hasEmittedConversationEnded: boolean;
  lastFrame: Float32Array | null;
  /** When a fresh frame was last consumed from the queue (stall detection). */
  lastFreshFrameAtMs: number;
  /** Copy of the most recently CONSUMED stream frame (interpolation base). */
  currentRawFrame: Float32Array | null;
  /** Reusable output buffer for interpolated frames. */
  blendScratch: Float32Array | null;
};

const FALLBACK_FPS = 60;
const FRAME_OFFSET = 0;

/**
 * Stream frames are NOT always 60fps: the SDK queue reads the real playback
 * rate from per-chunk metadata (BlendshapeQueue.getPlaybackFps), and the
 * service can stream MHA at other rates. Consuming at a hard-coded 60fps
 * plays the mouth too fast (starving the queue mid-speech) or too slow
 * (lagging the audio) by exactly the fps ratio.
 */
function getFrameDurationMs(queue: { getPlaybackFps?: () => number }): number {
  const fps = typeof queue.getPlaybackFps === 'function' ? queue.getPlaybackFps() : 0;
  return 1000 / (Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS);
}
/**
 * How long the last blendshape frame may be held once the queue runs dry.
 * Holding bridges tiny gaps between audio chunks, but past this the face must
 * release to neutral — otherwise the coach freezes mid-viseme (an open mouth
 * hangs visibly). Mid-speech gaps refill the queue well within this window.
 * Checked regardless of the SDK's isBotSpeaking flag, which can stay stuck
 * true when audio playback wedges (audioStuck).
 */
const HOLD_RELEASE_MS = 250;

export function createLipsyncPlayerState(): ConvaiLipsyncPlayerState {
  return {
    lastFrameTime: 0,
    accumulatedTimeMs: 0,
    lastPlayedFrameIndex: -1,
    wasConversationActive: false,
    hasEmittedConversationEnded: false,
    lastFrame: null,
    lastFreshFrameAtMs: 0,
    currentRawFrame: null,
    blendScratch: null,
  };
}

export function resetLipsyncPlayerState(state: ConvaiLipsyncPlayerState): void {
  state.lastFrameTime = 0;
  state.accumulatedTimeMs = 0;
  state.lastPlayedFrameIndex = -1;
  state.wasConversationActive = false;
  state.hasEmittedConversationEnded = false;
  state.lastFrame = null;
  state.lastFreshFrameAtMs = 0;
  state.currentRawFrame = null;
}

/** Drop the held frame once the queue is dry and no fresh frame arrived within the hold window. */
function releaseHeldFrameIfStale(
  state: ConvaiLipsyncPlayerState,
  queue: { hasFrames?: () => boolean },
  currentTime: number,
): void {
  if (!state.lastFrame) return;
  const queueDry = typeof queue.hasFrames === 'function' && !queue.hasFrames();
  if (queueDry && currentTime - state.lastFreshFrameAtMs >= HOLD_RELEASE_MS) {
    state.lastFrame = null;
  }
}

/** Reference: isBotSpeaking || (hasReceivedEndSignal && hasFrames). */
export function shouldPlayLipsyncFrames(queue: {
  isBotSpeaking?: () => boolean;
  hasReceivedEndSignal?: () => boolean;
  hasFrames?: () => boolean;
} | null | undefined): boolean {
  if (!queue) return false;
  const isBotSpeaking = typeof queue.isBotSpeaking === 'function' ? queue.isBotSpeaking() : false;
  const hasEndSignal = typeof queue.hasReceivedEndSignal === 'function'
    ? queue.hasReceivedEndSignal()
    : false;
  const hasFrames = typeof queue.hasFrames === 'function' ? queue.hasFrames() : false;
  return isBotSpeaking || (hasEndSignal && hasFrames);
}

function getQueueLength(queue: {
  length?: number;
  getLength?: () => number;
}): number {
  if (typeof queue.length === 'number') return queue.length;
  if (typeof queue.getLength === 'function') return queue.getLength();
  return 0;
}

/** Copy `src` into the state's `currentRawFrame` buffer (reused across ticks). */
function storeRawFrame(state: ConvaiLipsyncPlayerState, src: Float32Array): void {
  if (state.currentRawFrame?.length === src.length) {
    state.currentRawFrame.set(src);
  } else {
    state.currentRawFrame = new Float32Array(src);
  }
}

/**
 * Blend the last consumed frame toward the queue's upcoming head frame by the
 * fractional progress through the current frame slot. Stream frames arrive at
 * ~25-60fps while the display runs at 60-120Hz; without this the mouth steps
 * from pose to pose (sample-and-hold), which reads as chattery/mushy motion.
 */
function interpolatedFrame(
  state: ConvaiLipsyncPlayerState,
  queue: { hasFrames?: () => boolean; getFrameWithAlpha?: (index: number) => Float32Array | null },
  frac: number,
): Float32Array | null {
  const base = state.currentRawFrame;
  if (!base) return null;
  const hasNext = typeof queue.hasFrames === 'function' && queue.hasFrames();
  const next = hasNext && typeof queue.getFrameWithAlpha === 'function'
    ? queue.getFrameWithAlpha(0)
    : null;
  if (!next || next.length !== base.length) return base;
  const t = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  if (state.blendScratch?.length !== base.length) {
    state.blendScratch = new Float32Array(base.length);
  }
  const out = state.blendScratch;
  for (let i = 0; i < base.length; i++) {
    out[i] = base[i] + (next[i] - base[i]) * t;
  }
  return out;
}

/**
 * Advance lipsync by one display tick. Returns the current blendshape frame to apply
 * (interpolated between the two stream frames spanning this instant), or the last
 * held frame while the queue bridges a gap.
 */
export function advanceLipsyncFrame(
  state: ConvaiLipsyncPlayerState,
  queue: {
    isBotSpeaking?: () => boolean;
    hasReceivedEndSignal?: () => boolean;
    hasFrames?: () => boolean;
    isConversationEnded?: () => boolean;
    length?: number;
    getLength?: () => number;
    getFrameWithAlpha?: (index: number) => Float32Array | null;
    consumeFrames?: (count: number) => void;
    reset?: () => void;
    getPlaybackFps?: () => number;
  },
  currentTime: number = performance.now(),
): Float32Array | null {
  const isBotSpeaking = typeof queue.isBotSpeaking === 'function' ? queue.isBotSpeaking() : false;
  const hasEndSignal = typeof queue.hasReceivedEndSignal === 'function'
    ? queue.hasReceivedEndSignal()
    : false;

  if (isBotSpeaking && !state.wasConversationActive) {
    state.lastFrameTime = currentTime;
    state.accumulatedTimeMs = 0;
    state.lastPlayedFrameIndex = -1;
    state.wasConversationActive = true;
    state.hasEmittedConversationEnded = false;
    state.lastFrame = null;
    state.lastFreshFrameAtMs = currentTime;
    state.currentRawFrame = null;
  }

  if (!isBotSpeaking && state.wasConversationActive && hasEndSignal) {
    state.wasConversationActive = false;
    // The utterance's audio is over. Any frames still queued are a tail that
    // playback pacing never reached — the old partial reset re-armed the
    // clock, so shouldPlay (endSignal && hasFrames) REPLAYED that tail after
    // the face had already settled: a silent expression (typically the
    // end-of-utterance smile beat) popped in ~0.3s after speech ended. Drop
    // the leftovers instead and let the face ease to neutral from the last
    // audio-synced frame.
    drainLipsyncQueueRemaining(state, queue);
    if (typeof queue.reset === 'function') {
      queue.reset();
    }
  }

  const isEnded = typeof queue.isConversationEnded === 'function' ? queue.isConversationEnded() : false;
  if (isEnded && !state.hasEmittedConversationEnded) {
    state.hasEmittedConversationEnded = true;
  }

  const shouldPlay = shouldPlayLipsyncFrames(queue);
  if (!shouldPlay) {
    const queueDrained = typeof queue.hasFrames === 'function' && !queue.hasFrames();
    if (state.lastFrame && isEnded && queueDrained) {
      state.lastFrame = null;
    }
    releaseHeldFrameIfStale(state, queue, currentTime);
    return state.lastFrame;
  }

  if (state.lastFrameTime > 0 && shouldPlay) {
    const delta = currentTime - state.lastFrameTime;
    state.lastFrameTime = currentTime;

    if (typeof queue.hasFrames === 'function' && queue.hasFrames()) {
      if (state.lastPlayedFrameIndex === -1) {
        state.accumulatedTimeMs = 0;
      } else {
        state.accumulatedTimeMs += delta;
      }

      const frameDurationMs = getFrameDurationMs(queue);
      const targetFrameIndex = Math.floor(state.accumulatedTimeMs / frameDurationMs);

      if (targetFrameIndex > state.lastPlayedFrameIndex) {
        const framesToSkip = targetFrameIndex - state.lastPlayedFrameIndex;
        const queueLength = getQueueLength(queue);

        if (framesToSkip > 1 && queueLength < framesToSkip) {
          const offsetIndex = Math.min(
            queueLength - 1 + FRAME_OFFSET,
            Math.max(0, queueLength - 1),
          );
          const frameToPlay = typeof queue.getFrameWithAlpha === 'function'
            ? queue.getFrameWithAlpha(offsetIndex)
            : null;
          if (frameToPlay) {
            storeRawFrame(state, frameToPlay);
            state.lastFrame = state.currentRawFrame;
            state.lastFreshFrameAtMs = currentTime;
          }
          if (typeof queue.consumeFrames === 'function' && queueLength > 0) {
            queue.consumeFrames(queueLength);
          }
        } else {
          const framesToConsume = Math.min(framesToSkip, queueLength);
          const baseFrameIndex = Math.min(framesToConsume - 1, Math.max(0, queueLength - 1));
          const frameIndex = Math.min(
            baseFrameIndex + FRAME_OFFSET,
            Math.max(0, queueLength - 1),
          );
          const frameToPlay = typeof queue.getFrameWithAlpha === 'function'
            ? queue.getFrameWithAlpha(frameIndex)
            : null;
          if (frameToPlay) {
            storeRawFrame(state, frameToPlay);
            state.lastFrame = state.currentRawFrame;
            state.lastFreshFrameAtMs = currentTime;
          }
          if (typeof queue.consumeFrames === 'function' && framesToConsume > 0) {
            queue.consumeFrames(framesToConsume);
          }
        }

        state.lastPlayedFrameIndex = targetFrameIndex;
      }

      // Between stream frames: blend the consumed frame toward the queue's
      // upcoming head by the fractional slot progress, so a 25-30fps stream
      // animates smoothly on a 60-120Hz display instead of stepping.
      const frac = state.accumulatedTimeMs / frameDurationMs - state.lastPlayedFrameIndex;
      const blended = interpolatedFrame(state, queue, frac);
      if (blended) state.lastFrame = blended;
    }
  } else if (shouldPlay && state.lastFrameTime === 0) {
    state.lastFrameTime = currentTime;
  }

  // Even while the SDK still claims the bot is speaking, a dry queue with no
  // fresh frames means playback stalled or ended — release the held frame.
  releaseHeldFrameIfStale(state, queue, currentTime);
  return state.lastFrame;
}

export function isLipsyncPlayerActive(
  state: ConvaiLipsyncPlayerState,
  queue: Parameters<typeof shouldPlayLipsyncFrames>[0],
): boolean {
  return shouldPlayLipsyncFrames(queue) || state.lastFrame !== null;
}

/** After audio ends, consume any remaining blendshape frames so speech-wait can finish. */
export function drainLipsyncQueueRemaining(
  state: ConvaiLipsyncPlayerState,
  queue: {
    hasFrames?: () => boolean;
    isConversationEnded?: () => boolean;
    length?: number;
    getLength?: () => number;
    consumeFrames?: (count: number) => void;
  },
): void {
  const queueLength = getQueueLength(queue);
  if (queueLength > 0 && typeof queue.consumeFrames === 'function') {
    queue.consumeFrames(queueLength);
  }
  state.lastFrame = null;
  state.lastPlayedFrameIndex = -1;
  state.accumulatedTimeMs = 0;
  state.lastFrameTime = 0;
  state.currentRawFrame = null;
}

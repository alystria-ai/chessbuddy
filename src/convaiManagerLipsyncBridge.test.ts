import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COACHES, DIFFICULTIES, type CoachId } from './coachConfig';
import { buildCoachInstruction } from './chessAi';
import { createConnection, type CoachConnection } from './convaiConnection';
import {
  chessConvai,
  type ConvaiBlendshapeQueue,
} from './convaiManager';

type ManagerInternals = {
  pool: Map<string, CoachConnection>;
  activeCoachId: CoachId;
  speakingCoachId: CoachId | '';
  disconnectOne: (conn: CoachConnection) => Promise<void>;
  connectCoach: typeof chessConvai.connectCoach;
  deliverWelcomeLine: (typeof chessConvai)['speakWelcome'];
  audio: {
    isAdvancing: (conn: CoachConnection) => boolean;
    isPlaying: (conn: CoachConnection) => boolean;
  };
  armLipsyncConversation: (conn: CoachConnection) => void;
  sleep: (ms: number) => Promise<void>;
};

type QueueControl = {
  frames: Float32Array[];
  speaking: boolean;
  endSignal: boolean;
  conversationEnded: boolean;
  normalizationPending: boolean;
  consumeCalls: number;
  consumedFrames: number;
  normalizationCalls: number;
  resetCalls: number;
};

const manager = chessConvai as unknown as ManagerInternals;

function connection(coachId: CoachId = 'arjun'): CoachConnection {
  const conn = manager.pool.get(coachId);
  if (!conn) throw new Error(`Missing test connection for ${coachId}`);
  return conn;
}

function createQueue(overrides: Partial<Pick<
  QueueControl,
  'frames' | 'speaking' | 'endSignal' | 'conversationEnded' | 'normalizationPending'
>> = {}): { queue: ConvaiBlendshapeQueue; control: QueueControl } {
  const control: QueueControl = {
    frames: overrides.frames ?? [new Float32Array([0.1]), new Float32Array([0.2])],
    speaking: overrides.speaking ?? false,
    endSignal: overrides.endSignal ?? false,
    conversationEnded: overrides.conversationEnded ?? false,
    normalizationPending: overrides.normalizationPending ?? false,
    consumeCalls: 0,
    consumedFrames: 0,
    normalizationCalls: 0,
    resetCalls: 0,
  };

  const queue: ConvaiBlendshapeQueue = {
    get length() { return control.frames.length; },
    getLength: () => control.frames.length,
    hasFrames: () => control.frames.length > 0,
    isBotSpeaking: () => control.speaking,
    hasReceivedEndSignal: () => control.endSignal,
    isConversationEnded: () => control.conversationEnded,
    isAllFramesConsumed: () => control.frames.length === 0,
    getPlaybackFps: () => 60,
    getFrameWithAlpha: (index) => control.frames[index] ?? null,
    consumeFrames: (count) => {
      const consumed = Math.min(Math.max(0, count), control.frames.length);
      control.consumeCalls += 1;
      control.consumedFrames += consumed;
      control.frames.splice(0, consumed);
    },
    consumeNormalizationSignal: () => {
      control.normalizationCalls += 1;
      const pending = control.normalizationPending;
      control.normalizationPending = false;
      return pending;
    },
    reset: () => {
      control.resetCalls += 1;
      control.frames.splice(0);
      control.speaking = false;
      control.endSignal = false;
      control.conversationEnded = false;
      control.normalizationPending = false;
    },
  };

  return { queue, control };
}

function attachQueue(
  coachId: CoachId,
  overrides?: Parameters<typeof createQueue>[0],
): ReturnType<typeof createQueue> {
  const result = createQueue(overrides);
  connection(coachId).client = { blendshapeQueue: result.queue };
  return result;
}

describe('Convai manager render-loop lipsync bridge', () => {
  beforeEach(() => {
    // CoachAudioMonitor intentionally falls back to a document-wide audio
    // query when a connection has no bound element. These manager unit tests
    // run in Vitest's Node environment, so provide only that inert DOM seam.
    vi.stubGlobal('document', { querySelectorAll: () => [] });
    manager.pool = new Map(COACHES.map((coach) => [coach.id, createConnection(coach)]));
    manager.activeCoachId = 'arjun';
    manager.speakingCoachId = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps legacy playback available when a disabled adapter never claims ownership', () => {
    const { control } = attachQueue('arjun', {
      speaking: true,
      frames: [new Float32Array([0.35]), new Float32Array([0.7])],
    });

    // A render adapter that failed its coverage gate must not call
    // reportLipsyncRenderState. With no heartbeat, the compatibility player
    // remains the queue owner instead of stranding live speech.
    expect(connection().lipsyncRendererHeartbeatAt).toBe(0);
    const frame = chessConvai.getLipsyncFrame('arjun');

    expect(Array.from(frame ?? [])).toEqual([expect.closeTo(0.35, 5)]);
    expect(control.consumedFrames).toBe(1);
    expect(control.frames).toHaveLength(1);
  });

  it('uses elapsed quiet time and ignores stale playbackComplete after the real tail is quiet', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const conn = connection();
    conn.longestResponseText = 'Choose your first candidate move.';
    conn.lastEmittedText = conn.longestResponseText;
    conn.lastFinalTextAt = now;
    conn.isSpeaking = true;
    conn.turnEnded = true;
    conn.client = {
      blendshapeQueue: {
        hasFrames: () => false,
        isBotSpeaking: () => false,
        isConversationEnded: () => false,
        isAllFramesConsumed: () => false,
        getTimeLeftMs: () => 1_000,
      },
    };

    let audioActive = true;
    const originalAudio = manager.audio;
    const originalSleep = manager.sleep;
    manager.audio = {
      isAdvancing: () => audioActive,
      isPlaying: () => audioActive,
    };
    const sleep = vi.fn(async () => {
      if (sleep.mock.calls.length === 1) {
        now += 50;
        audioActive = false;
        conn.isSpeaking = false;
      } else {
        // Simulate a throttled/busy main thread: one nominal 50ms poll arrives
        // four seconds later. Completion must use that real elapsed silence.
        now += 4_000;
      }
    });
    manager.sleep = sleep;

    try {
      await chessConvai.waitUntilSpeechFinished(COACHES.find(({ id }) => id === 'arjun')!, 10_000);
    } finally {
      manager.audio = originalAudio;
      manager.sleep = originalSleep;
    }

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(conn.lastSpeechEndedAt).toBe(5_050);
  });

  it('finishes after the SDK stop edge when the audio element micro-advances through silence', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const conn = connection();
    conn.longestResponseText = 'Choose your first candidate move.';
    conn.lastEmittedText = conn.longestResponseText;
    conn.lastFinalTextAt = now;
    conn.isSpeaking = false;
    conn.turnEnded = true;
    conn.lastTurnEndAt = now;
    conn.lastSpeechEndedAt = now;
    conn.lipsyncActive = false;
    conn.client = {
      blendshapeQueue: {
        hasFrames: () => true,
        isBotSpeaking: () => false,
        isConversationEnded: () => false,
        isAllFramesConsumed: () => false,
        getTimeLeftMs: () => 1_000,
      },
    };

    const originalAudio = manager.audio;
    const originalSleep = manager.sleep;
    manager.audio = {
      isAdvancing: () => false,
      isPlaying: () => true,
    };
    const sleep = vi.fn(async () => {
      now += 50;
    });
    manager.sleep = sleep;

    try {
      await chessConvai.waitUntilSpeechFinished(COACHES.find(({ id }) => id === 'arjun')!, 5_000);
    } finally {
      manager.audio = originalAudio;
      manager.sleep = originalSleep;
    }

    expect(sleep).toHaveBeenCalledTimes(10);
    expect(conn.lastSpeechEndedAt).toBe(1_500);
  });

  it('uses a fresh renderer heartbeat as exclusive ownership without consuming or normalizing twice', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const { control } = attachQueue('arjun', {
      speaking: true,
      normalizationPending: true,
      frames: [new Float32Array([0.25]), new Float32Array([0.5])],
    });

    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: true });

    expect(chessConvai.getLipsyncFrame('arjun')).toBeNull();
    expect(chessConvai.consumeLipsyncNormalize('arjun')).toBe(false);
    expect(control.consumedFrames).toBe(0);
    expect(control.normalizationCalls).toBe(0);
    expect(control.frames).toHaveLength(2);
  });

  it('leaves a bot-stopped end-signal tail to the live render adapter', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_500);
    const { control } = attachQueue('arjun', {
      speaking: false,
      endSignal: true,
      frames: [new Float32Array([0.45]), new Float32Array([0.15])],
    });

    // The V2 adapter is responsible for consuming/fading this final tail even
    // after isBotSpeaking drops. A held (not fresh) render tick must retain
    // ownership without letting the compatibility path race the same frames.
    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: false });

    expect(chessConvai.getLipsyncFrame('arjun')).toBeNull();
    expect(control.consumedFrames).toBe(0);
    expect(control.frames).toHaveLength(2);
    expect(connection().lipsyncActive).toBe(true);
    expect(connection().lipsyncPlayer.lastFreshFrameAtMs).toBe(0);
  });

  it('records fresh samples once while held render ticks only refresh ownership', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    attachQueue('arjun', { speaking: true });

    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: true });
    const conn = connection();
    expect(conn.lipsyncPlayer.lastFreshFrameAtMs).toBe(1_000);
    expect(conn.lipsyncRendererHeartbeatAt).toBe(1_000);
    expect(conn.lipsyncActive).toBe(true);

    now.mockReturnValue(1_125);
    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: false });

    expect(conn.lipsyncRendererHeartbeatAt).toBe(1_125);
    expect(conn.lipsyncPlayer.lastFreshFrameAtMs).toBe(1_000);
    expect(conn.lipsyncActive).toBe(true);
  });

  it('authorizes a missing-end-signal drain only for the selected coach after its quiet turn ended', () => {
    attachQueue('arjun', { speaking: false });
    attachQueue('leila', { speaking: false });
    const arjun = connection('arjun');
    const leila = connection('leila');

    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('arjun')).toBe(false);

    arjun.turnEnded = true;
    arjun.isSpeaking = true;
    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('arjun')).toBe(false);

    arjun.isSpeaking = false;
    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('arjun')).toBe(true);

    leila.turnEnded = true;
    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('leila')).toBe(false);

    manager.activeCoachId = 'leila';
    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('arjun')).toBe(false);
    expect(chessConvai.canDrainMissingEndSignalLipsyncTail('leila')).toBe(true);
  });

  it('bumps reset generation on normalization and drains only the ended stale tail', () => {
    const { control } = attachQueue('arjun', {
      speaking: false,
      endSignal: true,
      normalizationPending: true,
      frames: [new Float32Array([0.8]), new Float32Array([0.9])],
    });
    const conn = connection();
    conn.lipsyncActive = true;
    conn.lipsyncConversationEndResetSent = false;
    conn.lipsyncPlayer.lastFrame = new Float32Array([0.6]);
    conn.lipsyncPlayer.currentRawFrame = new Float32Array([0.6]);
    conn.lipsyncPlayer.lastFreshFrameAtMs = 900;
    manager.speakingCoachId = 'arjun';
    const initialGeneration = chessConvai.getLipsyncResetGeneration('arjun');

    expect(chessConvai.consumeLipsyncNormalize('arjun')).toBe(true);

    expect(control.normalizationCalls).toBe(1);
    expect(control.consumedFrames).toBe(2);
    expect(control.frames).toHaveLength(0);
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
    expect(conn.lipsyncActive).toBe(false);
    expect(conn.lipsyncConversationEndResetSent).toBe(true);
    expect(conn.lipsyncPlayer.lastFrame).toBeNull();
    expect(conn.lipsyncPlayer.currentRawFrame).toBeNull();
    expect(conn.lipsyncPlayer.lastFreshFrameAtMs).toBe(0);
    expect(manager.speakingCoachId).toBe('');

    expect(chessConvai.consumeLipsyncNormalize('arjun')).toBe(false);
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
  });

  it('bumps reset generation exactly once when the render adapter completes an ended turn', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(2_000);
    attachQueue('arjun', {
      speaking: false,
      conversationEnded: false,
      frames: [],
    });
    const conn = connection();
    conn.turnEnded = true;
    conn.lipsyncConversationEndResetSent = false;
    const initialGeneration = chessConvai.getLipsyncResetGeneration('arjun');

    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: true });
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration);

    // The adapter has already consumed the end signal and reset its SDK queue.
    // Its inactive report plus the manager's turn boundary is therefore the
    // authoritative completion proof.
    now.mockReturnValue(2_100);
    chessConvai.reportLipsyncRenderState('arjun', { active: false, fresh: false });
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
    expect(conn.lipsyncConversationEndResetSent).toBe(true);
    expect(conn.lipsyncPlayer.lastFreshFrameAtMs).toBe(0);

    now.mockReturnValue(2_200);
    chessConvai.reportLipsyncRenderState('arjun', { active: false, fresh: false });
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
  });

  it('releases a held pose at the speaking-quiet edge even when turnEnd is late and stale frames stay fresh', () => {
    let nowMs = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    attachQueue('arjun', { speaking: true, frames: [new Float32Array([0.8])] });
    const conn = connection();

    conn.turnEnded = false;
    conn.isSpeaking = false;
    conn.lastSpeechEndedAt = 0;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);

    // stateChange(false) is the quiet boundary; Convai can deliver turnEnd
    // later, so it must not be required to release the facial-only tail.
    conn.lastSpeechEndedAt = Date.now();
    conn.turnEnded = false;
    conn.lastTurnEndAt = 0;
    conn.lipsyncPlayer.lastFreshFrameAtMs = 1_000;
    conn.isSpeaking = true;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);

    conn.isSpeaking = false;
    nowMs = 1_119;
    conn.lipsyncPlayer.lastFreshFrameAtMs = nowMs;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);
    // A stale SDK queue may keep presenting apparently fresh facial heads
    // after the audible speaking edge. Those must not restart the grace.
    nowMs = 1_120;
    conn.lipsyncPlayer.lastFreshFrameAtMs = nowMs;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(true);

    // The next speaking edge clears the prior quiet proof.
    conn.lastSpeechEndedAt = 0;
    conn.lipsyncPlayer.lastFreshFrameAtMs = 0;
    conn.turnEnded = false;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);

    // turnEnd remains a valid fallback for SDKs that omit stateChange(false).
    conn.turnEnded = true;
    conn.lastTurnEndAt = Date.now() - 120;
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(true);

    manager.activeCoachId = 'leila';
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);
  });

  it('clears the previous quiet proof before ahead-delivered frames of a new turn', () => {
    let nowMs = 2_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    attachQueue('arjun', { speaking: false, frames: [new Float32Array([0.7])] });
    const conn = connection();
    conn.turnEnded = true;
    conn.lastTurnEndAt = 1_000;
    conn.lastSpeechEndedAt = 1_000;
    conn.lipsyncPlayer.lastFreshFrameAtMs = 2_000;

    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(true);

    manager.armLipsyncConversation(conn);
    // A facial chunk can precede stateChange(true); it belongs to the new turn
    // and must not be discarded under the previous turn's quiet timestamp.
    nowMs = 2_500;
    conn.lipsyncPlayer.lastFreshFrameAtMs = nowMs;
    expect(conn.turnEnded).toBe(false);
    expect(conn.lastSpeechEndedAt).toBe(0);
    expect(chessConvai.canReleaseLipsyncHeldPose('arjun')).toBe(false);
  });

  it('releases ownership for same-coach model replacement without discarding the SDK queue', () => {
    vi.spyOn(performance, 'now').mockReturnValue(3_000);
    const { control } = attachQueue('arjun', {
      speaking: true,
      frames: [new Float32Array([0.2]), new Float32Array([0.4])],
    });
    const conn = connection();

    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: true });
    conn.lipsyncPlayer.lastFrame = new Float32Array([0.9]);
    conn.lipsyncPlayer.currentRawFrame = new Float32Array([0.9]);
    const initialGeneration = chessConvai.getLipsyncResetGeneration('arjun');

    chessConvai.releaseLipsyncRenderer('arjun');

    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
    expect(conn.lipsyncRendererHeartbeatAt).toBe(0);
    expect(conn.lipsyncActive).toBe(false);
    expect(conn.lipsyncPlayer.lastFrame).toBeNull();
    expect(conn.lipsyncPlayer.currentRawFrame).toBeNull();
    expect(control.consumedFrames).toBe(0);
    expect(control.frames).toHaveLength(2);

    // Until the replacement model mounts and claims ownership, compatibility
    // playback can safely resume from the preserved queue.
    expect(chessConvai.getLipsyncFrame('arjun')).not.toBeNull();
    expect(control.consumedFrames).toBe(1);
  });

  it('does not let a late release from the replaced coach disturb the new active coach', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(4_000);
    const arjun = attachQueue('arjun', { speaking: true });
    chessConvai.reportLipsyncRenderState('arjun', { active: true, fresh: true });

    manager.activeCoachId = 'leila';
    const leila = attachQueue('leila', { speaking: true });
    now.mockReturnValue(4_100);
    chessConvai.reportLipsyncRenderState('leila', { active: true, fresh: true });
    const leilaConn = connection('leila');
    const leilaHeartbeat = leilaConn.lipsyncRendererHeartbeatAt;
    const leilaGeneration = chessConvai.getLipsyncResetGeneration('leila');

    chessConvai.releaseLipsyncRenderer('arjun');

    expect(chessConvai.getLipsyncQueue('arjun')).toBeNull();
    expect(chessConvai.getLipsyncQueue('leila')).toBe(leila.queue);
    expect(leilaConn.lipsyncRendererHeartbeatAt).toBe(leilaHeartbeat);
    expect(chessConvai.getLipsyncResetGeneration('leila')).toBe(leilaGeneration);
    expect(leila.control.consumedFrames).toBe(0);
    expect(arjun.control.consumedFrames).toBe(0);
  });

  it('resets the render generation and SDK queue when speech is interrupted', () => {
    const { control } = attachQueue('arjun', { speaking: true });
    const conn = connection();
    conn.isSpeaking = true;
    conn.lipsyncActive = true;
    manager.speakingCoachId = 'arjun';
    const initialGeneration = chessConvai.getLipsyncResetGeneration('arjun');

    chessConvai.interruptBot(COACHES.find((coach) => coach.id === 'arjun')!);

    expect(control.resetCalls).toBe(1);
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
    expect(conn.isSpeaking).toBe(false);
    expect(conn.lipsyncActive).toBe(false);
    expect(manager.speakingCoachId).toBe('');
  });

  it('resets facial state and ownership when the SDK connection disconnects', async () => {
    const { control } = attachQueue('arjun', { speaking: true });
    const conn = connection();
    conn.connected = true;
    conn.isSpeaking = true;
    conn.lipsyncActive = true;
    conn.lipsyncRendererHeartbeatAt = 5_000;
    manager.speakingCoachId = 'arjun';
    const initialGeneration = chessConvai.getLipsyncResetGeneration('arjun');

    await manager.disconnectOne(conn);

    // The client/SDK queue is released first; the monotonic generation is the
    // renderer-facing neutral signal after disconnect.
    expect(control.resetCalls).toBe(0);
    expect(chessConvai.getLipsyncResetGeneration('arjun')).toBe(initialGeneration + 1);
    expect(conn.client).toBeNull();
    expect(conn.connected).toBe(false);
    expect(conn.lipsyncActive).toBe(false);
    expect(conn.lipsyncRendererHeartbeatAt).toBe(0);
    expect(manager.speakingCoachId).toBe('');
  });

  it('hands the fresh preconnected room to the first welcome without resetting it', async () => {
    const coach = COACHES.find(({ id }) => id === 'sofia')!;
    const difficulty = DIFFICULTIES.find(({ id }) => id === 'intermediate')!;
    const conn = connection('sofia');
    const resetSession = vi.fn();
    const updateContext = vi.fn();
    conn.client = {
      conversationSessionId: 0,
      resetSession,
      updateContext,
      blendshapeQueue: { reset: vi.fn() },
    };
    conn.connected = true;
    conn.botReady = true;

    vi.spyOn(chessConvai, 'connectCoach').mockResolvedValue(undefined);
    vi.spyOn(manager, 'deliverWelcomeLine').mockResolvedValue('Welcome.');

    await chessConvai.beginNewGame(
      coach,
      difficulty,
      'fresh-game',
      'STARTING_BOARD',
      null,
      'WELCOME_CONTEXT',
    );

    expect(resetSession).not.toHaveBeenCalled();
    expect(updateContext).not.toHaveBeenCalledWith({ mode: 'reset', run_llm: 'false' });
    expect(updateContext).not.toHaveBeenCalledWith({
      text: 'STARTING_BOARD',
      mode: 'replace',
      run_llm: 'false',
    });

    resetSession.mockClear();
    updateContext.mockClear();
    conn.client.conversationSessionId = 2;
    await chessConvai.beginNewGame(
      coach,
      difficulty,
      'next-game',
      'STARTING_BOARD',
      null,
      'WELCOME_CONTEXT',
    );

    expect(resetSession).toHaveBeenCalledTimes(1);
    expect(updateContext).toHaveBeenCalledWith({ mode: 'reset', run_llm: 'false' });
  });

  it('does not stack an unchanged policy update in front of a warm-room welcome', async () => {
    const coach = COACHES.find(({ id }) => id === 'sofia')!;
    const difficulty = DIFFICULTIES.find(({ id }) => id === 'intermediate')!;
    const conn = connection('sofia');
    const updateContext = vi.fn();
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    conn.client = {
      conversationSessionId: 0,
      updateContext,
      blendshapeQueue: { reset: vi.fn() },
    };
    conn.connected = true;
    conn.botReady = true;
    conn.staticPolicy = staticPolicy;
    conn.appliedStaticPolicy = staticPolicy;
    conn.endUserId = 'google:warm-room-test';
    conn.endUserMetadata = { name: 'Warm Room Test' };
    conn.ltmEnabled = true;
    conn.activeCharacterId = coach.characterId;
    // The preconnect already carried this policy in ConvaiClient.dynamicInfo.
    // A published board-vision fixture keeps this unit test on the handoff seam.
    conn.boardVision = { isPublished: () => true } as never;

    vi.spyOn(manager, 'deliverWelcomeLine').mockResolvedValue('Welcome.');

    await chessConvai.beginNewGame(
      coach,
      difficulty,
      'fresh-game',
      'STARTING_BOARD',
      {
        displayName: 'Warm Room Test',
        endUserId: 'google:warm-room-test',
        endUserMetadata: { name: 'Warm Room Test' },
      },
      'WELCOME_CONTEXT',
    );

    expect(updateContext).not.toHaveBeenCalledWith({
      text: staticPolicy,
      mode: 'replace',
      run_llm: 'false',
    });
  });
});

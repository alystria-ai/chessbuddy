import {
  registerKnownEndUserId,
  resolveConvaiConnectionEndUserId,
  type UserIdentity,
  usesConvaiLongTermMemory,
} from './auth';
import { buildCoachInstruction } from './chessAi';
import { ensureBoardVisionCanvas, type BoardVisionSession } from './boardVision';
import { getConvaiAuthToken } from './convaiAuthToken';
import { isMauLimitError } from './convaiErrors';
import {
  COACHES,
  resolveConvaiCharacterId,
  type CoachConfig,
  type CoachId,
  type DifficultyConfig,
} from './coachConfig';
import { debugLog } from './debugLog';
import { elapsedSince, updateQuietSince } from './speechWaitTiming';
import {
  advanceLipsyncFrame,
  drainLipsyncQueueRemaining,
  isLipsyncPlayerActive,
  resetLipsyncPlayerState,
  shouldPlayLipsyncFrames,
} from './convaiLipsyncPlayer';
import { createConnection, type CoachConnection } from './convaiConnection';
import { CoachAudioMonitor } from './coachAudioMonitor';
import { applyVoiceMuteToElement } from './voiceMutePolicy';
import { CONVAI_MHA_CLIENT_OPTIONS } from './convaiMhaLipsync';
const SUPPRESSED_RESPONSE_PATTERN = /^\s*(silent|human):?\s*[.!?]*\s*$/i;
const PROMPT_LEAK_PATTERN = /^\s*(human|system|user)\s*:/i;
const LIPSYNC_RENDERER_HEARTBEAT_MS = 500;

/** SDK queue surface shared with the Three.js render-loop adapter. */
export type ConvaiBlendshapeQueue = {
  length?: number;
  getLength?: () => number;
  isBotSpeaking?: () => boolean;
  hasReceivedEndSignal?: () => boolean;
  hasFrames?: () => boolean;
  isConversationEnded?: () => boolean;
  isAllFramesConsumed?: () => boolean;
  getTimeLeftMs?: () => number;
  getPlaybackFps?: () => number;
  getFrameWithAlpha?: (index: number) => Float32Array | null;
  consumeFrames?: (count: number) => void;
  consumeNormalizationSignal?: () => boolean;
  startBotSpeaking?: () => void;
  stopBotSpeaking?: () => void;
  startConversation?: () => void;
  reset?: () => void;
};

export type LipsyncRenderState = {
  /** True while the adapter has a contribution applied or is fading it out. */
  active: boolean;
  /** True only when this render tick consumed a new SDK facial frame. */
  fresh?: boolean;
};

/**
 * Repair the SDK's cumulative bot-llm-text: it occasionally re-injects an
 * earlier, already-complete sentence verbatim into the middle of later chunks
 * — often mid-word ("In the opening, priorit[Pawn to F 3 ... square.]ize
 * getting...") — so the same sentence appears 2+ times spliced at chunk
 * boundaries. Audio and lipsync are unaffected (they come from the TTS
 * stream), so only the text needs fixing: keep the FIRST occurrence of each
 * sentence and strip verbatim re-echoes.
 *
 * Two strip rules, both anchored on "this is never legitimate speech":
 * - a repeat GLUED to the preceding text (no whitespace before it, e.g.
 *   "I'm notThis is move one.") is a splice at any length — real dialogue
 *   always has a space/newline before a new sentence;
 * - a cleanly-separated repeat is stripped only at >=20 chars, so short
 *   emphatic repetition ("Well done. Well done.") survives.
 */
export function stripInjectedRepeats(text: string): string {
  const sentences = text.match(/[^.!?]*[.!?]+/g);
  if (!sentences) return text;
  let out = text;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length < 8) continue;
    const first = out.indexOf(sentence);
    if (first === -1) continue;
    let searchFrom = first + sentence.length;
    while (true) {
      const idx = out.indexOf(sentence, searchFrom);
      if (idx === -1) break;
      const gluedToPreceding = !/\s/.test(out[idx - 1] ?? ' ');
      if (gluedToPreceding || sentence.length >= 20) {
        out = out.slice(0, idx) + out.slice(idx + sentence.length);
        // don't advance — consecutive injected copies land at the same index
      } else {
        searchFrom = idx + sentence.length;
      }
    }
  }
  return out;
}
/** Reserved speech tail for auto coach-move turns (silent moves should not pay the full chat reserve). */
/** localStorage key for the coach-voice mute toggle (see setVoiceMuted). */
const VOICE_MUTED_KEY = 'classic-chess.voiceMuted';
const MIN_SPEECH_RESERVE_AUTO_MS = 2000;
const WELCOME_TURN_BUDGET_MS = 20000;
const SILENT_TURN_SDK_QUIET_MS = 300;
/** Preserve a real post-speech facial tail, but never hold one stale sample. */
const HELD_POSE_FRESH_FRAME_GRACE_MS = 120;
/** Let the final rendered mouth frame close after the SDK explicitly stops speech. */
const SDK_SPEECH_STOP_SETTLE_MS = 500;

/** The permanent Convai API key stays on the server. */
type ConvaiCredential = { authToken: string };

export type SpeechWaitOptions = {
  /** Only count response text whose lastFinalTextAt is at or after this timestamp. */
  turnStartAt?: number;
};

export type ConvaiResponse = {
  coachId: CoachId;
  characterName: string;
  text: string;
  responseId: string;
};

type RunLlmMode = 'auto' | 'true' | 'false';

type ResponseListener = (response: ConvaiResponse) => void;
type StatusListener = (status: ReturnType<ChessConvaiManager['getStatus']>) => void;

function sameMetadata(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

class ChessConvaiManager {
  private readonly staleReadyMs = 8000;
  private pool = new Map<string, CoachConnection>();
  private activeCoachId: CoachId = 'arjun';
  private speakingCoachId: CoachId | '' = '';
  private responseListeners = new Set<ResponseListener>();
  private responseSequence = 0;
  private statusListeners = new Set<StatusListener>();
  private speechQueue: Promise<void> = Promise.resolve();
  private streamDebounce: ReturnType<typeof setTimeout> | null = null;
  private lastSpeechEndedAt = 0;
  private speechWaitGeneration = 0;
  /** When a wire-level interrupt was last sent (user-turn settle guard). */
  private lastWireInterruptAt = 0;
  private micEnabled = false;
  /** Coach voice muted (persisted per browser) — see setVoiceMuted. */
  private voiceMuted = (() => {
    try {
      return window.localStorage.getItem(VOICE_MUTED_KEY) === '1';
    } catch {
      return false;
    }
  })();
  private convaiTurnInFlight = false;
  // A conversation epoch is bumped whenever a brand-new game starts. Speech tasks capture
  // the epoch when enqueued and bail if it changed before they run — this discards stale
  // queued turns (e.g. answers to messages sent during the previous game) so the coach
  // never parrots old context after "New game".
  private conversationEpoch = 0;
  // Monotonic id for user chat turns. Only the most recent pending chat is allowed to run,
  // so bombarding the coach with messages answers just the latest instead of stacking up.
  private latestChatSeq = 0;
  private userTranscript = '';
  private transcriptListeners = new Set<(text: string) => void>();
  private globalEndUserId = '';
  private globalEndUserMetadata: Record<string, unknown> | null = null;
  private globalLtmEnabled = false;
  /** Tracks coach <audio> playback (audible / advancing / stuck detection). */
  private audio = new CoachAudioMonitor();
  /** Keeps SDK-created/replaced media elements aligned with the persisted mute. */
  private voiceMuteObserver: MutationObserver | null = null;
  private voiceMuteLifecycleHandler: ((event: Event) => void) | null = null;

  constructor() {
    for (const coach of COACHES) this.pool.set(coach.id, createConnection(coach));
    this.ensureVoiceMuteGuard();
  }

  syncEndUserIdentity(identity: UserIdentity | null | undefined): void {
    this.globalLtmEnabled = usesConvaiLongTermMemory(identity);
    this.globalEndUserId = resolveConvaiConnectionEndUserId(identity);
    this.globalEndUserMetadata = this.globalLtmEnabled ? identity?.endUserMetadata ?? null : null;
    this.applyEndUserIdentityToPool();
    if (this.globalLtmEnabled) {
      debugLog('Convai', `Long-term memory enabled for endUserId=${this.globalEndUserId}`);
    } else {
      debugLog(
        'Convai',
        `Guest session — endUserId=${this.globalEndUserId} (stable per browser, no app-side LTM writes)`,
      );
    }
  }

  private applyEndUserIdentityToPool(): void {
    for (const conn of this.pool.values()) {
      conn.endUserId = this.globalEndUserId;
      conn.endUserMetadata = this.globalEndUserMetadata;
      conn.ltmEnabled = this.globalLtmEnabled;
    }
  }

  private ensureConnection(coach: CoachConfig): CoachConnection {
    let conn = this.pool.get(coach.id);
    if (!conn) {
      conn = createConnection(coach);
      this.pool.set(coach.id, conn);
    } else {
      conn.coach = coach;
    }
    return conn;
  }

  async connectCoach(
    coach: CoachConfig,
    options: {
      waitForBotReady?: boolean;
      readyWaitMs?: number;
      reconnectIfStale?: boolean;
      endUserId?: string;
      endUserMetadata?: Record<string, unknown> | null;
      staticPolicy?: string;
    } = {},
  ): Promise<void> {
    this.activeCoachId = coach.id as CoachId;
    const conn = this.ensureConnection(coach);

    const targetCharacterId = resolveConvaiCharacterId(coach, this.globalLtmEnabled);
    const needsReconnectForUser = Boolean(
      conn.connected &&
      (
        conn.activeCharacterId !== targetCharacterId ||
        (options.endUserId !== undefined && conn.endUserId !== options.endUserId) ||
        (options.endUserMetadata !== undefined && !sameMetadata(conn.endUserMetadata, options.endUserMetadata ?? null))
      ),
    );

    if (options.staticPolicy) conn.staticPolicy = options.staticPolicy;
    if (options.endUserMetadata !== undefined) {
      this.globalEndUserMetadata = options.endUserMetadata ?? null;
    }
    if (options.endUserId !== undefined) {
      this.globalEndUserId = options.endUserId.trim();
      if (this.globalEndUserId) registerKnownEndUserId(this.globalEndUserId);
    }
    this.applyEndUserIdentityToPool();

    await this.disconnectOtherCoaches(coach.id);

    if (conn.connecting || conn.connected) {
      if (needsReconnectForUser) {
        await this.disconnectOne(conn);
      } else if (conn.connected && options.reconnectIfStale && this.isReadyStale(conn)) {
        debugLog('Convai', `[${coach.name}] BOT READY stale after connect; reconnecting before speech`);
        await this.disconnectOne(conn);
      } else {
        if (options.waitForBotReady) await this.waitForReady(conn, options.readyWaitMs ?? 3000);
        if (
          conn.connected
          && conn.staticPolicy
          && conn.appliedStaticPolicy !== conn.staticPolicy
        ) {
          await this.seedStaticCoachPolicy(coach, conn.staticPolicy);
        }
        if (conn.connected) await this.ensureProfileMemory(conn);
        if (conn.connected && !conn.boardVision && conn.client && conn.botReady) {
          void this.ensureCoachBoardVision(conn);
        }
        this.emitStatus();
        return;
      }
    }

    if (conn.connecting) {
      if (options.waitForBotReady) await this.waitForReady(conn, options.readyWaitMs ?? 3000);
      this.emitStatus();
      return;
    }

    const authToken = await getConvaiAuthToken();
    if (!authToken) {
      conn.lastConnectError = 'Voice coaching is temporarily unavailable.';
      debugLog('Convai', `[${coach.name}] Server-issued auth token unavailable`);
      this.emitStatus();
      return;
    }
    const credential: ConvaiCredential = { authToken };
    debugLog('Convai', `[${coach.name}] Using short-lived auth token from the server`);

    conn.connecting = true;
    this.emitStatus();
    conn.lastConnectError = '';

    try {
      await this.establishConvaiSession(coach, conn, options, credential);
    } catch (err) {
      const message = String((err as { message?: string })?.message ?? conn.lastConnectError ?? err ?? '');
      if (conn.client || conn.unsubFns.length > 0) {
        await this.disconnectOne(conn);
      }
      debugLog('Convai', `[${coach.name}] Connection failed:`, message || err);
    } finally {
      conn.connecting = false;
      this.emitStatus();
    }
  }

  private async establishConvaiSession(
    coach: CoachConfig,
    conn: CoachConnection,
    options: {
      waitForBotReady?: boolean;
      readyWaitMs?: number;
    },
    credential: ConvaiCredential,
  ): Promise<void> {
    const characterId = resolveConvaiCharacterId(coach, conn.ltmEnabled);
    const endUserId = conn.endUserId || undefined;
    const usingGuestClone = !conn.ltmEnabled && Boolean(coach.guestCharacterId?.trim());
    debugLog(
      'Convai',
      `[${coach.name}] Connecting character=${characterId} endUserId=${endUserId}${
        conn.ltmEnabled ? ' (LTM on)' : ' (guest, no LTM writes)'
      }${usingGuestClone ? ' [guest clone]' : ''}...`,
    );
    const sdk = await import('@convai/web-sdk/vanilla');
    const { ConvaiClient, AudioRenderer } = sdk;

    const client = new ConvaiClient({
      ...credential,
      characterId,
      endUserId,
      endUserMetadata: conn.ltmEnabled ? conn.endUserMetadata || undefined : undefined,
      enableVideo: true,
      enableLipsync: CONVAI_MHA_CLIENT_OPTIONS.enableLipsync,
      enableEmotion: true,
      // Convai Web LipSync Kit transport — keep these SDK snake_case keys and
      // values in lockstep with the supplied Web Studio 2 verified setup.
      blendshapeConfig: {
        ...CONVAI_MHA_CLIENT_OPTIONS.blendshapeConfig,
        format: CONVAI_MHA_CLIENT_OPTIONS.blendshapeConfig.format as 'mha',
      },
      visionInputConfig: {
        enabled: true,
        sampleIntervalSecs: 1,
        bufferFrames: 5,
        replacePreviousVisionContext: true,
      },
      respondModes: {
        vision: 'silent',
      },
      ttsEnabled: true,
      startWithAudioOn: false,
      keepInContext: true,
      dynamicInfo: conn.staticPolicy || undefined,
    });
    // Attach immediately so any failure path below (e.g. MAU error detected
    // after connect()) can reach disconnectOne → client.disconnect(). Assigning
    // only after a fully successful connect leaked live LiveKit rooms.
    conn.client = client;

    conn.unsubFns.push(
      client.on('message', (msg: any) => {
          const type: string = msg?.type ?? 'unknown';
          const content: string = msg?.content ?? '';
          if (type !== 'bot-llm-text') {
            debugLog('Convai', `[${coach.name}] MSG type="${type}" content="${String(content).slice(0, 80)}"`);
          }
          if (type === 'llm-no-response') {
            this.markLlmNoResponse(conn);
            return;
          }
          if (type === 'bot-llm-text' && content) {
            if (PROMPT_LEAK_PATTERN.test(content)) {
              debugLog('Convai', `[${coach.name}] Suppressing prompt-leak shaped response`);
              this.suppressResponse(conn, 'prompt-leak');
              return;
            }
            const suppressedWord = this.getSuppressedResponseWord(content);
            if (suppressedWord) {
              this.suppressResponse(conn, suppressedWord);
              return;
            }
            // First chunk of a turn WE did not start (microphone speech, or any
            // server-driven turn): clear the previous turn's text before it can
            // be compared against this one. Only the orchestrated paths call
            // resetResponseState, so without this longestResponseText kept the
            // longest reply of the whole session and getBestResponseText handed
            // it back whenever a newer reply was shorter — the mic appeared to
            // return "the same response" every time. turnEnded is the boundary:
            // nothing clears it except a new turn starting.
            if (conn.turnEnded) {
              debugLog('Convai', `[${coach.name}] New unprompted turn — clearing previous response text`);
              this.resetResponseState(conn);
            }
            const sdkResponseId = String(msg?.id ?? '').trim();
            if (sdkResponseId) {
              conn.streamResponseId = sdkResponseId;
            } else if (!conn.streamResponseId) {
              conn.streamResponseId = `${coach.id}:response:${++this.responseSequence}`;
            }
            const cleaned = stripInjectedRepeats(content);
            conn.streamBuffer = cleaned;
            conn.lastEmittedText = cleaned;
            if (cleaned.length > conn.longestResponseText.length) conn.longestResponseText = cleaned;
            // Emit every chunk so the caption streams in smoothly as text arrives.
            // `content` is cumulative, so each emit shows the text grown so far.
            this.emitResponse(conn, cleaned, conn.streamResponseId);
            if (this.streamDebounce) clearTimeout(this.streamDebounce);
            this.streamDebounce = setTimeout(() => this.flushStream(conn), 200);
          }
        }),
      );

      conn.unsubFns.push(
        client.on('stateChange', (sdkState: any) => {
          const wasSpeaking = conn.isSpeaking;
          conn.isSpeaking = Boolean(sdkState.isSpeaking);
          conn.isThinking = Boolean(sdkState.isThinking);

          if (conn.isSpeaking && !wasSpeaking) {
            this.armLipsyncConversation(conn);
            conn.lipsyncActive = true;
            this.speakingCoachId = conn.coach.id;
            // Never let the previous utterance's quiet timestamp authorize a
            // release in the new turn.
            conn.lastSpeechEndedAt = 0;
            this.lastSpeechEndedAt = 0;
            try { client.blendshapeQueue?.startBotSpeaking?.(); } catch {}
            // The coach is replying now, so the user's pending live transcript is done.
            if (this.userTranscript) this.emitTranscript('');
          }

          if (wasSpeaking && !conn.isSpeaking) {
            this.flushStream(conn);
            const endedAt = Date.now();
            conn.lastSpeechEndedAt = endedAt;
            this.lastSpeechEndedAt = endedAt;
            conn.isThinking = false;
            if (conn.speechEndTimer) clearTimeout(conn.speechEndTimer);
            conn.speechEndTimer = setTimeout(() => {
              conn.speechEndTimer = null;
              if (!conn.isSpeaking) {
                this.finishLipsyncIfEnded(conn);
                if (!conn.lipsyncActive) {
                  const quietAt = Date.now();
                  conn.lastSpeechEndedAt = quietAt;
                  this.lastSpeechEndedAt = quietAt;
                }
                this.emitStatus();
              }
            }, 120);
          }

          this.emitStatus();
        }),
      );

      // speakingChange is status-only — lipsync clock starts in stateChange when isSpeaking
      // goes true. A second startBotSpeaking here rewound blendshape playback (double-play).

      conn.unsubFns.push(client.on('botReady', () => {
        conn.botReady = true;
        debugLog('Convai', `[${coach.name}] BOT READY`);
        void this.ensureCoachBoardVision(conn);
        this.emitStatus();
      }));

      conn.unsubFns.push(client.on('error', (err: any) => {
        const message = String(err?.message || err || '');
        conn.lastConnectError = message;
        debugLog('Convai', `[${coach.name}] error:`, message);
        if (/missing end_user_id/i.test(message)) {
          debugLog(
            'Convai',
            `[${coach.name}] Guest play requires LTM disabled on this Convai character, or a separate guest clone via VITE_CONVAI_GUEST_CHARACTER_${String(coach.id).toUpperCase()}.`,
          );
        } else if (isMauLimitError(message)) {
          debugLog(
            'Convai',
            `[${coach.name}] MAU limit reached — account cleanup must be handled by an authorized operator.`,
          );
        }
      }));

      conn.unsubFns.push(client.on('turnEnd', (payload: any) => {
        conn.turnEnded = true;
        conn.lastTurnEndAt = Date.now();
        const sessionId = payload?.sessionId ?? client.conversationSessionId ?? 'unknown';
        debugLog('Convai', `[${coach.name}] turnEnd session=${sessionId}`);
        this.captureLatestText(conn);
        if (this.userTranscript) this.emitTranscript('');
      }));

      // Live microphone transcription: stream the partial text to the UI and treat the user
      // starting to speak as a preemption, so any in-flight orchestrated turn (a welcome line,
      // a move comment) stops waiting and the user is given priority instead of looping.
      conn.unsubFns.push(
        client.on('userTranscriptionChange', (payload: any) => {
          const text = typeof payload === 'string'
            ? payload
            : String(payload?.text ?? payload?.transcription ?? payload?.content ?? '');
          this.handleUserTranscription(conn, text);
        }) ?? (() => {}),
      );

      conn.unsubFns.push(client.on('llmNoResponse', () => {
        this.markLlmNoResponse(conn);
      }));

      conn.unsubFns.push(client.on('blendshapes', () => {
        conn.lipsyncActive = true;
        this.speakingCoachId = conn.coach.id;
      }));

      conn.unsubFns.push(client.on('metrics', (metricsData: any) => {
        debugLog('Convai', `[${coach.name}] metrics`, metricsData);
      }));

      conn.unsubFns.push(client.on('serverResponse', (response: any) => {
        if (response?.event_type !== 'context-update') return;
        conn.contextAckSequence += 1;
        conn.lastContextAckStatus = String(response?.status ?? 'unknown');
        const triggered = response?.extras?.llm_triggered;
        conn.lastContextAckTriggered = typeof triggered === 'boolean' ? triggered : null;
        debugLog(
          'Convai',
          `[${coach.name}] Context ack status=${conn.lastContextAckStatus}`
            + ` run_llm=${String(response?.extras?.actual_run_llm ?? 'unknown')}`
            + ` triggered=${String(conn.lastContextAckTriggered ?? 'unknown')}`,
        );
      }));

      await client.connect();
      if (isMauLimitError(conn.lastConnectError) || /missing end_user_id/i.test(conn.lastConnectError)) {
        throw new Error(conn.lastConnectError);
      }
      conn.activeCharacterId = characterId;
      conn.connected = true;
      conn.connectedAt = Date.now();
      // `dynamicInfo` above installs this policy as part of the connection
      // request. Remember that fact so handing an already-warm room to Play
      // does not send the identical non-LLM context update immediately before
      // the response-generating welcome update.
      conn.appliedStaticPolicy = conn.staticPolicy;

      try {
        conn.audioRenderer = new AudioRenderer(client.room);
        conn.coachAudioEl = this.audio.resolveElement(conn.audioRenderer);
        // A fresh element starts unmuted — carry the user's mute choice over.
        this.applyVoiceMute();
        debugLog('Convai', `[${coach.name}] AudioRenderer created`);
      } catch (err) {
        debugLog('Convai', `[${coach.name}] AudioRenderer failed:`, err);
      }

      setTimeout(() => {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.paused) el.play().catch(() => {});
        });
      }, 1500);

    if (conn.staticPolicy) await this.seedStaticCoachPolicy(coach, conn.staticPolicy);
    if (options.waitForBotReady) await this.waitForReady(conn, options.readyWaitMs ?? 5000);
    await this.ensureCoachBoardVision(conn);
    await this.ensureProfileMemory(conn);
  }

  private unlockAudioCtx: AudioContext | null = null;

  unlockAudio(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        // Reuse one context — browsers cap concurrent AudioContexts (~6 in
        // Chrome) and this is called on every game start / user interaction.
        if (!this.unlockAudioCtx || this.unlockAudioCtx.state === 'closed') {
          this.unlockAudioCtx = new AudioCtx();
        }
        const ctx = this.unlockAudioCtx;
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        void ctx.resume();
      }
      document.querySelectorAll('audio').forEach((el) => el.play().catch(() => {}));
    } catch {}
  }

  async seedStaticCoachPolicy(coach: CoachConfig, instruction: string): Promise<void> {
    const conn = this.pool.get(coach.id);
    if (!conn || !instruction.trim()) return;
    // Persist even before the client exists — a later connectCoach reads
    // conn.staticPolicy, so dropping it here answered the first chat turn
    // under a stale (move-mode) system instruction.
    conn.staticPolicy = instruction;
    if (!conn.client) return;
    if (conn.appliedStaticPolicy === instruction) return;
    if (typeof conn.client.updateContext === 'function') {
      try {
        conn.client.updateContext({ text: instruction, mode: 'replace', run_llm: 'false' });
        conn.appliedStaticPolicy = instruction;
      } catch (err) {
        debugLog('Convai', `[${coach.name}] Static policy updateContext failed:`, err);
      }
    }
    debugLog('Convai', `[${coach.name}] Static policy seeded len=${instruction.length}`);
  }

  /** Connect options that re-apply a connection's identity and coaching policy on (re)connect. */
  private reconnectOptionsFor(conn: CoachConnection | undefined): {
    staticPolicy: string | undefined;
    endUserId: string | undefined;
    endUserMetadata: Record<string, unknown> | undefined;
  } {
    return {
      staticPolicy: conn?.staticPolicy,
      endUserId: conn?.endUserId,
      endUserMetadata: conn?.endUserMetadata ?? undefined,
    };
  }

  /**
   * Shared "empty response" recovery: tear down the connection, reconnect with the same
   * identity/policy, and resend the turn once. `canResend` is re-checked after the reconnect
   * completes (per-site guard: speech generation / conversation epoch); when it fails the
   * resend is skipped and `null` is returned so the caller keeps its original response.
   */
  private async reconnectAndResendOnce(
    coach: CoachConfig,
    conn: CoachConnection,
    logMessage: string,
    canResend: () => boolean,
    resend: () => Promise<string>,
  ): Promise<string | null> {
    debugLog('Convai', `[${coach.name}] ${logMessage}`);
    await this.disconnectOne(conn);
    await this.connectCoach(coach, {
      waitForBotReady: true,
      readyWaitMs: 3500,
      ...this.reconnectOptionsFor(conn),
    });
    if (canResend()) return resend();
    return null;
  }

  async runCoachTurn(
    coach: CoachConfig,
    dynamicInfo: string,
    options: { runLlm?: RunLlmMode; preflightSilence?: boolean; maxWaitMs?: number; waitForFullSpeech?: boolean; guard?: () => boolean; skipConnect?: boolean } = {},
  ): Promise<string> {
    const runLlm = options.runLlm ?? 'auto';
    const startEpoch = this.conversationEpoch;
    const extraGuard = options.guard;
    const stillRelevant = () => startEpoch === this.conversationEpoch && (!extraGuard || extraGuard());
    return this.runExclusiveSpeech(async () => {
      if (!stillRelevant()) {
        debugLog('Convai', `[${coach.name}] Coach turn superseded before start; skipping`);
        return '';
      }
      this.convaiTurnInFlight = true;
      this.emitStatus();
      try {
        this.activeCoachId = coach.id;
        if (!options.skipConnect) {
          await this.connectCoach(coach, {
            waitForBotReady: true,
            readyWaitMs: 3500,
            reconnectIfStale: true,
            ...this.reconnectOptionsFor(this.pool.get(coach.id)),
          });
        }
        if (options.preflightSilence !== false) {
          await this.waitForGlobalSilence(`${coach.name} turn preflight`, 150, 300);
        }
        const genAtStart = this.speechWaitGeneration;
        let response = await this.sendContextTurn(coach, dynamicInfo, runLlm, options.maxWaitMs, options.waitForFullSpeech);
        // Only retry a genuinely empty forced turn — not one cut short by the user or a new
        // game. A bumped speech generation or changed epoch means we were interrupted, and
        // replaying the same line then would re-greet/re-explain on top of whatever the user
        // just triggered (the "welcome keeps playing" loop).
        if (
          !response.trim() &&
          runLlm === 'true' &&
          this.speechWaitGeneration === genAtStart &&
          stillRelevant()
        ) {
          const conn = this.pool.get(coach.id);
          if (conn && !conn.llmNoResponse && !conn.responseSuppressed) {
            const retried = await this.reconnectAndResendOnce(
              coach,
              conn,
              'Forced turn empty; reconnecting once',
              stillRelevant,
              () => this.sendContextTurn(coach, dynamicInfo, runLlm, options.maxWaitMs, options.waitForFullSpeech),
            );
            if (retried !== null) response = retried;
          }
        }
        const conn = this.pool.get(coach.id);
        if (conn) return this.getBestResponseText(conn) || response;
        return response;
      } finally {
        this.convaiTurnInFlight = false;
        this.emitStatus();
      }
    });
  }

  async speakCoachMessage(coach: CoachConfig, message: string, dynamicInfo: string, guard?: () => boolean): Promise<string> {
    const startEpoch = this.conversationEpoch;
    const stillRelevant = () => startEpoch === this.conversationEpoch && (!guard || guard());
    return this.runExclusiveSpeech(async () => {
      if (!stillRelevant()) {
        debugLog('Convai', `[${coach.name}] Message superseded before start; skipping`);
        return '';
      }
      this.convaiTurnInFlight = true;
      this.emitStatus();
      try {
        this.activeCoachId = coach.id;
        await this.connectCoach(coach, {
          waitForBotReady: true,
          readyWaitMs: 3500,
          reconnectIfStale: true,
          ...this.reconnectOptionsFor(this.pool.get(coach.id)),
        });
        await this.waitForGlobalSilence(`${coach.name} turn preflight`, 150, 300);
        const genAtStart = this.speechWaitGeneration;
        let response = await this.sendAndAwaitSpeech(coach, message, dynamicInfo);
        if (!response.trim()) {
          const conn = this.pool.get(coach.id);
          if (conn?.llmNoResponse || conn?.responseSuppressed) {
            return '';
          }
          // The service's text-message path can silently drop turns while the
          // context-turn path (how the welcome line is produced) keeps
          // working — observed as every sendUserTextMessage dying with empty
          // responses on a day when every run_llm context turn succeeded.
          // Re-ask through the context path on the SAME connection first;
          // it's fast and doesn't tear anything down.
          if (conn && message.trim() && this.speechWaitGeneration === genAtStart && stillRelevant()) {
            debugLog('Convai', `[${coach.name}] Empty text-turn response; retrying via context turn`);
            const contextAsk = [
              dynamicInfo.trim(),
              `The student just said: "${message}". Respond to them now, speaking directly to the student.`,
            ].filter(Boolean).join('\n\n');
            const viaContext = await this.sendContextTurn(coach, contextAsk, 'true', 15000, true);
            if (viaContext.trim()) response = viaContext;
          }
          if (!response.trim()) {
            const conn2 = this.pool.get(coach.id);
            if (conn2 && message.trim() && this.speechWaitGeneration === genAtStart && stillRelevant()) {
              const retried = await this.reconnectAndResendOnce(
                coach,
                conn2,
                'Empty response, reconnecting once',
                stillRelevant,
                () => this.sendAndAwaitSpeech(coach, message, dynamicInfo),
              );
              if (retried !== null) response = retried;
            }
          }
        }
        return response;
      } finally {
        this.convaiTurnInFlight = false;
        this.emitStatus();
      }
    });
  }

  async sendUserChat(
    coach: CoachConfig,
    difficulty: DifficultyConfig,
    message: string,
    dynamicInfo: string,
    fen?: string,
  ): Promise<string> {
    // The user gets priority: stop whatever the coach is currently saying right away, and
    // tag this turn so that if more messages arrive while it waits, only the newest one is
    // actually answered (older ones are skipped by the guard below). `dynamicInfo` carries
    // the live board context, which sendAndAwaitSpeech pushes before the question.
    const mySeq = ++this.latestChatSeq;
    const myEpoch = this.conversationEpoch;
    this.interruptBot(coach);
    this.emitTranscript('');
    const conn = this.pool.get(coach.id);
    if (conn) conn.isThinking = true;
    this.convaiTurnInFlight = true;
    this.activeCoachId = coach.id;
    this.emitStatus();
    this.refreshBoardVision(coach, fen);
    try {
      const staticPolicy = `${buildCoachInstruction(coach, difficulty, 'chat')}`;
      await this.seedStaticCoachPolicy(coach, staticPolicy);
      const authoritativeDynamic = this.buildAuthoritativeDynamicContext(dynamicInfo, fen);
      const chatMessage = fen?.trim()
        ? `Current board FEN: ${fen.trim()}. The student asks: "${message}". Answer only from the authoritative board context just provided, not from earlier conversation about past positions.`
        : `The student asks: "${message}". Answer using the current board context.`;
      return await this.speakCoachMessage(
        coach,
        chatMessage,
        authoritativeDynamic,
        () => mySeq === this.latestChatSeq && myEpoch === this.conversationEpoch,
      );
    } finally {
      // A turn that dies with no server events (no state change, no speech,
      // no turn end — the empty-LLM-response case) never gets its manually
      // set thinking flag cleared by the event handlers, leaving the
      // "Thinking..." chip stuck forever. Guarantee it clears once this chat
      // turn resolves — unless a newer chat already re-armed it.
      if (mySeq === this.latestChatSeq) {
        const finalConn = this.pool.get(coach.id);
        if (finalConn) finalConn.isThinking = false;
        this.emitStatus();
      }
    }
  }

  async updateCoachContext(coach: CoachConfig, dynamicInfo: string): Promise<void> {
    this.activeCoachId = coach.id;
    await this.connectCoach(coach, this.reconnectOptionsFor(this.pool.get(coach.id)));
    await this.pushDynamicContext(coach, dynamicInfo, 'false');
  }

  async rememberGameSummary(coach: CoachConfig, memory: string): Promise<boolean> {
    const conn = this.pool.get(coach.id);
    const text = memory.trim();
    const manager = conn?.client?.memoryManager;
    if (!conn?.ltmEnabled || !text || !manager?.addMemories) return false;
    try {
      const exists = await this.memoryExists(manager, text);
      if (!exists) {
        await manager.addMemories([text]);
        debugLog('Convai', `[${coach.name}] Saved long-term memory: ${text}`);
      }
      return true;
    } catch (err) {
      debugLog('Convai', `[${coach.name}] Failed to save long-term memory:`, err);
      return false;
    }
  }

  refreshBoardVision(coach: CoachConfig, fen?: string): void {
    const conn = this.pool.get(coach.id);
    if (!conn?.client) return;
    void this.ensureCoachBoardVision(conn, fen);
  }

  private async ensureCoachBoardVision(conn: CoachConnection, fen?: string): Promise<BoardVisionSession | null> {
    if (fen?.trim()) conn.pendingBoardVisionFen = fen;
    if (!conn.client || !conn.connected || !conn.botReady) return null;

    if (conn.boardVision?.isPublished()) {
      const activeFen = fen?.trim() || conn.pendingBoardVisionFen;
      if (activeFen) conn.boardVision.updateFromFen(activeFen);
      else conn.boardVision.refresh();
      conn.pendingBoardVisionFen = '';
      return conn.boardVision;
    }

    if (conn.boardVisionPublishPromise) return conn.boardVisionPublishPromise;

    const publishFen = fen?.trim() || conn.pendingBoardVisionFen || undefined;
    conn.boardVisionPublishPromise = ensureBoardVisionCanvas(conn.client, null, {
      fen: publishFen,
      attempts: 2,
      delayMs: 600,
      readyWaitMs: 8000,
    }).then((session) => {
      conn.boardVisionPublishPromise = null;
      if (session?.isPublished()) {
        conn.boardVision = session;
        conn.pendingBoardVisionFen = '';
        if (fen?.trim()) session.updateFromFen(fen);
      }
      return session;
    }).catch(() => {
      conn.boardVisionPublishPromise = null;
      return null;
    });

    return conn.boardVisionPublishPromise;
  }

  async beginNewGame(
    coach: CoachConfig,
    difficulty: DifficultyConfig,
    sessionId: string,
    startingDynamicInfo: string,
    identity?: UserIdentity | null,
    welcomeDynamicInfo?: string,
  ): Promise<string> {
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    this.syncEndUserIdentity(identity);
    const endUserId = this.globalEndUserId;
    const endUserMetadata = this.globalEndUserMetadata;
    const conn = this.pool.get(coach.id);
    if (conn) {
      conn.staticPolicy = staticPolicy;
    }

    // New conversation: invalidate any speech turns still queued from the previous game and
    // drop pending user-chat sequencing, so nothing from the old game speaks into the new one.
    this.conversationEpoch++;
    this.latestChatSeq = 0;
    this.emitTranscript('');

    this.interruptBot(coach);
    await this.connectCoach(coach, {
      waitForBotReady: true,
      readyWaitMs: 3500,
      endUserId,
      endUserMetadata,
      staticPolicy,
      reconnectIfStale: false,
    });

    const readyConn = this.pool.get(coach.id);
    if (!readyConn?.client) return '';

    // A first-play preconnect has never hosted a conversation. Resetting that
    // already-ready room and immediately stacking reset/policy/board/welcome
    // context updates made Convai silently drop the greeting turn, forcing a
    // slow disconnect/reconnect. Hand the untouched warm room straight to the
    // welcome instead. Reused rooms still reset so an earlier game's dialogue
    // cannot leak into the new one.
    const rawConversationSessionId = Number(readyConn.client.conversationSessionId);
    const isFreshPreconnectedRoom = Number.isFinite(rawConversationSessionId)
      && rawConversationSessionId <= 0;

    // Always clear the local facial timeline before the first game frame.
    this.resetLipsyncState(readyConn);
    if (isFreshPreconnectedRoom) {
      debugLog('Convai', `[${coach.name}] Reusing fresh preconnected room for immediate welcome`);
    } else {
      try { readyConn.client.resetSession?.(); } catch {}
      try {
        readyConn.client.updateContext?.({ mode: 'reset', run_llm: 'false' });
      } catch {}
      readyConn.appliedStaticPolicy = '';
      await this.seedStaticCoachPolicy(coach, staticPolicy);
    }
    debugLog(
      'Convai',
      `[${coach.name}] New game session=${sessionId} endUserId=${endUserId}${this.globalLtmEnabled ? ' (LTM on)' : ' (guest, LTM off)'}`,
    );

    if (!welcomeDynamicInfo?.trim()) {
      await this.pushDynamicContext(coach, startingDynamicInfo, 'false');
      return '';
    }

    return this.runExclusiveSpeech(async () => {
      this.convaiTurnInFlight = true;
      this.emitStatus();
      try {
        return await this.deliverWelcomeLine(coach, welcomeDynamicInfo);
      } finally {
        this.convaiTurnInFlight = false;
        this.emitStatus();
      }
    });
  }

  private async deliverWelcomeLine(coach: CoachConfig, welcomeDynamicInfo: string): Promise<string> {
    const conn = this.pool.get(coach.id);
    if (!conn?.client || !conn.connected) return '';

    await this.waitForReady(conn, 2000);
    const genAtStart = this.speechWaitGeneration;
    let response = await this.sendContextTurn(
      coach,
      welcomeDynamicInfo,
      'true',
      WELCOME_TURN_BUDGET_MS,
      true,
    );

    const afterTurn = this.pool.get(coach.id);
    if (
      !response.trim() &&
      afterTurn &&
      !afterTurn.llmNoResponse &&
      !afterTurn.responseSuppressed &&
      this.speechWaitGeneration === genAtStart
    ) {
      const retried = await this.reconnectAndResendOnce(
        coach,
        afterTurn,
        'Welcome line empty; reconnecting once',
        () => this.speechWaitGeneration === genAtStart,
        () => this.sendContextTurn(
          coach,
          welcomeDynamicInfo,
          'true',
          WELCOME_TURN_BUDGET_MS,
          true,
        ),
      );
      if (retried !== null) response = retried;
    }

    const finalConn = this.pool.get(coach.id);
    return finalConn ? this.getBestResponseText(finalConn) || response : response;
  }

  interruptBot(coach: CoachConfig): void {
    const conn = this.pool.get(coach.id);
    if (!conn) return;
    this.speechWaitGeneration++;
    // Only send the WIRE interrupt when there is actually a turn to cut off.
    // An interrupt fired at an idle bot races the message sent right after
    // it: the server can process the interrupt against the NEW turn and
    // silently cancel it — which matched the observed failure exactly (user
    // turns on a just-used connection returning empty with no error, while
    // fresh connections, which never send an interrupt, respond fine). The
    // local state cleanup below always runs either way.
    const hasActiveTurn = conn.isSpeaking
      || conn.isThinking
      || conn.lipsyncActive
      || this.convaiTurnInFlight;
    if (hasActiveTurn) {
      try { conn.client?.sendInterruptMessage?.(); } catch {}
      this.lastWireInterruptAt = Date.now();
    }
    conn.streamBuffer = '';
    conn.lastEmittedText = '';
    conn.longestResponseText = '';
    conn.streamResponseId = '';
    conn.turnEnded = true;
    conn.lastTurnEndAt = Date.now();
    conn.isThinking = false;
    conn.isSpeaking = false;
    if (this.streamDebounce) {
      clearTimeout(this.streamDebounce);
      this.streamDebounce = null;
    }
    try { conn.client?.blendshapeQueue?.stopBotSpeaking?.(); } catch {}
    this.resetLipsyncState(conn);
    const endedAt = Date.now();
    conn.lastSpeechEndedAt = endedAt;
    this.lastSpeechEndedAt = endedAt;
    this.emitStatus();
    debugLog('Convai', `[${coach.name}] Bot interrupted (${hasActiveTurn ? 'wire' : 'local only'})`);
  }

  async speakWelcome(coach: CoachConfig, dynamicInfo: string): Promise<string> {
    return this.runCoachTurn(coach, dynamicInfo, {
      runLlm: 'true',
      preflightSilence: false,
      waitForFullSpeech: true,
      maxWaitMs: WELCOME_TURN_BUDGET_MS,
      skipConnect: true,
    });
  }

  async speakGameOver(coach: CoachConfig, dynamicInfo: string): Promise<string> {
    this.interruptBot(coach);
    return this.runCoachTurn(coach, dynamicInfo, { runLlm: 'true', preflightSilence: false, waitForFullSpeech: true, maxWaitMs: 20000 });
  }

  private estimateSpeechMs(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.min(12000, Math.max(1400, words * 420 + 500));
  }

  private estimateLipsyncTailMs(conn: CoachConnection): number {
    const queue = conn.client?.blendshapeQueue;
    const timeLeftMs = queue?.getTimeLeftMs?.();
    if (typeof timeLeftMs === 'number' && timeLeftMs > 0) return timeLeftMs;
    return 2000;
  }

  private computeSpeechWaitBudget(conn: CoachConnection, finalText: string): number {
    return Math.max(
      this.estimateSpeechMs(finalText) + 3000,
      this.estimateLipsyncTailMs(conn) + 1500,
    );
  }

  private speechElapsedMs(conn: CoachConnection): number {
    if (conn.lastFinalTextAt <= 0) return 0;
    return Date.now() - conn.lastFinalTextAt;
  }

  private isCoachSpeechPlaybackComplete(conn: CoachConnection): boolean {
    const queue = conn.client?.blendshapeQueue;
    if (typeof queue?.isAllFramesConsumed === 'function' && queue.isAllFramesConsumed()) return true;
    if (queue?.isConversationEnded?.() && !queue?.hasFrames?.()) return true;
    const timeLeftMs = queue?.getTimeLeftMs?.();
    if (typeof timeLeftMs === 'number' && timeLeftMs <= 0) return true;
    if (
      queue?.isConversationEnded?.()
      && !this.audio.isPlaying(conn)
      && !this.audio.isAdvancing(conn)
      && !this.isCoachSpeechSignalActive(conn)
    ) {
      return true;
    }
    return false;
  }

  private buildAuthoritativeDynamicContext(dynamicInfo: string, fen?: string): string {
    const trimmedFen = fen?.trim();
    if (!trimmedFen) return dynamicInfo;
    return `AUTHORITATIVE BOARD STATE (ignore any earlier coach lines that contradict this): FEN: ${trimmedFen}. ${dynamicInfo}`;
  }

  private logDynamicContextFen(coachName: string, dynamicInfo: string): void {
    const match = dynamicInfo.match(/FEN:\s*([^\s.]+\/[^\s.]+\/[^\s.]+\/[^\s.]+\/[^\s.]+\/[^\s.]+\/[^\s.]+\/[^\s.]+)/i)
      ?? dynamicInfo.match(/Current board FEN:\s*([^.]+)/i);
    if (match) {
      debugLog('Convai', `[${coachName}] Dynamic context FEN=${match[1].trim().slice(0, 80)}`);
    }
  }

  private getTurnResponseText(conn: CoachConnection, turnStartAt?: number): string {
    const text = this.getBestResponseText(conn);
    if (!turnStartAt) return text;
    if (conn.lastFinalTextAt < turnStartAt) return '';
    return text;
  }

  private isCoachSpeechSignalActive(conn: CoachConnection, _turnStartAt?: number): boolean {
    if (conn.isSpeaking) return true;
    const queue = conn.client?.blendshapeQueue;
    if (typeof queue?.isBotSpeaking === 'function' && queue.isBotSpeaking()) return true;
    if (this.audio.isAdvancing(conn)) return true;
    if (this.audio.isPlaying(conn)) return true;
    return false;
  }

  private hasFreshLipsyncRenderer(
    conn: CoachConnection,
    now = performance.now(),
  ): boolean {
    const heartbeatAt = conn.lipsyncRendererHeartbeatAt;
    return heartbeatAt > 0
      && now >= heartbeatAt
      && now - heartbeatAt < LIPSYNC_RENDERER_HEARTBEAT_MS;
  }

  private armLipsyncConversation(conn: CoachConnection): void {
    conn.lipsyncConversationEndResetSent = false;
    // A new transport turn invalidates every completion proof from the prior
    // utterance. Facial frames can arrive just ahead of stateChange(true), so
    // clear these here rather than waiting for that later event.
    conn.turnEnded = false;
    conn.lastTurnEndAt = 0;
    conn.lastSpeechEndedAt = 0;
    this.lastSpeechEndedAt = 0;
    // This field remains the speech-wait drought clock while the new renderer
    // owns consumption, so each utterance must begin with an unambiguous zero.
    conn.lipsyncPlayer.lastFreshFrameAtMs = 0;
  }

  private incrementLipsyncResetGeneration(conn: CoachConnection): void {
    conn.lipsyncResetGeneration = conn.lipsyncResetGeneration >= Number.MAX_SAFE_INTEGER
      ? 1
      : conn.lipsyncResetGeneration + 1;
  }

  /** True when SDK queue, audio, and held lipsync tail are all finished for this turn. */
  private isCoachLipsyncTailComplete(conn: CoachConnection): boolean {
    const queue = conn.client?.blendshapeQueue;
    if (shouldPlayLipsyncFrames(queue)) return false;
    if (typeof queue?.isBotSpeaking === 'function' && queue.isBotSpeaking()) return false;
    if (conn.isSpeaking) return false;
    if (this.audio.isAdvancing(conn) || this.audio.isPlaying(conn)) return false;
    if (this.hasFreshLipsyncRenderer(conn) && conn.lipsyncActive) return false;
    if (isLipsyncPlayerActive(conn.lipsyncPlayer, queue)) return false;
    return true;
  }

  private pumpLipsyncTail(conn: CoachConnection): void {
    const queue = conn.client?.blendshapeQueue;
    if (!queue) return;
    // The Three.js adapter is the sole queue consumer while its render-loop
    // heartbeat is fresh. The legacy player resumes only after an actual
    // renderer disappearance/stall, preserving headless speech completion.
    if (this.hasFreshLipsyncRenderer(conn)) return;

    const audioQuiet = !this.audio.isAdvancing(conn) && !this.audio.isPlaying(conn);
    const tailTimeLeftMs = queue.getTimeLeftMs?.();
    const sdkTailElapsed = typeof tailTimeLeftMs === 'number' && tailTimeLeftMs <= 0;

    if (conn.turnEnded && audioQuiet && sdkTailElapsed) {
      if (shouldPlayLipsyncFrames(queue) || isLipsyncPlayerActive(conn.lipsyncPlayer, queue)) {
        drainLipsyncQueueRemaining(conn.lipsyncPlayer, queue);
        conn.lipsyncActive = false;
        if (this.speakingCoachId === conn.coach.id) this.speakingCoachId = '';
      }
      return;
    }

    const wasUtteranceActive = conn.lipsyncPlayer.wasConversationActive;
    const frame = advanceLipsyncFrame(conn.lipsyncPlayer, queue, performance.now());
    if (frame) {
      if (!wasUtteranceActive && conn.lipsyncPlayer.wasConversationActive) {
        this.markLipsyncUtteranceStart(conn);
      }
      this.sampleLipsyncAudioLead(conn);
      conn.lipsyncActive = true;
      this.speakingCoachId = conn.coach.id;
    } else if (this.isCoachLipsyncTailComplete(conn)) {
      this.finishLipsyncIfEnded(conn);
    }
  }

  private async waitForSilentTurnQuiet(conn: CoachConnection, maxMs: number): Promise<void> {
    let sdkQuietMs = 0;
    const start = Date.now();
    while (sdkQuietMs < SILENT_TURN_SDK_QUIET_MS && Date.now() - start < maxMs) {
      if (conn.llmNoResponse || conn.responseSuppressed) return;
      const active = conn.isSpeaking
        || Boolean(conn.client?.blendshapeQueue?.isBotSpeaking?.())
        || this.audio.isAdvancing(conn);
      if (!active) sdkQuietMs += 50;
      else sdkQuietMs = 0;
      await this.sleep(50);
    }
  }

  private markSpeechEnded(conn: CoachConnection, coachName: string, reason: string): void {
    const endedAt = Date.now();
    conn.lastSpeechEndedAt = endedAt;
    this.lastSpeechEndedAt = endedAt;
    conn.isThinking = false;
    this.emitStatus();
    debugLog('Convai', `[${coachName}] Speech finished (${reason})`);
  }

  async waitUntilSpeechFinished(coach: CoachConfig, maxWaitMs = 15000, options: SpeechWaitOptions = {}): Promise<void> {
    const conn = this.pool.get(coach.id);
    if (!conn) return;

    const turnStartAt = options.turnStartAt ?? 0;

    if (conn.llmNoResponse || conn.responseSuppressed) {
      debugLog(
        'Convai',
        `[${coach.name}] Speech wait skipped (${conn.llmNoResponse ? 'llm-no-response' : 'suppressed'})`,
      );
      return;
    }

    const initialText = this.getTurnResponseText(conn, turnStartAt || undefined);
    if (!initialText.trim() && !this.isCoachSpeechSignalActive(conn, turnStartAt || undefined)) {
      await this.waitForSilentTurnQuiet(conn, Math.min(maxWaitMs, 500));
      debugLog('Convai', `[${coach.name}] Speech wait skipped (silent turn)`);
      return;
    }


    const waitGeneration = this.speechWaitGeneration;
    const start = Date.now();
    let sawSpeechActivity = this.isCoachSpeechSignalActive(conn, turnStartAt || undefined);
    let signalQuietSince: number | null = null;
    let audioQuietSince: number | null = null;
    let lastText = initialText;
    let textStableSince = start;
    let playbackCompleteSince: number | null = null;
    let lastPollLogAt = 0;

    while (Date.now() - start < maxWaitMs) {
      if (this.speechWaitGeneration !== waitGeneration) {
        debugLog('Convai', `[${coach.name}] Speech wait aborted (interrupted)`);
        return;
      }

      if (conn.llmNoResponse || conn.responseSuppressed) {
        debugLog('Convai', `[${coach.name}] Speech wait aborted (no response)`);
        return;
      }

      const text = this.getTurnResponseText(conn, turnStartAt || undefined);
      this.pumpLipsyncTail(conn);
      const speechSignalActive = this.isCoachSpeechSignalActive(conn, turnStartAt || undefined);
      const audioAdvancing = this.audio.isAdvancing(conn);
      const audioStuck = this.audio.isPlaying(conn) && !audioAdvancing;

      // Time since the lipsync player consumed a FRESH frame (0 = none yet
      // this session). Frames are generated 1:1 from the TTS audio, so a long
      // post-turnEnd drought means playback is genuinely over even when the
      // queue still holds unplayable leftover frames.
      const lastFreshFrameAt = conn.lipsyncPlayer.lastFreshFrameAtMs;
      const framesDroughtMs = lastFreshFrameAt > 0 ? performance.now() - lastFreshFrameAt : 0;

      const now = Date.now();
      if (speechSignalActive) sawSpeechActivity = true;

      signalQuietSince = updateQuietSince(
        signalQuietSince,
        !speechSignalActive,
        sawSpeechActivity,
        now,
      );
      audioQuietSince = updateQuietSince(
        audioQuietSince,
        !audioAdvancing,
        sawSpeechActivity,
        now,
      );

      if (text !== lastText) {
        textStableSince = now;
        lastText = text;
      }

      const signalQuietMs = elapsedSince(signalQuietSince, now);
      const audioQuietMs = elapsedSince(audioQuietSince, now);
      const textStableMs = Math.max(0, now - textStableSince);
      const textSettled = textStableMs >= 300;
      const signalQuiet = signalQuietMs >= 250;
      const audioQuiet = audioQuietMs >= 350;
      const playbackComplete = this.isCoachSpeechPlaybackComplete(conn);
      playbackCompleteSince = updateQuietSince(
        playbackCompleteSince,
        playbackComplete,
        true,
        now,
      );
      const playbackCompleteMs = elapsedSince(playbackCompleteSince, now);
      const sdkSpeechStoppedMs = conn.lastSpeechEndedAt > 0
        ? Math.max(0, now - conn.lastSpeechEndedAt)
        : 0;
      const audioStillPlaying = this.audio.isPlaying(conn);
      const lipsyncTailComplete = this.isCoachLipsyncTailComplete(conn);
      const sdkQuiet = !speechSignalActive;
      const tailTimeLeftMs = conn.client?.blendshapeQueue?.getTimeLeftMs?.();
      const sdkTailDone = typeof tailTimeLeftMs === 'number' ? tailTimeLeftMs <= 0 : playbackComplete;

      if (now - lastPollLogAt >= 500) {
        lastPollLogAt = now;
        debugLog(
          'Convai',
          `[${coach.name}] speech-wait poll: isSpeaking=${conn.isSpeaking} audioAdv=${audioAdvancing} audioStuck=${audioStuck} lipsync=${conn.lipsyncActive} lipsyncTailComplete=${lipsyncTailComplete} sawActivity=${sawSpeechActivity} signalQuietMs=${signalQuietMs} audioQuietMs=${audioQuietMs} textStableMs=${textStableMs} playbackComplete=${playbackComplete} framesDroughtMs=${Math.round(framesDroughtMs)} turnEnded=${conn.turnEnded} elapsed=${now - start}`,
        );
      }

      if (
        text.trim() &&
        textSettled &&
        sawSpeechActivity &&
        sdkQuiet &&
        signalQuiet &&
        audioQuiet &&
        !audioStillPlaying &&
        lipsyncTailComplete
      ) {
        this.markSpeechEnded(conn, coach.name, `speech complete (sdkQuiet ${signalQuietMs}ms, audioQuiet ${audioQuietMs}ms, lipsync tail complete)`);
        return;
      }

      if (
        text.trim() &&
        textSettled &&
        sawSpeechActivity &&
        playbackComplete &&
        lipsyncTailComplete &&
        signalQuiet &&
        audioQuiet &&
        !this.audio.isAdvancing(conn)
      ) {
        this.markSpeechEnded(conn, coach.name, `speech complete (playbackComplete, lipsync tail drained)`);
        return;
      }

      if (
        text.trim() &&
        textSettled &&
        sawSpeechActivity &&
        conn.turnEnded &&
        lipsyncTailComplete &&
        (playbackComplete || sdkTailDone) &&
        audioQuiet &&
        signalQuiet &&
        !this.audio.isAdvancing(conn) &&
        !audioStillPlaying
      ) {
        this.markSpeechEnded(conn, coach.name, `speech complete (turnEnd tail drained)`);
        return;
      }

      if (text.trim() && textSettled && !sawSpeechActivity && playbackComplete && lipsyncTailComplete) {
        this.markSpeechEnded(conn, coach.name, `TTS estimate complete, no activity detected (${this.speechElapsedMs(conn)}ms)`);
        return;
      }

      // Convai can leave its audio element alive after stateChange(false) and
      // turnEnd, then micro-advance through trailing silence every few seconds.
      // That makes both audio.isPlaying and the generic speech signal stay true
      // forever even though the rendered mouth has fully faded. The explicit
      // SDK stop edge + current turnEnd + inactive facial adapter is stronger
      // evidence than that stale HTMLAudioElement. Settle briefly so the final
      // visible mouth frame closes, then unblock the chess move.
      if (
        text.trim()
        && textSettled
        && sawSpeechActivity
        && conn.turnEnded
        && !conn.isSpeaking
        && !conn.lipsyncActive
        && sdkSpeechStoppedMs >= SDK_SPEECH_STOP_SETTLE_MS
      ) {
        this.markSpeechEnded(
          conn,
          coach.name,
          `speech complete (SDK stopped ${sdkSpeechStoppedMs}ms, rendered mouth inactive)`,
        );
        return;
      }

      // Convai leaves its <audio> element live after the utterance, micro-advancing
      // through trailing silence. currentTime can't distinguish that silence from
      // speech, so isPlaying()/isAdvancing() stay pinned true and poison every guard
      // above — lipsyncTailComplete, signalQuiet and audioStillPlaying never settle,
      // burning the full timeout before the coach moves. The blendshape queue draining
      // is the authoritative "coach finished talking" signal (frames are generated 1:1
      // from the TTS audio), so once it has held complete for a sustained window and
      // the SDK is no longer signalling bot speech, the tail is genuinely done. The
      // hold guards against a brief mid-utterance queue underrun flipping it early.
      const sdkStillSpeaking =
        conn.isSpeaking || Boolean(conn.client?.blendshapeQueue?.isBotSpeaking?.());
      if (
        text.trim() &&
        textSettled &&
        sawSpeechActivity &&
        playbackComplete &&
        playbackCompleteMs >= 500 &&
        !sdkStillSpeaking
      ) {
        this.markSpeechEnded(
          conn,
          coach.name,
          `speech complete (playback drained ${playbackCompleteMs}ms, audio element stuck)`,
        );
        return;
      }

      // Stuck-tail bailout: when the queue's audio end-signal never arrives,
      // shouldPlayLipsyncFrames() goes false with frames still queued — those
      // leftovers are never consumed, so getTimeLeftMs() stays > 0 and
      // playbackComplete is pinned FALSE forever, blocking every guard above
      // (and pumpLipsyncTail's drain, which requires timeLeft <= 0) until the
      // full budget burns. The coach then visibly "waits" to move long after
      // she finished talking. Once the turn has ended, the SDK is quiet and no
      // fresh frame has been consumed for a sustained window, the leftovers
      // are unplayable — drop them and finish the wait.
      if (
        text.trim() &&
        textSettled &&
        sawSpeechActivity &&
        conn.turnEnded &&
        !sdkStillSpeaking &&
        !this.hasFreshLipsyncRenderer(conn) &&
        framesDroughtMs >= 1500
      ) {
        const queue = conn.client?.blendshapeQueue;
        if (queue && !this.hasFreshLipsyncRenderer(conn)) {
          drainLipsyncQueueRemaining(conn.lipsyncPlayer, queue);
        }
        conn.lipsyncActive = false;
        if (this.speakingCoachId === conn.coach.id) this.speakingCoachId = '';
        this.markSpeechEnded(
          conn,
          coach.name,
          `speech complete (turn ended, ${Math.round(framesDroughtMs)}ms frame drought — leftover tail frames drained)`,
        );
        return;
      }

      await this.sleep(50);
    }

    const endedAt = Date.now();
    conn.lastSpeechEndedAt = endedAt;
    this.lastSpeechEndedAt = endedAt;
    debugLog('Convai', `[${coach.name}] waitUntilSpeechFinished timed out after ${maxWaitMs}ms`);
  }

  /**
   * Return the live SDK queue only for the currently selected coach. Queue
   * ownership is intentionally narrow: a portrait left mounted during a coach
   * switch cannot consume the new active character's facial stream.
   */
  getLipsyncQueue(coachId: CoachId): ConvaiBlendshapeQueue | null {
    if (coachId !== this.activeCoachId) return null;
    const conn = this.pool.get(coachId);
    return (conn?.client?.blendshapeQueue as ConvaiBlendshapeQueue | null | undefined) ?? null;
  }

  /**
   * Authorize disposal of a queue tail whose SDK bot-speaking and end signals
   * are both missing. Selection and the manager's authoritative turn boundary
   * are required; a live manager speaking signal vetoes stale-tail disposal.
   */
  canDrainMissingEndSignalLipsyncTail(coachId: CoachId): boolean {
    if (coachId !== this.activeCoachId) return false;
    const conn = this.pool.get(coachId);
    return Boolean(conn?.client && conn.turnEnded && !conn.isSpeaking);
  }

  /**
   * The SDK can retain its final facial frame/bot-speaking flag after its own
   * stateChange has already marked speech quiet. The SDK audio element can
   * keep advancing through trailing silence. Once stateChange marks audible
   * speech quiet, release any buffered facial-only tail after a short grace;
   * otherwise use fresh facial samples as the fallback completion clock.
   */
  canReleaseLipsyncHeldPose(coachId: CoachId): boolean {
    if (coachId !== this.activeCoachId) return false;
    const conn = this.pool.get(coachId);
    if (!conn?.client || conn.isSpeaking) return false;
    if (!conn.turnEnded && conn.lastSpeechEndedAt <= 0) return false;

    // Once the SDK's speaking state has crossed to quiet, that edge is the
    // authoritative end of audible speech. The queue can continue yielding
    // buffered/stale facial heads for many seconds afterward; treating each
    // one as newly spoken audio creates a circular wait (fresh frame postpones
    // release, release is required to drain the tail) and strands the chess
    // move until the full speech timeout. Keep the short grace for a transient
    // state edge, but do not let post-speech queue activity move the boundary.
    if (
      conn.lastSpeechEndedAt > 0
      && Math.max(0, Date.now() - conn.lastSpeechEndedAt) >= HELD_POSE_FRESH_FRAME_GRACE_MS
    ) {
      return true;
    }

    if (
      conn.lastTurnEndAt > 0
      && Math.max(0, Date.now() - conn.lastTurnEndAt) >= HELD_POSE_FRESH_FRAME_GRACE_MS
    ) {
      return true;
    }

    // Compatibility fallback for SDK variants that expose a boolean turn end
    // without a timestamp or omit stateChange(false).
    const lastFreshFrameAt = conn.lipsyncPlayer.lastFreshFrameAtMs;
    const facialFrameQuietMs = lastFreshFrameAt > 0
      ? Math.max(0, performance.now() - lastFreshFrameAt)
      : 0;
    return conn.turnEnded && facialFrameQuietMs >= HELD_POSE_FRESH_FRAME_GRACE_MS;
  }

  /** Monotonic reset signal for the render-loop adapter. */
  getLipsyncResetGeneration(coachId: CoachId): number {
    return this.pool.get(coachId)?.lipsyncResetGeneration ?? 0;
  }

  /**
   * Declare render-loop ownership and mirror its playback state into the
   * manager's speech/diagnostic state. Call once per rendered frame, including
   * frames where no new blendshape sample was available.
   */
  reportLipsyncRenderState(coachId: CoachId, state: LipsyncRenderState): void {
    if (coachId !== this.activeCoachId) return;
    const conn = this.pool.get(coachId);
    if (!conn?.client) return;

    const now = performance.now();
    const rendererAlreadyOwnedQueue = this.hasFreshLipsyncRenderer(conn, now);
    conn.lipsyncRendererHeartbeatAt = now;

    if (!rendererAlreadyOwnedQueue) {
      // Do not let a held frame from the compatibility player keep the face or
      // speech wait active after ownership moves to the supplied adapter.
      resetLipsyncPlayerState(conn.lipsyncPlayer);
    }

    const active = state.active || Boolean(state.fresh);
    if (state.fresh) {
      if (conn.lipsyncPlayer.lastFreshFrameAtMs <= 0) {
        this.markLipsyncUtteranceStart(conn);
      }
      conn.lipsyncPlayer.lastFreshFrameAtMs = now;
      this.sampleLipsyncAudioLead(conn);
    }

    conn.lipsyncActive = active;
    if (active) {
      this.speakingCoachId = coachId;
      return;
    }

    // An inactive adapter may simply be between chunks while the SDK/audio is
    // still live. Only release the speaking owner after every source is quiet.
    const queue = conn.client.blendshapeQueue as ConvaiBlendshapeQueue | undefined;
    const sdkSpeaking = conn.isSpeaking || Boolean(queue?.isBotSpeaking?.());
    const audioActive = this.audio.isAdvancing(conn) || this.audio.isPlaying(conn);
    if (!sdkSpeaking && !audioActive && this.speakingCoachId === coachId) {
      this.speakingCoachId = '';
    }
    this.finishLipsyncIfEnded(conn);
  }

  /**
   * Relinquish queue ownership when a portrait/model unmounts. The queue is
   * preserved so legacy headless playback can safely resume after this call.
   */
  releaseLipsyncRenderer(coachId: CoachId): void {
    const conn = this.pool.get(coachId);
    if (!conn) return;
    conn.lipsyncRendererHeartbeatAt = 0;
    conn.lipsyncActive = false;
    resetLipsyncPlayerState(conn.lipsyncPlayer);
    this.incrementLipsyncResetGeneration(conn);

    const queue = conn.client?.blendshapeQueue as ConvaiBlendshapeQueue | undefined;
    const stillSpeaking = conn.isSpeaking
      || Boolean(queue?.isBotSpeaking?.())
      || this.audio.isAdvancing(conn)
      || this.audio.isPlaying(conn);
    if (!stillSpeaking && this.speakingCoachId === coachId) this.speakingCoachId = '';
  }

  consumeLipsyncNormalize(coachId: CoachId): boolean {
    const conn = this.pool.get(coachId);
    const queue = conn?.client?.blendshapeQueue;
    // A fresh renderer consumes normalization inside updateFromConvaiQueue;
    // compatibility code must not race it for this one-shot signal.
    if (conn && this.hasFreshLipsyncRenderer(conn)) return false;
    if (!queue?.consumeNormalizationSignal) return false;
    if (!queue.consumeNormalizationSignal()) return false;
    // The signal means "this utterance is over — face to neutral", but the
    // queue can still hold unplayable leftover frames (audio stalled at the
    // tail). Resetting the player WITHOUT draining them made
    // advanceLipsyncFrame restart consumption (endSignal && hasFrames →
    // shouldPlay) — the mouth re-opened ~0.3s after settling, replayed the
    // dead tail, then closed again. Drain the leftovers first — but only when
    // the bot is NOT speaking and the end signal is set, so a genuinely new
    // utterance's frames can never be eaten.
    const botSpeaking = typeof queue.isBotSpeaking === 'function' ? queue.isBotSpeaking() : false;
    const staleTail = !botSpeaking
      && Boolean(queue.hasReceivedEndSignal?.())
      && Boolean(queue.hasFrames?.());
    if (staleTail) {
      drainLipsyncQueueRemaining(conn!.lipsyncPlayer, queue);
      conn!.lipsyncActive = false;
      if (this.speakingCoachId === conn!.coach.id) this.speakingCoachId = '';
    }
    resetLipsyncPlayerState(conn!.lipsyncPlayer);
    conn!.lipsyncConversationEndResetSent = true;
    this.incrementLipsyncResetGeneration(conn!);
    debugLog(
      'Convai',
      `[${conn!.coach.name}] Lipsync normalization signal — ease to neutral${staleTail ? ' (stale tail frames drained)' : ''}`,
    );
    return true;
  }

  /** Playback fps the SDK queue reports from stream metadata (0 when unknown). */
  getLipsyncPlaybackFps(coachId: CoachId): number {
    const queue = this.pool.get(coachId)?.client?.blendshapeQueue;
    const fps = queue?.getPlaybackFps?.();
    return Number.isFinite(fps) && fps > 0 ? fps : 0;
  }

  getLipsyncFrame(coachId: CoachId): Float32Array | null {
    const conn = this.pool.get(coachId);
    if (!conn?.client) return null;
    if (this.hasFreshLipsyncRenderer(conn)) return null;
    if (this.speakingCoachId && this.speakingCoachId !== coachId) return null;

    const queue = conn.client.blendshapeQueue;
    if (!queue) return null;

    const botSpeaking = typeof queue.isBotSpeaking === 'function' ? queue.isBotSpeaking() : false;
    const playing = shouldPlayLipsyncFrames(queue) || botSpeaking || conn.isSpeaking;
    if (!playing && !isLipsyncPlayerActive(conn.lipsyncPlayer, queue)) {
      // Player fully idle — release the sticky lipsyncActive flag so the
      // portrait can decay to neutral between utterances (thinking pauses),
      // not only when the whole conversation turn is flagged ended.
      if (conn.lipsyncActive) {
        conn.lipsyncActive = false;
        if (this.speakingCoachId === conn.coach.id) this.speakingCoachId = '';
      }
      return null;
    }

    const wasUtteranceActive = conn.lipsyncPlayer.wasConversationActive;
    const frame = advanceLipsyncFrame(conn.lipsyncPlayer, queue, performance.now());
    if (frame) {
      if (!wasUtteranceActive && conn.lipsyncPlayer.wasConversationActive) {
        this.markLipsyncUtteranceStart(conn);
      }
      this.sampleLipsyncAudioLead(conn);
      conn.lipsyncActive = true;
      this.speakingCoachId = conn.coach.id;
      if (
        !playing
        && !this.audio.isAdvancing(conn)
        && !this.audio.isPlaying(conn)
        && this.isCoachLipsyncTailComplete(conn)
      ) {
        this.finishLipsyncIfEnded(conn);
        return null;
      }
      return frame;
    }

    if (this.isCoachLipsyncTailComplete(conn)) {
      this.finishLipsyncIfEnded(conn);
    }
    return null;
  }

  /**
   * Diagnostics: measure how far lipsync frame playback leads the audible
   * voice at each utterance start. Frames are consumed on a wall clock from
   * the moment the SDK flags speech; the <audio> element starts with its own
   * buffering latency. A consistently large lead here is the mouth moving
   * before the voice. (isAdvancing itself needs two samples ~40ms apart, so
   * real leads are ~40-70ms smaller than logged.) Runs in production too —
   * the deployed app's Copy-Logs ring buffer records it, so "lipsync feels
   * off" reports from chess.convai.com come with the sync number attached.
   */
  private lipsyncLeadProbe = new WeakMap<CoachConnection, number>();

  private markLipsyncUtteranceStart(conn: CoachConnection): void {
    this.lipsyncLeadProbe.set(conn, performance.now());
  }

  private sampleLipsyncAudioLead(conn: CoachConnection): void {
    const t0 = this.lipsyncLeadProbe.get(conn);
    if (t0 === undefined) return;
    if (!this.audio.isAdvancing(conn)) return;
    this.lipsyncLeadProbe.delete(conn);
    debugLog(
      'Lipsync',
      `[${conn.coach.name}] utterance start: audio began ${Math.round(performance.now() - t0)}ms after first lipsync frame`,
    );
  }

  /** True while lipsync or TTS tail should keep the portrait mouth driven (not decay). */
  isCoachLipsyncActive(coachId: CoachId): boolean {
    const conn = this.pool.get(coachId);
    if (!conn) return false;
    if (conn.lipsyncActive || conn.isSpeaking) return true;
    const queue = conn.client?.blendshapeQueue;
    if (queue && shouldPlayLipsyncFrames(queue)) return true;
    if (isLipsyncPlayerActive(conn.lipsyncPlayer, queue)) return true;
    if (typeof queue?.isBotSpeaking === 'function' && queue.isBotSpeaking()) return true;
    if (this.audio.isAdvancing(conn)) return true;
    return this.audio.isPlaying(conn);
  }

  getMicEnabled(): boolean {
    return this.micEnabled;
  }

  getVoiceMuted(): boolean {
    return this.voiceMuted;
  }

  /**
   * Mute/unmute the coach's VOICE (the incoming TTS audio), independent of the
   * microphone. Muting the <audio> elements rather than pausing them keeps the
   * stream advancing, so lipsync, speech-completion detection and turn pacing
   * all behave exactly as they do unmuted — the character still talks, you
   * just don't hear her. New elements created for later turns pick the flag up
   * via applyVoiceMute() on each connect.
   */
  setVoiceMuted(muted: boolean): void {
    this.voiceMuted = muted;
    try {
      window.localStorage.setItem(VOICE_MUTED_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable (private mode) — in-memory mute still applies.
    }
    this.applyVoiceMute();
    debugLog('Convai', `[Voice] ${muted ? 'Muted' : 'Unmuted'} coach audio`);
    this.emitStatus();
  }

  /** Push the current mute flag onto every coach <audio> element. */
  private applyVoiceMute(): void {
    this.ensureVoiceMuteGuard();
    const elements = new Set<HTMLAudioElement>();
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio').forEach((element) => elements.add(element));
    }
    for (const conn of this.pool.values()) {
      for (const el of this.audio.getElements(conn)) {
        elements.add(el);
      }
    }
    elements.forEach((element) => applyVoiceMuteToElement(element, this.voiceMuted));
  }

  /**
   * AudioRenderer may attach a media element asynchronously or replace it on a
   * later room track. Observe both DOM insertion and media lifecycle/property
   * events so those elements cannot escape a mute chosen earlier.
   */
  private ensureVoiceMuteGuard(): void {
    if (
      this.voiceMuteObserver
      || typeof document === 'undefined'
      || typeof MutationObserver === 'undefined'
      || typeof HTMLAudioElement === 'undefined'
    ) return;

    const applyNode = (node: Node) => {
      if (node instanceof HTMLAudioElement) {
        applyVoiceMuteToElement(node, this.voiceMuted);
        return;
      }
      if (!(node instanceof Element)) return;
      node.querySelectorAll('audio').forEach((element) => {
        applyVoiceMuteToElement(element, this.voiceMuted);
      });
    };

    this.voiceMuteObserver = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(applyNode);
    });
    this.voiceMuteObserver.observe(document.documentElement, { childList: true, subtree: true });

    this.voiceMuteLifecycleHandler = (event: Event) => {
      if (event.target instanceof HTMLAudioElement) {
        applyVoiceMuteToElement(event.target, this.voiceMuted);
      }
    };
    for (const eventName of ['play', 'playing', 'loadedmetadata', 'canplay', 'volumechange']) {
      document.addEventListener(eventName, this.voiceMuteLifecycleHandler, true);
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
    const conn = this.pool.get(this.activeCoachId);
    if (!conn?.client) { this.emitStatus(); return; }
    try {
      if (enabled) {
        debugLog('Convai', `[Mic] Enabling microphone`);
        await conn.client.audioControls?.enableAudio?.();
      } else {
        debugLog('Convai', `[Mic] Disabling microphone`);
        await conn.client.audioControls?.disableAudio?.();
        this.emitTranscript('');
      }
    } catch (err) {
      debugLog('Convai', `[Mic] Toggle failed:`, err);
    }
    this.emitStatus();
  }

  /** Subscribe to live user speech transcription ('' when cleared). */
  onUserTranscript(listener: (text: string) => void): () => void {
    this.transcriptListeners.add(listener);
    listener(this.userTranscript);
    return () => this.transcriptListeners.delete(listener);
  }

  getUserTranscript(): string {
    return this.userTranscript;
  }

  private emitTranscript(text: string): void {
    if (text === this.userTranscript) return;
    this.userTranscript = text;
    for (const listener of this.transcriptListeners) listener(text);
  }

  private handleUserTranscription(conn: CoachConnection, rawText: string): void {
    const text = (rawText ?? '').trim();
    // Ignore echoes of text we sent programmatically (chat box / hints) — only genuine
    // live mic speech should drive the transcript + preemption.
    if (/^the student asks:/i.test(text)) return;
    // The user starting to speak preempts any in-flight orchestrated turn: bump the speech
    // generation so its wait/retry logic aborts instead of replaying over the user.
    if (text && !this.userTranscript) {
      this.speechWaitGeneration++;
      this.lastSpeechEndedAt = Date.now();
      debugLog('Convai', `[${conn.coach.name}] User started speaking (mic) — preempting`);
    }
    this.emitTranscript(text);
  }

  getIsSpeaking(coachId?: CoachId): boolean {
    if (coachId) return Boolean(this.pool.get(coachId)?.isSpeaking);
    for (const conn of this.pool.values()) if (conn.isSpeaking) return true;
    return false;
  }

  getStatus() {
    const active = this.pool.get(this.activeCoachId);
    const coaches: Record<string, { connected: boolean; botReady: boolean; connecting: boolean; speaking: boolean; thinking: boolean }> = {};
    for (const [id, conn] of this.pool) {
      coaches[id] = {
        connected: conn.connected,
        botReady: conn.botReady,
        connecting: conn.connecting,
        speaking: conn.isSpeaking,
        thinking: conn.isThinking,
      };
    }
    return {
      activeCoachId: this.activeCoachId,
      connected: Boolean(active?.connected),
      botReady: Boolean(active?.botReady),
      connecting: Boolean(active?.connecting),
      speaking: Boolean(active?.isSpeaking),
      thinking: Boolean(active?.isThinking),
      convaiTurnInFlight: this.convaiTurnInFlight,
      micEnabled: this.micEnabled,
      voiceMuted: this.voiceMuted,
      coaches,
    };
  }

  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.add(listener);
    return () => this.responseListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  private async pushDynamicContext(coach: CoachConfig, dynamicInfo: string, runLlm: RunLlmMode): Promise<void> {
    const conn = this.pool.get(coach.id);
    if (!conn?.client || !conn.connected || !dynamicInfo.trim()) return;
    this.refreshBoardVision(coach);
    try {
      conn.client.updateContext({ text: dynamicInfo, mode: 'replace', run_llm: runLlm });
    } catch (err) {
      debugLog('Convai', `[${coach.name}] Dynamic context updateContext failed:`, err);
      return;
    }
    debugLog('Convai', `[${coach.name}] Dynamic context len=${dynamicInfo.length} run_llm=${runLlm}`);
  }

  private async sendContextTurn(
    coach: CoachConfig,
    dynamicInfo: string,
    runLlm: RunLlmMode,
    maxWaitMs?: number,
    requireFullSpeech = false,
  ): Promise<string> {
    const conn = this.pool.get(coach.id);
    if (!conn?.client || !conn.connected) return '';

    await this.waitForReady(conn, 2000);
    const readyConn = this.pool.get(coach.id);
    if (!readyConn?.client || !readyConn.connected) return '';

    this.resetResponseState(readyConn);
    this.activeCoachId = coach.id;
    this.armLipsyncConversation(readyConn);
    try { readyConn.client.blendshapeQueue?.startConversation?.(); } catch {}

    const turnStartAt = Date.now();
    const sessionId = readyConn.client.conversationSessionId ?? 'unknown';
    const contextAckAtStart = readyConn.contextAckSequence;
    debugLog('Convai', `[${coach.name}] Context turn session=${sessionId} run_llm=${runLlm}`);
    await this.pushDynamicContext(coach, dynamicInfo, runLlm);

    // The SDK publishes context updates asynchronously. Convai emits a
    // serverResponse acknowledgement for every client message, so do not burn
    // the full dead-turn budget when the responsive update never reaches the
    // server. Any actual response activity is equally strong evidence that the
    // turn arrived and lets us continue without waiting for a late ack.
    if (runLlm === 'true') {
      const acknowledgedOrActive = await this.waitForContextAckOrActivity(
        readyConn,
        contextAckAtStart,
        2200,
      );
      if (!acknowledgedOrActive) {
        debugLog('Convai', `[${coach.name}] Context turn unacknowledged; recovering early`);
        return '';
      }
      if (
        readyConn.contextAckSequence > contextAckAtStart
        && (
          readyConn.lastContextAckStatus === 'error'
          || readyConn.lastContextAckTriggered === false
        )
        && !this.hasContextTurnActivity(readyConn)
      ) {
        debugLog(
          'Convai',
          `[${coach.name}] Context turn was not triggered by server; recovering early`,
        );
        return '';
      }
    }

    const turnBudgetMs = maxWaitMs ?? (requireFullSpeech ? 15000 : 8000);
    const turnStart = Date.now();
    const remainingBudget = () => Math.max(0, turnBudgetMs - (Date.now() - turnStart));
    const isAutoContextTurn = runLlm === 'auto';
    const textReserveMs = isAutoContextTurn ? MIN_SPEECH_RESERVE_AUTO_MS : 2000;
    const textBudgetMs = requireFullSpeech
      ? Math.max(4000, remainingBudget() - textReserveMs)
      : remainingBudget();

    // Dead-turn cap (see sendAndAwaitSpeech): a context turn with zero server
    // activity after the initial phases gives up in ~12s total instead of
    // holding the welcome/loading flow for the full budget. Turns showing any
    // life keep the whole budget, so slow-but-real replies are unaffected.
    const response = await this.waitForResponseCompletion(readyConn, isAutoContextTurn, textBudgetMs, requireFullSpeech, requireFullSpeech ? 6000 : undefined);
    if (requireFullSpeech && response.trim()) {
      const finalText = readyConn.longestResponseText.trim() || this.getBestResponseText(readyConn) || response;
      const speechBudget = this.computeSpeechWaitBudget(readyConn, finalText);
      await this.waitUntilSpeechFinished(coach, speechBudget, { turnStartAt });
    }
    return response;
  }

  private async sendAndAwaitSpeech(coach: CoachConfig, message: string, dynamicInfo: string): Promise<string> {
    const conn = this.pool.get(coach.id);
    if (!conn?.client || !conn.connected) return '';

    await this.waitForReady(conn, 2000);
    if (!conn.botReady && this.isReadyStale(conn)) {
      debugLog('Convai', `[${coach.name}] BOT READY still pending on stale session; reconnecting`);
      await this.disconnectOne(conn);
      await this.connectCoach(coach, {
        waitForBotReady: true,
        readyWaitMs: 3500,
        ...this.reconnectOptionsFor(conn),
      });
    }

    const readyConn = this.pool.get(coach.id);
    if (!readyConn?.client || !readyConn.connected) return '';

    this.resetResponseState(readyConn);
    this.activeCoachId = coach.id;

    if (!message.trim()) {
      return this.sendContextTurn(coach, dynamicInfo, 'auto');
    }

    if (dynamicInfo.trim()) {
      this.logDynamicContextFen(coach.name, dynamicInfo);
      await this.pushDynamicContext(coach, dynamicInfo, 'false');
    }

    // If a wire interrupt just went out (user preempted actual speech), let
    // it settle server-side before the new message so the interrupt cannot
    // be applied against the turn we are about to start.
    const sinceInterrupt = Date.now() - this.lastWireInterruptAt;
    if (sinceInterrupt < 400) {
      await this.sleep(400 - sinceInterrupt);
    }

    const turnStartAt = Date.now();
    const sessionId = readyConn.client.conversationSessionId ?? 'unknown';
    debugLog('Convai', `[${coach.name}] User turn session=${sessionId}: "${message.slice(0, 100)}"`);
    this.armLipsyncConversation(readyConn);
    try { readyConn.client.blendshapeQueue?.startConversation?.(); } catch {}
    readyConn.client.sendUserTextMessage(message);

    const turnBudgetMs = 20000;
    const turnStart = Date.now();
    const remainingBudget = () => Math.max(0, turnBudgetMs - (Date.now() - turnStart));
    // Dead-turn cap: a user chat that produces no server activity at all
    // resolves in ~12s instead of burning the full 20s before the
    // reconnect-and-resend recovery kicks in.
    const response = await this.waitForResponseCompletion(readyConn, false, remainingBudget(), true, 6000);
    const finalText = readyConn.longestResponseText.trim() || this.getBestResponseText(readyConn) || response;
    const speechBudget = finalText.trim() ? this.computeSpeechWaitBudget(readyConn, finalText) : 0;
    if (finalText.trim() && speechBudget > 0) {
      await this.waitUntilSpeechFinished(coach, speechBudget, { turnStartAt });
    }
    const best = readyConn.longestResponseText.trim() || this.getBestResponseText(readyConn) || response;
    debugLog('Convai', `[${coach.name}] Speech done. Response: "${best.slice(0, 100)}"`);
    return best;
  }

  private resetResponseState(conn: CoachConnection): void {
    conn.lastEmittedText = '';
    conn.streamBuffer = '';
    conn.longestResponseText = '';
    conn.streamResponseId = '';
    conn.responseSuppressed = false;
    conn.llmNoResponse = false;
    conn.turnEnded = false;
    conn.lastTurnEndAt = 0;
    conn.lastFinalTextAt = 0;
  }

  private async waitForFinalText(
    conn: CoachConnection,
    maxWaitMs: number,
    stableMs = 400,
    requireTurnEnd = false,
  ): Promise<void> {
    if (maxWaitMs <= 0) return;
    const start = Date.now();
    let stableFor = 0;
    let lastText = this.getBestResponseText(conn);
    while (Date.now() - start < maxWaitMs) {
      if (conn.llmNoResponse || conn.responseSuppressed) return;
      this.captureLatestText(conn);
      const current = this.getBestResponseText(conn);
      if (current === lastText) {
        stableFor += 50;
      } else {
        stableFor = 0;
        lastText = current;
        if (current.trim()) {
          conn.lastFinalTextAt = Date.now();
        }
      }
      if (current.trim() && conn.turnEnded && stableFor >= 200) return;
      if (current.trim() && stableFor >= stableMs && !requireTurnEnd) return;
      await this.sleep(50);
    }
  }

  private async waitForResponseCompletion(
    conn: CoachConnection,
    isAutoContextTurn = false,
    maxWaitMs?: number,
    requireFullSpeech = false,
    deadTurnCapMs?: number,
  ): Promise<string> {
    const budgetMs = maxWaitMs ?? 30000;
    const deadline = Date.now() + budgetMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    const pastDeadline = () => Date.now() >= deadline;

    let everSpoke = false;
    const initialCap = Math.min(isAutoContextTurn ? 2500 : 4000, budgetMs);
    const initialStart = Date.now();
    while (Date.now() - initialStart < initialCap) {
      if (pastDeadline()) break;
      await this.sleep(100);
      if (conn.llmNoResponse) return '';
      if (conn.responseSuppressed) return '';
      if (conn.turnEnded) break;
      if (conn.isSpeaking) {
        everSpoke = true;
        break;
      }
      this.captureLatestText(conn);
      if (conn.lastEmittedText && !requireFullSpeech) break;
      if (requireFullSpeech && conn.longestResponseText.trim() && conn.turnEnded) break;
    }

    if (!everSpoke && !conn.lastEmittedText && !conn.turnEnded && remaining() > 0) {
      await this.waitForTurnEndOrFirstText(conn, Math.min(isAutoContextTurn ? 1500 : 2000, remaining()));
      if (conn.llmNoResponse) return '';
      if (conn.responseSuppressed) return '';
      if (conn.isSpeaking) everSpoke = true;
    }

    // Only treat "no text yet" as a silent abstain on fast turns. When the caller must wait
    // for the full spoken line (coach moves: auto + requireFullSpeech), an empty buffer at
    // this point usually means the LLM response is still in flight — the transcript and TTS
    // routinely arrive ~7-8s after the context push. Abstaining here is exactly what made the
    // coach move before her line started. Genuine silence is signalled by llmNoResponse /
    // responseSuppressed, which waitForFinalText below honours as an immediate exit.
    if (
      isAutoContextTurn &&
      !requireFullSpeech &&
      !conn.lastEmittedText &&
      !conn.streamBuffer &&
      !conn.longestResponseText &&
      !conn.isSpeaking
    ) {
      debugLog('Convai', `[${conn.coach.name}] Auto-context turn yielded no text; treating as silent abstain`);
      return '';
    }

    if (requireFullSpeech) {
      // If the turn has shown ZERO signs of life through the initial phases
      // (~6s: no speech, no text, no turn end), it is almost certainly a dead
      // turn — the empty-LLM-response failure. Waiting out the full budget
      // just delays the reconnect-and-resend recovery; cap the remaining wait
      // instead. Any activity at all keeps the full budget.
      const noLifeYet = !everSpoke
        && !conn.isSpeaking
        && !conn.turnEnded
        && !conn.lastEmittedText
        && !conn.streamBuffer
        && !conn.longestResponseText;
      const finalTextBudget = noLifeYet && deadTurnCapMs !== undefined
        ? Math.min(remaining(), deadTurnCapMs)
        : remaining();
      await this.waitForFinalText(conn, finalTextBudget, 400, true);
    } else if ((conn.isSpeaking || everSpoke || conn.lastEmittedText) && remaining() > 0) {
      let silentMs = 0;
      const speakingCap = Math.min(isAutoContextTurn ? 8000 : 20000, remaining());
      const speakingStart = Date.now();
      while (Date.now() - speakingStart < speakingCap) {
        if (pastDeadline()) break;
        await this.sleep(100);
        if (conn.llmNoResponse) return '';
        if (conn.responseSuppressed) return '';

        if (
          isAutoContextTurn &&
          !conn.isSpeaking &&
          !conn.lastEmittedText &&
          !conn.streamBuffer &&
          !conn.longestResponseText &&
          silentMs >= 500
        ) {
          debugLog('Convai', `[${conn.coach.name}] Auto-context turn flickered isSpeaking without text; exiting fast`);
          return '';
        }

        if (!conn.isSpeaking) {
          silentMs += 100;
          if (conn.turnEnded && silentMs >= 300) break;
          if (silentMs >= 1500) break;
        } else {
          silentMs = 0;
        }
      }
      if (remaining() > 0) {
        await this.waitForTurnEndOrStableText(
          conn,
          Math.min(isAutoContextTurn ? 1000 : 2000, remaining()),
          isAutoContextTurn ? 300 : 500,
        );
      }
    } else if (conn.lastEmittedText && remaining() > 0) {
      await this.waitForTurnEndOrStableText(
        conn,
        Math.min(isAutoContextTurn ? 1000 : 2000, remaining()),
        isAutoContextTurn ? 300 : 500,
      );
    }

    this.captureLatestText(conn);
    if ((everSpoke || conn.lastEmittedText) && !requireFullSpeech) {
      this.lastSpeechEndedAt = Date.now();
      await this.waitForGlobalSilence(
        `${conn.coach.name} post-speech`,
        80,
        Math.min(isAutoContextTurn ? 200 : 250, remaining()),
      );
    }
    return this.getBestResponseText(conn);
  }

  private async waitForTurnEndOrFirstText(conn: CoachConnection, maxWaitMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await this.sleep(100);
      if (conn.llmNoResponse) return;
      if (conn.responseSuppressed) return;
      this.captureLatestText(conn);
      if (conn.turnEnded || conn.isSpeaking || conn.lastEmittedText || conn.longestResponseText || conn.streamBuffer) return;
    }
  }

  private async waitForTurnEndOrStableText(conn: CoachConnection, maxWaitMs: number, stableMs: number): Promise<void> {
    const start = Date.now();
    let stableFor = 0;
    let lastText = conn.longestResponseText || conn.lastEmittedText || conn.streamBuffer;
    while (Date.now() - start < maxWaitMs) {
      await this.sleep(100);
      if (conn.llmNoResponse) return;
      if (conn.responseSuppressed) return;
      const current = conn.longestResponseText || conn.lastEmittedText || conn.streamBuffer;
      if (current === lastText) {
        stableFor += 100;
      } else {
        stableFor = 0;
        lastText = current;
      }
      if (conn.turnEnded && stableFor >= 200) return;
      if (stableFor >= stableMs) return;
    }
  }

  private captureLatestText(conn: CoachConnection): void {
    if (conn.responseSuppressed) return;
    if (this.streamDebounce) {
      clearTimeout(this.streamDebounce);
      this.streamDebounce = null;
    }
    if (!conn.streamBuffer) return;
    const text = conn.streamBuffer;
    conn.lastEmittedText = text;
    if (text.length > conn.longestResponseText.length) conn.longestResponseText = text;
    conn.streamBuffer = '';
    conn.lastFinalTextAt = Date.now();
    debugLog('Convai', `[${conn.coach.name}] FINAL: "${text.slice(0, 180)}"`);
  }

  private flushStream(conn: CoachConnection): void {
    if (conn.responseSuppressed) return;
    this.captureLatestText(conn);
    const text = this.getBestResponseText(conn);
    if (!text) return;
    this.emitResponse(conn, text, conn.streamResponseId);
  }

  private hasContextTurnActivity(conn: CoachConnection): boolean {
    return conn.isThinking
      || conn.isSpeaking
      || conn.turnEnded
      || Boolean(conn.lastEmittedText || conn.streamBuffer || conn.longestResponseText);
  }

  private async waitForContextAckOrActivity(
    conn: CoachConnection,
    ackSequenceAtStart: number,
    maxWaitMs: number,
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      if (conn.contextAckSequence > ackSequenceAtStart || this.hasContextTurnActivity(conn)) {
        return true;
      }
      await this.sleep(50);
    }
    return conn.contextAckSequence > ackSequenceAtStart || this.hasContextTurnActivity(conn);
  }

  private emitResponse(conn: CoachConnection, text: string, responseId = conn.streamResponseId): void {
    for (const listener of this.responseListeners) {
      listener({ coachId: conn.coach.id, characterName: conn.coach.name, text, responseId });
    }
  }

  private getBestResponseText(conn: CoachConnection): string {
    if (conn.responseSuppressed) return '';
    const latest = conn.lastEmittedText.trim();
    const longest = conn.longestResponseText.trim();
    if (!latest) return longest;
    if (!longest) return latest;
    if (longest.includes(latest)) return longest;
    if (latest.includes(longest)) return latest;
    return latest.length >= longest.length ? latest : longest;
  }

  private runExclusiveSpeech<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.speechQueue;
    let release!: () => void;
    this.speechQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    return (async () => {
      await previous.catch(() => {});
      try {
        return await task();
      } finally {
        release();
      }
    })();
  }

  private async waitForGlobalSilence(context: string, minQuietMs = 900, maxWaitMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const quietFor = this.lastSpeechEndedAt === 0 ? minQuietMs : Date.now() - this.lastSpeechEndedAt;
      if (!this.getIsSpeaking() && quietFor >= minQuietMs) return;
      await this.sleep(150);
    }
    debugLog('Convai', `[${context}] Silence gate timed out, continuing`);
  }

  private async waitForReady(conn: CoachConnection, maxWaitMs: number): Promise<void> {
    const start = Date.now();
    while (!conn.botReady && Date.now() - start < maxWaitMs) {
      await this.sleep(500);
    }
  }

  private isReadyStale(conn: CoachConnection): boolean {
    return conn.connected && !conn.botReady && conn.connectedAt > 0 && Date.now() - conn.connectedAt >= this.staleReadyMs;
  }

  private async ensureProfileMemory(conn: CoachConnection): Promise<void> {
    const name = typeof conn.endUserMetadata?.name === 'string' ? conn.endUserMetadata.name.trim() : '';
    const manager = conn.client?.memoryManager;
    if (!conn.ltmEnabled || !name || !manager?.addMemories) return;

    const memory = `The student's name is ${name}.`;
    const key = `${conn.coach.characterId}:${conn.endUserId}:${memory}`;
    if (conn.profileMemoryKey === key) return;

    try {
      const exists = await this.memoryExists(manager, memory);
      if (!exists) await manager.addMemories([memory]);
      conn.profileMemoryKey = key;
      debugLog('Convai', `[${conn.coach.name}] Profile memory ready for ${conn.endUserId}`);
    } catch (err) {
      debugLog('Convai', `[${conn.coach.name}] Profile memory skipped:`, err);
    }
  }

  private async memoryExists(manager: any, text: string): Promise<boolean> {
    if (typeof manager.listMemories !== 'function') return false;
    try {
      const result = await manager.listMemories({ limit: 100 });
      const items = Array.isArray(result)
        ? result
        : Array.isArray(result?.memories)
          ? result.memories
          : Array.isArray(result?.items)
            ? result.items
            : Array.isArray(result?.data)
              ? result.data
              : [];
      const needle = text.toLowerCase();
      return items.some((item: unknown) => {
        if (typeof item === 'string') return item.toLowerCase() === needle;
        if (!item || typeof item !== 'object') return false;
        const value = String(
          (item as { text?: unknown; memory?: unknown; content?: unknown }).text ??
          (item as { text?: unknown; memory?: unknown; content?: unknown }).memory ??
          (item as { text?: unknown; memory?: unknown; content?: unknown }).content ??
          '',
        );
        return value.toLowerCase() === needle;
      });
    } catch {
      return false;
    }
  }

  private getSuppressedResponseWord(text: string): string | null {
    return text.match(SUPPRESSED_RESPONSE_PATTERN)?.[1]?.toLowerCase() ?? null;
  }

  private suppressResponse(conn: CoachConnection, word: string): void {
    if (conn.responseSuppressed) return;
    conn.responseSuppressed = true;
    conn.streamBuffer = '';
    conn.lastEmittedText = '';
    conn.longestResponseText = '';
    conn.streamResponseId = '';
    conn.turnEnded = true;
    conn.lastTurnEndAt = Date.now();
    if (this.streamDebounce) {
      clearTimeout(this.streamDebounce);
      this.streamDebounce = null;
    }
    try { conn.client?.sendInterruptMessage?.(); } catch {}
    this.resetLipsyncState(conn);
    this.lastSpeechEndedAt = Date.now();
    this.emitResponse(conn, '');
    this.emitStatus();
    debugLog('Convai', `[${conn.coach.name}] Suppressed bot response containing "${word}"; interrupted audio`);
  }

  private markLlmNoResponse(conn: CoachConnection): void {
    if (conn.llmNoResponse) return;
    conn.llmNoResponse = true;
    conn.streamBuffer = '';
    conn.lastEmittedText = '';
    conn.longestResponseText = '';
    conn.streamResponseId = '';
    conn.turnEnded = true;
    conn.lastTurnEndAt = Date.now();
    conn.isThinking = false;
    if (this.streamDebounce) {
      clearTimeout(this.streamDebounce);
      this.streamDebounce = null;
    }
    this.resetLipsyncState(conn);
    this.lastSpeechEndedAt = Date.now();
    this.emitStatus();
    debugLog('Convai', `[${conn.coach.name}] LLM chose no response`);
  }

  private resetLipsyncState(conn: CoachConnection): void {
    conn.lipsyncActive = false;
    conn.lipsyncConversationEndResetSent = true;
    this.incrementLipsyncResetGeneration(conn);
    resetLipsyncPlayerState(conn.lipsyncPlayer);
    try { conn.client?.blendshapeQueue?.reset?.(); } catch {}
    if (this.speakingCoachId === conn.coach.id) this.speakingCoachId = '';
  }

  private finishLipsyncIfEnded(conn: CoachConnection): boolean {
    const queue = conn.client?.blendshapeQueue;
    if (queue && shouldPlayLipsyncFrames(queue)) return false;
    // The supplied adapter resets the SDK queue after its fade reaches zero,
    // so isConversationEnded() may already have returned to false by the time
    // this manager-side report runs. A quiet, inactive renderer plus turnEnd
    // is the equivalent completed-end proof and must bump the reset generation
    // exactly once as well.
    const queueEnded = Boolean(queue?.isConversationEnded?.());
    const rendererCompletedTurn = this.hasFreshLipsyncRenderer(conn)
      && conn.turnEnded
      && conn.lipsyncPlayer.lastFreshFrameAtMs > 0
      && !conn.lipsyncActive;
    if (!queueEnded && !rendererCompletedTurn) return false;
    if (conn.isSpeaking || queue?.isBotSpeaking?.()) return false;
    if (this.audio.isAdvancing(conn)) return false;
    if (this.audio.isPlaying(conn)) return false;
    conn.lipsyncActive = false;
    if (!conn.lipsyncConversationEndResetSent) {
      conn.lipsyncConversationEndResetSent = true;
      this.incrementLipsyncResetGeneration(conn);
    }
    resetLipsyncPlayerState(conn.lipsyncPlayer);
    if (this.speakingCoachId === conn.coach.id) this.speakingCoachId = '';
    this.emitStatus();
    return true;
  }

  private async disconnectOne(conn: CoachConnection): Promise<void> {
    for (const unsub of conn.unsubFns) {
      try { unsub(); } catch {}
    }
    conn.unsubFns = [];
    if (conn.speechEndTimer) {
      clearTimeout(conn.speechEndTimer);
      conn.speechEndTimer = null;
    }
    if (this.streamDebounce) {
      clearTimeout(this.streamDebounce);
      this.streamDebounce = null;
    }
    if (conn.audioRenderer) {
      try { conn.audioRenderer.destroy(); } catch {}
      conn.audioRenderer = null;
    }
    conn.coachAudioEl = null;
    if (conn.boardVision) {
      try { conn.boardVision.stop(); } catch {}
      conn.boardVision = null;
    }
    conn.boardVisionPublishPromise = null;
    conn.pendingBoardVisionFen = '';
    if (conn.client) {
      try { await conn.client.disconnect(); } catch {}
      conn.client = null;
    }
    conn.connected = false;
    conn.botReady = false;
    conn.connectedAt = 0;
    conn.appliedStaticPolicy = '';
    conn.contextAckSequence = 0;
    conn.lastContextAckStatus = '';
    conn.lastContextAckTriggered = null;
    conn.isSpeaking = false;
    this.resetLipsyncState(conn);
    conn.lipsyncRendererHeartbeatAt = 0;
    conn.streamBuffer = '';
    conn.lastEmittedText = '';
    conn.longestResponseText = '';
    conn.streamResponseId = '';
    conn.responseSuppressed = false;
    conn.llmNoResponse = false;
    conn.turnEnded = false;
    conn.lastTurnEndAt = 0;
    conn.isThinking = false;
    this.emitStatus();
  }

  private async disconnectOtherCoaches(activeCoachId: CoachId): Promise<void> {
    const disconnects: Array<Promise<void>> = [];
    for (const [coachId, conn] of this.pool) {
      if (coachId === activeCoachId) continue;
      if (!conn.connected && !conn.connecting && !conn.client) continue;
      disconnects.push(this.disconnectOne(conn));
    }
    await Promise.all(disconnects);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) listener(status);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const chessConvai = new ChessConvaiManager();

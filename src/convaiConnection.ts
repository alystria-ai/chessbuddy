import type { BoardVisionSession } from './boardVision';
import type { CoachConfig } from './coachConfig';
import { createLipsyncPlayerState, type ConvaiLipsyncPlayerState } from './convaiLipsyncPlayer';

export type CoachConnection = {
  coach: CoachConfig;
  client: any;
  audioRenderer: any;
  coachAudioEl: HTMLAudioElement | null;
  connected: boolean;
  connecting: boolean;
  botReady: boolean;
  connectedAt: number;
  isSpeaking: boolean;
  streamBuffer: string;
  lastEmittedText: string;
  longestResponseText: string;
  /** Stable SDK ChatMessage id for the cumulative response currently streaming. */
  streamResponseId: string;
  responseSuppressed: boolean;
  llmNoResponse: boolean;
  isThinking: boolean;
  unsubFns: Array<() => void>;
  /** 120ms post-speech settle timer — cleared on disconnect. */
  speechEndTimer: ReturnType<typeof setTimeout> | null;
  lipsyncActive: boolean;
  lipsyncPlayer: ConvaiLipsyncPlayerState;
  /**
   * Monotonic lifecycle signal observed by the render-loop lipsync adapter.
   * It changes whenever facial state must be discarded (normalization,
   * conversation completion, interruption, model replacement, or disconnect).
   */
  lipsyncResetGeneration: number;
  /**
   * Monotonic-clock timestamp of the latest render-loop ownership report.
   * While fresh, manager-side compatibility playback must not consume the SDK
   * queue; zero means no renderer currently owns it.
   */
  lipsyncRendererHeartbeatAt: number;
  /** Prevent repeated generation bumps while polling an already-ended turn. */
  lipsyncConversationEndResetSent: boolean;
  turnEnded: boolean;
  lastTurnEndAt: number;
  lastFinalTextAt: number;
  lastSpeechEndedAt: number;
  staticPolicy: string;
  /** Policy already installed on the currently connected Convai room. */
  appliedStaticPolicy: string;
  /** Monotonic receipt count for server acknowledgements of context updates. */
  contextAckSequence: number;
  lastContextAckStatus: string;
  lastContextAckTriggered: boolean | null;
  endUserId: string;
  endUserMetadata: Record<string, unknown> | null;
  ltmEnabled: boolean;
  activeCharacterId: string;
  profileMemoryKey: string;
  boardVision: BoardVisionSession | null;
  lastConnectError: string;
  pendingBoardVisionFen: string;
  boardVisionPublishPromise: Promise<BoardVisionSession | null> | null;
};

export function createConnection(coach: CoachConfig): CoachConnection {
  return {
    coach,
    client: null,
    audioRenderer: null,
    coachAudioEl: null,
    connected: false,
    connecting: false,
    botReady: false,
    connectedAt: 0,
    isSpeaking: false,
    streamBuffer: '',
    lastEmittedText: '',
    longestResponseText: '',
    streamResponseId: '',
    responseSuppressed: false,
    llmNoResponse: false,
    isThinking: false,
    unsubFns: [],
    speechEndTimer: null,
    lipsyncActive: false,
    lipsyncPlayer: createLipsyncPlayerState(),
    lipsyncResetGeneration: 0,
    lipsyncRendererHeartbeatAt: 0,
    lipsyncConversationEndResetSent: true,
    turnEnded: false,
    lastTurnEndAt: 0,
    lastFinalTextAt: 0,
    lastSpeechEndedAt: 0,
    staticPolicy: '',
    appliedStaticPolicy: '',
    contextAckSequence: 0,
    lastContextAckStatus: '',
    lastContextAckTriggered: null,
    endUserId: '',
    endUserMetadata: null,
    ltmEnabled: false,
    activeCharacterId: '',
    profileMemoryKey: '',
    boardVision: null,
    lastConnectError: '',
    pendingBoardVisionFen: '',
    boardVisionPublishPromise: null,
  };
}

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Chess, type Move, type Square } from 'chess.js';
import { ArrowLeft, ArrowRight, BookOpen, Check, ClipboardCopy, Flag, Library, Lightbulb, Menu as MenuIcon, RotateCcw, ScanSearch, SlidersHorizontal, X } from 'lucide-react';
import { analyzeGame } from './analysis';
import AuthButton from './AuthButton';
import { authUserToIdentity, fetchAuthUser, getCachedAuthUser, resolveConvaiConnectionEndUserId, type AuthUser, type UserIdentity } from './auth';
import { DIFFICULTIES, getAllCoaches, getCoach, getDifficulty, DEFAULT_COACH, type CoachId, type DifficultyConfig, type DifficultyId } from './coachConfig';
import { preloadCoachAssets } from './coachAssetPreload';
import { CHARACTER_RESOURCE_DISPOSE_DELAY_MS } from './characterResourceLifecycle';
import { analyzeCoachMoveContext, buildCoachInstruction, buildDynamicCoachInfo, buildGameOverDynamicInfo, buildWelcomeDynamicInfo, guardObviousRecapture, legalTargets } from './chessAi';
import { clickBack, playUiSound, unlockUiAudio } from './uiSounds';
import { chessConvai } from './convaiManager';
import { mergeConversationMessage, type CoachConversationMessage } from './coachConversation';
import { CONVAI_ACCOUNT_FEATURES_ENABLED } from './featureFlags';

import { copyLogToClipboard, debugLog } from './debugLog';
import { ChessBoard, kingSquareOf, miniBoardFocusStyle } from './ChessBoard';
import { ConfettiBurst } from './Celebration';
import {
  buildErrorMap,
  buildHintText,
  buildMovePairs,
  describeAccuracy,
  getChipClass,
  getStatus,
  moveRecordToMoveLike,
  resultLabel,
  toRecord,
} from './chessHelpers';
import { applyRepeatSuppression, recentlySpokenTopics } from './coachSpeechPolicy';
import { sequenceCoachMove } from './coachMoveSequence';
import CoachCard from './CoachCard';
import { GameSetupPanel, ReadyMoreMenu } from './GameSetupPanel';
import MicButton from './MicButton';
import DeveloperOptions from './DeveloperOptions';
import MoveListPanel from './MoveListPanel';
import { ScrollWhenClipped } from './useOverflowScroll';
import { stockfishEngine } from './stockfishEngine';
import {
  createSessionId,
  deleteSession,
  loadCoachingControlMode,
  loadSessions,
  saveCoachingControlMode,
  saveSession,
  type AnalysisSummary,
  type CoachingControlMode,
  type MoveSnapshot,
  type StoredGameSession,
} from './storage';
import type { MoveRecord } from './types';
import { useWheelScrollBridge } from './wheelScrollBridge';
import { resolveCoachStatusLabel, shouldRetryWelcomeConnection, shouldStartWelcome } from './welcomeLifecycle';
import { pickCoachIdleInvite } from './coachIdleInvites';
import { isMobilePortrait } from './isMobilePortrait';
import {
  readMobilePortraitSignals,
  resolveMobilePortraitQuality,
  shouldPreloadMobilePortrait,
} from './mobilePortraitQuality';

const DATASET_TOOLS_ENABLED = __DATASET_TOOLS_ENABLED__;
const PuzzleScreen = lazy(() => import('./PuzzleScreen'));
const MyGamesScreen = lazy(() => import('./MyGamesScreen'));
const CustomCoachCreator = lazy(() => import('./CustomCoachCreator'));
const DatasetScreen = lazy(() => import('./DatasetScreen'));
const MenuScreen = lazy(() => import('./MenuScreen'));
const LEGACY_MENU_QA = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('legacy-menu');
const READY_PREFS_KEY = 'chessbuddy-ready-preferences-v1';
const CONVAI_SITE_URL = 'https://www.convai.com/';
const CONVAI_LOGO_URL = `${import.meta.env.BASE_URL}convai-logo-mark.png`;

type Screen = 'ready' | 'menu' | 'game' | 'puzzles' | 'games' | 'creator' | 'dataset';

function loadReadyPreferences(): { coachId: CoachId; difficultyId: DifficultyId } {
  try {
    const parsed = JSON.parse(localStorage.getItem(READY_PREFS_KEY) ?? '{}') as {
      coachId?: string;
      difficultyId?: string;
    };
    const coachId = getAllCoaches().some((coach) => coach.id === parsed.coachId)
      ? parsed.coachId as CoachId
      : DEFAULT_COACH.id;
    const difficultyId = DIFFICULTIES.some((difficulty) => difficulty.id === parsed.difficultyId)
      ? parsed.difficultyId as DifficultyId
      : 'intermediate';
    return { coachId, difficultyId };
  } catch {
    return { coachId: DEFAULT_COACH.id, difficultyId: 'intermediate' };
  }
}

type DialogueExchange = {
  timestamp: string;
  coachId: CoachId;
  coachName: string;
  difficultyId: DifficultyId;
  fen: string;
  dynamicInfo: string;
  prompt: string;
  coachResponse: string;
  wasSilent: boolean;
};

function RouteFallback({ label }: { label: string }) {
  return (
    <main className="route-loading-screen" role="status" aria-live="polite">
      <div><span aria-hidden="true">♙</span><strong>{label}</strong></div>
    </main>
  );
}

type GameReadyTimingWindow = Window & {
  __chessGameReadyTiming?: {
    playIntentAt: number;
    activeAt?: number;
    playToActiveMs?: number;
  };
};

function addStudentContext(text: string, identity: UserIdentity | null): string {
  if (!identity) return text;
  return [
    text,
    `Signed-in student profile: their preferred name is ${identity.displayName}.`,
    'Use the student name naturally when it helps, but do not overuse it.',
  ].join(' ');
}

function buildLongTermGameMemory(analysis: AnalysisSummary, difficulty: DifficultyConfig): string {
  const firstTip = analysis.tips[0] ?? 'keep scanning checks, captures, and threats before quiet moves';
  const issue = analysis.blunders > 0
    ? `${analysis.blunders} blunder${analysis.blunders > 1 ? 's' : ''}`
    : analysis.mistakes > 0
      ? `${analysis.mistakes} mistake${analysis.mistakes > 1 ? 's' : ''}`
      : analysis.inaccuracies > 0
        ? `${analysis.inaccuracies} inaccuracy${analysis.inaccuracies > 1 ? 'ies' : 'y'}`
        : 'a mostly solid game';
  return `In a ${difficulty.label} chess game, the student had ${issue}; useful coaching focus: ${firstTip}.`;
}

function App() {
  useWheelScrollBridge();

  const homeScreen: Screen = LEGACY_MENU_QA ? 'menu' : 'ready';
  const [screen, setScreen] = useState<Screen>(homeScreen);
  const [initialReadyPreferences] = useState(loadReadyPreferences);
  const [coachId, setCoachId] = useState<CoachId>(initialReadyPreferences.coachId);
  const [difficultyId, setDifficultyId] = useState<DifficultyId>(initialReadyPreferences.difficultyId);
  const [gameInstanceId, setGameInstanceId] = useState(0);
  const [coachingControlMode, setCoachingControlModeState] = useState<CoachingControlMode>(() => loadCoachingControlMode());
  const [sessions, setSessions] = useState<StoredGameSession[]>(() => loadSessions());
  // Coach chat is a permanent part of the game card; no visibility toggle.
  const chatOpen = true;
  /** Saved game being resumed/replayed, if any (see ResumeRequest). */
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest | null>(null);
  /** Sign-in confirmation banner text ('' = hidden). */
  const [authToast, setAuthToast] = useState('');
  const [showReadySettings, setShowReadySettings] = useState(false);
  const openReadySettings = useCallback(() => setShowReadySettings(true), []);
  const closeReadySettings = useCallback(() => setShowReadySettings(false), []);

  useEffect(() => {
    try {
      localStorage.setItem(READY_PREFS_KEY, JSON.stringify({ coachId, difficultyId }));
    } catch (error) {
      debugLog('App', 'Could not persist ready-screen preferences:', error);
    }
  }, [coachId, difficultyId]);

  useEffect(() => {
    if (!authToast) return;
    const timer = window.setTimeout(() => setAuthToast(''), 4000);
    return () => window.clearTimeout(timer);
  }, [authToast]);

  // Warm the selected coach while the actual board/coach shell is already on
  // screen behind the Play overlay. Only the chosen device variant is fetched.
  // Economy phones skip this so the GLB does not fight the first paint.
  useEffect(() => {
    if (screen !== 'ready' && screen !== 'menu') return;
    if (isMobilePortrait()) {
      const quality = resolveMobilePortraitQuality(readMobilePortraitSignals());
      if (!shouldPreloadMobilePortrait(quality)) return;
    }
    const idle = window.setTimeout(() => preloadCoachAssets(coachId), 300);
    // Mobile character teardown clears the parsed cache after its 1.8 s retry
    // grace. Warm once more just after that boundary: the invalidated marker
    // makes this a real re-preload only when disposal actually occurred.
    const afterResourceCleanup = window.setTimeout(
      () => preloadCoachAssets(coachId),
      CHARACTER_RESOURCE_DISPOSE_DELAY_MS + 150,
    );
    return () => {
      window.clearTimeout(idle);
      window.clearTimeout(afterResourceCleanup);
    };
  }, [screen, coachId]);

  useEffect(() => {
    if (screen !== 'ready' && screen !== 'game') return undefined;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return undefined;

    // The engine WASM is ~5.6 MB. Starting it beside the selected coach's
    // 8-13 MB GLB more than doubled cold portrait time on constrained mobile
    // links. Let the character win that bandwidth race; bestMove() can still
    // start Stockfish on demand if the player moves before this warm-up.
    let engineWarmTimer: number | null = null;
    let cancelled = false;
    const warmEngineWhenPortraitReady = () => {
      if (cancelled) return;
      if (document.querySelector('.character-window.is-ready')) {
        void stockfishEngine.warmup();
        return;
      }
      engineWarmTimer = window.setTimeout(warmEngineWhenPortraitReady, 500);
    };
    warmEngineWhenPortraitReady();
    if (screen !== 'ready') {
      void import('@convai/web-sdk/vanilla');
      return () => {
        cancelled = true;
        if (engineWarmTimer !== null) window.clearTimeout(engineWarmTimer);
      };
    }

    const warm = () => {
      if (cancelled) return;
      // Download/parse the SDK chunk, but do not request a token, microphone,
      // websocket, or Convai room before the player presses Play.
      void import('@convai/web-sdk/vanilla');
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warm, { timeout: 1800 });
      return () => {
        cancelled = true;
        if (engineWarmTimer !== null) window.clearTimeout(engineWarmTimer);
        idleWindow.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(warm, 900);
    return () => {
      cancelled = true;
      if (engineWarmTimer !== null) window.clearTimeout(engineWarmTimer);
      window.clearTimeout(timer);
    };
  }, [screen]);

  useLayoutEffect(() => {
    if (screen !== 'game') return;
    const timingWindow = window as GameReadyTimingWindow;
    const timing = timingWindow.__chessGameReadyTiming;
    if (!timing?.playIntentAt || timing.activeAt) return;
    timing.activeAt = performance.now();
    timing.playToActiveMs = timing.activeAt - timing.playIntentAt;
    document.documentElement.dataset.playToActiveMs = timing.playToActiveMs.toFixed(1);
    debugLog('Performance', `Play overlay -> active board in ${timing.playToActiveMs.toFixed(1)}ms`);
  }, [screen]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedAuthUser());
  const userIdentity = useMemo(() => authUserToIdentity(authUser), [authUser]);
  const handleAuthUserChange = useCallback((user: AuthUser | null, meta?: { justSignedIn?: boolean }) => {
    setAuthUser(user);
    chessConvai.syncEndUserIdentity(authUserToIdentity(user));
    // Confirm a sign-in the user just performed. The modal's own success panel
    // auto-dismisses (and Convai sign-in returns via a page redirect, landing
    // with no modal at all), so this is the durable confirmation.
    if (user && meta?.justSignedIn) {
      const who = user.name || user.email;
      setAuthToast(who ? `Signed in as ${who}` : 'Signed in');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthUser()
      .then((user) => {
        if (!cancelled) {
          setAuthUser(user);
          chessConvai.syncEndUserIdentity(authUserToIdentity(user));
        }
      })
      .catch(() => {
        if (!cancelled) {
          const cached = getCachedAuthUser();
          setAuthUser(cached);
          chessConvai.syncEndUserIdentity(authUserToIdentity(cached));
        }
      });
    return () => { cancelled = true; };
  }, []);

  const coach = getCoach(coachId);

  const handleCoachingControlModeChange = useCallback((mode: CoachingControlMode) => {
    setCoachingControlModeState(mode);
    saveCoachingControlMode(mode);
    debugLog('App', `coachingControlMode -> ${mode}`);
  }, []);

  /**
   * Start a game. With `resume`, the board, move list and hint count are
   * restored from a saved session and the coach/difficulty follow that game
   * rather than the current menu selection.
   */
  function startQuickPlay(resume: ResumeRequest | null = null) {
    setResumeRequest(resume);
    const selectedCoach = resume ? getCoach(resume.coachId) : coach;
    const selectedDifficultyId = resume ? resume.difficultyId : difficultyId;
    if (resume) {
      setCoachId(resume.coachId);
      setDifficultyId(resume.difficultyId);
    }
    debugLog(
      'Loading',
      `Quick play started — coach=${selectedCoach.id} difficulty=${selectedDifficultyId}${resume ? ` (resuming ${resume.moves.length} plies of ${resume.sessionId})` : ''}`,
    );
    chessConvai.unlockAudio();
    (window as GameReadyTimingWindow).__chessGameReadyTiming = {
      playIntentAt: performance.now(),
    };
    // The real board/avatar shell is already mounted behind the ready overlay.
    // Reveal it synchronously; voice connects and the welcome runs in-card.
    setScreen('game');
  }

  const refreshSessions = useCallback(() => {
    setSessions(loadSessions());
  }, []);

  let body: ReactNode;
  if (screen === 'ready' || screen === 'game') {
    body = (
      <ChessGame
        coachId={coachId}
        difficultyId={difficultyId}
        coachingControlMode={coachingControlMode}
        userIdentity={userIdentity}
        sessionStarted={screen === 'game'}
        onStartGame={() => startQuickPlay()}
        onBackToReady={() => {
          chessConvai.interruptBot(coach);
          refreshSessions();
          setResumeRequest(null);
          setGameInstanceId((current) => current + 1);
          setScreen(homeScreen);
        }}
        onSessionsChanged={refreshSessions}
        onCoachChange={setCoachId}
        onDifficultyChange={setDifficultyId}
        onCoachingControlModeChange={handleCoachingControlModeChange}
        onOpenSettings={openReadySettings}
        onPuzzles={() => {
          chessConvai.interruptBot(coach);
          setScreen('puzzles');
        }}
        onGames={() => {
          chessConvai.interruptBot(coach);
          refreshSessions();
          setScreen('games');
        }}
        onCreator={() => {
          chessConvai.interruptBot(coach);
          setScreen('creator');
        }}
        creatorEnabled={CONVAI_ACCOUNT_FEATURES_ENABLED && authUser?.provider === 'convai'}
        authSlot={<AuthButton user={authUser} onUserChange={handleAuthUserChange} />}
        chatOpen={chatOpen}
        resume={resumeRequest}
        key={`game-${gameInstanceId}-${resumeRequest?.sessionId ?? 'new'}`}
      />
    );
  } else if (screen === 'puzzles') {
    body = (
      <Suspense fallback={<RouteFallback label="Opening tactics…" />}>
        <PuzzleScreen coachId={coachId} difficultyId={difficultyId} userIdentity={userIdentity} onBack={() => setScreen(homeScreen)} key={`puzzles-${coachId}`} />
      </Suspense>
    );
  } else if (screen === 'games') {
    body = (
      <Suspense fallback={<RouteFallback label="Opening your games…" />}>
        <MyGamesScreen
          sessions={sessions}
          onBack={() => {
            refreshSessions();
            setScreen(homeScreen);
          }}
          onDelete={(id) => {
            deleteSession(id);
            refreshSessions();
          }}
          onPlayFrom={(session, ply) => {
            const isFullResume = ply >= session.moves.length;
            startQuickPlay({
              // Continuing the game updates the same saved entry; branching from
              // an earlier move starts a new one so the original survives.
              sessionId: isFullResume ? session.id : createSessionId(),
              coachId: session.coachId,
              difficultyId: session.difficultyId,
              moves: session.moves.slice(0, ply),
              hintsUsed: isFullResume ? session.hintsUsed : 0,
            });
          }}
        />
      </Suspense>
    );
  } else if (screen === 'creator') {
    body = <Suspense fallback={<RouteFallback label="Opening coach setup…" />}><CustomCoachCreator user={authUser} onBack={() => setScreen(homeScreen)} /></Suspense>;
  } else if (screen === 'dataset' && DATASET_TOOLS_ENABLED) {
    body = <Suspense fallback={<RouteFallback label="Opening dialogue tools…" />}><DatasetScreen onBack={() => setScreen(homeScreen)} /></Suspense>;
  } else if (screen === 'menu') {
    body = (
      <Suspense fallback={<RouteFallback label="Opening legacy menu QA…" />}>
        <MenuScreen
          coachId={coachId}
          difficultyId={difficultyId}
          savedGameCount={sessions.length}
          coachingControlMode={coachingControlMode}
          onCoachChange={setCoachId}
          onDifficultyChange={setDifficultyId}
          onCoachingControlModeChange={handleCoachingControlModeChange}
          onQuickPlay={() => startQuickPlay()}
          onPuzzles={() => setScreen('puzzles')}
          onGames={() => setScreen('games')}
          onCreator={() => setScreen('creator')}
          creatorEnabled={CONVAI_ACCOUNT_FEATURES_ENABLED && authUser?.provider === 'convai'}
          onDataset={DATASET_TOOLS_ENABLED ? () => setScreen('dataset') : undefined}
          authSlot={<AuthButton user={authUser} onUserChange={handleAuthUserChange} />}
        />
      </Suspense>
    );
  } else {
    body = null;
  }

  return (
    <>
      {body}
      {(screen === 'ready' || screen === 'game') && (
        <GameSetupPanel
          open={showReadySettings}
          coachId={coachId}
          difficultyId={difficultyId}
          coachingControlMode={coachingControlMode}
          onCoachChange={setCoachId}
          onDifficultyChange={setDifficultyId}
          onCoachingControlModeChange={handleCoachingControlModeChange}
          onClose={closeReadySettings}
        />
      )}
      {authToast && (
        <div className="toast-notification auth-toast" role="status" aria-live="polite">
          <Check size={16} strokeWidth={2.6} aria-hidden="true" />
          <span>{authToast}</span>
        </div>
      )}
    </>
  );
}

/**
 * A saved game to continue from. `sessionId` is the id the continued game
 * saves under: the SAME id when resuming (it updates that entry) and a NEW one
 * when replaying from an earlier move, so branching never overwrites the
 * original game.
 */
export type ResumeRequest = {
  sessionId: string;
  coachId: CoachId;
  difficultyId: DifficultyId;
  moves: MoveRecord[];
  hintsUsed: number;
};

/** Rebuild a board by replaying the moves (keeps chess.js history intact — a
 *  FEN-only restore would lose repetition/50-move state). */
function replayGame(resume?: ResumeRequest | null): Chess {
  const game = new Chess();
  if (!resume) return game;
  for (const move of resume.moves) {
    try {
      game.move(move.san);
    } catch {
      // Corrupt/incompatible entry — keep whatever replayed cleanly.
      break;
    }
  }
  return game;
}

function ReadyStartCard({
  hasMoves,
  coachName,
  difficultyLabel,
  onStart,
  onSettings,
}: {
  hasMoves: boolean;
  coachName: string;
  difficultyLabel: string;
  onStart: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="game-ready-start-card">
      <button type="button" className="game-ready-play" onClick={onStart}>
        {hasMoves ? 'Continue' : 'Play'}
      </button>
      <div className="game-ready-options-row">
        <div className="game-ready-summary" aria-label={`${coachName}, ${difficultyLabel}`}>
          <strong>{coachName}</strong><span aria-hidden="true">·</span><span>{difficultyLabel}</span>
        </div>
        <button type="button" className="game-ready-change" onClick={onSettings}>
          <SlidersHorizontal aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
      <a
        className="game-ready-powered-by"
        href={CONVAI_SITE_URL}
        aria-label="Powered by Convai — visit Convai"
      >
        <span>Powered by</span>
        <img src={CONVAI_LOGO_URL} alt="" aria-hidden="true" />
        <strong>Convai</strong>
      </a>
    </div>
  );
}

function MobileGameDrawer({
  open,
  sessionStarted,
  coachId,
  logsCopied,
  creatorEnabled,
  authSlot,
  onClose,
  onMenu,
  onHint,
  onNewGame,
  onCopyLogs,
  onResign,
  onTactics,
  onGames,
  onCreator,
  onSettings,
}: {
  open: boolean;
  sessionStarted: boolean;
  coachId: CoachId;
  logsCopied: boolean;
  creatorEnabled: boolean;
  authSlot?: ReactNode;
  onClose: () => void;
  onMenu: () => void;
  onHint: () => void;
  onNewGame: () => void;
  onCopyLogs: () => void;
  onResign: () => void;
  onTactics: () => void;
  onGames: () => void;
  onCreator: () => void;
  onSettings: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
      return;
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const run = (action: () => void) => {
    onClose();
    let ran = false;
    const openAfterDrawer = () => {
      if (ran) return;
      ran = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(action);
      });
    };
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.addEventListener('close', openAfterDrawer, { once: true });
      window.setTimeout(openAfterDrawer, 150);
      return;
    }
    openAfterDrawer();
  };

  return (
    <dialog
      ref={dialogRef}
      className="mobile-game-drawer"
      aria-labelledby="mobile-game-menu-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="mobile-game-drawer-panel">
        <header>
          <div>
            <span id="mobile-game-menu-title">Chessbuddy</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close menu">
            <X aria-hidden="true" />
          </button>
        </header>

        <nav aria-label="Game menu">
          {sessionStarted ? (
            <>
              <p className="mobile-drawer-kicker">Session</p>
              <button type="button" onClick={() => run(onMenu)}>
                <ArrowLeft aria-hidden="true" />
                <span><strong>Back to lobby</strong><small>Your game is saved automatically</small></span>
              </button>
              <p className="mobile-drawer-kicker">Board</p>
              <button type="button" onClick={() => run(onHint)}>
                <Lightbulb aria-hidden="true" />
                <span><strong>Ask for a hint</strong><small>Get the next useful idea</small></span>
              </button>
              <button type="button" onClick={() => run(onGames)}>
                <Library aria-hidden="true" />
                <span><strong>Saved games</strong><small>Continue or review previous sessions</small></span>
              </button>
              <button type="button" onClick={() => run(onNewGame)}>
                <RotateCcw aria-hidden="true" />
                <span><strong>New game</strong><small>Reset the current board</small></span>
              </button>
              <button type="button" onClick={() => run(onCopyLogs)}>
                {logsCopied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
                <span><strong>{logsCopied ? 'Logs copied' : 'Copy session logs'}</strong><small>Useful for troubleshooting</small></span>
              </button>
              <button className="is-danger" type="button" onClick={() => run(onResign)}>
                <Flag aria-hidden="true" />
                <span><strong>Resign game</strong><small>End this match</small></span>
              </button>
            </>
          ) : (
            <>
              <p className="mobile-drawer-kicker">Play</p>
              <button type="button" onClick={() => run(onTactics)}>
                <BookOpen aria-hidden="true" />
                <span><strong>Tactics</strong><small>Practice focused positions</small></span>
              </button>
              <button type="button" onClick={() => run(onGames)}>
                <Library aria-hidden="true" />
                <span><strong>Saved games</strong><small>Continue or review previous sessions</small></span>
              </button>
              {creatorEnabled && (
                <button type="button" onClick={() => run(onCreator)}>
                  <span className="mobile-drawer-piece" aria-hidden="true">♙</span>
                  <span><strong>Create a coach</strong><small>Build a personal chess guide</small></span>
                </button>
              )}
            </>
          )}

          <p className="mobile-drawer-kicker">Studio</p>
          <button type="button" onClick={() => run(onSettings)}>
            <SlidersHorizontal aria-hidden="true" />
            <span><strong>Game settings</strong><small>Coach, challenge and coaching style</small></span>
          </button>
          <div className="mobile-drawer-utility" onClickCapture={onClose}>
            <DeveloperOptions coachId={coachId} description="Tune portrait, voice and diagnostics" />
          </div>
        </nav>

        <div className="mobile-drawer-account" onClickCapture={onClose}>
          <span>Account</span>
          {authSlot}
        </div>

        <a className="mobile-drawer-powered" href={CONVAI_SITE_URL} aria-label="Powered by Convai — visit Convai">
          <span>Powered by</span>
          <img src={CONVAI_LOGO_URL} alt="" aria-hidden="true" />
          <strong>Convai</strong>
        </a>
      </aside>
    </dialog>
  );
}

function ChessGame({
  coachId,
  difficultyId,
  coachingControlMode,
  userIdentity,
  sessionStarted,
  onStartGame,
  onBackToReady,
  onSessionsChanged,
  onCoachChange,
  onDifficultyChange,
  onCoachingControlModeChange,
  onOpenSettings,
  onPuzzles,
  onGames,
  onCreator,
  creatorEnabled,
  authSlot,
  chatOpen,
  resume,
}: {
  coachId: CoachId;
  difficultyId: DifficultyId;
  coachingControlMode: CoachingControlMode;
  userIdentity: UserIdentity | null;
  sessionStarted: boolean;
  onStartGame: () => void;
  onBackToReady: () => void;
  onSessionsChanged: () => void;
  onCoachChange: (coachId: CoachId) => void;
  onDifficultyChange: (difficultyId: DifficultyId) => void;
  onCoachingControlModeChange: (mode: CoachingControlMode) => void;
  onOpenSettings: () => void;
  onPuzzles: () => void;
  onGames: () => void;
  onCreator: () => void;
  creatorEnabled: boolean;
  authSlot?: ReactNode;
  chatOpen: boolean;
  /**
   * Board to start from instead of the initial position: a saved game being
   * resumed, or one being replayed from a chosen move. Consumed by the lazy
   * state initialisers below, so it only applies on mount (ChessGame is keyed
   * on the resume id, which forces that mount).
   */
  resume?: ResumeRequest | null;
}) {
  const coach = getCoach(coachId);
  const difficulty = getDifficulty(difficultyId);

  useEffect(() => {
    if (sessionStarted) return undefined;
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) {
      document.documentElement.dataset.convaiPreconnect = 'skipped-data-saver';
      return undefined;
    }

    let observeResult = true;
    document.documentElement.dataset.convaiPreconnectStarted = 'true';
    document.documentElement.dataset.convaiPreconnect = 'connecting';
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    debugLog('Loading', `Preconnecting ${coach.name} with mic/audio input off`);
    void chessConvai.connectCoach(coach, {
      waitForBotReady: true,
      readyWaitMs: 12000,
      reconnectIfStale: false,
      staticPolicy,
      endUserId: resolveConvaiConnectionEndUserId(userIdentity),
      endUserMetadata: userIdentity?.endUserMetadata ?? null,
    }).then(() => {
      if (!observeResult) return;
      const status = chessConvai.getStatus();
      document.documentElement.dataset.convaiPreconnect = status.botReady ? 'ready' : 'unavailable';
      debugLog(
        'Loading',
        `Preconnect ${coach.name} connected=${status.connected} botReady=${status.botReady}`,
      );
    }).catch((error) => {
      if (!observeResult) return;
      document.documentElement.dataset.convaiPreconnect = 'unavailable';
      debugLog('Loading', `Preconnect ${coach.name} failed:`, error);
    });

    // Do not disconnect on Play: the point is to hand the already-warm room to
    // beginNewGame. A coach/identity change calls connectCoach again, whose
    // pool logic replaces the stale selected connection safely.
    return () => {
      observeResult = false;
    };
  }, [coach, difficulty, sessionStarted, userIdentity]);
  const [game, setGame] = useState(() => replayGame(resume));
  const [selected, setSelected] = useState<Square | null>(null);
  const [history, setHistory] = useState<MoveRecord[]>(() => resume?.moves ?? []);
  const [thinking, setThinking] = useState(false);
  const [boardThinking, setBoardThinking] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [coachLineUpdate, setCoachLineUpdate] = useState<{ text: string; responseId?: string }>({ text: '' });
  const coachLine = coachLineUpdate.text;
  const setCoachLine = useCallback((text: string, responseId?: string) => {
    setCoachLineUpdate({ text, ...(responseId ? { responseId } : {}) });
  }, []);
  const [conversationMessages, setConversationMessages] = useState<CoachConversationMessage[]>([]);
  const conversationMessageIdRef = useRef(0);
  const [hintText, setHintText] = useState('');
  const [hintLevel, setHintLevel] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(() => resume?.hintsUsed ?? 0);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [analysisPending, setAnalysisPending] = useState(false);
  const sessionIdRef = useRef(resume?.sessionId ?? createSessionId());
  const analysisStartedRef = useRef(false);
  const gameOverHandledRef = useRef(false);
  const welcomeSpokenRef = useRef(false);
  const lateWelcomeReconnectAttemptedRef = useRef(false);
  const [welcomeDelivered, setWelcomeDelivered] = useState(false);
  const prevThinkingRef = useRef(false);
  const [yourTurnPulse, setYourTurnPulse] = useState(false);
  const [convaiStatus, setConvaiStatus] = useState(chessConvai.getStatus());
  const [recentCoachSpeech, setRecentCoachSpeech] = useState(false);
  // Track which speech reasons were last fired and at which fullmove number, so we can
  // suppress repeated positional advice (e.g. "your king is still in the center").
  const spokenReasonsRef = useRef<Map<string, number>>(new Map());

  const [coachResponding, setCoachResponding] = useState(false);
  const [resigned, setResigned] = useState(false);
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showGameOverModal, setShowGameOverModal] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedMoveIdx, setSelectedMoveIdx] = useState<number | null>(null);
  const [coachGuidance, setCoachGuidance] = useState('');
  const [guidanceLoading, setGuidanceLoading] = useState(false);

  const [lastExchange, setLastExchange] = useState<DialogueExchange | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [logsCopied, setLogsCopied] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [selectedExpected, setSelectedExpected] = useState<'silent' | 'talk'>('silent');
  const [showReadyMore, setShowReadyMore] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [idleInvite] = useState(() => pickCoachIdleInvite());
  const moveSequenceRef = useRef(0);

  // Every asynchronous engine/speech turn owns one generation. Invalidate it
  // synchronously before leaving, resigning, resetting, or unmounting so an
  // interrupted response cannot append a late move to an abandoned game.
  function cancelPendingCoachMove() {
    moveSequenceRef.current += 1;
    setThinking(false);
    setBoardThinking(false);
    chessConvai.interruptBot(coach);
  }

  useEffect(() => () => {
    moveSequenceRef.current += 1;
  }, []);

  const appendConversationMessage = useCallback((
    role: CoachConversationMessage['role'],
    rawText: string,
    responseId?: string,
  ) => {
    setConversationMessages((current) => mergeConversationMessage(
      current,
      role,
      rawText,
      () => ++conversationMessageIdRef.current,
      responseId,
    ));
  }, []);

  useEffect(() => {
    if (!sessionStarted || !coachLine) return;
    appendConversationMessage('coach', coachLine, coachLineUpdate.responseId);
  }, [appendConversationMessage, coachLine, coachLineUpdate.responseId, sessionStarted]);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? '' : current));
    }, 3000);
  }

  async function handleCopyLogs() {
    try {
      await copyLogToClipboard();
      setLogsCopied(true);
      showToast('Session logs copied.');
      window.setTimeout(() => setLogsCopied(false), 1800);
    } catch (error) {
      debugLog('App', 'Copy Logs failed:', error);
      showToast('Could not copy session logs.');
    }
  }

  function openSaveModal() {
    if (!lastExchange) {
      showToast('No recent dialogue exchange to save.');
      return;
    }
    setSelectedExpected(lastExchange.wasSilent ? 'silent' : 'talk');
    setShowSaveModal(true);
  }

  async function handleAddToDataset(expectedResponse: 'silent' | 'talk') {
    if (!lastExchange) {
      showToast('No recent dialogue exchange to save.');
      return;
    }
    const payload = {
      ...lastExchange,
      sessionId: sessionIdRef.current,
      coachingControlMode,
      expectedResponse,
    };
    try {
      const res = await fetch('/api/dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const result = await res.json();
        showToast(`Saved to dataset! Total entries: ${result.count}`);
      } else {
        showToast('Failed to save dialogue.');
      }
    } catch {
      showToast('Error connecting to dataset API.');
    }
  }

  const legalMoves = useMemo(() => {
    if (!selected) return [];
    return legalTargets(game.fen(), selected);
  }, [game, selected]);

  const lastMove = history[history.length - 1];
  const identityKey = userIdentity?.endUserId ?? 'guest';
  const convaiPreparing = convaiStatus.thinking || convaiStatus.convaiTurnInFlight || coachResponding || guidanceLoading;
  const status = resolveCoachStatusLabel({
    coachName: coach.name,
    sessionStarted,
    speaking: convaiStatus.speaking,
    calculating: thinking,
    preparing: convaiPreparing,
    connecting: convaiStatus.connecting,
    connected: convaiStatus.connected,
    botReady: convaiStatus.botReady,
    recentCoachSpeech,
    resigned,
    fallbackStatus: getStatus(game, coach.name),
  });

  useEffect(() => chessConvai.onStatus(setConvaiStatus), []);

  useEffect(() => {
    if (convaiStatus.speaking) {
      setRecentCoachSpeech(true);
      return undefined;
    }
    if (!recentCoachSpeech) return undefined;
    if (convaiStatus.convaiTurnInFlight) return undefined;
    const timer = window.setTimeout(() => setRecentCoachSpeech(false), 200);
    return () => window.clearTimeout(timer);
  }, [convaiStatus.speaking, convaiStatus.convaiTurnInFlight, recentCoachSpeech]);

  useEffect(() => {
    if (!sessionStarted) return;
    if (!shouldStartWelcome({
      botReady: convaiStatus.botReady,
      alreadyStarted: welcomeSpokenRef.current,
      loadingCoverVisible: false,
    })) return;
    welcomeSpokenRef.current = true;
    // Resumed games greet from the CURRENT board, not a fresh one — otherwise
    // she welcomes the student to move one over a mid-game position.
    const isResumed = Boolean(resume?.moves.length);
    const welcomeBoard = isResumed ? game : new Chess();
    const openingInfo = addStudentContext(buildDynamicCoachInfo(welcomeBoard, null, null, coach, difficulty), userIdentity);
    const welcomeInfo = addStudentContext(
      buildWelcomeDynamicInfo(welcomeBoard, coach, difficulty, sessionIdRef.current, isResumed),
      userIdentity,
    );
    const welcomeSequence = moveSequenceRef.current;
    void (async () => {
      try {
        const spoken = await chessConvai.beginNewGame(
          coach,
          difficulty,
          sessionIdRef.current,
          openingInfo,
          userIdentity,
          welcomeInfo,
        );
        if (moveSequenceRef.current !== welcomeSequence) return;
        if (spoken) {
          setCoachLine(spoken);
        } else {
          // Greeting turn died server-side even after the retry — show a
          // canned welcome instead of a silent coach.
          setCoachLine(`Welcome! I'm ${coach.name} — you have the white pieces, so make your first move whenever you're ready.`);
        }
      } finally {
        setWelcomeDelivered(true);
      }
    })();
  }, [sessionStarted, convaiStatus.botReady, coach, difficulty, userIdentity, resume, game]);

  useEffect(() => {
    if (!sessionStarted) return;
    if (!shouldRetryWelcomeConnection({
      botReady: convaiStatus.botReady,
      alreadyStarted: welcomeSpokenRef.current,
      loadingCoverVisible: false,
      retryAlreadyAttempted: lateWelcomeReconnectAttemptedRef.current,
    })) return;

    lateWelcomeReconnectAttemptedRef.current = true;
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    debugLog('Loading', `${coach.name} welcome voice was not ready — retrying once over the revealed board`);
    void chessConvai.connectCoach(coach, {
      waitForBotReady: true,
      readyWaitMs: 12000,
      reconnectIfStale: true,
      staticPolicy,
      endUserId: resolveConvaiConnectionEndUserId(userIdentity),
      endUserMetadata: userIdentity?.endUserMetadata ?? null,
    });
  }, [sessionStarted, convaiStatus.botReady, coach, difficulty, userIdentity]);

  useEffect(() => {
    if (!sessionStarted || !welcomeDelivered) return;
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    const dynamicInfo = addStudentContext(
      buildDynamicCoachInfo(game, null, lastMove ? moveRecordToMoveLike(lastMove) : null, coach, difficulty, history),
      userIdentity,
    );
    void chessConvai.connectCoach(coach, {
      waitForBotReady: true,
      readyWaitMs: 3500,
      reconnectIfStale: false,
      staticPolicy,
      endUserId: resolveConvaiConnectionEndUserId(userIdentity),
      endUserMetadata: userIdentity?.endUserMetadata ?? null,
    }).then(() => chessConvai.updateCoachContext(coach, dynamicInfo));
  }, [identityKey, sessionStarted, welcomeDelivered, coach, difficulty, userIdentity]);

  useEffect(() => {
    return chessConvai.onResponse((response) => {
      if (response.coachId === coach.id) {
        setCoachLine(response.text, response.responseId);
      }
    });
  }, [coach.id, setCoachLine]);

  // (The old F6 jaw soft-knee A/B toggle is gone: the SDK 1.7 naturalness
  // stack replaced the compressor with the production gain table + hard cap,
  // and raw-vs-tuned A/B lives in the dev menu now.)

  useEffect(() => {
    if (!history.length) return;
    persistCurrentSession(game, history, hintsUsed, coachId, difficultyId, analysis);
    onSessionsChanged();
  }, [analysis, coachId, difficultyId, game, hintsUsed, history, onSessionsChanged]);

  const gameEnded = game.isGameOver() || resigned;

  /**
   * Leaving tears down the live coach connection and the board, so ask first
   * on ANY live game — including one with no moves yet: getting the coach
   * connected is the slow part, and dropping it by a stray Menu tap is what
   * the confirm exists to prevent. Only a finished game (already saved, the
   * post-game screen) leaves immediately.
   */
  function requestLeaveToMenu() {
    if (!gameEnded) {
      unlockUiAudio();
      playUiSound('tap');
      setShowLeaveConfirm(true);
      return;
    }
    cancelPendingCoachMove();
    clickBack(onBackToReady);
  }

  /** Player is always White: checkmate with Black to move means the player won. */
  const gameOutcome: 'victory' | 'defeat' | 'draw' | null = !gameEnded
    ? null
    : resigned
      ? 'defeat'
      : game.isCheckmate()
        ? (game.turn() === 'b' ? 'victory' : 'defeat')
        : 'draw';

  // Verdict sound when the game-over modal appears.
  useEffect(() => {
    if (!showGameOverModal || !gameOutcome) return;
    playUiSound(gameOutcome === 'victory' ? 'win' : gameOutcome === 'defeat' ? 'lose' : 'confirm');
  }, [showGameOverModal, gameOutcome]);

  useEffect(() => {
    if (!gameEnded || analysisStartedRef.current) return;
    if (!history.length && !resigned) return;
    analysisStartedRef.current = true;
    setAnalysisPending(true);
    const userMoveCount = Math.max(1, history.filter((move) => move.color === 'w').length);
    // Keep roughly the same total engine budget as the old first-20-moves
    // analysis while grading the complete game. Short games retain the full
    // 300 ms search; longer games use a smaller per-position slice.
    const analysisMoveTimeMs = Math.max(160, Math.min(300, Math.round(12_000 / (userMoveCount * 2))));
    void analyzeGame(history, game.fen(), async (fen) => {
      // Analysis grades at full engine strength regardless of the level the game
      // was played at, capturing the evaluation so accuracy reflects how much each
      // move changed the position rather than just whether it matched the top move.
      const result = await stockfishEngine.analyzePosition(fen, analysisMoveTimeMs, 20);
      return { bestSan: result.bestMove?.san ?? null, whiteCp: result.whiteCp };
    }).then((summary) => {
      setAnalysis(summary);
      setAnalysisPending(false);
      if (userIdentity) {
        void chessConvai.rememberGameSummary(coach, buildLongTermGameMemory(summary, difficulty));
      }
    });
  }, [coach, difficulty, userIdentity, game, history, gameEnded]);

  useEffect(() => {
    if (!gameEnded || gameOverHandledRef.current) return;
    gameOverHandledRef.current = true;
    let cancelled = false;
    void (async () => {
      if (resigned && history.length === 0) {
        chessConvai.interruptBot(coach);
        if (!cancelled) setShowGameOverModal(true);
        return;
      }
      const gameOverInfo = buildGameOverDynamicInfo(game, coach, difficulty, resigned);
      const spoken = await chessConvai.speakGameOver(coach, gameOverInfo);
      if (cancelled) return;
      if (spoken) setCoachLine(spoken);
      if (!cancelled) setShowGameOverModal(true);
    })();
    return () => { cancelled = true; };
  }, [coach, difficulty, game, gameEnded, history.length, resigned]);

  useEffect(() => {
    const wasThinking = prevThinkingRef.current;
    prevThinkingRef.current = thinking;
    if (wasThinking && !thinking && !gameEnded && game.turn() === 'w') {
      playUiSound('yourTurn');
      setYourTurnPulse(true);
      const timer = window.setTimeout(() => setYourTurnPulse(false), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [thinking, game, gameEnded]);

  function persistCurrentSession(
    currentGame: Chess,
    moves: MoveSnapshot[],
    hintCount: number,
    selectedCoachId: CoachId,
    selectedDifficultyId: DifficultyId,
    currentAnalysis: AnalysisSummary | null,
  ) {
    const now = new Date().toISOString();
    saveSession({
      id: sessionIdRef.current,
      createdAt: moves[0]?.fenBefore ? sessionIdRef.current.split('-').slice(1, 2)[0] ?? now : now,
      updatedAt: now,
      mode: 'quick-play',
      coachId: selectedCoachId,
      difficultyId: selectedDifficultyId,
      result: resultLabel(currentGame, coach.name, resigned),
      finalFen: currentGame.fen(),
      hintsUsed: hintCount,
      moves,
      analysis: currentAnalysis ?? undefined,
    });
  }

  async function resetGame() {
    cancelPendingCoachMove();
    const newSessionId = createSessionId();
    sessionIdRef.current = newSessionId;
    analysisStartedRef.current = false;
    gameOverHandledRef.current = false;
    // resetGame drives its own welcome below. Mark it claimed before state
    // updates render, otherwise the general late-ready effect can start a
    // second greeting concurrently.
    welcomeSpokenRef.current = true;
    lateWelcomeReconnectAttemptedRef.current = false;
    setWelcomeDelivered(false);
    spokenReasonsRef.current.clear();
    const freshGame = new Chess();
    setGame(freshGame);
    setSelected(null);
    setHistory([]);
    setThinking(false);
    setBoardThinking(false);
    setCoachLine('');
    setConversationMessages([]);
    setHintText('');
    setHintLevel(0);
    setHintsUsed(0);
    setAnalysis(null);
    setAnalysisPending(false);
    setCoachResponding(false);
    setResigned(false);
    setShowResignConfirm(false);
    setShowGameOverModal(false);
    setShowAnalysis(false);
    setSelectedMoveIdx(null);
    setCoachGuidance('');
    setGuidanceLoading(false);

    const openingInfo = addStudentContext(buildDynamicCoachInfo(freshGame, null, null, coach, difficulty), userIdentity);
    const welcomeInfo = addStudentContext(buildWelcomeDynamicInfo(freshGame, coach, difficulty, newSessionId), userIdentity);
    const spoken = await chessConvai.beginNewGame(
      coach,
      difficulty,
      newSessionId,
      openingInfo,
      userIdentity,
      welcomeInfo,
    );
    setWelcomeDelivered(true);
    // An empty welcome means the greeting turn died server-side (empty LLM
    // response even after the internal retry). Show a canned greeting so the
    // coach isn't just silently staring at the student.
    setCoachLine(spoken || `Welcome! I'm ${coach.name} — you have the white pieces, so make your first move whenever you're ready.`);
  }

  function makePlayerMove(from: Square, to: Square) {
    if (!sessionStarted) return false;
    const next = new Chess(game.fen());
    const fenBefore = next.fen();
    const move = next.move({ from, to, promotion: 'q' });
    if (!move) return false;
    const record = toRecord(move, 'You', fenBefore, next.fen());
    debugLog('App', `Player move: ${move.san} (${from}→${to}) moveNo=${Number(next.fen().split(' ')[5])} fen="${next.fen()}"`);

    setGame(next);
    chessConvai.refreshBoardVision(coach, next.fen());
    setHistory((moves) => [...moves, record]);
    setSelected(null);
    setHintText('');
    setHintLevel(0);

    if (!next.isGameOver()) {
      const moveSequence = ++moveSequenceRef.current;
      // A first move is stronger intent than a late greeting. Let the board
      // win and prevent a delayed welcome from overwriting move commentary.
      if (!welcomeDelivered) {
        welcomeSpokenRef.current = true;
        setWelcomeDelivered(true);
      }
      chessConvai.interruptBot(coach);
      setThinking(true);
      setBoardThinking(true);
      void makeCoachMove(next.fen(), move, [...history, record], moveSequence, performance.now()).catch((error) => {
        if (moveSequence !== moveSequenceRef.current) return;
        debugLog('makeCoachMove', 'Coach move preparation failed:', error);
        setThinking(false);
        setBoardThinking(false);
      });
    }
    return true;
  }

  async function makeCoachMove(
    fen: string,
    playerMove: Move | undefined,
    moveHistory: MoveRecord[],
    moveSequence: number,
    turnStartedAt: number,
  ) {
    const next = new Chess(fen);
    const engineMove = await stockfishEngine.bestMove(next.fen(), difficulty.moveTimeMs, difficulty.stockfishSkill);
    if (moveSequence !== moveSequenceRef.current) return;
    // Board focus belongs only to the engine calculation. Response generation,
    // audio playback and lip-sync tail all face the player.
    setBoardThinking(false);
    // Skill-limited Stockfish can skip an obvious recapture (reads broken,
    // not weak) — the guard swaps in the safe recapture when that happens.
    const planned = guardObviousRecapture(next, engineMove, playerMove);
    if (planned !== engineMove) {
      debugLog('makeCoachMove', `recapture guard overrode ${engineMove?.san ?? 'none'} → ${planned?.san ?? 'none'}`);
    }
    const fullMoveNo = Number(next.fen().split(' ')[5]);
    const recentTopics = recentlySpokenTopics(spokenReasonsRef.current, fullMoveNo);
    const dynamicInfo = buildDynamicCoachInfo(next, planned, playerMove, coach, difficulty, moveHistory, recentTopics);
    if (!planned) {
      setThinking(false);
      setBoardThinking(false);
      return;
    }
    const fenBefore = next.fen();
    const appliedMove = next.move(planned);
    if (!appliedMove) {
      setThinking(false);
      setBoardThinking(false);
      return;
    }
    const coachRecord = toRecord(appliedMove, coach.name, fenBefore, next.fen());
    const postMoveFen = next.fen();
    const guard = () => moveSequence === moveSequenceRef.current;
    const staticPolicy = buildCoachInstruction(coach, difficulty, 'move');
    const speech = coachingControlMode === 'game'
      ? analyzeCoachMoveContext(new Chess(fen), planned, playerMove, difficulty, moveHistory)
      : null;
    const suppression = speech
      ? applyRepeatSuppression(speech, spokenReasonsRef.current, fullMoveNo)
      : null;
    const shouldSpeak = coachingControlMode === 'coach' || Boolean(suppression?.shouldSpeak);
    debugLog(
      'makeCoachMove',
      coachingControlMode === 'coach'
        ? `[coach-decides] speech-before-move moveNo=${fullMoveNo} fen="${postMoveFen}"`
        : `[game-decides] speech=${shouldSpeak ? 'yes' : 'no'} reason=${speech?.reason ?? 'none'} moveNo=${fullMoveNo}`,
    );

    const result = await sequenceCoachMove({
      shouldSpeak,
      isCurrent: guard,
      speak: async () => {
        await chessConvai.seedStaticCoachPolicy(coach, staticPolicy);
        if (!guard()) return '';
        return chessConvai.runCoachTurn(coach, dynamicInfo, {
          runLlm: coachingControlMode === 'coach' ? 'auto' : 'true',
          waitForFullSpeech: true,
          preflightSilence: coachingControlMode === 'coach',
          maxWaitMs: 18000,
          guard,
        });
      },
      commit: () => {
        debugLog('App', `Coach move applied after speech: ${appliedMove.san} (${appliedMove.from}→${appliedMove.to}) moveNo=${Number(next.fen().split(' ')[5])} fen="${postMoveFen}"`);
        setGame(next);
        chessConvai.refreshBoardVision(coach, postMoveFen);
        setHistory((moves) => [...moves, coachRecord]);
        setThinking(false);
        setBoardThinking(false);
        const coachMoveMs = performance.now() - turnStartedAt;
        document.documentElement.dataset.coachMoveMs = coachMoveMs.toFixed(1);
        debugLog('Performance', `Coach move visible after speech in ${Math.round(coachMoveMs)}ms`);
      },
      onSpeechError: (error) => debugLog('makeCoachMove', 'Move speech failed; applying move safely:', error),
    });
    if (!result.committed) return;

    const spoken = result.spoken || '';
    if (shouldSpeak && DATASET_TOOLS_ENABLED) {
      setLastExchange({
        timestamp: new Date().toISOString(),
        coachId: coach.id,
        coachName: coach.name,
        difficultyId: difficulty.id,
        fen: postMoveFen,
        dynamicInfo,
        prompt: '',
        coachResponse: spoken,
        wasSilent: !spoken,
      });
    }
    if (coachingControlMode === 'coach') {
      setCoachLine(spoken);
    } else if (spoken && speech) {
      setCoachLine(spoken);
      for (const reason of speech.reasons) spokenReasonsRef.current.set(reason, fullMoveNo);
    }

    if (!shouldSpeak) {
      const afterReplyInfo = buildDynamicCoachInfo(
        next,
        null,
        appliedMove,
        coach,
        difficulty,
        [...moveHistory, coachRecord],
        recentTopics,
      );
      void chessConvai.seedStaticCoachPolicy(coach, staticPolicy)
        .then(() => (guard() ? chessConvai.updateCoachContext(coach, afterReplyInfo) : undefined))
        .catch((error) => debugLog('makeCoachMove', 'Silent move context update failed:', error));
    }
  }

  function handleSquareClick(square: Square) {
    if (!sessionStarted) return;
    chessConvai.unlockAudio();
    if (thinking || gameEnded || game.turn() !== 'w') return;
    const piece = game.get(square);
    if (selected) {
      if (selected === square) {
        setSelected(null);
        return;
      }
      if (piece?.color === 'w') {
        // King-then-rook castling gesture (the common chess-site convention):
        // clicking your own rook while the king is selected castles to that
        // side instead of re-selecting the rook. The two-square king move
        // (E1→G1/C1) works as well via the normal path below.
        if (game.get(selected)?.type === 'k' && piece.type === 'r') {
          const castle = game
            .moves({ square: selected, verbose: true })
            .find((m) => (m.flags.includes('k') && square === 'h1') || (m.flags.includes('q') && square === 'a1'));
          if (castle && makePlayerMove(selected, castle.to)) return;
        }
        setSelected(square);
        return;
      }
      if (makePlayerMove(selected, square)) return;
      return;
    }
    if (piece?.color === 'w') setSelected(square);
  }

  async function askHint() {
    if (thinking || game.isGameOver() || game.turn() !== 'w') return;
    setCoachResponding(true);
    const nextLevel = Math.min(3, hintLevel + 1);
    setHintLevel(nextLevel);
    setHintsUsed((count) => count + 1);
    const best = await stockfishEngine.bestMove(game.fen(), 520, Math.max(10, difficulty.stockfishSkill));
    const localHint = buildHintText(nextLevel, best, coach.name);
    setHintText(localHint);
    const dynamicInfo = buildDynamicCoachInfo(game, best, lastMove ? moveRecordToMoveLike(lastMove) : null, coach, difficulty);
    await chessConvai.seedStaticCoachPolicy(coach, buildCoachInstruction(coach, difficulty, 'hint'));
    const prompt = [
      `The student asked for hint level ${nextLevel} of 3.`,
      nextLevel < 3 ? 'Do not reveal the exact move.' : `You may reveal this move naturally: ${best?.san ?? 'the best move'}.`,
      localHint,
      'Use 1-2 useful teaching sentences.',
    ].join(' ');
    const spoken = await chessConvai.speakCoachMessage(coach, prompt, dynamicInfo);

    if (DATASET_TOOLS_ENABLED) {
      setLastExchange({
        timestamp: new Date().toISOString(),
        coachId: coach.id,
        coachName: coach.name,
        difficultyId: difficulty.id,
        fen: game.fen(),
        dynamicInfo,
        prompt,
        coachResponse: spoken || '',
        wasSilent: !spoken,
      });
    }

    if (spoken) setCoachLine(spoken);
    setCoachResponding(false);
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || thinking) return;
    unlockUiAudio();
    playUiSound('send');
    appendConversationMessage('user', text);
    setChatInput('');
    setCoachResponding(true);
    const dynamicInfo = addStudentContext(
      buildDynamicCoachInfo(
        game,
        null,
        lastMove ? moveRecordToMoveLike(lastMove) : null,
        coach,
        difficulty,
        history,
      ),
      userIdentity,
    );
    let spoken = '';
    try {
      spoken = await chessConvai.sendUserChat(
        coach,
        difficulty,
        text,
        dynamicInfo,
        game.fen(),
      );
    } catch {
      setCoachLine("Sorry — I couldn't answer that just now. Ask me again?");
      setCoachResponding(false);
      return;
    }

    if (DATASET_TOOLS_ENABLED) {
      setLastExchange({
        timestamp: new Date().toISOString(),
        coachId: coach.id,
        coachName: coach.name,
        difficultyId: difficulty.id,
        fen: game.fen(),
        dynamicInfo: `${buildCoachInstruction(coach, difficulty, 'chat')} ${dynamicInfo}`,
        prompt: `Student question: "${text}". Please answer as the chess coach using the current board context.`,
        coachResponse: spoken || '',
        wasSilent: !spoken,
      });
    }

    if (spoken) {
      setCoachLine(spoken);
    } else {
      // The turn died server-side (empty LLM response even after the
      // reconnect-and-resend). Say so instead of leaving the student staring
      // at a thinking chip that resolves into silence.
      setCoachLine("Sorry — I lost my train of thought there. Ask me that again?");
    }
    setCoachResponding(false);
  }

  async function askAboutMove(moveIdx: number) {
    const move = history[moveIdx];
    if (!move || guidanceLoading) return;
    setGuidanceLoading(true);
    setCoachGuidance('');

    const moveNumber = Math.ceil((moveIdx + 1) / 2);
    const km = analysis?.keyMoments.find((m) => m.moveNumber === moveNumber && move.color === 'w');
    const quality = km ? km.label.toLowerCase() : (move.color === 'w' ? 'solid' : 'opponent');
    const studentMove = move.color === 'w';
    const moveOwner = studentMove
      ? 'you, the student playing White'
      : `I, ${coach.name}, playing Black`;

    const dynamicCtx = [
      `FEN before the move: ${move.fenBefore}`,
      `Move ${moveNumber}: ${moveOwner} played ${move.san}.`,
      studentMove
        ? 'Pronoun rule for this review: say "you/your" for the side that made this move.'
        : 'Pronoun rule for this review: say "I/my" for the side that made this move; do not call it the student\'s move.',
      quality !== 'opponent' && quality !== 'solid' ? `This was classified as a ${quality}.` : '',
      km?.bestMove ? `Stockfish preferred ${km.bestMove} in this position.` : '',
      km?.description ?? '',
    ].filter(Boolean).join(' ');

    const promptSubject = studentMove ? 'your move' : 'my move';
    const prompt = quality === 'solid' || quality === 'opponent'
      ? `In 2 sentences, explain what makes ${promptSubject} ${move.san} on move ${moveNumber} a reasonable choice and what chess principle it follows.`
      : `In 2-3 sentences, explain concretely why ${promptSubject} ${move.san} on move ${moveNumber} was a ${quality}${km?.bestMove ? ` and what makes ${km.bestMove} stronger` : ''}.`;

    await chessConvai.seedStaticCoachPolicy(coach, buildCoachInstruction(coach, difficulty, 'move'));
    const spoken = await chessConvai.speakCoachMessage(coach, prompt, dynamicCtx);
    if (spoken) {
      setCoachLine(spoken);
      setCoachGuidance(spoken);
    }
    setGuidanceLoading(false);
  }

  const selectedBoardGame = useMemo(() => {
    if (selectedMoveIdx === null || !history[selectedMoveIdx]) return null;
    return new Chess(history[selectedMoveIdx].fenAfter);
  }, [selectedMoveIdx, history]);

  if (showAnalysis) {
    const movePairs = buildMovePairs(history);
    const errorMap = buildErrorMap(analysis?.keyMoments ?? []);
    const hasAnalysisScore = Boolean(
      analysis
      && (analysis.scoringModel !== 'critical-v1' || (analysis.gradedMoves ?? 0) > 0),
    );
    const reviewMove = selectedMoveIdx !== null
      ? history[selectedMoveIdx]
      : history[history.length - 1];
    const reviewGame = selectedBoardGame ?? game;
    const reviewMoveNumber = selectedMoveIdx !== null
      ? Math.ceil((selectedMoveIdx + 1) / 2)
      : null;

    return (
      <main
        className="game-screen"
        data-screen="analysis"
        data-screen-state={analysisPending ? 'pending' : 'ready'}
      >

        <header className="topbar">
          <button className="analysis-menu-action" onClick={requestLeaveToMenu}>
            <MenuIcon aria-hidden="true" />
            <span>Menu</span>
          </button>
          <h1>Post-Game Analysis</h1>
          <div className="topbar-actions">
            <button className="ghost-action" onClick={() => setShowAnalysis(false)} title="Back to game" aria-label="Back to game">
              <ArrowLeft aria-hidden="true" />
              <span>Back</span>
            </button>
            <button className="ghost-action" onClick={resetGame} aria-label="New game">
              <RotateCcw aria-hidden="true" />
              <span>New Game</span>
            </button>
          </div>
        </header>

        <div className="app-shell analysis-shell">
          <CoachCard
            coach={coach}
            status={status}
            lastLine={coachLine}
            messages={conversationMessages}
            onAddToDataset={DATASET_TOOLS_ENABLED ? openSaveModal : undefined}
            chatOpen={chatOpen}
            showEmptyConversation
            chatInput={chatInput}
            chatBusy={coachResponding}
            onChatInputChange={setChatInput}
            onChatSend={() => void sendChat()}
            mic={<MicButton className="coach-mic-btn" />}
          />

          <section className="analysis-board-stage" aria-label="Position review board">
            <div className="analysis-board-heading">
              <p className="eyebrow">Review Board</p>
              <h2>{reviewMoveNumber ? `Move ${reviewMoveNumber}: ${reviewMove?.san ?? ''}` : 'Final position'}</h2>
              <p>{reviewMoveNumber ? 'This is the position after the selected move.' : 'Select a move in the report to review that position.'}</p>
            </div>
            <ChessBoard
              className="analysis-review-board"
              game={reviewGame}
              lastMove={reviewMove ? { from: reviewMove.from, to: reviewMove.to } : null}
              disabled
            />
            <p className="analysis-board-hint">The highlighted squares show the latest move.</p>
          </section>

          <div className="analysis-panel invisible-scroll">

            <div className="analysis-header">
              <div className="analysis-result-mark" aria-hidden="true">
                <ScanSearch />
              </div>
              <div className="analysis-header-copy">
                <h2>{resultLabel(game, coach.name, resigned)}</h2>
                <p className="analysis-meta">
                  {analysis?.opening ?? 'Identifying opening…'} · {Math.ceil(history.length / 2)} move{Math.ceil(history.length / 2) !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Performance */}
            <section className="analysis-section" data-analysis-section="performance">
              <p className="eyebrow">Your Performance</p>
              {analysisPending && <p className="muted-text">Stockfish is reviewing your moves…</p>}
              {analysis && (
                <div className="perf-grid">
                  <div className="perf-card">
                    <div className="perf-score">{hasAnalysisScore ? `${analysis.whiteAccuracy}%` : '—'}</div>
                    <div className="perf-label">Critical accuracy</div>
                    <div className="perf-desc">
                      {hasAnalysisScore
                        ? describeAccuracy(analysis.whiteAccuracy)
                        : 'Not enough engine data to calculate a score'}
                    </div>
                    {hasAnalysisScore && typeof analysis.averageCentipawnLoss === 'number' && (
                      <div className="perf-desc">Average loss: {analysis.averageCentipawnLoss} cp</div>
                    )}
                    {hasAnalysisScore && typeof analysis.gradedMoves === 'number' && typeof analysis.totalUserMoves === 'number' && (
                      <div className="perf-desc">Graded {analysis.gradedMoves} of {analysis.totalUserMoves} moves</div>
                    )}
                  </div>
                  <div className="perf-card">
                    <div className="error-badges">
                      {analysis.blunders > 0 && <span className="err-badge blunder">{analysis.blunders} blunder{analysis.blunders > 1 ? 's' : ''}</span>}
                      {analysis.mistakes > 0 && <span className="err-badge mistake">{analysis.mistakes} mistake{analysis.mistakes > 1 ? 's' : ''}</span>}
                      {analysis.inaccuracies > 0 && <span className="err-badge inaccuracy">{analysis.inaccuracies} inaccurac{analysis.inaccuracies > 1 ? 'ies' : 'y'}</span>}
                      {hasAnalysisScore && analysis.blunders === 0 && analysis.mistakes === 0 && analysis.inaccuracies === 0 && (
                        <span className="err-badge clean">Clean game</span>
                      )}
                    </div>
                    <div className="error-legend">
                      <span className="legend-item"><span className="err-dot blunder" />Blunder — a severe loss of winning chances or position value</span>
                      <span className="legend-item"><span className="err-dot mistake" />Mistake — a clear, consequential evaluation loss</span>
                      <span className="legend-item"><span className="err-dot inaccuracy" />Inaccuracy — a meaningful missed improvement</span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Move Timeline */}
            <section className="analysis-section" data-analysis-section="timeline">
              <p className="eyebrow">Move Timeline</p>
              <p className="section-hint">Click any move to review it — red = blunder, orange = mistake, yellow = inaccuracy</p>
              <div className="move-timeline">
                {movePairs.length === 0 && (
                  <div className="timeline-empty" role="status">
                    <span className="timeline-empty-rule" aria-hidden="true" />
                    <span>No moves were recorded before the game ended.</span>
                  </div>
                )}
                {movePairs.map(([w, b], pairIdx) => (
                  <div key={pairIdx} className="move-pair">
                    <span className="move-number-label">{pairIdx + 1}.</span>
                    {w && (
                      <button
                        className={`move-chip ${getChipClass(w.historyIdx, history, errorMap)} ${selectedMoveIdx === w.historyIdx ? 'selected' : ''}`}
                        onClick={() => { setSelectedMoveIdx(w.historyIdx); setCoachGuidance(''); }}
                      >
                        {w.san}
                      </button>
                    )}
                    {b && (
                      <button
                        className={`move-chip coach-chip ${selectedMoveIdx === b.historyIdx ? 'selected' : ''}`}
                        onClick={() => { setSelectedMoveIdx(b.historyIdx); setCoachGuidance(''); }}
                      >
                        {b.san}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Selected move detail */}
            {selectedMoveIdx !== null && selectedBoardGame && (() => {
              const move = history[selectedMoveIdx];
              const moveNumber = Math.ceil((selectedMoveIdx + 1) / 2);
              const km = analysis?.keyMoments.find((m) => m.moveNumber === moveNumber && move?.color === 'w');
              const quality = km ? km.label : (move?.color === 'w' ? 'Good' : null);
              return (
                <section className="analysis-section move-detail-section" data-analysis-section="move-detail">
                  <p className="eyebrow">Move {moveNumber} — {history[selectedMoveIdx]?.by}: {history[selectedMoveIdx]?.san}</p>
                  <div className="move-detail-layout">
                    <div className="mini-board-wrap">
                      <div className="mini-board-viewport">
                        <ChessBoard
                          className="mini-board-focus"
                          game={selectedBoardGame}
                          lastMove={move ? { from: move.from, to: move.to } : null}
                          style={move ? miniBoardFocusStyle(move) : undefined}
                        />
                      </div>
                    </div>
                    <div className="move-detail-info">
                      {km ? (
                        <div className={`moment-info ${km.label.toLowerCase()}`}>
                          <strong>{km.label}</strong> — {km.description}
                          {km.bestMove && <p className="better-move">Better: <code>{km.bestMove}</code></p>}
                        </div>
                      ) : quality === 'Good' ? (
                        <div className="moment-info good">
                          <strong>Good move</strong> — no better option found by Stockfish in this position
                        </div>
                      ) : null}
                      <div className="guidance-area">
                        {coachGuidance ? (
                          <p className="coach-guidance-text">{coachGuidance}</p>
                        ) : guidanceLoading ? (
                          <p className="muted-text">{coach.name} is analyzing this position…</p>
                        ) : (
                          <button className="primary-action" onClick={() => void askAboutMove(selectedMoveIdx)}>
                            Ask {coach.name} about this move
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Key Moments */}
            {analysis && analysis.keyMoments.length > 0 && (
              <section className="analysis-section" data-analysis-section="moments">
                <p className="eyebrow">Key Moments</p>
                {analysis.keyMoments.map((km, idx) => {
                  const mIdx = history.findIndex((m, i) => m.color === 'w' && Math.ceil((i + 1) / 2) === km.moveNumber);
                  return (
                    <div
                      key={idx}
                      className={`moment-item ${km.label.toLowerCase()}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => { if (mIdx !== -1) { setSelectedMoveIdx(mIdx); setCoachGuidance(''); }}}
                      onKeyDown={(e) => { if (e.key === 'Enter' && mIdx !== -1) { setSelectedMoveIdx(mIdx); setCoachGuidance(''); }}}
                    >
                      <div className="moment-header">
                        <span className={`moment-badge ${km.label.toLowerCase()}`}>{km.label}</span>
                        <span className="moment-movenumber">Move {km.moveNumber}</span>
                      </div>
                      <p>{km.description}</p>
                      {km.bestMove && <p className="better-move">Better: <code>{km.bestMove}</code></p>}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Coach Tips */}
            {analysis && analysis.tips.length > 0 && (
              <section className="analysis-section" data-analysis-section="tips">
                <p className="eyebrow">Coach's Tips for Next Time</p>
                <ul className="tips-list">
                  {analysis.tips.map((tip, idx) => <li key={idx}>{tip}</li>)}
                </ul>
              </section>
            )}

          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`game-screen${sessionStarted ? '' : ' is-game-ready'}`}
      data-screen="game"
      data-screen-state={sessionStarted ? 'active' : 'ready'}
    >

      <header className={`topbar game-navigation-rail${sessionStarted ? '' : ' game-ready-navigation'}`}>
        {sessionStarted ? (
          <>
            <button className="rail-menu-button" onClick={requestLeaveToMenu} aria-label="Back to ready screen">
              <ArrowLeft aria-hidden="true" />
              <small>Menu</small>
            </button>
            <nav className="rail-tools" aria-label="Game shortcuts">
              <button
                type="button"
                className="rail-tool"
                onClick={() => void askHint()}
                disabled={game.turn() !== 'w' || thinking || gameEnded}
                title="Ask for a hint"
                aria-label="Ask for a hint"
              >
                <Lightbulb aria-hidden="true" />
                <small>Hint</small>
              </button>
              <MoveListPanel history={history} />
              <button type="button" className="rail-tool" onClick={resetGame} title="Start a new game" aria-label="Start a new game">
                <RotateCcw aria-hidden="true" />
                <small>New</small>
              </button>
              <button
                type="button"
                className={`rail-tool rail-copy-logs${logsCopied ? ' is-active' : ''}`}
                onClick={() => void handleCopyLogs()}
                title="Copy session logs"
                aria-label={logsCopied ? 'Session logs copied' : 'Copy session logs'}
              >
                {logsCopied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
                <small>{logsCopied ? 'Copied' : 'Logs'}</small>
              </button>
              <DeveloperOptions coachId={coach.id} />
              <button
                type="button"
                className="rail-tool rail-tool-danger"
                onClick={() => { if (!gameEnded) setShowResignConfirm(true); }}
                disabled={gameEnded}
                title="Resign game"
                aria-label="Resign game"
              >
                <Flag aria-hidden="true" />
                <small>Resign</small>
              </button>
            </nav>
          </>
        ) : (
          <>
            <button className="rail-menu-button game-ready-more-button" onClick={() => setShowReadyMore(true)} aria-label="More options">
              <MenuIcon aria-hidden="true" />
              <small>More</small>
            </button>
            <nav className="rail-tools game-ready-rail-tools" aria-label="Ways to play">
              <button type="button" className="rail-tool" onClick={onPuzzles} aria-label="Open tactics">
                <BookOpen aria-hidden="true" />
                <small>Tactics</small>
              </button>
              <button type="button" className="rail-tool" onClick={onGames} aria-label="Open game library">
                <Library aria-hidden="true" />
                <small>Games</small>
              </button>
              <button type="button" className="rail-tool" onClick={onOpenSettings} aria-label="Open game settings">
                <SlidersHorizontal aria-hidden="true" />
                <small>Settings</small>
              </button>
              <DeveloperOptions coachId={coach.id} />
            </nav>
          </>
        )}
        {!sessionStarted && <div className="game-ready-auth">{authSlot}</div>}
        <div className="topbar-actions"><span>{difficulty.label}</span></div>
      </header>

      <button
        type="button"
        className="mobile-menu-trigger"
        onClick={() => setShowMobileMenu(true)}
        aria-label="Open game menu"
        aria-haspopup="dialog"
        aria-expanded={showMobileMenu}
      >
        <span className="mobile-menu-mark" aria-hidden="true">
          <i /><i /><i />
        </span>
      </button>

      <MobileGameDrawer
        open={showMobileMenu}
        sessionStarted={sessionStarted}
        coachId={coach.id}
        logsCopied={logsCopied}
        creatorEnabled={creatorEnabled}
        authSlot={authSlot}
        onClose={() => setShowMobileMenu(false)}
        onMenu={requestLeaveToMenu}
        onHint={() => void askHint()}
        onNewGame={resetGame}
        onCopyLogs={() => void handleCopyLogs()}
        onResign={() => { if (!gameEnded) setShowResignConfirm(true); }}
        onTactics={onPuzzles}
        onGames={onGames}
        onCreator={onCreator}
        onSettings={onOpenSettings}
      />

      <div className="app-shell">
        <CoachCard
          coach={coach}
          status={status}
          previewMode={!sessionStarted}
          lastLine={sessionStarted ? (coachLine || hintText) : idleInvite}
          messages={sessionStarted ? conversationMessages : []}
          onAddToDataset={sessionStarted && DATASET_TOOLS_ENABLED ? openSaveModal : undefined}
          chatOpen={chatOpen}
          chatInput={chatInput}
          chatBusy={coachResponding || thinking}
          boardThinking={boardThinking}
          playerWon={gameOutcome === 'victory'}
          onChatInputChange={setChatInput}
          onChatSend={() => void sendChat()}
          onResign={sessionStarted && !gameEnded ? () => setShowResignConfirm(true) : undefined}
          onMenu={() => setShowMobileMenu(true)}
          mic={<MicButton className="coach-mic-btn" />}
        />

        <section className={`game-stage${yourTurnPulse ? ' your-turn-pulse' : ''}`} aria-label="Chess board">
          <ChessBoard
            game={game}
            disabled={!sessionStarted}
            selected={selected}
            legalMoves={legalMoves}
            lastMove={lastMove}
            checkSquare={game.inCheck() ? kingSquareOf(game, game.turn()) : null}
            onSquareClick={handleSquareClick}
          />
          {!sessionStarted && (
            <div className="game-ready-stage-overlay" aria-label="Game ready to start">
              <ReadyStartCard
                hasMoves={history.length > 0}
                coachName={coach.name}
                difficultyLabel={difficulty.label}
                onStart={onStartGame}
                onSettings={onOpenSettings}
              />
            </div>
          )}
        </section>

        {sessionStarted && <aside className="side-panel mobile-game-state" aria-label="Game controls">
          <div className="panel-card turn-card">
            <ScrollWhenClipped className="turn-card-body">
              <p className="eyebrow">Game State</p>
              <h2>{game.turn() === 'w' ? 'Your move' : `${coach.name} to move`}</h2>
              <p>{getStatus(game, coach.name)}</p>
              {hintText && <p className="hint-text">{hintText}</p>}
              <button
                className="primary-action"
                onClick={() => void askHint()}
                disabled={game.turn() !== 'w' || thinking || gameEnded}
              >
                Ask Hint {hintLevel ? `(${hintLevel}/3)` : ''}
              </button>
              <button className="ghost-action" onClick={resetGame}>New game</button>
              <button
                className="ghost-action danger-action"
                onClick={() => { if (!gameEnded) setShowResignConfirm(true); }}
                disabled={gameEnded}
              >
                Resign
              </button>
            </ScrollWhenClipped>
          </div>
        </aside>}
      </div>

      {!sessionStarted && (
        <div className="game-ready-mobile-start" aria-label="Game ready to start">
          <ReadyStartCard
            hasMoves={history.length > 0}
            coachName={coach.name}
            difficultyLabel={difficulty.label}
            onStart={onStartGame}
            onSettings={onOpenSettings}
          />
        </div>
      )}

      <ReadyMoreMenu
        open={showReadyMore}
        onClose={() => setShowReadyMore(false)}
        onTactics={onPuzzles}
        onGames={onGames}
        onCreator={onCreator}
        creatorEnabled={creatorEnabled}
        onSettings={onOpenSettings}
      />

      {showGameOverModal && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
          {gameOutcome === 'victory' && <ConfettiBurst count={90} />}
          <div className={`gameover-modal${gameOutcome ? ` is-${gameOutcome}` : ''}`}>
            <div className="gameover-ornament" aria-hidden="true">
              {gameOutcome === 'victory' ? '♔' : gameOutcome === 'defeat' ? '♚' : '½'}
            </div>
            <div className="gameover-result" id="gameover-title">{resultLabel(game, coach.name, resigned)}</div>
            <p className="gameover-status">{resigned ? `You resigned. ${coach.name} wins.` : getStatus(game, coach.name)}</p>
            <div className="gameover-actions">
              <button
                className="primary-action"
                onClick={() => { setShowGameOverModal(false); setShowAnalysis(true); }}
              >
                <span className="gameover-action-main">
                  <ScanSearch aria-hidden="true" />
                  <span>View Analysis</span>
                </span>
                <ArrowRight className="gameover-action-arrow" aria-hidden="true" />
              </button>
              <button
                className="ghost-action"
                onClick={() => { setShowGameOverModal(false); resetGame(); }}
              >
                <RotateCcw aria-hidden="true" />
                <span>New Game</span>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showLeaveConfirm && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="gameover-modal">
            <div className="gameover-result" id="leave-title">Leave this game?</div>
            <p className="gameover-status">
              Your game is saved — continue it from the Game Library whenever you like.
            </p>
            <div className="gameover-actions">
              <button
                className="ghost-action"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Keep Playing
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  cancelPendingCoachMove();
                  setShowLeaveConfirm(false);
                  clickBack(onBackToReady);
                }}
              >
                Leave Game
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showResignConfirm && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="resign-title">
          <div className="gameover-modal">
            <div className="gameover-result" id="resign-title">Resign?</div>
            <p className="gameover-status">{coach.name} will be credited with the win.</p>
            <div className="gameover-actions">
              <button
                className="ghost-action"
                onClick={() => setShowResignConfirm(false)}
              >
                Keep Playing
              </button>
              <button
                className="primary-action danger-action"
                onClick={() => {
                  cancelPendingCoachMove();
                  setShowResignConfirm(false);
                  setResigned(true);
                }}
              >
                Resign
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}


      {DATASET_TOOLS_ENABLED && toastMessage && (
        <div className="toast-notification" role="status" aria-live="polite">
          <span>{toastMessage}</span>
        </div>
      )}

      {DATASET_TOOLS_ENABLED && showSaveModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dataset-save-title">
          <div className="save-modal">
            <h2 id="dataset-save-title">Add Dialogue to Dataset</h2>
            <p className="save-modal-sub">
              Mark whether the coach should have spoken in this situation so the dataset reflects the ideal behaviour.
            </p>
            <label className="save-modal-field">
              <span>Expected response</span>
              <select
                value={selectedExpected}
                onChange={(event) => setSelectedExpected(event.target.value as 'silent' | 'talk')}
              >
                <option value="silent">Silent</option>
                <option value="talk">Talk</option>
              </select>
            </label>
            <div className="save-modal-actions">
              <button className="ghost-action" onClick={() => setShowSaveModal(false)}>
                Cancel
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  void handleAddToDataset(selectedExpected);
                  setShowSaveModal(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;

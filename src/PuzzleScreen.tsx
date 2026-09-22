import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { resolveConvaiConnectionEndUserId, type UserIdentity } from './auth';
import { getCoach, getDifficulty, type CoachId, type DifficultyId } from './coachConfig';
import { legalTargets } from './chessAi';
import { clickBack, playUiSound, unlockUiAudio } from './uiSounds';
import Tooltip from './Tooltip';
import { chessConvai } from './convaiManager';
import { debugLog } from './debugLog';
import CoachCard from './CoachCard';
import MicButton from './MicButton';
import LoadingScreen from './LoadingScreen';
import { PUZZLES, puzzleScore } from './puzzles';
import {
  loadPuzzleProgress,
  markPuzzleCompleted,
  resetPuzzleProgress,
} from './storage';
import { ChessBoard, kingSquareOf } from './ChessBoard';
import { ConfettiBurst } from './Celebration';
import { normalizeSan } from './chessHelpers';

/** How long the solved celebration shows before auto-advancing. */
const AUTO_ADVANCE_MS = 2600;

const PUZZLE_GROUP_SIZE = 5;

/** Local visual-QA seam. The browser matrix must exercise every puzzle state
 * without opening a real Convai session or sending coaching traffic. This is
 * compiled out of production builds and does not alter player behavior. */
const VISUAL_QA_MODE = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('headless');

export default function PuzzleScreen({
  coachId,
  difficultyId,
  userIdentity,
  onBack,
}: {
  coachId: CoachId;
  difficultyId: DifficultyId;
  userIdentity: UserIdentity | null;
  onBack: () => void;
}) {
  const coach = getCoach(coachId);
  const allForDifficulty = useMemo(
    () => PUZZLES.filter((puzzle) => puzzle.difficultyId === difficultyId),
    [difficultyId],
  );
  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    // Prune ids that no longer exist in the puzzle set (the set has been
    // replaced wholesale before) so the progress counter never over-reports.
    const known = new Set(allForDifficulty.map((p) => p.id));
    return (loadPuzzleProgress()[difficultyId] ?? []).filter((id) => known.has(id));
  });

  function buildBatch(completed: string[]): string[] {
    const completedSet = new Set(completed);
    const fresh = allForDifficulty.filter((puzzle) => !completedSet.has(puzzle.id));
    return fresh.slice(0, PUZZLE_GROUP_SIZE).map((puzzle) => puzzle.id);
  }

  const [batchIds, setBatchIds] = useState<string[]>(() => buildBatch(completedIds));
  const [batchPos, setBatchPos] = useState(0);
  const [wrongInBatch, setWrongInBatch] = useState<string[]>([]);
  const [showIntro, setShowIntro] = useState(true);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewPos, setReviewPos] = useState(0);
  const [groupComplete, setGroupComplete] = useState(false);

  const activePuzzleId = reviewMode ? reviewIds[reviewPos] : batchIds[batchPos];
  const allDone = batchIds.length === 0;
  const fallbackPuzzle = allForDifficulty[0] ?? PUZZLES[0];
  const puzzle = useMemo(
    () => allForDifficulty.find((item) => item.id === activePuzzleId) ?? fallbackPuzzle,
    [allForDifficulty, activePuzzleId, fallbackPuzzle],
  );
  const [game, setGame] = useState(() => new Chess(puzzle.fen));
  const [selected, setSelected] = useState<Square | null>(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState('');
  const chatOpen = true;
  const [chatInput, setChatInput] = useState('');
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  /** Index into puzzle.solution of the NEXT expected player move. */
  const [solutionStep, setSolutionStep] = useState(0);
  /** True while a wrong attempt shows briefly before the board resets. */
  const [rewinding, setRewinding] = useState(false);
  /** Drives the board flash, verdict chip, and confetti. */
  const [verdict, setVerdict] = useState<'solved' | 'wrong' | null>(null);
  /** Points just earned — shown in the solved chip and the score-corner pop. */
  const [scorePop, setScorePop] = useState<{ amount: number; key: number } | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const replyTimerRef = useRef<number | null>(null);
  const rewindTimerRef = useRef<number | null>(null);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  /** Latest nextPuzzle — the auto-advance timer must not act on a stale closure. */
  const nextPuzzleRef = useRef<() => void>(() => {});
  const [coachReady, setCoachReady] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(10);
  const [loadingStep, setLoadingStep] = useState(`Loading ${coach.name}...`);
  const avatarReadyRef = useRef<boolean>(false);

  // Connect Convai coach on mount
  useEffect(() => {
    if (VISUAL_QA_MODE) {
      setLoadingProgress(100);
      setLoadingStep(`${coach.name} is ready.`);
      setCoachReady(true);
      return undefined;
    }
    debugLog('PuzzleScreen', `Mounting — connecting coach ${coach.name} (${coach.id})`);
    chessConvai.unlockAudio();
    void chessConvai.connectCoach(coach, {
      endUserId: resolveConvaiConnectionEndUserId(userIdentity),
      endUserMetadata: userIdentity?.endUserMetadata,
    }).then(() => {
      debugLog('PuzzleScreen', `connectCoach resolved for ${coach.name}`);
    });

    const unsub = chessConvai.onStatus((status) => {
      if (status.activeCoachId !== coach.id) return;
      debugLog('PuzzleScreen', `Status update — connecting=${status.connecting} connected=${status.connected} botReady=${status.botReady}`);
      if (status.botReady) {
        setLoadingProgress(100);
        setLoadingStep(`${coach.name} is ready.`);
        setCoachReady(true);
      } else if (status.connected) {
        setLoadingProgress(70);
        setLoadingStep(`Warming up ${coach.name}...`);
      } else if (status.connecting) {
        setLoadingProgress(40);
        setLoadingStep(`Connecting ${coach.name} to Convai...`);
      }
    });

    return () => {
      debugLog('PuzzleScreen', 'Unmounting — unsubscribing status listener');
      unsub();
    };
  }, [coach, userIdentity]);

  // Listen for AI text responses
  useEffect(() => {
    const unsub = chessConvai.onResponse((response) => {
      if (response.coachId !== coach.id) return;
      debugLog('PuzzleScreen', `AI response received (${response.text.length} chars): ${response.text.slice(0, 80)}`);
      setFeedback(response.text);
    });
    return unsub;
  }, [coach.id]);

  const ready = VISUAL_QA_MODE || (coachReady && avatarReady);

  useEffect(() => {
    debugLog('PuzzleScreen', `Loaded puzzle id="${puzzle.id}" title="${puzzle.title}" sideToMove=${puzzle.sideToMove} solution="${puzzle.solution.join(' ')}" fen="${puzzle.fen}"`);
    setGame(new Chess(puzzle.fen));
    setSelected(null);
    setHintsUsed(0);
    setFeedback('');
    setPuzzleSolved(false);
    setSolutionStep(0);
    setRewinding(false);
    setVerdict(null);
    setScorePop(null);
    setLastMove(null);
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    if (rewindTimerRef.current !== null) window.clearTimeout(rewindTimerRef.current);
    if (autoAdvanceTimerRef.current !== null) window.clearTimeout(autoAdvanceTimerRef.current);
  }, [puzzle, activePuzzleId, reviewMode]);

  useEffect(() => () => {
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    if (rewindTimerRef.current !== null) window.clearTimeout(rewindTimerRef.current);
    if (autoAdvanceTimerRef.current !== null) window.clearTimeout(autoAdvanceTimerRef.current);
  }, []);

  const legalMoves = useMemo(() => selected ? legalTargets(game.fen(), selected) : [], [game, selected]);

  function handleAvatarReady() {
    if (avatarReadyRef.current) return;
    avatarReadyRef.current = true;
    debugLog('PuzzleScreen', 'Avatar onReady fired');
    setAvatarReady(true);
    setLoadingProgress((p) => Math.max(p, 60));
  }

  async function handlePuzzleSquare(square: Square) {
    if (game.isGameOver() || puzzleSolved || rewinding) return;
    // Ignore clicks while the scripted opponent reply is pending (the side to
    // move is the opponent then, so selection below would refuse anyway).
    if (game.turn() !== puzzle.sideToMove) return;
    const piece = game.get(square);
    if (selected) {
      if (selected === square) {
        setSelected(null);
        return;
      }
      if (piece?.color === puzzle.sideToMove) {
        setSelected(square);
        return;
      }
      const expectedSan = puzzle.solution[solutionStep] ?? '';
      // If the expected move is a promotion, promote to ITS piece — there is
      // no promotion picker, and the old hardcoded queen made underpromotion
      // puzzles unsolvable.
      const promoMatch = /=([QRBN])/.exec(expectedSan);
      const promotion = (promoMatch ? promoMatch[1].toLowerCase() : 'q') as 'q' | 'r' | 'b' | 'n';
      const next = new Chess(game.fen());
      const move = next.move({ from: selected, to: square, promotion });
      if (!move) return;

      const normPlayed = normalizeSan(move.san);
      const normExpected = normalizeSan(expectedSan);
      const correct = normPlayed === normExpected;
      debugLog('PuzzleScreen', `Move attempted: played="${move.san}" expected="${expectedSan}" step=${solutionStep}/${puzzle.solution.length} correct=${correct} puzzle="${puzzle.id}"`);
      setGame(next);
      setSelected(null);
      setLastMove({ from: move.from, to: move.to });

      if (!correct) {
        setStreak(0);
        setVerdict('wrong');
        playUiSound('wrong');
        if (!reviewMode) {
          setWrongInBatch((prev) => prev.includes(puzzle.id) ? prev : [...prev, puzzle.id]);
        }
        const prompt = `The student made a wrong move in a puzzle (theme: ${puzzle.theme}). Give only a single short line flagging the mistake, for example: "Uh oh — not the best move there. Take another look." Do not reveal the correct answer. Do not explain the position. Keep it to one brief sentence.`;
        void chessConvai.speakCoachMessage(coach, prompt, `Puzzle theme: ${puzzle.theme}. Side to move: ${puzzle.sideToMove}.`);
        // Show the wrong move briefly, then rewind to the start of the puzzle
        // so the player can try the whole line again (it stays flagged for
        // review — retrying does not undo the miss).
        setRewinding(true);
        rewindTimerRef.current = window.setTimeout(() => {
          rewindTimerRef.current = null;
          setGame(new Chess(puzzle.fen));
          setSolutionStep(0);
          setRewinding(false);
          setVerdict(null);
          setLastMove(null);
        }, 1100);
        return;
      }

      const nextStep = solutionStep + 1;
      if (nextStep >= puzzle.solution.length) {
        // Line complete — score once for the whole puzzle.
        const earned = puzzleScore(hintsUsed, true);
        const bonus = hintsUsed === 0 && (streak + 1) % 5 === 0 ? 50 : 0;
        setScore((v) => v + earned + bonus);
        setStreak((v) => hintsUsed === 0 ? v + 1 : 0);
        debugLog('PuzzleScreen', `Puzzle solved — brief praise. bonus=${bonus}`);
        markPuzzleCompleted(difficultyId, puzzle.id);
        setCompletedIds((prev) => prev.includes(puzzle.id) ? prev : [...prev, puzzle.id]);
        setVerdict('solved');
        setScorePop({ amount: earned + bonus, key: Date.now() });
        playUiSound(bonus > 0 ? 'streak' : 'solve');
        const prompt = reviewMode
          ? `The student is revisiting a puzzle they got wrong. They just played the correct move (theme: ${puzzle.theme}). ${puzzle.explanation} Give one brief teaching sentence explaining why that move works. Do not say "great job" or generic praise — name the chess idea.`
          : `The student played the correct move in a puzzle (theme: ${puzzle.theme}). Give only a very short confirmation: 1-5 words max. For example: "Good eye.", "Exactly.", "That's it.", "Nice find." Do not explain the move unless this is a review session.`;
        void chessConvai.speakCoachMessage(coach, prompt, `Puzzle theme: ${puzzle.theme}. Side to move: ${puzzle.sideToMove}.`);
        setPuzzleSolved(true);
        setSolutionStep(nextStep);
        // Celebrate, then move on by itself — the Next Puzzle button still
        // works for anyone faster than the timer.
        autoAdvanceTimerRef.current = window.setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          nextPuzzleRef.current();
        }, AUTO_ADVANCE_MS);
        return;
      }

      // Multi-move line: play the scripted opponent reply after a beat, then
      // hand the position back to the player.
      const replySan = puzzle.solution[nextStep];
      const fenAfterPlayer = next.fen();
      setSolutionStep(nextStep);
      replyTimerRef.current = window.setTimeout(() => {
        replyTimerRef.current = null;
        const withReply = new Chess(fenAfterPlayer);
        const reply = withReply.move(replySan);
        if (!reply) {
          debugLog('PuzzleScreen', `BAD PUZZLE DATA: scripted reply "${replySan}" illegal after ${move.san} in ${puzzle.id}`);
          return;
        }
        setGame(withReply);
        setLastMove({ from: reply.from, to: reply.to });
        setSolutionStep(nextStep + 1);
      }, 650);
      return;
    }
    if (piece?.color === puzzle.sideToMove) setSelected(square);
  }

  async function askPuzzleHint() {
    const next = Math.min(3, hintsUsed + 1);
    setHintsUsed(next);
    debugLog('PuzzleScreen', `Hint requested — level ${next}`);
    const hintText = puzzle.hints[next - 1] ?? '';
    // Hint the move the player is actually stuck on (multi-move lines).
    const expectedSan = puzzle.solution[solutionStep] ?? puzzle.solution[0];
    const prompt = [
      `The student asked for hint level ${next} of 3. Puzzle theme: ${puzzle.theme}.`,
      next === 1 ? 'Give only a directional clue — point to a region of the board or type of move. Do not name the piece or square.' : '',
      next === 2 ? 'Name the tactical or strategic idea (for example: pin, fork, outpost, open file). Do not reveal the piece or destination square.' : '',
      next === 3 ? `Reveal the move. Use natural language only — no raw chess notation. Say the piece name and the target square using a capital letter for the file and a space before the rank number. For example: "Move your knight to F 3" or "Take with your bishop on E 5". The solution move in chess notation is ${expectedSan}.` : '',
      `Teaching context: ${hintText}`,
      'Give exactly 1-2 sentences. Do not pad with encouragement.',
    ].filter(Boolean).join(' ');
    void chessConvai.speakCoachMessage(coach, prompt, `Puzzle theme: ${puzzle.theme}. Side to move: ${puzzle.sideToMove}.`);
  }

  function startNextBatch(extraCompleted: string[] = []) {
    const updatedCompleted = Array.from(new Set([...completedIds, ...extraCompleted]));
    const nextBatch = buildBatch(updatedCompleted);
    debugLog('PuzzleScreen', `Starting next batch — fresh count=${nextBatch.length}`);
    setBatchIds(nextBatch);
    setBatchPos(0);
    setWrongInBatch([]);
    setGroupComplete(false);
    setReviewMode(false);
    setReviewIds([]);
    setReviewPos(0);
  }

  function nextPuzzle() {
    if (reviewMode) {
      if (reviewPos + 1 < reviewIds.length) {
        setReviewPos((v) => v + 1);
      } else {
        debugLog('PuzzleScreen', 'Review complete — starting next batch');
        startNextBatch();
      }
      return;
    }
    // If the user skips without solving, count it as "not clean" so the
    // group-complete summary is honest and the puzzle goes into the review
    // pile alongside any wrong-answer puzzles.
    let nextWrong = wrongInBatch;
    if (!puzzleSolved && !wrongInBatch.includes(puzzle.id)) {
      debugLog('PuzzleScreen', `Skipping unsolved puzzle "${puzzle.id}" — marking for review`);
      nextWrong = [...wrongInBatch, puzzle.id];
      setWrongInBatch(nextWrong);
    }
    if (batchPos + 1 < batchIds.length) {
      debugLog('PuzzleScreen', `Advancing to batch position ${batchPos + 1}/${batchIds.length}`);
      setBatchPos((v) => v + 1);
    } else {
      debugLog('PuzzleScreen', `Batch finished — showing group-complete screen (clean=${batchIds.length - nextWrong.length}/${batchIds.length})`);
      setGroupComplete(true);
    }
  }
  nextPuzzleRef.current = nextPuzzle;

  // Clean sweep deserves a fanfare (a review pile just gets the card).
  useEffect(() => {
    if (groupComplete && wrongInBatch.length === 0) playUiSound('win');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupComplete]);

  function startReview() {
    if (wrongInBatch.length === 0) {
      startNextBatch();
      return;
    }
    debugLog('PuzzleScreen', `Starting review — ${wrongInBatch.length} puzzles to revisit`);
    setReviewIds(wrongInBatch);
    setReviewPos(0);
    setReviewMode(true);
    setGroupComplete(false);
  }

  function resetProgress() {
    debugLog('PuzzleScreen', `Resetting puzzle progress for difficulty=${difficultyId}`);
    resetPuzzleProgress(difficultyId);
    setCompletedIds([]);
    setBatchIds(buildBatch([]));
    setBatchPos(0);
    setWrongInBatch([]);
    setGroupComplete(false);
    setReviewMode(false);
    setReviewIds([]);
    setReviewPos(0);
  }

  if (ready && !showIntro && allDone) {
    const totalForDifficulty = allForDifficulty.length;
    return (
      <main className="game-screen" data-screen="puzzles" data-screen-state="complete">
        <header className="topbar">
          <button onClick={() => clickBack(onBack)}>Menu</button>
          <h1>Tactics</h1>
          <div className="topbar-actions"><span>{score} pts</span></div>
        </header>
        <div className="puzzle-intro-overlay">
          <ConfettiBurst count={64} />
          <div className="puzzle-intro-card panel-card">
            <p className="eyebrow">All Done</p>
            <h2>You finished every {getDifficulty(difficultyId).label} puzzle</h2>
            <p>You've solved all {totalForDifficulty} puzzles at this difficulty. Try a harder level from the menu, or reset to replay them.</p>
            <div className="puzzle-group-actions">
              <button className="primary-action" onClick={() => clickBack(onBack)}>Back to menu</button>
              <button className="ghost-action" onClick={resetProgress}>Reset progress</button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (ready && !showIntro && groupComplete) {
    const wrongCount = wrongInBatch.length;
    const batchSize = batchIds.length;
    const cleanCount = batchSize - wrongCount;
    return (
      <main className="game-screen" data-screen="puzzles" data-screen-state="batch-complete">
        <header className="topbar">
          <button onClick={() => clickBack(onBack)}>Menu</button>
          <h1>Tactics</h1>
          <div className="topbar-actions"><span>{score} pts</span></div>
        </header>
        <div className="puzzle-intro-overlay">
          {wrongCount === 0 && <ConfettiBurst count={64} />}
          <div className="puzzle-intro-card panel-card">
            <p className="eyebrow">Batch Complete</p>
            <h2>{cleanCount} of {batchSize} solved cleanly</h2>
            {wrongCount > 0
              ? <p>You have {wrongCount} puzzle{wrongCount > 1 ? 's' : ''} to revisit. Review them now for extra learning, or skip ahead.</p>
              : <p>Clean sweep — no mistakes. Moving on to the next batch.</p>
            }
            <div className="puzzle-group-actions">
              {wrongCount > 0 && (
                <button className="primary-action" onClick={startReview}>Review mistakes ({wrongCount})</button>
              )}
              <button className="ghost-action" onClick={() => startNextBatch()}>
                {wrongCount > 0 ? 'Skip review' : 'Next batch'}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  async function sendPuzzleChat() {
    const text = chatInput.trim();
    if (!text) return;
    unlockUiAudio();
    playUiSound('send');
    setChatInput('');
    const dynamicInfo = `Puzzle theme: ${puzzle.theme}. Side to move: ${puzzle.sideToMove}. Position FEN: ${puzzle.fen}.`;
    const spoken = await chessConvai.sendUserChat(
      coach,
      getDifficulty(difficultyId),
      text,
      dynamicInfo,
      puzzle.fen,
    );
    // Empty means the turn died server-side even after the retry — say so
    // instead of resolving into silence.
    setFeedback(spoken || "Sorry — I lost my train of thought there. Ask me that again?");
  }

  const sideLabel = puzzle.sideToMove === 'w' ? 'White' : 'Black';

  return (
    <main
      className="game-screen"
      data-screen="puzzles"
      data-screen-state={showIntro ? 'intro' : reviewMode ? 'review' : verdict ?? 'active'}
    >
      <header className="topbar">
        <button onClick={() => clickBack(onBack)}>Menu</button>
        <h1>{reviewMode ? 'Review Mode' : 'Puzzles'}</h1>
        <div className="topbar-actions">
          <span className="score-anchor">
            <span key={score} className={score > 0 ? 'score-bump' : ''}>{score} pts</span>
            {scorePop && <span key={scorePop.key} className="score-pop">+{scorePop.amount}</span>}
          </span>
          {streak > 0 && <span key={`streak-${streak}`} className="score-bump">{streak} streak</span>}
          {!reviewMode && <span>{batchPos + 1}/{batchIds.length}</span>}
          {reviewMode && <span>{reviewPos + 1}/{reviewIds.length}</span>}
          <Tooltip text="Total progress for this difficulty" placement="bottom">
            <span>{completedIds.length}/{allForDifficulty.length}</span>
          </Tooltip>
        </div>
      </header>
      <div className="training-layout">
        <div className="puzzle-left-col">
          <CoachCard
            coach={coach}
            status={coach.name}
            lastLine={feedback || undefined}
            onReady={handleAvatarReady}
            chatOpen={chatOpen}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatSend={() => void sendPuzzleChat()}
            mic={<MicButton className="coach-mic-btn" />}
          />
          <div className="puzzle-theme-label">
            <span className="eyebrow">{reviewMode ? 'Review' : puzzle.theme}</span>
            <strong>{puzzle.title}</strong>
          </div>
          <div className="puzzle-actions">
            <button className="primary-action" onClick={() => void askPuzzleHint()} disabled={hintsUsed >= 3 || puzzleSolved}>
              Hint {hintsUsed > 0 ? `(${hintsUsed}/3)` : ''}
            </button>
            <button className="ghost-action" onClick={nextPuzzle}>
              {reviewMode ? (reviewPos + 1 < reviewIds.length ? 'Next' : 'Finish review') : puzzleSolved ? 'Next Puzzle' : 'Skip'}
            </button>
          </div>
        </div>
        <section
          className={`game-stage puzzle-board-stage${verdict === 'solved' ? ' stage-solved' : ''}${verdict === 'wrong' ? ' stage-wrong' : ''}`}
        >
          <ChessBoard
            game={game}
            selected={selected}
            legalMoves={legalMoves}
            lastMove={lastMove}
            checkSquare={game.inCheck() ? kingSquareOf(game, game.turn()) : null}
            onSquareClick={(sq) => void handlePuzzleSquare(sq)}
            orientation={puzzle.sideToMove}
          />
          {verdict === 'solved' && <ConfettiBurst key={`confetti-${puzzle.id}`} count={44} />}
          {verdict && (
            <div className={`puzzle-result-chip ${verdict === 'solved' ? 'is-solved' : 'is-wrong'}`}>
              {verdict === 'solved' ? `Solved!${scorePop ? ` +${scorePop.amount}` : ''}` : 'Not quite — try again'}
            </div>
          )}
        </section>
      </div>

      {ready && showIntro && (
        <div className="puzzle-cover">
          <div className="puzzle-intro-card panel-card">
            <p className="eyebrow">Puzzle Challenge</p>
            <h2>Find the best move for {sideLabel}</h2>
            <ul className="puzzle-intro-rules">
              <li>Tap a piece, then tap where you want it to go.</li>
              <li>You can ask for up to 3 hints per puzzle.</li>
              <li>After {PUZZLE_GROUP_SIZE} puzzles, you can review the ones you got wrong.</li>
              <li>The coach will stay quiet during routine moves — listen when they speak.</li>
            </ul>
            <button className="primary-action" onClick={() => setShowIntro(false)}>Start puzzles</button>
          </div>
        </div>
      )}
      {!ready && <LoadingScreen progress={loadingProgress} step={loadingStep} />}
    </main>
  );
}

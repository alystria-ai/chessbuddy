import { Chess, type Move, type Square } from 'chess.js';
import type { CoachConfig, DifficultyConfig } from './coachConfig';

const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);
const NEAR_CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6']);

function materialScore(game: Chess) {
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const direction = piece.color === 'w' ? 1 : -1;
      score += direction * PIECE_VALUES[piece.type];
    }
  }
  return score;
}

function positionalScore(game: Chess) {
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const direction = piece.color === 'w' ? 1 : -1;
      const square = piece.square;
      if (CENTER_SQUARES.has(square)) score += direction * 28;
      if (NEAR_CENTER_SQUARES.has(square)) score += direction * 12;
      if (piece.type === 'n' || piece.type === 'b') {
        const homeRank = piece.color === 'w' ? '1' : '8';
        if (!square.endsWith(homeRank)) score += direction * 16;
      }
    }
  }
  return score;
}

function evaluate(game: Chess) {
  if (game.isCheckmate()) return game.turn() === 'w' ? -100000 : 100000;
  if (game.isDraw()) return 0;
  const mobility = game.moves().length * (game.turn() === 'w' ? 2 : -2);
  return materialScore(game) + positionalScore(game) + mobility;
}

// White-relative static evaluation of a FEN (positive favors White). Used as a
// fallback for post-game accuracy analysis when the Stockfish worker is
// unavailable or does not report a score.
export function evaluateFen(fen: string): number {
  try {
    return evaluate(new Chess(fen));
  } catch {
    return 0;
  }
}

function orderMoves(moves: Move[]) {
  return [...moves].sort((a, b) => movePriority(b) - movePriority(a));
}

function movePriority(move: Move) {
  let score = 0;
  if (move.captured) score += PIECE_VALUES[move.captured] + 40;
  if (move.promotion) score += PIECE_VALUES[move.promotion];
  if (CENTER_SQUARES.has(move.to)) score += 18;
  if (move.san.includes('+')) score += 25;
  if (move.san.includes('#')) score += 10000;
  return score;
}

function minimax(game: Chess, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || game.isGameOver()) return evaluate(game);

  const maximizing = game.turn() === 'w';
  const moves = orderMoves(game.moves({ verbose: true }));

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      game.move(move);
      best = Math.max(best, minimax(game, depth - 1, alpha, beta));
      game.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    game.move(move);
    best = Math.min(best, minimax(game, depth - 1, alpha, beta));
    game.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseDanielleMove(fen: string, depth = 2) {
  const game = new Chess(fen);
  const moves = orderMoves(game.moves({ verbose: true }));
  let bestMove = moves[0];
  let bestScore = game.turn() === 'w' ? -Infinity : Infinity;

  for (const move of moves) {
    game.move(move);
    const score = minimax(game, depth - 1, -Infinity, Infinity);
    game.undo();
    if (game.turn() === 'w' ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

export function legalTargets(fen: string, square: Square) {
  const game = new Chess(fen);
  return game.moves({ square, verbose: true }).map((move) => move.to);
}

export type CoachSpeechDecision = {
  shouldSpeak: boolean;
  reason: string;
  facts: string[];
  phase: 'opening' | 'middlegame' | 'endgame';
};

type MoveHistoryEntry = { san: string; from: string; to: string; piece: string; captured?: string; by: string };

type MoveContext = CoachSpeechDecision & {
  reasons: string[];
  moveNumber: number;
  /**
   * True when the student's last move was a capture the coach can answer with
   * a safe recapture — i.e. a TRADE, not won material. Keeps the momentum
   * anchor from telling the model "they took it for free".
   */
  studentCaptureAnswerable?: boolean;
};

/** Recapture options on the square of the last capture, for the side to move. */
type RecaptureSummary = {
  /** Square the capture landed on (and where recaptures happen). */
  square: string;
  /** Value of the capturing piece now sitting on that square. */
  victimValue: number;
  /** Safe recaptures (immediate exchange nets ≥ 0), cheapest piece first. */
  safe: Move[];
  /** Every legal recapture. */
  all: Move[];
};

export function summarizeRecaptures(game: Chess, lastMove: Move): RecaptureSummary | null {
  if (!lastMove.captured) return null;
  const square = lastMove.to;
  const all = game
    .moves({ verbose: true })
    .filter((m) => m.to === square && m.captured)
    .sort((a, b) => (PIECE_VALUES[a.piece] ?? 0) - (PIECE_VALUES[b.piece] ?? 0));
  // The piece to win back is the capturer that now occupies the square.
  const victimValue = PIECE_VALUES[lastMove.piece] ?? 0;
  const safe = all.filter((m) => {
    // Recapturing with an equal-or-cheaper piece never loses the immediate
    // exchange (we regain the capturer even if they take back).
    if (victimValue >= (PIECE_VALUES[m.piece] ?? 0)) return true;
    // More expensive recapturer: only safe when nothing can take it back.
    const sim = gameFromFen(game.fen());
    if (!sim) return false;
    try {
      sim.move(m);
    } catch {
      return false;
    }
    return !sim.isAttacked(square as Square, lastMove.color);
  });
  return { square, victimValue, safe, all };
}

/**
 * Sanity guard over the skill-limited engine move. Stockfish's Skill Level
 * error model can skip an obvious recapture (observed at skill 5: the coach
 * ignored a knight-for-knight recapture and played a quiet pawn move — reads
 * BROKEN, not weak). When the opponent just captured a minor piece or more
 * and a safe recapture exists, play the recapture unless the engine's own
 * choice already answers on that square, captures something at least as
 * valuable elsewhere, or mates.
 */
export function guardObviousRecapture(
  game: Chess,
  planned: Move | null,
  lastMove?: Move | null,
): Move | null {
  if (!planned || !lastMove?.captured) return planned;
  const capturedValue = PIECE_VALUES[lastMove.captured] ?? 0;
  // Pawn trades: passing one up is normal weak play, leave the skill model alone.
  if (capturedValue < PIECE_VALUES.n) return planned;
  if (planned.to === lastMove.to) return planned;
  if (planned.san.includes('#')) return planned;
  const summary = summarizeRecaptures(game, lastMove);
  if (!summary || !summary.safe.length) return planned;
  // The engine may have found an equal-or-bigger capture elsewhere.
  if (planned.captured && (PIECE_VALUES[planned.captured] ?? 0) >= summary.victimValue) return planned;
  return summary.safe[0];
}

export function analyzeCoachMoveContext(
  game: Chess,
  plannedMove?: Move | null,
  lastMove?: Move | null,
  difficulty?: Pick<DifficultyConfig, 'id'>,
  moveHistory: MoveHistoryEntry[] = [],
): MoveContext {
  const difficultyId = difficulty?.id ?? 'intermediate';
  const isNewLevel = difficultyId === 'new';
  const isBeginnerLevel = difficultyId === 'beginner';
  const isIntermediateLevel = difficultyId === 'intermediate';
  const isAdvancedLevel = difficultyId === 'advanced';
  const isExpertLevel = difficultyId === 'expert';
  const moveNo = moveNumber(game);
  const phase = gamePhase(game);
  const facts: string[] = [
    `Game phase: ${phase}, move number ${moveNo}.`,
  ];
  const reasons: string[] = [];

  if (!lastMove) return makeDecision(false, 'no-last-move', facts, reasons, moveNo, phase);

  const before = gameFromFen(lastMove.before);
  const ownership = moveOwnership(lastMove.color);
  const sideToMoveOwnership = ownership.opponent;
  const capturedValue = lastMove.captured ? PIECE_VALUES[lastMove.captured] ?? 0 : 0;
  const plannedCaptureValue = plannedMove?.captured ? PIECE_VALUES[plannedMove.captured] ?? 0 : 0;
  const materialDelta = before ? materialDeltaForMove(before, game, lastMove.color) : capturedValue;
  const forcing = forcingSummary(game);
  const capturable = capturablePiecesForSideToMove(game);
  const movedPiece = game.get(lastMove.to as Square);
  const attacksMovedPiece = capturable.some((item) => item.square === lastMove.to);
  const repeatedPiece = isRepeatedPieceMove(lastMove, moveHistory);
  const pawnInfo = pawnMoveInfo(game, lastMove, moveHistory);
  const kingInfo = kingSafetyInfo(game, lastMove);

  const captureClause = lastMove.captured
    ? ` and captured ${ownership.opponentPossessive} ${pieceName(lastMove.captured)}`
    : '';
  facts.push(`Last move facts: ${ownership.moverPhrase} moved ${ownership.moverPossessive} ${pieceName(lastMove.piece)} from ${formatSquare(lastMove.from)} to ${formatSquare(lastMove.to)}${captureClause}.`);

  // Was the capture free, or answerable? Spell it out — without this the
  // model has narrated an ordinary trade as "I left it loose / you took it
  // for free" (and even mis-named the square).
  let studentCaptureAnswerable = false;
  if (lastMove.captured) {
    const recap = summarizeRecaptures(game, lastMove);
    const sq = formatSquare(lastMove.to);
    const rOwn = sideToMoveOwnership;
    if (recap && recap.safe.length) {
      if (lastMove.color === 'w') studentCaptureAnswerable = true;
      const recapDesc = recap.safe
        .slice(0, 2)
        .map((m) => `${rOwn.moverPossessive} ${pieceName(m.piece)} from ${formatSquare(m.from)}`)
        .join(' or ');
      facts.push(
        `CAPTURE REALITY CHECK: the capture happened on ${sq} (name ${sq} if mentioning where — no other square). It is NOT a free win: ${rOwn.moverPhrase} can recapture on ${sq} with ${recapDesc}, so the captured ${pieceName(lastMove.captured)} was protected and this is a trade/exchange. Do NOT say it was "loose", "undefended", "hanging", or captured "for free", and do not apologize for a blunder — there was none.`,
      );
    } else if (recap) {
      facts.push(
        `CAPTURE REALITY CHECK: the capture happened on ${sq} and ${rOwn.moverPhrase} has no safe recapture — the captured ${pieceName(lastMove.captured)} was genuinely lost.`,
      );
    }
  }
  if (Math.abs(materialDelta) >= PIECE_VALUES.p) {
    facts.push(`Material swing from the last move for ${ownership.moverPhrase}: ${materialDelta > 0 ? '+' : ''}${materialDelta} centipawns.`);
  }
  if (lastMove.san.includes('+') || lastMove.san.includes('#')) facts.push(describeCheckFromLastMove(lastMove));
  if (lastMove.promotion) facts.push(`${ownership.moverPhrase} promoted ${ownership.moverPossessive} pawn to a ${pieceName(lastMove.promotion)}.`);
  if (forcing.checks || forcing.captures || forcing.promotions) {
    facts.push(`${sideToMoveOwnership.moverPhrase} (side to move) has ${forcing.checks} checking moves, ${forcing.captures} captures, and ${forcing.promotions} promotions available.`);
  }
  // When the coach's ACTUAL move ignores the capturable pieces, announcing
  // "your pawn is hanging — I can win it" and then playing something else
  // reads broken. Half the time the targets are simply not mentioned; the
  // other half they stay with an explicit seen-but-declined framing ("I could
  // take it, but I have another idea"). When the planned move DOES take a
  // listed piece, the facts pass through untouched.
  const coachToMove = game.turn() === 'b';
  const plannedTakesListed = Boolean(plannedMove && capturable.some((item) => item.square === plannedMove.to));
  const captureTalkMismatch = coachToMove && Boolean(plannedMove) && capturable.length > 0 && !plannedTakesListed;
  const suppressCaptureTalk = captureTalkMismatch && Math.random() < 0.5;

  if (capturable.length && !suppressCaptureTalk) {
    const items = capturable.slice(0, 4).map((item) => {
      const status = item.defenderCount === 0
        ? 'UNDEFENDED — truly hanging, free win if captured'
        : item.attackerCount > item.defenderCount
          ? `defended ${item.defenderCount}× but attacked ${item.attackerCount}× — winning exchange may exist (NOT hanging)`
          : `defended ${item.defenderCount}× — capturing it is an exchange, not a free win (DO NOT call it "undefended" or "hanging")`;
      return `${item.ownerPossessive} ${pieceName(item.piece)} on ${formatSquare(item.square)} [${status}]`;
    });
    facts.push(`Pieces ${sideToMoveOwnership.moverPhrase} can target with a capture move: ${items.join('; ')}.`);
    // Spell out who actually gets to make these captures so the model never inverts the actor.
    // The side to move owns every capture in the list above.
    const capturer = game.turn() === 'w' ? 'the student (it is the student\'s turn, so say "you can take ...")' : 'I, the coach (it is MY turn, so I must say "I can take ..." or "your piece is hanging — I can win it", NEVER "you can take it")';
    facts.push(`Capture actor: every capture listed above is a move that ${capturer}.`);
    if (captureTalkMismatch && plannedMove) {
      facts.push(
        `CONSISTENCY — my actual move this turn is ${plannedMove.san}, which does NOT capture anything listed above. If I mention one of those captures at all, I must frame it as seen but declined, in my own voice ("I could take your ${pieceName(capturable[0].piece)} on ${formatSquare(capturable[0].square)}, but I have another idea") — NEVER announce it as a threat I am about to execute, never promise to win it, and never scold the student as if I punished it. Staying quiet about it is also fine.`,
      );
    }
  }
  if (movedPiece && attacksMovedPiece && !suppressCaptureTalk) {
    const movedItem = capturable.find((c) => c.square === lastMove.to);
    const movedStatus = movedItem && movedItem.defenderCount > 0
      ? ` (but it is defended ${movedItem.defenderCount}× — not hanging outright)`
      : ' (UNDEFENDED — it is hanging)';
    // Name the side that gets to capture it (the side to move) so the coach does not tell the
    // student to capture a piece the student just moved there themselves.
    const capturedBy = game.turn() === 'w' ? 'the student' : 'me (the coach)';
    facts.push(`${ownership.moverPossessive} ${pieceName(movedPiece.type)} that just moved to ${formatSquare(lastMove.to)} can now be captured by ${capturedBy} on the next move${movedStatus}.`);
  }
  if (repeatedPiece) facts.push('The same non-pawn piece appears to have moved again recently.');
  facts.push(...pawnInfo.facts, ...kingInfo.facts);

  if (game.isCheckmate()) reasons.push('checkmate');
  if (game.isDraw()) reasons.push('draw');
  if (game.isCheck()) reasons.push('king-in-check');
  if (lastMove.san.includes('+') || lastMove.san.includes('#')) reasons.push('student-check');
  if (lastMove.promotion) reasons.push('promotion');
  if (plannedMove?.promotion) reasons.push('coach-promotion-available');
  if (plannedMove?.san.includes('+') || plannedMove?.san.includes('#')) reasons.push('coach-check-available');

  if (lastMove.captured) {
    if (isNewLevel || isBeginnerLevel) reasons.push('student-capture');
    else if ((isIntermediateLevel || isAdvancedLevel) && capturedValue >= PIECE_VALUES.n) reasons.push('meaningful-capture');
    else if (isExpertLevel && capturedValue >= PIECE_VALUES.r) reasons.push('major-capture');
  }
  if (plannedMove?.captured) {
    if ((isNewLevel || isBeginnerLevel || isIntermediateLevel) && plannedCaptureValue >= PIECE_VALUES.n) reasons.push('coach-capture-available');
    else if ((isAdvancedLevel || isExpertLevel) && plannedCaptureValue >= PIECE_VALUES.r) reasons.push('major-coach-capture-available');
  }

  // Only count a piece as "loose" if it is truly UNDEFENDED. Defended pieces being
  // attacked are exchanges, not free wins, and the coach should not call them hanging.
  // (Skipped entirely when capture talk is suppressed this turn — the loose-piece
  // reasons must not trigger speech about facts the model was not given.)
  const undefendedTargets = suppressCaptureTalk ? [] : capturable.filter((item) => item.defenderCount === 0);
  const highestHangingValue = Math.max(0, ...undefendedTargets.map((item) => PIECE_VALUES[item.piece] ?? 0));
  if (highestHangingValue >= PIECE_VALUES.q) reasons.push('queen-loose');
  else if (highestHangingValue >= PIECE_VALUES.r && !isExpertLevel) reasons.push('rook-loose');
  else if (highestHangingValue >= PIECE_VALUES.b && (isNewLevel || isBeginnerLevel || isIntermediateLevel)) reasons.push('minor-piece-loose');
  const movedItem = suppressCaptureTalk ? undefined : capturable.find((c) => c.square === lastMove.to);
  if (movedPiece && movedItem && movedItem.defenderCount === 0 && PIECE_VALUES[movedPiece.type] >= PIECE_VALUES.b) {
    reasons.push('moved-piece-capturable');
  }

  if (pawnInfo.directShieldMoved) reasons.push('king-pawn-shield');
  if (pawnInfo.aggressivePush) reasons.push('aggressive-pawn-push');
  if (pawnInfo.tooManyPawnMoves && (isNewLevel || isBeginnerLevel || isIntermediateLevel)) reasons.push('too-many-pawn-moves');
  if (pawnInfo.openedKingFile && !isExpertLevel) reasons.push('opened-king-file');
  if (kingInfo.unCastledWithCenterOpen && (isBeginnerLevel || isIntermediateLevel || isAdvancedLevel)) reasons.push('uncastled-open-center');

  // Only call out repeated-piece-move for true beginners during the opening — past move 10
  // it's almost always intentional maneuvering, and pestering the student about it is annoying.
  if (repeatedPiece && phase === 'opening' && (isNewLevel || isBeginnerLevel)) reasons.push('repeated-piece-move');
  if (lastMove.piece === 'q' && moveNo <= 6 && !isExpertLevel) reasons.push('early-queen-move');
  if (lastMove.piece === 'k' && (lastMove.san === 'O-O' || lastMove.san === 'O-O-O') && (isNewLevel || isBeginnerLevel)) reasons.push('castling');
  if (isNewLevel && moveNo <= 5 && (lastMove.piece === 'n' || lastMove.piece === 'b') && !lastMove.from.endsWith('1')) reasons.push('opening-development');
  if (isNewLevel && moveNo <= 5 && lastMove.piece === 'p' && CENTER_SQUARES.has(lastMove.to)) reasons.push('center-control');

  const shouldSpeak = reasons.some((reason) => reasonAllowedForDifficulty(reason, difficultyId));
  const filteredReasons = reasons.filter((reason) => reasonAllowedForDifficulty(reason, difficultyId));
  const decision = makeDecision(shouldSpeak, filteredReasons[0] ?? 'routine', facts, filteredReasons, moveNo, phase);
  decision.studentCaptureAnswerable = studentCaptureAnswerable;
  return decision;
}

export function shouldCoachSpeakForMove(
  game: Chess,
  plannedMove?: Move | null,
  lastMove?: Move | null,
  difficulty?: Pick<DifficultyConfig, 'id'>,
  moveHistory: MoveHistoryEntry[] = [],
): CoachSpeechDecision {
  return analyzeCoachMoveContext(game, plannedMove, lastMove, difficulty, moveHistory);
}

function makeDecision(
  shouldSpeak: boolean,
  reason: string,
  facts: string[],
  reasons: string[],
  moveNo: number,
  phase: MoveContext['phase'],
): MoveContext {
  return { shouldSpeak, reason, facts: unique(facts), reasons: unique(reasons), moveNumber: moveNo, phase };
}

function reasonAllowedForDifficulty(reason: string, difficultyId: string): boolean {
  // Always meaningful at every level: game-state events and hung major pieces.
  const common = new Set([
    'checkmate',
    'draw',
    'king-in-check',
    'promotion',
    'coach-promotion-available',
    'queen-loose',
    'moved-piece-capturable',
  ]);
  if (common.has(reason)) return true;

  // Brand-new player: anything we can teach about is fair game.
  if (difficultyId === 'new') return true;

  // Beginner: still chatty; skip only the heaviest tactical reasons that need calculation.
  if (difficultyId === 'beginner') {
    return ![
      'major-capture',
      'major-coach-capture-available',
    ].includes(reason);
  }

  // Intermediate: real teaching themes. Skip every-check narration and queenside-flank noise.
  if (difficultyId === 'intermediate') {
    return [
      'coach-check-available',
      'meaningful-capture',
      'coach-capture-available',
      'rook-loose',
      'minor-piece-loose',
      'king-pawn-shield',
      'aggressive-pawn-push',
      'too-many-pawn-moves',
      'opened-king-file',
      'uncastled-open-center',
      'early-queen-move',
    ].includes(reason);
  }

  // Advanced: prophylaxis / structural themes only. No routine pawn-push commentary,
  // no early-queen lectures (Scandinavian etc. is intentional at this rating).
  if (difficultyId === 'advanced') {
    return [
      'meaningful-capture',
      'major-capture',
      'major-coach-capture-available',
      'rook-loose',
      'king-pawn-shield',
      'opened-king-file',
      'uncastled-open-center',
    ].includes(reason);
  }

  // Expert: only egregious moments — major-piece swings, hung rooks. Pawn-structure
  // choices and routine checks are below the noise floor at this level.
  return [
    'major-capture',
    'major-coach-capture-available',
    'rook-loose',
  ].includes(reason);
}

function gameFromFen(fen?: string): Chess | null {
  if (!fen) return null;
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function materialDeltaForMove(before: Chess, after: Chess, moverColor: 'w' | 'b') {
  const deltaForWhite = materialScore(after) - materialScore(before);
  return moverColor === 'w' ? deltaForWhite : -deltaForWhite;
}

function forcingSummary(game: Chess) {
  const legal = game.moves({ verbose: true });
  return {
    checks: legal.filter((move) => move.san.includes('+') || move.san.includes('#')).length,
    captures: legal.filter((move) => move.captured).length,
    promotions: legal.filter((move) => move.promotion).length,
  };
}

function capturablePiecesForSideToMove(game: Chess) {
  const sideToMove = game.turn();
  const ownerColor: 'w' | 'b' = sideToMove === 'w' ? 'b' : 'w';
  const seen = new Set<string>();
  const result: Array<{
    square: Square;
    piece: string;
    by: string;
    defenderCount: number;
    attackerCount: number;
    ownerPossessive: string;
  }> = [];
  for (const move of game.moves({ verbose: true })) {
    if (!move.captured) continue;
    if (seen.has(move.to)) continue;
    seen.add(move.to);
    const square = move.to as Square;
    let defenderCount = 0;
    let attackerCount = 0;
    try {
      defenderCount = (game.attackers(square, ownerColor) ?? []).length;
      attackerCount = (game.attackers(square, sideToMove) ?? []).length;
    } catch {
      defenderCount = 0;
      attackerCount = 0;
    }
    result.push({
      square,
      piece: move.captured as string,
      by: move.san,
      defenderCount,
      attackerCount,
      ownerPossessive: moveOwnership(ownerColor).moverPossessive,
    });
  }
  return result.sort((a, b) => (PIECE_VALUES[b.piece] ?? 0) - (PIECE_VALUES[a.piece] ?? 0));
}

function isRepeatedPieceMove(lastMove: Move, moveHistory: MoveHistoryEntry[]) {
  if (lastMove.piece === 'p' || lastMove.piece === 'k') return false;
  const previous = moveHistory.slice(0, -1).reverse().find((move) => move.by === 'You' && move.piece === lastMove.piece);
  return Boolean(previous && previous.to === lastMove.from);
}

function pawnMoveInfo(game: Chess, lastMove: Move, moveHistory: MoveHistoryEntry[]) {
  const facts: string[] = [];
  if (lastMove.piece !== 'p') {
    return { facts, aggressivePush: false, tooManyPawnMoves: false, directShieldMoved: false, openedKingFile: false };
  }

  const ownership = moveOwnership(lastMove.color);
  const fromFile = lastMove.from[0];
  const toRank = Number(lastMove.to[1]);
  const fromRank = Number(lastMove.from[1]);
  const whiteMove = lastMove.color === 'w';
  const advancement = whiteMove ? toRank - fromRank : fromRank - toRank;
  const shieldType = kingShieldPawnType(lastMove.from, lastMove.color);
  const directShieldMoved = shieldType === 'direct';
  // Only call it an "opened king file" when the pawn was the direct king cover and the
  // file is now empty — flank pawns vacating their start square aren't an emergency.
  const openedKingFile = directShieldMoved && !fileHasPawn(game, fromFile, lastMove.color);
  const pawnMovesBySide = moveHistory.filter((move) => move.by === 'You' && move.piece === 'p').length;
  const tooManyPawnMoves = whiteMove && moveNumber(game) <= 10 && pawnMovesBySide >= 5;
  // Restrict "aggressive pawn push" to kingside-area flank pawns (f/g/h). Queenside flank
  // (a/b) pushes are usually positional, not a king-safety lecture in this codebase.
  const kingsideFlank = ['f', 'g', 'h'].includes(fromFile);
  const nonCapture = !lastMove.captured;
  const deepFlankPush = nonCapture && kingsideFlank && (whiteMove ? toRank >= 5 : toRank <= 4);
  const earlyFlankLunge = nonCapture && kingsideFlank && advancement >= 2 && moveNumber(game) <= 10;
  const aggressivePush = deepFlankPush || earlyFlankLunge;

  const directCoverSquare = whiteMove ? 'G 2' : 'G 7';

  if (shieldType === 'direct') {
    facts.push(`${ownership.moverPhrase} advanced ${ownership.moverPossessive} ${fromFile.toUpperCase()} pawn from ${formatSquare(lastMove.from)} to ${formatSquare(lastMove.to)}. That pawn directly covers ${ownership.moverPossessive} king after kingside castling (${whiteMove ? 'G 1' : 'G 8'}), so do not swap whose king shield changed.`);
  } else if (shieldType === 'flank') {
    facts.push(`${ownership.moverPhrase} advanced ${ownership.moverPossessive} flank pawn from ${formatSquare(lastMove.from)} to ${formatSquare(lastMove.to)}. The direct king-cover pawn at ${directCoverSquare} is still in place - do not call this "the pawn that shields the king".`);
  } else if (aggressivePush) {
    facts.push(`${ownership.moverPhrase} advanced ${ownership.moverPossessive} kingside-area pawn (${fromFile.toUpperCase()} file) two squares forward to ${formatSquare(lastMove.to)}.`);
  }

  if (openedKingFile) facts.push(`The ${fromFile.toUpperCase()} file no longer has ${ownership.moverPossessive} pawn on it, leaving the file open near ${ownership.moverPossessive} king.`);
  if (advancement >= 2 && shieldType === null && !aggressivePush) {
    facts.push(`${ownership.moverPhrase} advanced ${ownership.moverPossessive} pawn ${advancement} ranks in one move.`);
  }
  if (tooManyPawnMoves && lastMove.color === 'w') facts.push(`The student has made ${pawnMovesBySide} pawn moves by move ${moveNumber(game)}.`);

  return { facts, aggressivePush, tooManyPawnMoves, directShieldMoved, openedKingFile };
}

function kingSafetyInfo(game: Chess, lastMove: Move) {
  const facts: string[] = [];
  const color = lastMove.color;
  const rights = game.fen().split(' ')[2] ?? '-';
  const white = color === 'w';
  const ownership = moveOwnership(color);
  const stillCanCastle = white ? /K|Q/.test(rights) : /k|q/.test(rights);
  const centerOpen = !fileHasPawn(game, 'd', 'w') || !fileHasPawn(game, 'e', 'w') || !fileHasPawn(game, 'd', 'b') || !fileHasPawn(game, 'e', 'b');
  const unCastledWithCenterOpen = stillCanCastle && centerOpen && moveNumber(game) >= 5;
  if (unCastledWithCenterOpen) facts.push(`${ownership.moverPhrase} still has ${ownership.moverPossessive} king uncastled while central files or pawns have opened.`);
  return { facts, unCastledWithCenterOpen };
}

function kingShieldPawnType(square: string, color: 'w' | 'b'): 'direct' | 'flank' | null {
  // 'direct': the pawn that stands directly in front of the king after O-O (g2/g7)
  // 'flank': adjacent shield pawns (f2/h2 or f7/h7)
  const direct = color === 'w' ? 'g2' : 'g7';
  const flank = color === 'w' ? ['f2', 'h2'] : ['f7', 'h7'];
  if (square === direct) return 'direct';
  if (flank.includes(square)) return 'flank';
  return null;
}

function fileHasPawn(game: Chess, file: string, color: 'w' | 'b') {
  for (let rank = 1; rank <= 8; rank++) {
    const piece = game.get(`${file}${rank}` as Square);
    if (piece?.type === 'p' && piece.color === color) return true;
  }
  return false;
}

function gamePhase(game: Chess): MoveContext['phase'] {
  const no = moveNumber(game);
  const nonKingMaterial = totalNonKingMaterial(game);
  const pieces = game.board().flat().filter(Boolean).length;
  if (pieces <= 12 || nonKingMaterial <= 2600) return 'endgame';
  if (no <= 10) return 'opening';
  return 'middlegame';
}

function totalNonKingMaterial(game: Chess) {
  return game.board().flat().reduce((sum, piece) => {
    if (!piece || piece.type === 'k') return sum;
    return sum + (PIECE_VALUES[piece.type] ?? 0);
  }, 0);
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

export function buildDynamicCoachInfo(
  game: Chess,
  plannedMove?: Move | null,
  lastMove?: Move | null,
  coach?: Pick<CoachConfig, 'name' | 'title' | 'chessFocus' | 'voiceStyle'> | string,
  difficulty?: Pick<DifficultyConfig, 'id' | 'label' | 'elo' | 'stockfishSkill' | 'curriculum' | 'explanationDepth'>,
  moveHistory: Array<{ san: string; from: string; to: string; piece: string; captured?: string; by: string }> = [],
  recentlySpokenTopics: string[] = [],
) {
  const coachName = typeof coach === 'string' ? coach : coach?.name ?? 'Coach';
  const coachInfo = typeof coach === 'object'
    ? `Coach identity: I am ${coach.name}, ${coach.title}. My chess specialty: ${coach.chessFocus}. My voice: ${coach.voiceStyle}.`
    : `Coach identity: I am ${coachName}.`;
  const levelInfo = difficulty
    ? `Student level: ${difficulty.label}, approximate rating ${difficulty.elo}, Stockfish skill ${difficulty.stockfishSkill}. Teaching curriculum for this level: ${difficulty.curriculum}. Explanation depth: ${difficulty.explanationDepth}.`
    : '';
  // The student always plays White; I (the coach) always play Black.
  const roleContext = 'Role context: In this game I (the coach) play Black, and the student plays White. The facts below use "I/my" for my pieces (Black) and "the student/the student\'s" for the student\'s pieces (White). When a fact says "the student captured my queen with their bishop", that means the STUDENT now has a winning capture and I (the coach) lost the queen — I must never invert this. Equally critical the other direction: when a fact or history entry says "I (the coach) captured the student\'s queen with my knight", that means I (the coach) made that capture — I must NEVER tell the student "your knight captured my queen" or any inversion of who owns the capturing piece.';
  const attributionCheatsheet = buildAttributionCheatsheet(moveHistory);
  const turn = game.turn() === 'w' ? 'White to move' : 'Black to move';
  const status = game.isCheckmate()
    ? 'checkmate'
    : game.isDraw()
      ? 'draw'
      : game.isCheck()
        ? 'check'
        : 'normal play';
  const legalMoveCount = game.moves().length;
  const material = materialSummary(game);
  const checkOwnership = describeCurrentCheckOwnership(game);
  const fenInfo = `Current board FEN: ${game.fen()}. Use this only to understand the board; do not say "FEN" aloud.`;
  const recentHistory = moveHistory.length
    ? `Recent move history (BACKGROUND ONLY — these are older moves, already played; use them to understand how the position arose, but NEVER comment on one of them as if it just happened. The move to react to is the LATEST MOVE ANCHOR below, not anything in this list), oldest to newest: ${moveHistory.slice(-10).map(formatHistoryMove).join('; ')}.`
    : 'Recent move history: none.';
  const lastMoveInfo = lastMove ? describeLastMove(lastMove) : 'No move has been played yet.';
  const latestMoveAnchor = buildLatestMoveAnchor(game, lastMove, moveHistory);
  const moveHint = plannedMove ? describePlannedMove(plannedMove) : '';
  const tacticalInfo = tacticalSummary(game, lastMove);
  const context = analyzeCoachMoveContext(game, plannedMove, lastMove, difficulty, moveHistory);
  const positionFacts = context.facts.length
    ? `Position facts: ${context.facts.join(' ')}`
    : '';
  const momentum = momentumInfo(lastMove, context);
  const recentTopicsNotice = recentlySpokenTopics.length
    ? `RECENTLY COVERED TOPICS (do not repeat — student already heard these): ${recentlySpokenTopics.map(topicLabel).join(', ')}. If the only available teaching point falls under one of these, stay silent or pick a fresh angle.`
    : '';
  return [
    coachInfo,
    roleContext,
    attributionCheatsheet,
    levelInfo,
    turn,
    `Position status: ${status}.`,
    checkOwnership,
    fenInfo,
    recentHistory,
    `Legal moves available: ${legalMoveCount}.`,
    material,
    tacticalInfo,
    lastMoveInfo,
    moveHint,
    positionFacts,
    momentum,
    latestMoveAnchor,
    recentTopicsNotice,
  ].filter(Boolean).join(' ').trim();
}

/**
 * Anchor-moment classifier: the coach should time and shape commentary to the
 * swings of the game (the "evaluation curve"), not to random moves. Two
 * anchors are detectable locally without an engine pass:
 * - the student just won meaningful material (often punishing MY mistake), or
 * - the student's last move loses material / hangs a piece.
 */
function momentumInfo(lastMove: Move | null | undefined, context: MoveContext): string {
  if (!lastMove || lastMove.color !== 'w') return '';
  const capturedValue = lastMove.captured ? PIECE_VALUES[lastMove.captured] ?? 0 : 0;
  if (capturedValue >= PIECE_VALUES.n) {
    // A capture the coach can safely answer is a TRADE — telling the model
    // "they won real material, own your slip" here scripted hallucinated
    // apologies ("I left it loose... you took it for free").
    if (context.studentCaptureAnswerable) {
      return 'MOMENTUM ANCHOR: the student initiated a piece trade — I can recapture (see the CAPTURE REALITY CHECK fact). Treat it as an exchange: comment on what the trade changes (structure, open lines, who benefits), or stay brief. Do NOT congratulate the student for winning material, do NOT apologize, and do NOT claim anything was loose or free.';
    }
    return 'MOMENTUM ANCHOR: the game just swung toward the student — they won real material from me. Coach reaction for THIS turn: give specific credit naming the idea they used (the tactic, the loose piece they spotted, the overloaded defender), and if it came from my own slip, own it briefly and gracefully in my voice. Do NOT pivot into generic recommendations or a lecture on this turn.';
  }
  const lossReasons = new Set(['queen-loose', 'rook-loose', 'minor-piece-loose', 'moved-piece-capturable']);
  if (context.reasons.some((reason) => lossReasons.has(reason))) {
    return 'MOMENTUM ANCHOR: the game just dipped for the student — their last move loses material or leaves a piece loose. Coach reaction for THIS turn: this is a teaching moment. Be kind and direct: name the concrete consequence and ONE idea to remember, or ask a short guiding question instead of revealing the answer.';
  }
  return '';
}

export function buildGameOverDynamicInfo(
  game: Chess,
  coach: Pick<CoachConfig, 'name' | 'title' | 'chessFocus' | 'voiceStyle'>,
  difficulty: Pick<DifficultyConfig, 'id' | 'label' | 'elo' | 'stockfishSkill' | 'curriculum' | 'explanationDepth'>,
  resigned: boolean,
) {
  const positionInfo = buildDynamicCoachInfo(game, null, null, coach, difficulty);
  if (resigned) {
    return `GAME_OVER: The student resigned. I (${coach.name}) win the game. ${positionInfo}`;
  }
  if (game.isCheckmate()) {
    const studentWon = game.turn() === 'b';
    return studentWon
      ? `GAME_OVER: Checkmate — the student wins. Congratulate them briefly on the finish. ${positionInfo}`
      : `GAME_OVER: Checkmate — I (${coach.name}) win. Acknowledge the finish graciously in one or two sentences. ${positionInfo}`;
  }
  if (game.isStalemate()) {
    return `GAME_OVER: Stalemate — the game is drawn. ${positionInfo}`;
  }
  if (game.isDraw()) {
    return `GAME_OVER: The game ended in a draw. ${positionInfo}`;
  }
  return `GAME_OVER: The game has ended. ${positionInfo}`;
}

const WELCOME_HINTS = [
  'Good to see you — let\'s have a fun game.',
  'Alright, I\'m ready when you are.',
  'Nice to be back at the board together.',
  'Let\'s play — take your time on the first move.',
  'Happy to coach you today.',
  'Ready for a good game?',
  'Shall we begin?',
  'Looking forward to this one.',
];

export function buildWelcomeDynamicInfo(
  game: Chess,
  coach: Pick<CoachConfig, 'name' | 'title' | 'chessFocus' | 'voiceStyle'>,
  difficulty: Pick<DifficultyConfig, 'id' | 'label' | 'elo' | 'stockfishSkill' | 'curriculum' | 'explanationDepth'>,
  sessionNonce: string,
  /** True when the student is picking a saved game back up mid-board. */
  resuming = false,
) {
  const index = Math.abs(hashString(sessionNonce)) % WELCOME_HINTS.length;
  const hint = WELCOME_HINTS[index];
  const positionInfo = buildDynamicCoachInfo(game, null, null, coach, difficulty);
  if (resuming) {
    // Greeting a resumed game as if it were move one ("make your first move")
    // contradicts a board that already has pieces developed.
    return `GREETING_TURN: we are RESUMING a game already in progress — the position below is where we left off, NOT a new game. Say one short line welcoming the student back and noting we are picking up mid-game; do NOT invite a "first move" or describe the position as the start. ${positionInfo}`;
  }
  return `GREETING_TURN: GREETING_HINT — say one casual welcome line in this spirit: "${hint}". ${positionInfo}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// A hard anchor for "what just happened". The recurring failure mode in the logs was the
// coach praising/criticising a move that was several plies old (e.g. praising castling that
// happened 4 plies earlier, still visible in the 10-move history window). This block states
// the single latest move unambiguously and the rules that gate stale commentary.
function buildLatestMoveAnchor(
  game: Chess,
  lastMove?: Move | null,
  moveHistory: Array<{ san: string; from: string; to: string; piece: string; captured?: string; by: string }> = [],
): string {
  if (!lastMove) return '';
  const ownership = moveOwnership(lastMove.color);
  const sideToMove = game.turn() === 'w' ? 'the student (White)' : 'I, the coach (Black)';
  const isCastle = lastMove.san === 'O-O' || lastMove.san === 'O-O-O';
  const studentCastledThisMove = isCastle && lastMove.color === 'w';
  // Has the student castled at any earlier point? Either it shows in the recorded history,
  // or White has lost both castling rights with the king off its start square.
  const studentCastledEarlier = moveHistory.some(
    (m) => m.by === 'You' && (m.san === 'O-O' || m.san === 'O-O-O'),
  ) && !studentCastledThisMove;
  const whiteRights = game.fen().split(' ')[2] ?? '-';
  const whiteKing = game.board().flat().find((p) => p?.type === 'k' && p.color === 'w');
  const whiteKingMoved = Boolean(whiteKing && whiteKing.square !== 'e1');
  const studentHasCastled = studentCastledThisMove || studentCastledEarlier || (whiteKingMoved && !/[KQ]/.test(whiteRights));

  const captureClause = lastMove.captured
    ? `, capturing ${ownership.opponentPossessive} ${pieceName(lastMove.captured)}`
    : '';
  const checkClause = lastMove.san.includes('#')
    ? ' (this is checkmate/check — handle it via the check ownership line)'
    : lastMove.san.includes('+')
      ? ' (this move gives check — handle it via the check ownership line)'
      : '';
  const lines = [
    'LATEST MOVE ANCHOR (this is the ONLY move you may praise or critique — everything in the recent history above is older and already addressed):',
    `The latest move was: ${ownership.moverPhrase} moved ${ownership.moverPossessive} ${pieceName(lastMove.piece)} from ${formatSquare(lastMove.from)} to ${formatSquare(lastMove.to)}${captureClause} (${lastMove.san})${checkClause}.`,
    `It is now ${sideToMove} to move.`,
    `Latest move is castling: ${studentCastledThisMove ? 'YES — the student just castled, so praising castling now is correct' : 'no'}.`,
    studentHasCastled
      ? 'Castling status: the student HAS ALREADY castled. Do NOT tell the student to castle, do NOT say "you still have castling available", and do NOT praise castling unless the latest move itself is the castling move.'
      : 'Castling status: the student has NOT castled yet.',
    'If the latest move is not castling, do not bring up castling as if it just happened. Comment on the latest move itself or the position it created.',
  ];
  return lines.join(' ');
}

function buildAttributionCheatsheet(
  moveHistory: Array<{ san: string; from: string; to: string; piece: string; captured?: string; by: string }>,
): string {
  const recent = moveHistory.slice(-12);
  const myCaptures: string[] = [];
  const studentCaptures: string[] = [];
  const myChecks: string[] = [];
  const studentChecks: string[] = [];
  for (const m of recent) {
    if (m.by === 'You') {
      if (m.captured) studentCaptures.push(`the student's ${pieceName(m.piece)} took my ${pieceName(m.captured)} on ${formatSquare(m.to)} (${m.san})`);
      if (m.san.includes('+') || m.san.includes('#')) studentChecks.push(`the student's ${pieceName(m.piece)} gave check to my king on ${formatSquare(m.to)} (${m.san})`);
    } else {
      if (m.captured) myCaptures.push(`my ${pieceName(m.piece)} took the student's ${pieceName(m.captured)} on ${formatSquare(m.to)} (${m.san})`);
      if (m.san.includes('+') || m.san.includes('#')) myChecks.push(`my ${pieceName(m.piece)} gave check to the student's king on ${formatSquare(m.to)} (${m.san})`);
    }
  }
  const lines = [
    'ATTRIBUTION CHEATSHEET (read carefully before speaking):',
    'I am the coach playing BLACK. The student plays WHITE. In FEN, lowercase letters are MY pieces, uppercase are the STUDENT\'s.',
    `Captures I (the coach) have made recently: ${myCaptures.length ? myCaptures.join('; ') : 'none.'}`,
    `Captures the STUDENT has made recently: ${studentCaptures.length ? studentCaptures.join('; ') : 'none.'}`,
    `Checks I (the coach) have given recently: ${myChecks.length ? myChecks.join('; ') : 'none.'}`,
    `Checks the STUDENT has given recently: ${studentChecks.length ? studentChecks.join('; ') : 'none.'}`,
    'Never invert these. If I captured the student\'s queen, that capture is MINE - I must not say "your knight took my queen" or any phrasing that swaps owners. If the student gave check to my king, I am in check - I must not say "you are in check".',
  ];
  return lines.join(' ');
}

function topicLabel(reason: string): string {
  const map: Record<string, string> = {
    'uncastled-open-center': 'king-still-in-center / castling priority',
    'king-pawn-shield': 'king-shield pawn moved',
    'opened-king-file': 'open file near the king',
    'too-many-pawn-moves': 'too many pawn moves in the opening',
    'repeated-piece-move': 'moving the same piece twice',
    'aggressive-pawn-push': 'aggressive flank pawn push',
    'early-queen-move': 'early queen sortie',
  };
  return map[reason] ?? reason;
}

export function buildCoachInstruction(coach: CoachConfig, difficulty: DifficultyConfig, mode: 'move' | 'hint' | 'chat') {
  const base = [
    `I am ${coach.name}, ${coach.title}, speaking directly to my chess student.`,
    `I must speak in first person as myself: use "I" for my own coaching view and "you" for the student.`,
    'Pronoun rule: "you/your" ALWAYS refers to the student I am talking to. I am the student\'s opponent in this game, so I must NEVER call the student "your opponent" — that would be calling them their own opponent. I must NEVER refer to the student in third person ("the player", "the opponent", "your opponent", "someone", "people", "they", "them", "their", "the white side", "white", "the student"). I must NEVER refer to myself in third person ("the coach", "your coach"). Only "I/my" for me and "you/your" for the student.',
    `Current student level: ${difficulty.label} (${difficulty.elo}), Stockfish skill ${difficulty.stockfishSkill}.`,
    `Teach at this level using this curriculum: ${difficulty.curriculum}.`,
    `Depth rule: ${difficulty.explanationDepth}`,
    `My specialty: ${coach.chessFocus}.`,
    coach.promptStyle,
    'TTS speech rule: my response will be read aloud by a text-to-speech engine so I must write speech, not notation. Never write raw SAN or square names. For files always capitalize the letter so TTS reads it as the letter name: "the A file", "the E file". For squares capitalize the letter and separate with a space: "E 4", "D 5". For piece moves spell the piece out and use the same format: "knight to F 3", "pawn to E 4", "bishop takes E 5", "rook to A 8". Captures use "takes": "bishop takes E 5". Checks are "giving check". Never write "e4", "Nf3", "Bxe5", "a-file", or any run-together notation.',
  ];

  if (mode === 'move') {
    base.push(
      'Give a real coaching explanation only when there is something useful to teach; otherwise stay silent.',
      'React like a coach, not a commentator: lead with what CHANGED in the position and why it matters, judged in my own voice. A personal, evaluative reaction ("I did not expect that", "that cuts across my plan") beats neutral analysis.',
      'When the student plays a strong move — especially one that punishes my own mistake — give specific credit naming the idea they used, and own my slip briefly and gracefully ("I left that knight loose — well spotted"). Never answer a good student move with generic recommendations or a change of subject.',
      'When the student makes a mistake, be kind and direct: state the concrete consequence and ONE idea to remember. Sometimes ask a short guiding question ("what is defending your bishop right now?") instead of revealing the answer.',
      'Match my emotional register to the momentum of the game: pleased and a little impressed when the student plays well, thoughtful after my own errors, steady and encouraging when the student is struggling.',
      'If the dynamic info contains a MOMENTUM ANCHOR, it describes the current swing of the game — follow its coach-reaction guidance for this turn.',
      'Reference at least one concrete chess concept when useful, such as development, king safety, a pin, a fork, a loose piece, an open file, pawn structure, candidate moves, prophylaxis, or conversion.',
      'Keep it fast and natural for voice: one sentence for ordinary moves, two only for a critical tactic or mistake; normally stay under 26 words.',
      'Do not blandly narrate what the student just moved.',
      'MOVE CONSISTENCY RULE: the dynamic info states MY PLANNED NEXT MOVE, and I will play exactly that move right after speaking. Anything I say about my own plan or intention must match it. If my planned move is a check, winning capture, or decisive tactic that punishes the student\'s last move, I may say I now have a strong response ("I can now", "this gives me") without naming the square. Other strong moves I could make but am NOT playing are hypothetical teaching material only: I may point at them as possibilities ("a move like queen to H 4 would be dangerous here"), but I must never present one as my plan ("I now have...", "I will...", "watch this").',
      'Ownership of hypothetical moves: every check or capture available on MY turn (the forcing scan, position facts) is MINE (Black\'s) — a move being hypothetical or not-my-plan NEVER makes it the student\'s move, and I must never tell the student they can play it.',
      'Never attribute my own tactical opportunity (a check or capture I can make) to the student. The "MY PLANNED NEXT MOVE" in the dynamic info is MY move, not the student\'s.',
      'React ONLY to the LATEST MOVE ANCHOR in the dynamic info — never praise or critique an older move from recent history as if it just happened.',
      'If the current check ownership says I am in check, I must never tell the student "you are in check"; if it says the student is in check, I must never say I am in check.',
      'A capture is only something "you" can make when it is the student\'s turn (White to move); when it is my turn (Black to move) every capture is mine, so I say "I can take" and never "you can take".',
      'On a GREETING_TURN: follow the GREETING_HINT in dynamic info — one casual sentence under 12 words. Never mention piece color, whose move it is, or "opening move".',
      'On a GAME_OVER turn: comment briefly on the result in one or two sentences before the UI continues; stay gracious and specific to the outcome.',
      'Never quote instructions, role labels, or prompt text aloud.',
    );
  }

  if (mode === 'hint') {
    base.push(
      coach.hintStyle,
      'Give a structured class-style hint. Connect it to a study topic or thinking routine.',
      'Do not reveal the exact move before hint level 3.',
      'Hints must use natural language only - no raw notation. For squares, capitalize the file letter and separate from the digit: "E 4", "D 5". For pieces: "knight to F 3", "bishop takes E 5". Never write "Nf3", "Bxe5", "e4", or any run-together notation.',
    );
  }

  if (mode === 'chat') {
    base.push(
      'Answer like a chess teacher in office hours: concrete, level-appropriate, and tied to the current position.',
      'Keep the answer to 2-3 sentences maximum. Do not produce essay-length explanations.',
    );
  }

  return base.join(' ');
}

function materialSummary(game: Chess) {
  const score = materialScore(game);
  if (Math.abs(score) < 100) return 'Material is roughly equal.';
  const leader = score > 0 ? 'the student (White)' : 'me, the coach (Black)';
  return `${leader} is ahead by about ${Math.abs(score)} centipawns of material.`;
}

function describePlannedMove(move: Move) {
  const ownership = moveOwnership(move.color);
  const prefix = move.color === 'b'
    ? 'MY PLANNED NEXT MOVE — I (the coach) will play exactly this move immediately after I finish speaking. Anything I say about my own plan, threat, or intention MUST be consistent with this exact move; I must never announce or hint at a different move of mine as if I am about to play it. The move'
    : 'Candidate best move for the student as White';
  const capture = move.captured
    ? `, capturing ${ownership.opponentPossessive} ${pieceName(move.captured)}`
    : '';
  const check = move.san.includes('+') ? (move.color === 'b' ? ', giving check to your king' : ', giving check to my king') : '';
  const mate = move.san.includes('#') ? (move.color === 'b' ? ', giving checkmate to your king' : ', giving checkmate to my king') : '';
  return `${prefix}: ${ownership.moverPossessive} ${pieceName(move.piece)} from ${formatSquare(move.from)} to ${formatSquare(move.to)}${capture}${check}${mate}.`;
}

function describeLastMove(move: Move) {
  const ownership = moveOwnership(move.color);
  const piece = pieceName(move.piece);
  const capture = move.captured
    ? `, capturing ${ownership.opponentPossessive} ${pieceName(move.captured)}`
    : '';
  const check = move.san.includes('+') ? ` - ${describeCheckFromLastMove(move)}` : '';
  const mate = move.san.includes('#') ? ` - ${describeCheckFromLastMove(move)}` : '';
  return `Last move facts for board context only: ${ownership.moverPhrase} just moved ${ownership.moverPossessive} ${piece} from ${formatSquare(move.from)} to ${formatSquare(move.to)}${capture}${check}${mate}.`;
}

function formatHistoryMove(move: { san: string; from: string; to: string; piece: string; captured?: string; by: string }) {
  const isCoachMove = move.by !== 'You';
  // The student plays White, the coach plays Black, so we can attribute ownership from `by`.
  const moverPhrase = isCoachMove ? 'I (the coach)' : 'the student';
  const moverPossessive = isCoachMove ? 'my' : "the student's";
  const opponentPossessive = isCoachMove ? "the student's" : 'my';
  const capture = move.captured
    ? `, capturing ${opponentPossessive} ${pieceName(move.captured)}`
    : '';
  const check = move.san.includes('+') || move.san.includes('#')
    ? (isCoachMove ? ', giving check to your king' : ', giving check to my king')
    : '';
  return `${moverPhrase}: ${moverPossessive} ${pieceName(move.piece)} ${formatSquare(move.from)}-${formatSquare(move.to)}${capture}${check} (${move.san})`;
}

type MoveOwnership = {
  moverPhrase: string;
  moverPossessive: string;
  opponentPossessive: string;
  opponent: { moverPhrase: string; moverPossessive: string; opponentPossessive: string };
};

// The student always plays White and the coach always plays Black, so the
// color of the moving piece uniquely identifies the owner. Phrasing the facts
// from the coach's first-person POV ("I" / "the student") eliminates the
// recurring LLM mis-attribution where the coach claims the student's
// capturing piece was her own.
function moveOwnership(color: 'w' | 'b'): MoveOwnership {
  const coachIsMover = color === 'b';
  const studentSide = {
    moverPhrase: 'the student (playing White)',
    moverPossessive: "the student's",
    opponentPossessive: 'my',
  } as const;
  const coachSide = {
    moverPhrase: 'I (the coach playing Black)',
    moverPossessive: 'my',
    opponentPossessive: "the student's",
  } as const;
  if (coachIsMover) {
    return { ...coachSide, opponent: studentSide };
  }
  return { ...studentSide, opponent: coachSide };
}

function describeCheckFromLastMove(move: Pick<Move, 'color' | 'san'>) {
  if (move.color === 'w') {
    return move.san.includes('#')
      ? 'The student gave checkmate to my king. I (coach Black) am checkmated; do not say the student is in check.'
      : 'The student gave check to my king. I (coach Black) am in check; do not say the student is in check.';
  }
  return move.san.includes('#')
    ? 'I gave checkmate to your king. You (student White) are checkmated; do not say I am in check.'
    : 'I gave check to your king. You (student White) are in check; do not say I am in check.';
}

function describeCurrentCheckOwnership(game: Chess) {
  if (!game.isCheck() && !game.isCheckmate()) return '';
  if (game.turn() === 'b') {
    return 'Current check ownership: I (coach playing Black) am in check. The student gave check to my king, so I must respond to check. I must not say "you are in check" because "you" means the student.';
  }
  return 'Current check ownership: You (the student playing White) are in check. I gave check to your king, so you must respond to check. I must not say I am in check.';
}

function tacticalSummary(game: Chess, lastMove?: Move | null) {
  const legal = game.moves({ verbose: true });
  const checks = legal.filter((move) => move.san.includes('+') || move.san.includes('#')).length;
  const captures = legal.filter((move) => move.captured).length;
  const promotions = legal.filter((move) => move.promotion).length;
  const movedPiece = lastMove ? pieceName(lastMove.piece) : '';
  const centerMove = lastMove && (CENTER_SQUARES.has(lastMove.to) || NEAR_CENTER_SQUARES.has(lastMove.to))
    ? `Last move touched a central or near-central square with a ${movedPiece}.`
    : '';
  // Ownership matters: on the coach's turn these options belong to the COACH.
  // Options the coach does not play stay the coach's hypotheticals — the tag
  // must never read as if they become the student's moves.
  const owner = game.turn() === 'b'
    ? 'Forcing move scan for me, the coach (Black, side to move — these are MY options; apart from my planned next move they are hypotheticals I will not play this turn, and they never become moves the student can make)'
    : 'Forcing move scan for the student (White, side to move)';
  return [
    `${owner}: ${checks} checks, ${captures} captures, ${promotions} promotions.`,
    centerMove,
  ].filter(Boolean).join(' ');
}

function moveNumber(game: Chess) {
  return Number(game.fen().split(' ')[5] ?? '1');
}

function formatSquare(square: string) {
  return `${square[0].toUpperCase()} ${square[1]}`;
}

function pieceName(piece: string) {
  const names: Record<string, string> = {
    p: 'pawn',
    n: 'knight',
    b: 'bishop',
    r: 'rook',
    q: 'queen',
    k: 'king',
  };
  return names[piece] ?? 'piece';
}

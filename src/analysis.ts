import { Chess } from 'chess.js';
import type { MoveSnapshot, AnalysisSummary, KeyMoment } from './storage';

const OPENINGS: Array<{ prefix: string[]; name: string }> = [
  { prefix: ['e4', 'c5'], name: 'Sicilian Defense' },
  { prefix: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'Ruy Lopez' },
  { prefix: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italian Game' },
  { prefix: ['d4', 'Nf6', 'c4', 'g6'], name: "King's Indian Defense" },
  { prefix: ['d4', 'd5', 'c4'], name: "Queen's Gambit" },
  { prefix: ['e4', 'e6'], name: 'French Defense' },
  { prefix: ['e4', 'c6'], name: 'Caro-Kann Defense' },
];

/**
 * Chessbuddy's intentionally strict post-game model.
 *
 * Expected-points boundaries follow Chess.com's published move categories,
 * while the centipawn boundaries make the report remain critical in already
 * won/lost positions where expected points become insensitive. The aggregate
 * combines the mean, harmonic mean, and worst quintile so routine opening
 * moves cannot wash out a tactical collapse. See docs/critical-accuracy-model.md.
 */
const CRITICAL_MODEL = {
  expectedLoss: { inaccuracy: 5, mistake: 10, blunder: 20 },
  centipawnLoss: { inaccuracy: 50, mistake: 120, blunder: 250 },
  perMoveCeiling: { Inaccuracy: 84, Mistake: 69, Blunder: 39 },
  aggregateWeight: { mean: 0.3, harmonic: 0.3, worstQuintile: 0.4 },
  gameCaps: {
    blunder: [99, 84, 74, 64, 54],
    mistake: [99, 92, 87, 82, 77],
  },
} as const;

export type PositionEval = {
  bestSan: string | null;
  whiteCp: number;
};

export type EvalProvider = (fen: string) => Promise<PositionEval | null>;

type MoveLabel = 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';

type GradedMove = {
  move: MoveSnapshot;
  moveNumber: number;
  bestSan: string | null;
  label: MoveLabel;
  accuracy: number;
  centipawnLoss: number;
  expectedLoss: number;
  consequenceWeight: number;
};

export async function analyzeGame(
  moves: MoveSnapshot[],
  finalFen: string,
  evalProvider: EvalProvider,
): Promise<AnalysisSummary> {
  const opening = identifyOpening(moves.map((move) => move.san));
  const userMoves = moves
    .map((move, historyIndex) => ({ move, historyIndex }))
    .filter(({ move }) => move.color === 'w');
  const gradedMoves: GradedMove[] = [];

  // Grade every player move. A failed engine sample is unknown data and is
  // excluded from the score; it must never silently become a 100% move.
  for (const { move, historyIndex } of userMoves) {
    const before = sanitizeEvaluation(await evalProvider(move.fenBefore));
    if (!before) continue;

    const playedBest = before.bestSan
      ? normalizeSan(before.bestSan) === normalizeSan(move.san)
      : false;
    let whiteCpAfter = before.whiteCp;
    if (!playedBest) {
      const after = sanitizeEvaluation(await evalProvider(move.fenAfter));
      if (!after) continue;
      whiteCpAfter = after.whiteCp;
    }

    const expectedLoss = Math.max(0, winPercent(before.whiteCp) - winPercent(whiteCpAfter));
    const centipawnLoss = Math.max(0, before.whiteCp - whiteCpAfter);
    const label = playedBest ? 'Good' : classifyMove(expectedLoss, centipawnLoss);
    const accuracy = playedBest
      ? 100
      : criticalMoveAccuracy(expectedLoss, centipawnLoss, label);

    gradedMoves.push({
      move,
      moveNumber: Math.ceil((historyIndex + 1) / 2),
      bestSan: before.bestSan,
      label,
      accuracy,
      centipawnLoss,
      expectedLoss,
      consequenceWeight: consequenceWeight(label, expectedLoss, centipawnLoss),
    });
  }

  const inaccuracies = gradedMoves.filter(({ label }) => label === 'Inaccuracy').length;
  const mistakes = gradedMoves.filter(({ label }) => label === 'Mistake').length;
  const blunders = gradedMoves.filter(({ label }) => label === 'Blunder').length;
  const whiteAccuracy = gradedMoves.length
    ? clampAccuracy(Math.round(overallCriticalAccuracy(gradedMoves, { mistakes, blunders })))
    : 0;
  const averageCentipawnLoss = gradedMoves.length
    ? Math.round(gradedMoves.reduce((sum, grade) => sum + grade.centipawnLoss, 0) / gradedMoves.length)
    : 0;

  const keyMoments = gradedMoves
    .filter(({ label }) => label !== 'Good')
    .sort(compareCriticality)
    .slice(0, 5)
    .sort((a, b) => a.moveNumber - b.moveNumber)
    .map<KeyMoment>((grade) => ({
      moveNumber: grade.moveNumber,
      label: grade.label,
      description: describeMoment(grade.move, grade.bestSan, grade.label),
      bestMove: grade.bestSan ?? undefined,
    }));

  return {
    opening,
    whiteAccuracy,
    blackAccuracy: estimateBlackAccuracy(moves, finalFen),
    inaccuracies,
    mistakes,
    blunders,
    gradedMoves: gradedMoves.length,
    totalUserMoves: userMoves.length,
    averageCentipawnLoss,
    scoringModel: 'critical-v1',
    keyMoments: keyMoments.length ? keyMoments : fallbackMoments(moves),
    tips: buildTips({ inaccuracies, mistakes, blunders }, moves),
  };
}

function sanitizeEvaluation(evaluation: PositionEval | null): PositionEval | null {
  if (!evaluation || !Number.isFinite(evaluation.whiteCp)) return null;
  return {
    bestSan: typeof evaluation.bestSan === 'string' ? evaluation.bestSan : null,
    whiteCp: Math.max(-10_000, Math.min(10_000, evaluation.whiteCp)),
  };
}

// Lichess's public centipawn-to-winning-chances conversion. Values beyond
// +/-1000cp are intentionally saturated because the expected outcome is then
// nearly certain; raw centipawn loss still catches damage in those positions.
function winPercent(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

function criticalMoveAccuracy(
  expectedLoss: number,
  centipawnLoss: number,
  label: MoveLabel,
): number {
  const outcomeAccuracy = 103.1668 * Math.exp(-0.04354 * expectedLoss) - 3.1669;
  // This second curve is intentionally stricter than outcome-only accuracy.
  // It prevents a 3-5 pawn loss from looking harmless merely because the game
  // was already statistically close to decided.
  const evaluationAccuracy = 100 * Math.exp(-0.005 * Math.min(2000, centipawnLoss));
  const categoryCeiling = label === 'Good' ? 100 : CRITICAL_MODEL.perMoveCeiling[label];
  return Math.max(0, Math.min(100, outcomeAccuracy, evaluationAccuracy, categoryCeiling));
}

function classifyMove(expectedLoss: number, centipawnLoss: number): MoveLabel {
  if (
    expectedLoss >= CRITICAL_MODEL.expectedLoss.blunder
    || centipawnLoss >= CRITICAL_MODEL.centipawnLoss.blunder
  ) return 'Blunder';
  if (
    expectedLoss >= CRITICAL_MODEL.expectedLoss.mistake
    || centipawnLoss >= CRITICAL_MODEL.centipawnLoss.mistake
  ) return 'Mistake';
  if (
    expectedLoss >= CRITICAL_MODEL.expectedLoss.inaccuracy
    || centipawnLoss >= CRITICAL_MODEL.centipawnLoss.inaccuracy
  ) return 'Inaccuracy';
  return 'Good';
}

function consequenceWeight(
  label: MoveLabel,
  expectedLoss: number,
  centipawnLoss: number,
): number {
  const labelWeight = label === 'Blunder'
    ? 2.5
    : label === 'Mistake'
      ? 1.8
      : label === 'Inaccuracy'
        ? 1.25
        : 1;
  const measuredDamage = Math.min(1, Math.max(expectedLoss / 40, centipawnLoss / 600));
  return labelWeight + measuredDamage;
}

function overallCriticalAccuracy(
  grades: GradedMove[],
  counts: { mistakes: number; blunders: number },
): number {
  const totalWeight = grades.reduce((sum, grade) => sum + grade.consequenceWeight, 0);
  const weightedMean = grades.reduce(
    (sum, grade) => sum + grade.accuracy * grade.consequenceWeight,
    0,
  ) / totalWeight;
  const harmonic = totalWeight / grades.reduce(
    (sum, grade) => sum + grade.consequenceWeight / Math.max(1, grade.accuracy),
    0,
  );

  const worstCount = Math.max(1, Math.ceil(grades.length * 0.2));
  const worstMoves = [...grades]
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, worstCount);
  const worstWeight = worstMoves.reduce((sum, grade) => sum + grade.consequenceWeight, 0);
  const worstQuintile = worstMoves.reduce(
    (sum, grade) => sum + grade.accuracy * grade.consequenceWeight,
    0,
  ) / worstWeight;

  const blended = (
    weightedMean * CRITICAL_MODEL.aggregateWeight.mean
    + harmonic * CRITICAL_MODEL.aggregateWeight.harmonic
    + worstQuintile * CRITICAL_MODEL.aggregateWeight.worstQuintile
  );
  return Math.min(blended, severityCap(counts));
}

function severityCap({ mistakes, blunders }: { mistakes: number; blunders: number }): number {
  const blunderCap = CRITICAL_MODEL.gameCaps.blunder[
    Math.min(blunders, CRITICAL_MODEL.gameCaps.blunder.length - 1)
  ];
  const mistakeCap = CRITICAL_MODEL.gameCaps.mistake[
    Math.min(mistakes, CRITICAL_MODEL.gameCaps.mistake.length - 1)
  ];
  return Math.min(blunderCap, mistakeCap);
}

function compareCriticality(a: GradedMove, b: GradedMove): number {
  return (
    b.consequenceWeight - a.consequenceWeight
    || a.accuracy - b.accuracy
    || a.moveNumber - b.moveNumber
  );
}

export function identifyOpening(sans: string[]): string {
  for (const opening of OPENINGS) {
    if (opening.prefix.every((san, index) => normalizeSan(sans[index] ?? '') === normalizeSan(san))) {
      return opening.name;
    }
  }
  return 'Unclassified opening';
}

function normalizeSan(san: string): string {
  return san.replace(/[+#?!]/g, '');
}

function describeMoment(move: MoveSnapshot, best: string | null, label: string): string {
  const betterClause = best ? ` Stockfish preferred ${best}.` : '';
  const candidateClause = best ? ` A stronger candidate was ${best}.` : '';
  const pressureClause = best ? ` ${best} kept more pressure.` : '';
  if (label === 'Blunder') return `${move.san} significantly worsened your position.${betterClause}`;
  if (label === 'Mistake') return `${move.san} gave up a clearer chance.${candidateClause}`;
  return `${move.san} was playable, but${pressureClause || ' there was more to be had.'}`;
}

function fallbackMoments(moves: MoveSnapshot[]): KeyMoment[] {
  return moves.slice(Math.max(0, moves.length - 3)).map((move, index) => ({
    moveNumber: Math.ceil((moves.length - 2 + index) / 2),
    label: 'Review',
    description: `${move.by} played ${move.san}. Replay this moment and check piece safety before moving on.`,
  }));
}

function buildTips(
  counts: { inaccuracies: number; mistakes: number; blunders: number },
  moves: MoveSnapshot[],
): string[] {
  const tips: string[] = [];
  const capturesMissed = counts.mistakes + counts.blunders;
  if (capturesMissed > 0) tips.push('Before each move, scan for checks, captures, and direct threats.');
  if (moves.some((move) => move.piece === 'q' && moves.indexOf(move) < 10)) {
    tips.push('Delay early queen adventures unless they win something concrete.');
  }
  if (moves.filter((move) => move.color === 'w' && move.piece === 'p').length > 6) {
    tips.push('After opening the center, develop pieces before making extra pawn moves.');
  }
  if (tips.length < 2) tips.push('Keep asking what your least active piece should do next.');
  if (tips.length < 3) tips.push('Use the hint button when the position has checks or loose pieces.');
  return tips.slice(0, 3);
}

function estimateBlackAccuracy(moves: MoveSnapshot[], finalFen: string): number {
  const game = new Chess(finalFen);
  if (game.isCheckmate() && game.turn() === 'w') return 88;
  const blackCaptures = moves.filter((move) => move.color === 'b' && move.captured).length;
  return clampAccuracy(76 + Math.min(14, blackCaptures * 3));
}

function clampAccuracy(value: number): number {
  return Math.max(5, Math.min(99, value));
}

import type { DifficultyId } from './coachConfig';
import puzzleData from './puzzles.json';

export type Puzzle = {
  id: string;
  title: string;
  /** Plain-language snapshot of the position — who is on the board, who moves, and what the tension is. */
  positionSummary: string;
  fen: string;
  sideToMove: 'w' | 'b';
  difficultyId: DifficultyId;
  theme: string;
  /**
   * Full solution line in SAN: player moves at even indices, scripted
   * opponent replies at odd indices. Always odd length (ends on a player
   * move). PuzzleScreen walks the whole line, auto-playing the replies.
   */
  solution: string[];
  hints: string[];
  explanation: string;
};

/**
 * The data lives in puzzles.json so scripts/verify-puzzles.mjs can read it
 * directly. Every puzzle is machine-verified with chess.js + Stockfish
 * (depth 16) before shipping:
 *  - every player move is the engine's best AND uniquely best (>=150cp gap
 *    over the second-best move, or the only fast mate) — required because
 *    the app grades by exact SAN match per step;
 *  - every scripted opponent reply is a real defense (within 60cp of the
 *    engine's best), never a helper blunder;
 *  - the final position is decisively won for the puzzle side (mate, forced
 *    mate, or >= +300cp);
 *  - check/mate suffixes in the SAN are accurate.
 * Run `node scripts/verify-puzzles.mjs` after ANY edit to this data.
 */
export const PUZZLES: Puzzle[] = puzzleData as Puzzle[];

export function puzzleScore(hintsUsed: number, completed: boolean): number {
  if (!completed) return 0;
  if (hintsUsed <= 0) return 100;
  if (hintsUsed === 1) return 60;
  if (hintsUsed === 2) return 30;
  return 10;
}

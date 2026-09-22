import { Chess, type Move } from 'chess.js';
import type { KeyMoment } from './storage';
import type { MoveRecord } from './types';

export function toRecord(move: Move, by: string, fenBefore: string, fenAfter: string): MoveRecord {
  return { san: move.san, from: move.from, to: move.to, piece: move.piece, captured: move.captured, color: move.color, by, fenBefore, fenAfter };
}

export function moveRecordToMoveLike(move: MoveRecord) {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured,
    color: move.color,
  } as Move;
}

export function pieceName(piece: string) {
  const names: Record<string, string> = {
    p: 'Pawn',
    n: 'Knight',
    b: 'Bishop',
    r: 'Rook',
    q: 'Queen',
    k: 'King',
  };
  return names[piece] ?? 'Piece';
}

export function buildHintText(level: number, best: Move | null, coachName: string) {
  if (!best) return `${coachName}: Look for checks, captures, and threats before choosing a quiet move.`;
  if (level === 1) return `${coachName}: Start with forcing moves — which of your pieces can become more active?`;
  if (level === 2) return `${coachName}: The idea involves your ${pieceName(best.piece).toLowerCase()} — look for a square where it creates immediate pressure.`;
  const toFile = best.to[0].toUpperCase();
  const toRank = best.to[1];
  const action = best.captured ? 'takes' : 'to';
  return `${coachName}: Move your ${pieceName(best.piece).toLowerCase()} ${action} ${toFile} ${toRank}. That is the best move in this position.`;
}

export function getStatus(game: Chess, coachName: string) {
  if (game.isCheckmate()) return game.turn() === 'w' ? `Checkmate. ${coachName} wins.` : 'Checkmate. You win.';
  if (game.isStalemate()) return 'Stalemate. No legal move is available.';
  if (game.isDraw()) return 'Drawn position.';
  if (game.isCheck()) return 'Check. The king needs attention.';
  return game.turn() === 'w' ? 'Your move — choose a piece.' : `${coachName} to move.`;
}

export function resultLabel(game: Chess, coachName: string, resigned = false) {
  if (resigned) return `${coachName} won by resignation`;
  if (!game.isGameOver()) return 'In progress';
  if (game.isCheckmate()) return game.turn() === 'w' ? `${coachName} won by checkmate` : 'You won by checkmate';
  if (game.isStalemate()) return 'Draw by stalemate';
  return 'Draw';
}

export function normalizeSan(san: string) {
  return san.replace(/[+#?!]/g, '');
}

export type MovePairEntry = { san: string; historyIdx: number; color: 'w' | 'b' };

export function buildMovePairs(history: MoveRecord[]): [MovePairEntry | null, MovePairEntry | null][] {
  const pairs: [MovePairEntry | null, MovePairEntry | null][] = [];
  for (let i = 0; i < history.length; i += 2) {
    const w = history[i] ? { san: history[i].san, historyIdx: i, color: history[i].color } : null;
    const b = history[i + 1] ? { san: history[i + 1].san, historyIdx: i + 1, color: history[i + 1].color } : null;
    pairs.push([w, b]);
  }
  return pairs;
}

export function buildErrorMap(keyMoments: KeyMoment[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const km of keyMoments) {
    map.set(km.moveNumber, km.label);
  }
  return map;
}

export function getChipClass(historyIdx: number, history: MoveRecord[], errorMap: Map<number, string>): string {
  const move = history[historyIdx];
  if (!move || move.color !== 'w') return '';
  const moveNumber = Math.ceil((historyIdx + 1) / 2);
  const label = errorMap.get(moveNumber);
  if (!label) return 'good';
  return label.toLowerCase();
}

export function describeAccuracy(acc: number): string {
  if (acc >= 95) return 'Exceptional — no meaningful errors found';
  if (acc >= 90) return 'Strong — precise with only small misses';
  if (acc >= 80) return 'Solid, but important improvements remain';
  if (acc >= 70) return 'Mixed — several decisions need review';
  if (acc >= 55) return 'Inconsistent — tactical errors shaped the game';
  return 'Critical review needed — focus on checks, captures, and threats';
}

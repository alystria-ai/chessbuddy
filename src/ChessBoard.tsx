import type { CSSProperties } from 'react';
import { Chess, type Square } from 'chess.js';
import type { MoveSnapshot } from './storage';
import type { MoveRecord } from './types';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECES: Record<string, string> = {
  wp: '\u2659',
  wn: '\u2658',
  wb: '\u2657',
  wr: '\u2656',
  wq: '\u2655',
  wk: '\u2654',
  bp: '\u265f',
  bn: '\u265e',
  bb: '\u265d',
  br: '\u265c',
  bq: '\u265b',
  bk: '\u265a',
};

function squareAt(fileIndex: number, rankIndex: number): Square {
  return `${FILES[fileIndex]}${8 - rankIndex}` as Square;
}

/** The square of `color`'s king (for the in-check highlight), or null. */
export function kingSquareOf(game: Chess, color: 'w' | 'b'): Square | null {
  const board = game.board();
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece && piece.type === 'k' && piece.color === color) {
        return squareAt(file, rank);
      }
    }
  }
  return null;
}

export function ChessBoard({
  game,
  selected,
  legalMoves,
  lastMove,
  checkSquare,
  onSquareClick,
  orientation = 'w',
  disabled = false,
  className,
  style,
}: {
  game: Chess;
  selected?: Square | null;
  legalMoves?: Square[];
  lastMove?: Pick<MoveSnapshot, 'from' | 'to'> | null;
  /** King square to mark with the pulsing in-check highlight. */
  checkSquare?: Square | null;
  onSquareClick?: (square: Square) => void;
  orientation?: 'w' | 'b';
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const rankLabels = orientation === 'w'
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];
  const fileLabels = orientation === 'w' ? FILES : [...FILES].slice().reverse();
  return (
    <div className={`board-wrap${disabled ? ' is-disabled' : ''} ${className ?? ''}`.trim()} style={style}>
      <div className="rank-labels">
        {rankLabels.map((rank) => <span key={rank}>{rank}</span>)}
      </div>
      <div className="chess-board">
        {Array.from({ length: 8 }).map((_, rankIndex) =>
          Array.from({ length: 8 }).map((__, fileIndex) => {
            const fileIdx = orientation === 'w' ? fileIndex : 7 - fileIndex;
            const rankIdx = orientation === 'w' ? rankIndex : 7 - rankIndex;
            const square = squareAt(fileIdx, rankIdx);
            const piece = game.get(square);
            const isLight = (rankIdx + fileIdx) % 2 === 0;
            const isSelected = selected === square;
            const isTarget = legalMoves?.includes(square);
            const isLastMove = lastMove?.from === square || lastMove?.to === square;
            const isCheck = checkSquare === square;
            return (
              <button
                className={[
                  'square',
                  isLight ? 'light' : 'dark',
                  isSelected ? 'selected' : '',
                  isTarget ? 'target' : '',
                  isLastMove ? 'last-move' : '',
                  isCheck ? 'in-check' : '',
                ].join(' ')}
                key={square}
                disabled={disabled}
                onClick={() => onSquareClick?.(square)}
                aria-label={`${square}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ''}`}
              >
                {piece && <span className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`}>{PIECES[`${piece.color}${piece.type}`]}</span>}
              </button>
            );
          }),
        )}
      </div>
      <div className="file-labels">
        {fileLabels.map((file) => <span key={file}>{file}</span>)}
      </div>
    </div>
  );
}

export function miniBoardFocusStyle(move: Pick<MoveRecord, 'from' | 'to'>): CSSProperties {
  const viewport = 178;
  const board = 300;
  const from = squareCenter(move.from);
  const to = squareCenter(move.to);
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;
  const x = Math.min(0, Math.max(viewport - board, viewport / 2 - centerX * board));
  const y = Math.min(0, Math.max(viewport - board, viewport / 2 - centerY * board));
  return {
    '--focus-x': `${x}px`,
    '--focus-y': `${y}px`,
  } as CSSProperties;
}

function squareCenter(square: string) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return {
    x: (file + 0.5) / 8,
    y: (8 - rank + 0.5) / 8,
  };
}

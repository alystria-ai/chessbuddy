// Debug helper: take a FEN + candidate SAN list and report material outcome
// after a few plies of greedy / minimax search.
//
// Use: edit `positions` below and run `node scripts/debug-puzzle.mjs`.

import { Chess } from 'chess.js';

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function materialEval(game) {
  let score = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const v = VALUES[piece.type] ?? 0;
      score += piece.color === 'w' ? v : -v;
    }
  }
  return score;
}

function negamax(game, depth, alpha, beta, maxDepth) {
  if (game.isCheckmate()) return -100000 + (maxDepth - depth);
  if (game.isDraw() || game.isStalemate()) return 0;
  if (depth === 0) {
    const sign = game.turn() === 'w' ? 1 : -1;
    return sign * materialEval(game);
  }
  let best = -Infinity;
  const moves = game.moves({ verbose: true });
  moves.sort((a, b) => {
    const av = a.captured ? VALUES[a.captured] ?? 0 : 0;
    const bv = b.captured ? VALUES[b.captured] ?? 0 : 0;
    return bv - av;
  });
  for (const move of moves) {
    game.move(move);
    const score = -negamax(game, depth - 1, -beta, -alpha, maxDepth);
    game.undo();
    if (score > best) {
      best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
  }
  return best;
}

function scoreMove(fen, san, depth) {
  const game = new Chess(fen);
  game.move(san);
  return -negamax(game, depth - 1, -Infinity, Infinity, depth);
}

function topMoves(fen, depth, topN = 6) {
  const game = new Chess(fen);
  const scored = [];
  for (const san of game.moves()) {
    const s = scoreMove(fen, san, depth);
    scored.push({ san, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

const positions = [
  { id: 'beg-queen-fork (Qa4+ proposal)', fen: 'r3k3/8/8/8/8/8/8/3QK3 w - - 0 1' },
  { id: 'beg-queen-fork (Qe2+ alternative)', fen: '4k3/8/r7/8/8/8/8/3QK3 w - - 0 1' },
  { id: 'beg-discover-check (Bxf7+ current)', fen: 'q3k3/5R2/8/3b4/8/8/8/7K b - - 0 1' },
  { id: 'beg-queen-fork-2', fen: '1r5k/7b/8/8/8/8/8/4K2Q w - - 0 1' },
  { id: 'beg-queen-fork-2 (rook moved to a8)', fen: 'r6k/7b/8/8/8/8/8/4K2Q w - - 0 1' },
  { id: 'int-zwischenzug', fen: '4r1k1/6pp/8/3B4/8/8/6PP/4R1K1 w - - 0 1' },
  { id: 'int-zwischenzug (king on f8 design)', fen: '4rk2/5ppp/8/3B4/8/8/5PPP/4R1K1 w - - 0 1' },
  { id: 'int-queen-rank-fork', fen: '8/8/8/1r4k1/8/8/8/4QK2 w - - 0 1' },
  { id: 'int-queen-rank-fork (Qe4+ design)', fen: 'r7/8/6k1/8/8/8/8/4QK2 w - - 0 1' },
  { id: 'int-disc-attack', fen: '3r2k1/5ppp/8/3B4/8/8/5PPP/3R2K1 w - - 0 1' },
];

const DEPTH = 4;
for (const { id, fen } of positions) {
  console.log(`\n=== ${id} ===`);
  console.log(`FEN: ${fen}`);
  const top = topMoves(fen, DEPTH, 6);
  for (const { san, score } of top) {
    console.log(`  ${san.padEnd(10)} score=${score}`);
  }
}

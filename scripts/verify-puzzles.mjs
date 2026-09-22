/**
 * Puzzle verification with chess.js + Stockfish.
 *
 * Usage:
 *   node scripts/verify-puzzles.mjs                 # verifies src/puzzles.json
 *   node scripts/verify-puzzles.mjs candidates.json # verifies a candidate file
 *   node scripts/verify-puzzles.mjs --depth 18      # deeper (slower) search
 *
 * A puzzle passes only if ALL of the following hold:
 *  - the FEN parses, the side to move matches `sideToMove`, and the solution
 *    is a non-empty odd-length SAN line (player moves at even indices,
 *    scripted opponent replies at odd indices);
 *  - every move in the line is legal in sequence, and '#'/'+' suffixes are
 *    accurate (checkmate/check actually delivered);
 *  - every PLAYER move is the engine's best move AND uniquely best:
 *      * best is mate and the alternative is not, or
 *      * both mate but the alternative is >= 2 moves slower, or
 *      * neither mates and the gap is >= UNIQUE_GAP_CP centipawns
 *    (exact-SAN grading in the app means a second equally-good move would
 *    mark a correct player wrong);
 *  - every OPPONENT reply is a real defense: within REPLY_TOLERANCE_CP of the
 *    engine's best defense (no scripted blunders that fake the tactic);
 *  - the position after the full line is decisively won for the puzzle side:
 *    checkmate, a forced mate, or eval >= WIN_THRESHOLD_CP (kills "win a
 *    queen into a dead draw" compositions).
 *
 * The old version of this script only checked SAN legality — which is how a
 * broken set shipped as "verified".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';

const require = createRequire(import.meta.url);
const initEngine = require('stockfish');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const depthFlag = args.indexOf('--depth');
const DEPTH = depthFlag >= 0 ? Number(args[depthFlag + 1]) : 16;
const fileArg = args.find((a, i) => !a.startsWith('--') && (depthFlag < 0 || i !== depthFlag + 1));
const PUZZLE_FILE = fileArg
  ? path.resolve(process.cwd(), fileArg)
  : path.join(__dirname, '..', 'src', 'puzzles.json');

const UNIQUE_GAP_CP = 150;
const REPLY_TOLERANCE_CP = 60;
const WIN_THRESHOLD_CP = 300;
const MATE_SCORE = 100000;

/** Convert a UCI score to a single comparable number (side-to-move view). */
function scoreValue(s) {
  if (!s) return null;
  if (s.mate !== undefined) {
    return s.mate > 0 ? MATE_SCORE - s.mate * 100 : -MATE_SCORE - s.mate * 100;
  }
  return s.cp;
}

function describeScore(s) {
  if (!s) return 'n/a';
  if (s.mate !== undefined) return `mate ${s.mate}`;
  return `${s.cp}cp`;
}

async function createEngine() {
  const engine = await initEngine('lite-single');
  let handler = null;
  const dispatch = (line) => { if (handler) handler(String(line)); };
  engine.print = dispatch;
  engine.listener = dispatch;

  const send = (cmd) => engine.sendCommand(cmd);

  function expect(pattern) {
    return new Promise((resolve) => {
      const lines = [];
      handler = (line) => {
        lines.push(line);
        if (pattern.test(line)) {
          handler = null;
          resolve(lines);
        }
      };
    });
  }

  send('uci');
  await expect(/^uciok/);
  send('setoption name MultiPV value 2');
  send('isready');
  await expect(/^readyok/);

  return {
    /**
     * Search a position. Returns { best: {move, score}, second: {move, score} | null }.
     * `searchmoves` restricts the search to specific UCI moves.
     */
    async search(fen, { searchmoves = null, multipv = 2 } = {}) {
      send(`setoption name MultiPV value ${multipv}`);
      send('isready');
      await expect(/^readyok/);
      send('ucinewgame');
      send(`position fen ${fen}`);
      const done = expect(/^bestmove/);
      send(`go depth ${DEPTH}${searchmoves ? ` searchmoves ${searchmoves.join(' ')}` : ''}`);
      const lines = await done;

      // Keep the deepest info line per multipv slot.
      const slots = new Map();
      for (const line of lines) {
        const m = /^info depth (\d+) .*?multipv (\d+) score (cp|mate) (-?\d+).*? pv (\S+)/.exec(line);
        if (!m) continue;
        const [, d, pv, kind, val, move] = m;
        const prev = slots.get(Number(pv));
        if (!prev || Number(d) >= prev.depth) {
          slots.set(Number(pv), {
            depth: Number(d),
            move,
            score: kind === 'mate' ? { mate: Number(val) } : { cp: Number(val) },
          });
        }
      }
      return { best: slots.get(1) ?? null, second: slots.get(2) ?? null };
    },
    quit() {
      try { send('quit'); } catch { /* wasm teardown is best-effort */ }
    },
  };
}

function sanToUci(game, san) {
  try {
    const probe = new Chess(game.fen());
    const move = probe.move(san);
    if (!move) return null;
    return move.from + move.to + (move.promotion ?? '');
  } catch {
    // chess.js v1 throws on illegal SAN.
    return null;
  }
}

async function verifyPuzzle(engine, puzzle) {
  const errors = [];
  const warnings = [];

  let game;
  try {
    game = new Chess(puzzle.fen);
  } catch (err) {
    return { errors: [`FEN invalid: ${err.message}`], warnings };
  }

  if (game.turn() !== puzzle.sideToMove) {
    errors.push(`sideToMove=${puzzle.sideToMove} but FEN says ${game.turn()} to move`);
    return { errors, warnings };
  }
  if (!Array.isArray(puzzle.solution) || puzzle.solution.length === 0) {
    errors.push('solution is empty');
    return { errors, warnings };
  }
  if (puzzle.solution.length % 2 === 0) {
    errors.push(`solution has ${puzzle.solution.length} moves — must end on a player move (odd length)`);
  }

  for (let step = 0; step < puzzle.solution.length; step++) {
    const san = puzzle.solution[step];
    const isPlayerMove = step % 2 === 0;
    const fenBefore = game.fen();
    const uci = sanToUci(game, san);
    if (!uci) {
      errors.push(`step ${step}: "${san}" is not legal in ${fenBefore}`);
      break;
    }

    if (isPlayerMove) {
      const { best, second } = await engine.search(fenBefore);
      if (!best) {
        errors.push(`step ${step}: engine returned no line`);
        break;
      }
      if (best.move !== uci) {
        errors.push(
          `step ${step}: "${san}" (${uci}) is not the engine's best move — engine prefers ${best.move} (${describeScore(best.score)})`,
        );
      } else if (second) {
        const v1 = scoreValue(best.score);
        const v2 = scoreValue(second.score);
        const bestMates = best.score.mate !== undefined && best.score.mate > 0;
        const secondMates = second.score.mate !== undefined && second.score.mate > 0;
        let unique;
        if (bestMates && !secondMates) unique = true;
        else if (bestMates && secondMates) unique = second.score.mate >= best.score.mate + 2;
        else unique = v1 - v2 >= UNIQUE_GAP_CP;
        if (!unique) {
          errors.push(
            `step ${step}: "${san}" is not UNIQUELY best — ${second.move} scores ${describeScore(second.score)} vs ${describeScore(best.score)} (exact-match grading would reject a fine alternative)`,
          );
        }
      }
    } else {
      // Scripted opponent reply: must be a real defense, not a helper blunder.
      const { best } = await engine.search(fenBefore, { multipv: 1 });
      if (best && best.move !== uci) {
        const { best: played } = await engine.search(fenBefore, { searchmoves: [uci], multipv: 1 });
        const bestV = scoreValue(best.score);
        const playedV = scoreValue(played?.score);
        if (playedV === null || bestV - playedV > REPLY_TOLERANCE_CP) {
          errors.push(
            `step ${step}: scripted reply "${san}" is a poor defense — engine best ${best.move} (${describeScore(best.score)}) vs played (${describeScore(played?.score)})`,
          );
        }
      }
    }

    const move = game.move(san);
    const claimsMate = san.endsWith('#');
    const claimsCheck = !claimsMate && san.includes('+');
    if (claimsMate && !game.isCheckmate()) errors.push(`step ${step}: "${san}" claims mate but is not mate`);
    if (!claimsMate && game.isCheckmate()) errors.push(`step ${step}: "${san}" IS mate but lacks the # suffix`);
    if (claimsCheck && !game.inCheck()) errors.push(`step ${step}: "${san}" claims check but gives none`);
    if (!claimsCheck && !claimsMate && game.inCheck()) errors.push(`step ${step}: "${san}" gives check but lacks the + suffix`);
    void move;
  }

  // Final position must be decisively won for the puzzle side.
  if (errors.length === 0) {
    if (!game.isCheckmate()) {
      const { best } = await engine.search(game.fen(), { multipv: 1 });
      if (!best) {
        errors.push('final position: engine returned no line');
      } else {
        // Score is from the DEFENDER's perspective (they move next).
        const v = scoreValue(best.score);
        const defenderMated = best.score.mate !== undefined && best.score.mate < 0;
        if (!defenderMated && -v < WIN_THRESHOLD_CP) {
          errors.push(
            `final position not decisively won: defender's eval ${describeScore(best.score)} (need puzzle side >= +${WIN_THRESHOLD_CP}cp or mate)`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(PUZZLE_FILE, 'utf-8'));
  const puzzles = Array.isArray(raw) ? raw : raw.puzzles;
  console.log(`Verifying ${puzzles.length} puzzle(s) from ${PUZZLE_FILE} at depth ${DEPTH}\n`);

  const engine = await createEngine();
  let failCount = 0;

  const seenFens = new Map();
  for (const puzzle of puzzles) {
    const dup = seenFens.get(puzzle.fen);
    if (dup) console.log(`⚠️  ${puzzle.id}: duplicate FEN of ${dup}`);
    seenFens.set(puzzle.fen, puzzle.id);

    const { errors } = await verifyPuzzle(engine, puzzle);
    if (errors.length === 0) {
      console.log(`✅ PASS ${puzzle.id}  [${puzzle.difficultyId}] ${puzzle.solution.join(' ')}`);
    } else {
      failCount++;
      console.log(`❌ FAIL ${puzzle.id}  [${puzzle.difficultyId}]`);
      for (const e of errors) console.log(`     - ${e}`);
    }
  }

  engine.quit();
  console.log(`\n${puzzles.length - failCount}/${puzzles.length} passed`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

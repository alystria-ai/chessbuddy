import { describe, expect, it } from 'vitest';
import { analyzeGame, identifyOpening, type EvalProvider } from './analysis';
import type { MoveSnapshot } from './storage';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('analysis helpers', () => {
  it('identifies common openings from SAN prefixes', () => {
    expect(identifyOpening(['e4', 'c5', 'Nf3'])).toBe('Sicilian Defense');
    expect(identifyOpening(['d4', 'd5', 'c4'])).toBe("Queen's Gambit");
  });

  it('falls back for unknown openings', () => {
    expect(identifyOpening(['h4', 'a5'])).toBe('Unclassified opening');
  });
});

// Build a white move snapshot whose positions are tagged so a stub eval provider
// can look them up. `cpBefore`/`cpAfter` are white-relative centipawns, and
// `best` marks whether the player matched the engine's top move.
function whiteMove(
  index: number,
  san: string,
  cpBefore: number,
  cpAfter: number,
  best: boolean,
): { snapshot: MoveSnapshot; cpBefore: number; cpAfter: number; bestSan: string } {
  const fenBefore = `before-${index}`;
  const fenAfter = `after-${index}`;
  return {
    snapshot: {
      san,
      from: 'a1',
      to: 'a2',
      piece: 'p',
      color: 'w',
      by: 'You',
      fenBefore,
      fenAfter,
    },
    cpBefore,
    cpAfter,
    bestSan: best ? san : 'Zz9', // a SAN the player could never have played
  };
}

function providerFor(entries: ReturnType<typeof whiteMove>[]): EvalProvider {
  const byFen = new Map<string, { bestSan: string | null; whiteCp: number }>();
  for (const entry of entries) {
    byFen.set(entry.snapshot.fenBefore, { bestSan: entry.bestSan, whiteCp: entry.cpBefore });
    byFen.set(entry.snapshot.fenAfter, { bestSan: null, whiteCp: entry.cpAfter });
  }
  return async (fen: string) => byFen.get(fen) ?? null;
}

describe('analyzeGame accuracy model', () => {
  it('scores a clean game near the top of the range', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => whiteMove(i, 'e4', 30, 30, true));
    const moves = entries.map((e) => e.snapshot);
    const summary = await analyzeGame(moves, START_FEN, providerFor(entries));

    expect(summary.whiteAccuracy).toBeGreaterThanOrEqual(95);
    expect(summary.blunders).toBe(0);
    expect(summary.mistakes).toBe(0);
    expect(summary.inaccuracies).toBe(0);
  });

  it('does not reward a game full of blunders with a high score', async () => {
    // 4 good moves, 3 mistakes (~18% win drop), 3 blunders (~42% win drop).
    const entries = [
      whiteMove(0, 'e4', 30, 30, true),
      whiteMove(1, 'Nf3', 30, 30, true),
      whiteMove(2, 'Bc4', 30, 30, true),
      whiteMove(3, 'd3', 30, 30, true),
      whiteMove(4, 'h3', 100, -100, false),
      whiteMove(5, 'a3', 100, -100, false),
      whiteMove(6, 'g4', 100, -100, false),
      whiteMove(7, 'Qh5', 200, -300, false),
      whiteMove(8, 'Bxf7', 200, -300, false),
      whiteMove(9, 'Ng5', 200, -300, false),
    ];
    const moves = entries.map((e) => e.snapshot);
    const summary = await analyzeGame(moves, START_FEN, providerFor(entries));

    expect(summary.blunders).toBe(3);
    expect(summary.mistakes).toBe(3);
    expect(summary.whiteAccuracy).toBeLessThan(70);
  });

  it('does not ignore terrible moves played after the twentieth player move', async () => {
    const entries = [
      ...Array.from({ length: 20 }, (_, i) => whiteMove(i, 'e4', 30, 30, true)),
      whiteMove(20, 'Qh5', 250, -350, false),
    ];
    const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, providerFor(entries));

    expect(summary.blunders).toBe(1);
    expect(summary.whiteAccuracy).toBeLessThan(90);
  });

  it('penalizes a large evaluation loss even when the player was already losing', async () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => whiteMove(i, 'e4', 30, 30, true)),
      whiteMove(9, 'g4', -500, -900, false),
    ];
    const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, providerFor(entries));

    expect(summary.blunders).toBe(1);
    expect(summary.whiteAccuracy).toBeLessThan(90);
  });

  it('puts a hard ceiling on games containing a blunder', async () => {
    const entries = [
      ...Array.from({ length: 24 }, (_, i) => whiteMove(i, 'e4', 30, 30, true)),
      whiteMove(24, 'Qh5', 200, -100, false),
    ];
    const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, providerFor(entries));

    expect(summary.blunders).toBe(1);
    expect(summary.whiteAccuracy).toBeLessThanOrEqual(84);
  });

  it('tightens the game ceiling as blunders accumulate', async () => {
    const perfect = Array.from({ length: 20 }, (_, i) => whiteMove(i, 'e4', 30, 30, true));
    const one = [...perfect, whiteMove(20, 'g4', 250, -100, false)];
    const two = [...one, whiteMove(21, 'f3', 250, -100, false)];
    const three = [...two, whiteMove(22, 'Ke2', 250, -100, false)];
    const oneScore = await analyzeGame(one.map((entry) => entry.snapshot), START_FEN, providerFor(one));
    const twoScore = await analyzeGame(two.map((entry) => entry.snapshot), START_FEN, providerFor(two));
    const threeScore = await analyzeGame(three.map((entry) => entry.snapshot), START_FEN, providerFor(three));

    expect(oneScore.whiteAccuracy).toBeLessThanOrEqual(84);
    expect(twoScore.whiteAccuracy).toBeLessThanOrEqual(74);
    expect(threeScore.whiteAccuracy).toBeLessThanOrEqual(64);
    expect(oneScore.whiteAccuracy).toBeGreaterThan(twoScore.whiteAccuracy);
    expect(twoScore.whiteAccuracy).toBeGreaterThan(threeScore.whiteAccuracy);
  });

  it('is monotonic as the same mistake loses more evaluation', async () => {
    const scores: number[] = [];
    for (const loss of [0, 50, 120, 250, 500]) {
      const entries = [
        ...Array.from({ length: 9 }, (_, i) => whiteMove(i, 'e4', 30, 30, true)),
        whiteMove(9, 'g4', 100, 100 - loss, loss === 0),
      ];
      const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, providerFor(entries));
      scores.push(summary.whiteAccuracy);
    }

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('reports coverage and never turns a missing or invalid evaluation into perfection', async () => {
    const entries = [
      whiteMove(0, 'e4', 20, 20, true),
      whiteMove(1, 'g4', 100, -300, false),
      whiteMove(2, 'f3', 100, -300, false),
    ];
    const complete = providerFor(entries);
    const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, async (fen) => {
      if (fen === entries[1].snapshot.fenAfter) return null;
      if (fen === entries[2].snapshot.fenBefore) return { bestSan: 'Zz9', whiteCp: Number.NaN };
      return complete(fen);
    });

    expect(summary.totalUserMoves).toBe(3);
    expect(summary.gradedMoves).toBe(1);
    expect(summary.whiteAccuracy).toBe(99);
    expect(summary.blunders).toBe(0);
  });

  it('selects the most critical errors as key moments instead of the earliest five', async () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, i) => whiteMove(i, 'h3', 50, -10, false)),
      whiteMove(6, 'Qh5', 300, -300, false),
    ];
    const summary = await analyzeGame(entries.map((entry) => entry.snapshot), START_FEN, providerFor(entries));

    expect(summary.keyMoments).toHaveLength(5);
    expect(summary.keyMoments.some((moment) => moment.label === 'Blunder')).toBe(true);
  });
});

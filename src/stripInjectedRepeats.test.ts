import { describe, expect, it } from 'vitest';
import { stripInjectedRepeats } from './convaiManager';

describe('stripInjectedRepeats', () => {
  it('removes an earlier sentence re-injected mid-word into later chunks (real corruption sample)', () => {
    const s = "Pawn to F 3 doesn't develop a piece and it takes away your knight's best square.";
    const corrupted =
      `${s} In the opening, priorit${s}ize getting your pieces out—knights and bishops before pawns that don't control${s} the center.`;
    expect(stripInjectedRepeats(corrupted)).toBe(
      `${s} In the opening, prioritize getting your pieces out—knights and bishops before pawns that don't control the center.`,
    );
  });

  it('removes short sentences spliced mid-word (real corruption sample, 2026-07-24)', () => {
    const corrupted =
      "This is move one. You have twenty legal moves — I'm notThis is move one.This is move one. giving hints at the starting position. Make aThis is move one. choice.";
    expect(stripInjectedRepeats(corrupted)).toBe(
      "This is move one. You have twenty legal moves — I'm not giving hints at the starting position. Make a choice.",
    );
  });

  it('leaves clean text untouched', () => {
    const clean = 'Good, you recaptured. But notice — I now have a forcing check. Always scan checks first.';
    expect(stripInjectedRepeats(clean)).toBe(clean);
  });

  it('does not strip short repeated phrases', () => {
    const text = 'Well done. Well done. That was the right idea.';
    expect(stripInjectedRepeats(text)).toBe(text);
  });

  it('handles text without sentence terminators', () => {
    expect(stripInjectedRepeats('no punctuation here')).toBe('no punctuation here');
  });
});

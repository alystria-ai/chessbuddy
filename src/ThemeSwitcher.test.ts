import { describe, expect, it } from 'vitest';
import { getNextCategoryIndex } from './ThemeSwitcher';

describe('theme category keyboard navigation', () => {
  it('uses Up and Down for the desktop vertical rail', () => {
    expect(getNextCategoryIndex('ArrowDown', 2, 9, 'vertical')).toBe(3);
    expect(getNextCategoryIndex('ArrowUp', 0, 9, 'vertical')).toBe(8);
    expect(getNextCategoryIndex('ArrowRight', 2, 9, 'vertical')).toBeNull();
  });

  it('uses Left and Right for the mobile horizontal strip', () => {
    expect(getNextCategoryIndex('ArrowRight', 8, 9, 'horizontal')).toBe(0);
    expect(getNextCategoryIndex('ArrowLeft', 3, 9, 'horizontal')).toBe(2);
    expect(getNextCategoryIndex('ArrowDown', 2, 9, 'horizontal')).toBeNull();
  });

  it('supports Home and End in either orientation', () => {
    expect(getNextCategoryIndex('Home', 4, 9, 'vertical')).toBe(0);
    expect(getNextCategoryIndex('End', 4, 9, 'horizontal')).toBe(8);
  });

  it('does not navigate an empty collection', () => {
    expect(getNextCategoryIndex('Home', 0, 0, 'vertical')).toBeNull();
  });
});

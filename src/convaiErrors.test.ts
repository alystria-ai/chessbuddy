import { describe, expect, it } from 'vitest';
import { isMauLimitError } from './convaiErrors';

describe('Convai errors', () => {
  it('recognizes MAU and LTM speaker limits', () => {
    expect(isMauLimitError('LTM speaker limit reached')).toBe(true);
    expect(isMauLimitError('RESOURCE_EXHAUSTED')).toBe(true);
    expect(isMauLimitError('Monthly active user limit')).toBe(true);
    expect(isMauLimitError('Missing end_user_id')).toBe(false);
  });
});

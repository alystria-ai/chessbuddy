import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionId } from './storage';

describe('createSessionId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses cryptographically secure bytes while preserving the session id format', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_765_432_100_000);
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0x00, 0x01, 0x02, 0x0a, 0xab, 0xcd, 0xef]);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createSessionId()).toBe('game-1765432100000-0001020aabcde');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(7);
  });

  it('produces different ids when secure random bytes differ at the same timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_765_432_100_000);
    let fill = 0xaa;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(fill++);
        return bytes;
      },
    });

    const first = createSessionId();
    const second = createSessionId();

    expect(first).toMatch(/^game-1765432100000-[0-9a-f]{13}$/);
    expect(second).toMatch(/^game-1765432100000-[0-9a-f]{13}$/);
    expect(second).not.toBe(first);
  });

  it('fails closed when secure random generation is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => createSessionId()).toThrow('Secure random number generation is unavailable.');
  });
});

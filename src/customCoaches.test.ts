import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCustomCoaches, saveCustomCoach } from './customCoaches';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  } });
});

describe('stored custom coaches', () => {
  it('hides retired local personas while custom coaches are disabled', () => {
    store.set('classic-chess.customCoaches.v1', JSON.stringify([{
      id: 'custom-local', name: 'Local Persona', characterId: 'builtin-sofia', backstory: 'Old', createdAt: 'now', baseCoachId: 'sofia',
    }]));
    expect(loadCustomCoaches()).toEqual([]);
  });

  it('keeps dormant records out of coach selection', () => {
    saveCustomCoach({
      source: 'convai-character', id: 'custom-real', name: 'Real Coach', characterId: 'new-convai-character',
      backstory: 'Real', createdAt: 'now', baseCoachId: 'arjun',
    });
    expect(loadCustomCoaches()).toEqual([]);
  });
});

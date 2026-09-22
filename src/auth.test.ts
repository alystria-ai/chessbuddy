import { describe, expect, it, vi } from 'vitest';
import {
  authUserFromGoogleCredential,
  authUserToIdentity,
  fetchAuthUser,
  getKnownEndUserIds,
  getStableGuestEndUserId,
  registerKnownEndUserId,
  resolveConvaiConnectionEndUserId,
  resolveConvaiEndUserId,
  usesConvaiLongTermMemory,
} from './auth';

function fakeJwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `header.${encoded}.signature`;
}

function stubLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
  vi.stubGlobal('window', { localStorage });
  return store;
}

describe('authUserToIdentity', () => {
  it('maps a verified Google user to a stable Convai end user id', () => {
    const identity = authUserToIdentity({
      id: 'google-sub-123',
      name: 'Akshi',
      email: 'akshi@example.com',
      picture: 'https://example.com/avatar.png',
      provider: 'google',
    });

    expect(identity).toEqual({
      displayName: 'Akshi',
      endUserId: 'google:google-sub-123',
      endUserMetadata: {
        name: 'Akshi',
        email: 'akshi@example.com',
        picture: 'https://example.com/avatar.png',
        provider: 'google',
      },
    });
  });

  it('falls back to email as display name when Google name is absent', () => {
    const identity = authUserToIdentity({
      id: 'sub-456',
      name: '   ',
      email: 'student@example.com',
      provider: 'google',
    });

    expect(identity?.displayName).toBe('student@example.com');
    expect(identity?.endUserId).toBe('google:sub-456');
  });

  it('reuses one Convai end-user identity across every selected character', () => {
    const user = {
      id: 'player@convai.com',
      name: 'Player',
      email: 'player@convai.com',
      provider: 'convai' as const,
    };
    const firstCharacterIdentity = authUserToIdentity(user);
    const secondCharacterIdentity = authUserToIdentity(user);
    expect(firstCharacterIdentity?.endUserId).toBe('convai:player@convai.com');
    expect(secondCharacterIdentity?.endUserId).toBe(firstCharacterIdentity?.endUserId);
  });

  it('returns null for guest users', () => {
    expect(authUserToIdentity(null)).toBeNull();
  });

  it('reuses a stable guest id from localStorage across calls', () => {
    stubLocalStorage();
    const first = getStableGuestEndUserId();
    const second = getStableGuestEndUserId();
    expect(first).toBe(second);
    expect(first.startsWith('guest:')).toBe(true);
    expect(resolveConvaiConnectionEndUserId(null)).toBe(first);
    expect(resolveConvaiEndUserId(null)).toBe('');
    expect(usesConvaiLongTermMemory(null)).toBe(false);
  });

  it('tracks known end user ids in localStorage', () => {
    stubLocalStorage();
    registerKnownEndUserId('guest:abc');
    registerKnownEndUserId('google:sub-1');
    registerKnownEndUserId('guest:abc');
    expect(getKnownEndUserIds()).toEqual(['google:sub-1', 'guest:abc']);
  });

  it('does not assign Convai memory identity to guests', () => {
    stubLocalStorage();
    expect(usesConvaiLongTermMemory(null)).toBe(false);
    expect(usesConvaiLongTermMemory(authUserToIdentity({
      id: 'sub-456',
      name: 'Student',
      email: 'student@example.com',
      provider: 'google',
    }))).toBe(true);
    expect(resolveConvaiConnectionEndUserId(authUserToIdentity({
      id: 'sub-456',
      name: 'Student',
      email: 'student@example.com',
      provider: 'google',
    }))).toBe('google:sub-456');
  });

  it('can derive the same auth user from a Google ID token payload for static hosting', () => {
    const user = authUserFromGoogleCredential(fakeJwt({
      sub: 'static-sub-789',
      name: 'Static User',
      email: 'static@example.com',
      picture: 'https://example.com/static.png',
    }));

    expect(user).toEqual({
      id: 'static-sub-789',
      name: 'Static User',
      email: 'static@example.com',
      picture: 'https://example.com/static.png',
      provider: 'google',
    });
    expect(authUserToIdentity(user)?.endUserId).toBe('google:static-sub-789');
  });

  it('maps a Convai account to a stable Convai end user id', () => {
    const identity = authUserToIdentity({
      id: 'player@convai.com',
      name: 'Convai Player',
      email: 'player@convai.com',
      provider: 'convai',
    });

    expect(identity?.endUserId).toBe('convai:player@convai.com');
    expect(identity?.endUserMetadata.provider).toBe('convai');
  });

  it('skips same-origin auth fetch on static convai deploys', async () => {
    const store = stubLocalStorage();
    store.set('classic-chess.authUser.v1', JSON.stringify({
      id: 'google-sub',
      name: 'Cached',
      email: 'cached@example.com',
      provider: 'google',
    }));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
      },
      location: { hostname: 'chess.convai.com' },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = await fetchAuthUser();
    expect(user?.email).toBe('cached@example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

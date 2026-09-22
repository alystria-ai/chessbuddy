import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildConvaiLoginRedirectUrl,
  clearConvaiAuthPending,
  CONVAI_AUTH_COOKIE,
  convaiSessionToAuthUser,
  fetchConvaiAuthSessionResult,
  getConvaiCookie,
  isConvaiAuthConfigured,
  isConvaiAuthOffered,
  isConvaiAuthPending,
  markConvaiAuthPending,
  signOutConvai,
} from './convaiAuth';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubGlobal('window', { location: { href: 'https://chessbuddy.live/' }, sessionStorage: storage() });
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => vi.restoreAllMocks());

describe('secure Convai authentication', () => {
  it('keeps Convai account sign-in hidden while external callbacks are unsupported', () => {
    expect(isConvaiAuthOffered()).toBe(false);
    expect(isConvaiAuthConfigured()).toBe(true);
    vi.stubEnv('VITE_CONVAI_AUTH_ENABLED', 'false');
    expect(isConvaiAuthConfigured()).toBe(false);
  });

  it('builds the login redirect back to Chessbuddy', () => {
    const url = new URL(buildConvaiLoginRedirectUrl());
    expect(url.origin).toBe('https://login.convai.com');
    expect(url.searchParams.get('redirect')).toBe('https://chessbuddy.live/');
  });

  it('reads only the encrypted login cookie in the browser', () => {
    document.cookie = `${CONVAI_AUTH_COOKIE}=encrypted-auth`;
    expect(getConvaiCookie(CONVAI_AUTH_COOKIE)).toBe('encrypted-auth');
  });

  it('exchanges the encrypted credential with the same-origin backend', async () => {
    document.cookie = `${CONVAI_AUTH_COOKIE}=encrypted-auth`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      session: { authenticated: true, email: 'player@convai.com', username: 'Player', photoUrl: '' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchConvaiAuthSessionResult();
    expect(result.session?.email).toBe('player@convai.com');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/convai/session', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ encryptedAuth: 'encrypted-auth' }),
    }));
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain('apiKey');
  });

  it('restores an existing HttpOnly backend session without an encrypted browser cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      session: { authenticated: true, email: 'restored@convai.com', username: 'Restored', photoUrl: '' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchConvaiAuthSessionResult()).session?.email).toBe('restored@convai.com');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/convai/session', expect.objectContaining({ method: 'GET' }));
  });

  it('maps the verified session to a stable Convai identity', () => {
    expect(convaiSessionToAuthUser({ authenticated: true, email: 'player@convai.com', username: 'Player', photoUrl: '' })).toEqual({
      id: 'player@convai.com', name: 'Player', email: 'player@convai.com', provider: 'convai', picture: undefined,
    });
  });

  it('tracks redirect state and clears the server session on sign out', async () => {
    expect(isConvaiAuthPending()).toBe(false);
    markConvaiAuthPending();
    expect(isConvaiAuthPending()).toBe(true);
    clearConvaiAuthPending();
    expect(isConvaiAuthPending()).toBe(false);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await signOutConvai();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/convai/logout', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });
});

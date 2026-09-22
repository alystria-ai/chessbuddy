import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConvaiAuthToken, isAuthTokenEndpointKnownUnavailable, resetConvaiAuthTokenCache } from './convaiAuthToken';

describe('Convai auth tokens', () => {
  beforeEach(() => {
    resetConvaiAuthTokenCache();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('collapses concurrent requests and caches the token', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      authToken: 'short-lived-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(Promise.all([getConvaiAuthToken(), getConvaiAuthToken()]))
      .resolves.toEqual(['short-lived-token', 'short-lived-token']);
    await expect(getConvaiAuthToken()).resolves.toBe('short-lived-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('latches when a static host has no token endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not found', { status: 404 }));

    await expect(getConvaiAuthToken()).resolves.toBeNull();
    await expect(getConvaiAuthToken()).resolves.toBeNull();
    expect(isAuthTokenEndpointKnownUnavailable()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a static-host HTML fallback masquerading as success', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>app</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(getConvaiAuthToken()).resolves.toBeNull();
    expect(isAuthTokenEndpointKnownUnavailable()).toBe(true);
  });
});

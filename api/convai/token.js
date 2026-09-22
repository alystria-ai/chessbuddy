import { createRateLimiter, hasSameOrigin, sendJson } from '../_lib/http.js';

const DEFAULT_CONNECT_URL = 'https://api.convai.com/user/connect';

function parseExpiry(raw) {
  if (!raw) return null;
  const milliseconds = typeof raw === 'number'
    ? (raw < 1_000_000_000_000 ? raw * 1000 : raw)
    : Date.parse(raw);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function createTokenHandler(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rateLimited = createRateLimiter({
    limit: options.tokenRateLimit ?? 30,
    windowMs: options.tokenRateWindowMs ?? 60_000,
  });
  const refreshMarginMs = 5 * 60 * 1000;
  let cachedToken = null;
  let inFlightToken = null;

  async function mintToken(apiKey) {
    const connectUrl = String(
      options.connectUrl ?? process.env.CONVAI_CONNECT_URL ?? DEFAULT_CONNECT_URL,
    );
    const response = await fetchImpl(connectUrl, {
      method: 'POST',
      headers: {
        'CONVAI-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) throw new Error(`Convai Connect responded ${response.status}`);

    const data = await response.json();
    const token = data.apiAuthToken ?? data.api_auth_token;
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('Convai Connect returned no apiAuthToken');
    }
    const expiresAtMs = parseExpiry(data.expirationTime ?? data.expiration_time)
      ?? Date.now() + 60 * 60 * 1000;
    return { token: token.trim(), expiresAtMs };
  }

  async function getToken(apiKey) {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - refreshMarginMs > now) return cachedToken;
    if (!inFlightToken) {
      inFlightToken = mintToken(apiKey)
        .then((nextToken) => {
          cachedToken = nextToken;
          return nextToken;
        })
        .finally(() => {
          inFlightToken = null;
        });
    }
    return inFlightToken;
  }

  return async function tokenHandler(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return;
    }
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'cross_origin_request_denied' });
      return;
    }
    if (rateLimited(request)) {
      sendJson(response, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
      return;
    }

    const apiKey = String(options.apiKey ?? process.env.CONVAI_API_KEY ?? '').trim();
    if (!apiKey) {
      sendJson(response, 503, { error: 'convai_key_unconfigured' });
      return;
    }

    try {
      const { token, expiresAtMs } = await getToken(apiKey);
      sendJson(response, 200, {
        authToken: token,
        expiresAt: new Date(expiresAtMs).toISOString(),
      });
    } catch (error) {
      console.error('[convai-token]', error instanceof Error ? error.message : 'unknown failure');
      sendJson(response, 502, { error: 'convai_connect_failed' });
    }
  };
}

export default createTokenHandler();

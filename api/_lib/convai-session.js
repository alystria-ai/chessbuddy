import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRateLimiter, firstHeaderValue, hasSameOrigin, sendJson } from './http.js';
import { readJsonBody } from './body.js';

export const CONVAI_SESSION_COOKIE = 'chessbuddy_convai_session';
const DEFAULT_DECRYPT_URL = 'https://login.convai.com/api/decrypt';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function parseCookies(header) {
  const value = Array.isArray(header) ? header.join(';') : String(header ?? '');
  const cookies = {};
  for (const part of value.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(rest.join('='));
    } catch {
      cookies[name] = rest.join('=');
    }
  }
  return cookies;
}

function sessionKey(secret) {
  const value = String(secret ?? '').trim();
  if (value.length < 32) throw new Error('convai_session_secret_unconfigured');
  return createHash('sha256').update(value).digest();
}

export function sealConvaiSession(session, secret, now = Date.now()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(secret), iv);
  const payload = Buffer.from(JSON.stringify({
    ...session,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function openConvaiSession(token, secret, now = Date.now()) {
  try {
    const [ivPart, tagPart, encryptedPart] = String(token ?? '').split('.');
    if (!ivPart || !tagPart || !encryptedPart) return null;
    const decipher = createDecipheriv('aes-256-gcm', sessionKey(secret), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ]);
    const session = JSON.parse(decrypted.toString('utf8'));
    if (!session || typeof session.apiKey !== 'string' || !session.apiKey.trim()) return null;
    if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) return null;
    return session;
  } catch {
    return null;
  }
}

export function convaiSessionFromRequest(request, secret) {
  const token = parseCookies(request.headers?.cookie)[CONVAI_SESSION_COOKIE];
  return token ? openConvaiSession(token, secret) : null;
}

function cookieHeader(token, request, maxAge = SESSION_MAX_AGE_SECONDS) {
  const forwardedProto = firstHeaderValue(request.headers?.['x-forwarded-proto']);
  const secure = forwardedProto === 'https' || process.env.VERCEL === '1';
  return `${CONVAI_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearConvaiSessionCookie(request) {
  return cookieHeader('', request, 0);
}

function decryptedValue(body) {
  const wrapped = body?.decryptedString ?? body?.decryptedData ?? body?.data ?? body?.decrypted ?? body?.result;
  if (typeof wrapped === 'string') return wrapped;
  if (wrapped && typeof wrapped === 'object') return wrapped;
  return body && typeof body === 'object' ? body : null;
}

function objectPayload(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function decryptCredential(fetchImpl, decryptUrl, encryptedAuth) {
  for (const [field, value] of [['data', encryptedAuth], ['encryptedString', encryptedAuth]]) {
    const response = await fetchImpl(decryptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch {}
    if (response.ok) {
      const value = decryptedValue(body);
      if (value) return value;
    }
    if (response.status !== 400 || field === 'encryptedString') {
      throw new Error(`convai_decrypt_failed:${response.status}`);
    }
  }
  throw new Error('convai_decrypt_failed');
}

function publicUser(session) {
  return {
    authenticated: true,
    email: session.email,
    username: session.username,
    photoUrl: session.photoUrl,
    companyName: session.companyName,
    companyRole: session.companyRole,
    providers: session.providers,
  };
}

export function createConvaiSessionHandler(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const decryptUrl = options.decryptUrl ?? process.env.CONVAI_DECRYPT_URL ?? DEFAULT_DECRYPT_URL;
  const rateLimited = createRateLimiter({ limit: options.rateLimit ?? 8, windowMs: 60_000 });

  return async function convaiSessionHandler(request, response) {
    const secret = options.sessionSecret ?? process.env.CONVAI_SESSION_SECRET ?? '';
    if (request.method === 'GET') {
      const session = convaiSessionFromRequest(request, secret);
      if (!session) {
        sendJson(response, 401, { error: 'convai_session_missing' });
        return;
      }
      sendJson(response, 200, { session: publicUser(session) });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
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

    try {
      sessionKey(secret);
      const body = await readJsonBody(request, { maxBytes: 24 * 1024 });
      const encryptedAuth = typeof body.encryptedAuth === 'string' ? body.encryptedAuth.trim() : '';
      const encryptedApiKey = typeof body.encryptedApiKey === 'string' ? body.encryptedApiKey.trim() : '';
      if (!encryptedAuth || encryptedAuth.length > 20_000) {
        sendJson(response, 400, { error: 'convai_auth_credential_missing' });
        return;
      }
      const payload = objectPayload(await decryptCredential(fetchImpl, decryptUrl, encryptedAuth));
      if (!payload) {
        sendJson(response, 401, { error: 'convai_identity_missing' });
        return;
      }
      let apiKey = String(payload.apiKey ?? payload.api_key ?? '').trim();
      if (!apiKey && encryptedApiKey) {
        const decryptedApiKey = await decryptCredential(fetchImpl, decryptUrl, encryptedApiKey);
        const keyPayload = objectPayload(decryptedApiKey);
        apiKey = String(keyPayload?.apiKey ?? keyPayload?.api_key ?? (typeof decryptedApiKey === 'string' ? decryptedApiKey : '')).trim();
      }
      const email = String(payload.email ?? '').trim();
      const username = String(payload.username ?? '').trim();
      if (!apiKey || (!email && !username)) {
        sendJson(response, 401, { error: apiKey ? 'convai_identity_missing' : 'convai_api_key_missing' });
        return;
      }
      const session = {
        apiKey,
        email,
        username,
        photoUrl: String(payload.photoUrl ?? payload.photoURL ?? payload.profilePicture ?? '').trim(),
        companyName: typeof payload.companyName === 'string' ? payload.companyName : undefined,
        companyRole: typeof payload.companyRole === 'string' ? payload.companyRole : undefined,
        providers: Array.isArray(payload.providers) ? payload.providers.map(String) : undefined,
      };
      const token = sealConvaiSession(session, secret);
      sendJson(response, 200, { session: publicUser(session) }, {
        'Set-Cookie': cookieHeader(token, request),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const status = message === 'request_too_large' ? 413 : message.includes('unconfigured') ? 503 : 502;
      console.error('[convai-session]', message || 'unknown failure');
      sendJson(response, status, { error: status === 503 ? 'convai_session_unconfigured' : 'convai_session_exchange_failed' });
    }
  };
}

export function createConvaiLogoutHandler() {
  return async function convaiLogoutHandler(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return;
    }
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'cross_origin_request_denied' });
      return;
    }
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearConvaiSessionCookie(request) });
  };
}

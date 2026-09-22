import assert from 'node:assert/strict';
import test from 'node:test';
import healthHandler from './healthz.js';
import readinessHandler from './readyz.js';
import { createTokenHandler } from './convai/token.js';
import { createConvaiSessionHandler, openConvaiSession, sealConvaiSession } from './_lib/convai-session.js';
import { createCreatorCharacterHandler, createCreatorOptionsHandler } from './_lib/convai-creator.js';

const SESSION_SECRET = 'test-session-secret-is-at-least-32-characters';

function responseFor(request) {
  const headers = new Map();
  let body = '';
  return {
    req: request,
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(chunk = '') {
      body += String(chunk);
    },
    get body() {
      return body ? JSON.parse(body) : null;
    },
    get headers() {
      return headers;
    },
  };
}

async function invoke(handler, request) {
  const response = responseFor(request);
  await handler(request, response);
  return response;
}

function request(method = 'GET', headers = {}) {
  return { method, headers, socket: { remoteAddress: '127.0.0.1' } };
}

test('Vercel health and readiness endpoints report deployment state', async () => {
  const health = await invoke(healthHandler, request());
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.body, { status: 'ok' });

  const oldKey = process.env.CONVAI_API_KEY;
  delete process.env.CONVAI_API_KEY;
  try {
    const missing = await invoke(readinessHandler, request());
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.body.error, 'convai_key_unconfigured');

    process.env.CONVAI_API_KEY = 'server-only-key';
    process.env.CONVAI_SESSION_SECRET = SESSION_SECRET;
    const ready = await invoke(readinessHandler, request());
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.body, { status: 'ready' });
  } finally {
    if (oldKey === undefined) delete process.env.CONVAI_API_KEY;
    else process.env.CONVAI_API_KEY = oldKey;
    delete process.env.CONVAI_SESSION_SECRET;
  }
});

test('Convai account exchange keeps the API key inside an encrypted HttpOnly session', async () => {
  const handler = createConvaiSessionHandler({
    sessionSecret: SESSION_SECRET,
    fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).data, 'encrypted-login-cookie');
      return new Response(JSON.stringify({
        decryptedString: JSON.stringify({
          apiKey: 'user-private-api-key',
          email: 'player@convai.com',
          username: 'Player',
        }),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const exchange = await invoke(handler, {
    ...request('POST', { host: 'chessbuddy.live', origin: 'https://chessbuddy.live', 'x-forwarded-proto': 'https' }),
    body: { encryptedAuth: 'encrypted-login-cookie' },
  });
  assert.equal(exchange.statusCode, 200);
  assert.equal(JSON.stringify(exchange.body).includes('user-private-api-key'), false);
  const setCookie = exchange.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.equal(setCookie.includes('user-private-api-key'), false);

  const cookie = setCookie.split(';')[0];
  const restored = await invoke(handler, request('GET', { host: 'chessbuddy.live', cookie }));
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.body.session.email, 'player@convai.com');

  const token = decodeURIComponent(cookie.split('=')[1]);
  assert.equal(openConvaiSession(token, SESSION_SECRET)?.apiKey, 'user-private-api-key');
  assert.equal(openConvaiSession(`${token}tampered`, SESSION_SECRET), null);
});

test('authenticated creator options and character creation use only the signed-in user key', async () => {
  const sessionToken = sealConvaiSession({
    apiKey: 'user-private-api-key', email: 'player@convai.com', username: 'Player', photoUrl: '',
  }, SESSION_SECRET);
  const cookie = `chessbuddy_convai_session=${encodeURIComponent(sessionToken)}`;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers['CONVAI-API-KEY'], 'user-private-api-key');
    if (url.endsWith('/tts/get_available_voices')) return new Response(JSON.stringify({ voices: [] }), { status: 200 });
    if (url.endsWith('/tts/get_available_languages')) return new Response(JSON.stringify([]), { status: 200 });
    if (url.endsWith('/character/create')) return new Response(JSON.stringify({ charID: 'new-character-id' }), { status: 201 });
    if (url.endsWith('/character/update')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    throw new Error(`unexpected ${url}`);
  };
  const optionsHandler = createCreatorOptionsHandler({ fetchImpl, sessionSecret: SESSION_SECRET });
  const optionsResponse = await invoke(optionsHandler, request('GET', { host: 'chessbuddy.live', cookie }));
  assert.equal(optionsResponse.statusCode, 200);

  const createHandler = createCreatorCharacterHandler({ fetchImpl, sessionSecret: SESSION_SECRET });
  const createResponse = await invoke(createHandler, {
    ...request('POST', { host: 'chessbuddy.live', origin: 'https://chessbuddy.live', cookie }),
    body: {
      charName: 'My Coach', voiceType: 'US FEMALE 1', backstory: 'A careful coach.',
      languageCodes: ['en-US'], model: 'gemini-2.5-flash-lite', temperature: 0.45,
    },
  });
  assert.equal(createResponse.statusCode, 201);
  assert.deepEqual(createResponse.body, { charID: 'new-character-id' });
  assert.equal(JSON.stringify(createResponse.body).includes('user-private-api-key'), false);
  assert.equal(calls.filter((entry) => entry.url.includes('/character/')).length, 2);
});

test('creator APIs require Convai sign-in and explain plan access failures', async () => {
  const noSessionHandler = createCreatorOptionsHandler({ sessionSecret: SESSION_SECRET });
  const noSession = await invoke(noSessionHandler, request('GET', { host: 'chessbuddy.live' }));
  assert.equal(noSession.statusCode, 401);
  assert.equal(noSession.body.error, 'convai_sign_in_required');

  const token = sealConvaiSession({ apiKey: 'limited-key', email: 'free@convai.com', username: 'Free', photoUrl: '' }, SESSION_SECRET);
  const planHandler = createCreatorCharacterHandler({
    sessionSecret: SESSION_SECRET,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Professional plan required' }), { status: 403 }),
  });
  const plan = await invoke(planHandler, {
    ...request('POST', { host: 'chessbuddy.live', origin: 'https://chessbuddy.live', cookie: `chessbuddy_convai_session=${encodeURIComponent(token)}` }),
    body: { charName: 'Coach', voiceType: 'Voice', backstory: 'Backstory' },
  });
  assert.equal(plan.statusCode, 403);
  assert.equal(plan.body.error, 'convai_plan_required');
});

test('Vercel token endpoint mints and caches short-lived tokens', async () => {
  let connectCalls = 0;
  const handler = createTokenHandler({
    apiKey: 'server-only-key',
    fetchImpl: async (_url, options) => {
      connectCalls += 1;
      assert.equal(options.headers['CONVAI-API-KEY'], 'server-only-key');
      return new Response(JSON.stringify({
        apiAuthToken: 'short-lived-test-token',
        expirationTime: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const tokenRequest = () => request('POST', {
    host: 'chessbuddy.live',
    origin: 'https://chessbuddy.live',
  });

  const first = await invoke(handler, tokenRequest());
  const second = await invoke(handler, tokenRequest());
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.authToken, 'short-lived-test-token');
  assert.equal(second.body.authToken, 'short-lived-test-token');
  assert.equal(JSON.stringify(first.body).includes('server-only-key'), false);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(connectCalls, 1);
});

test('Vercel token endpoint rejects wrong methods, origins, and excess calls', async () => {
  const handler = createTokenHandler({
    apiKey: 'server-only-key',
    tokenRateLimit: 1,
    fetchImpl: async () => new Response(JSON.stringify({ apiAuthToken: 'token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  const get = await invoke(handler, request('GET'));
  assert.equal(get.statusCode, 405);

  const crossOrigin = await invoke(handler, request('POST', {
    host: 'chessbuddy.live',
    origin: 'https://attacker.example',
  }));
  assert.equal(crossOrigin.statusCode, 403);

  const first = await invoke(handler, request('POST', { host: 'chessbuddy.live' }));
  const second = await invoke(handler, request('POST', { host: 'chessbuddy.live' }));
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
});

test('Vercel token endpoint refuses requests when the permanent key is absent', async () => {
  const handler = createTokenHandler({ apiKey: '' });
  const response = await invoke(handler, request('POST', { host: 'chessbuddy.live' }));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, 'convai_key_unconfigured');
});

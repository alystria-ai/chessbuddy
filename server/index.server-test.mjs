import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createChessBuddyServer } from './index.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chessbuddy-server-'));
  const dist = join(directory, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>ChessBuddy</title>');
  await writeFile(join(dist, 'assets', 'app-12345678.js'), 'console.log("ready")');

  const server = createChessBuddyServer({
    distDirectory: dist,
    apiKey: 'server-only-key',
    sessionSecret: 'test-session-secret-is-at-least-32-characters',
    ...options,
  });
  const origin = await listen(server);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { origin };
}

test('serves the SPA and readiness endpoints', async (t) => {
  const { origin } = await fixture(t);

  const page = await fetch(`${origin}/play`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /ChessBuddy/);

  const health = await fetch(`${origin}/healthz`);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const ready = await fetch(`${origin}/readyz`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
});

test('mints and caches a short-lived token without exposing the permanent key', async (t) => {
  let connectCalls = 0;
  const fetchImpl = async (_url, options) => {
    connectCalls += 1;
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['CONVAI-API-KEY'], 'server-only-key');
    return new Response(JSON.stringify({
      apiAuthToken: 'short-lived-test-token',
      expirationTime: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { origin } = await fixture(t, { fetchImpl });

  const requestToken = () => fetch(`${origin}/api/convai/token`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const [first, second] = await Promise.all([requestToken(), requestToken()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(firstBody.authToken, 'short-lived-test-token');
  assert.equal(secondBody.authToken, 'short-lived-test-token');
  assert.equal(JSON.stringify(firstBody).includes('server-only-key'), false);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(connectCalls, 1);
});

test('rejects unsafe token requests and rate limits callers', async (t) => {
  const fetchImpl = async () => new Response(JSON.stringify({ apiAuthToken: 'token' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const { origin } = await fixture(t, { fetchImpl, tokenRateLimit: 1 });

  const getResponse = await fetch(`${origin}/api/convai/token`);
  assert.equal(getResponse.status, 405);

  const crossOrigin = await fetch(`${origin}/api/convai/token`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(crossOrigin.status, 403);

  const first = await fetch(`${origin}/api/convai/token`, { method: 'POST', headers: { Origin: origin } });
  const second = await fetch(`${origin}/api/convai/token`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
});

test('reports not ready and refuses tokens when the secret is missing', async (t) => {
  const { origin } = await fixture(t, { apiKey: '' });

  const ready = await fetch(`${origin}/readyz`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).error, 'convai_key_unconfigured');

  const token = await fetch(`${origin}/api/convai/token`, { method: 'POST', headers: { Origin: origin } });
  assert.equal(token.status, 503);
  assert.equal((await token.json()).error, 'convai_key_unconfigured');
});

test('reports not ready when encrypted Convai account sessions are unconfigured', async (t) => {
  const { origin } = await fixture(t, { sessionSecret: '' });
  const ready = await fetch(`${origin}/readyz`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).error, 'convai_session_unconfigured');
});

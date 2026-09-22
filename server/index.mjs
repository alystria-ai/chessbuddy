/**
 * ChessBuddy portable production server.
 *
 * It serves the built Vite app and exchanges the server-only Convai API key
 * for a short-lived browser token. The permanent key must never enter a Vite
 * variable, static asset, response body, or browser storage.
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConvaiLogoutHandler, createConvaiSessionHandler } from '../api/_lib/convai-session.js';
import { createCreatorCharacterHandler, createCreatorOptionsHandler } from '../api/_lib/convai-creator.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function indexStaticFiles(directory, root = directory, files = new Map()) {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      indexStaticFiles(absolutePath, root, files);
    } else if (entry.isFile()) {
      const requestPath = `/${relative(root, absolutePath).split(sep).join('/')}`;
      files.set(requestPath, absolutePath);
    }
  }
  return files;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(payload);
}

function parseExpiry(raw) {
  if (!raw) return null;
  const milliseconds = typeof raw === 'number'
    ? (raw < 1_000_000_000_000 ? raw * 1000 : raw)
    : Date.parse(raw);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function firstHeaderValue(value) {
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function requestHost(req) {
  return firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
}

function hasSameOrigin(req) {
  const fetchSite = firstHeaderValue(req.headers['sec-fetch-site']);
  if (fetchSite === 'cross-site') return false;

  const origin = firstHeaderValue(req.headers.origin);
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req).toLowerCase();
  } catch {
    return false;
  }
}

function requestAddress(req) {
  return firstHeaderValue(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ limit, windowMs }) {
  const windows = new Map();
  let lastSweepAt = 0;

  return (req) => {
    const now = Date.now();
    if (now - lastSweepAt > windowMs) {
      lastSweepAt = now;
      for (const [address, entry] of windows) {
        if (entry.resetAt <= now) windows.delete(address);
      }
    }

    const address = requestAddress(req);
    const current = windows.get(address);
    if (!current || current.resetAt <= now) {
      windows.set(address, { count: 1, resetAt: now + windowMs });
      return false;
    }

    current.count += 1;
    return current.count > limit;
  };
}

function decodeRequestPath(req) {
  try {
    return decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    return null;
  }
}

export function createChessBuddyServer(options = {}) {
  const distDirectory = resolve(options.distDirectory ?? join(PROJECT_ROOT, 'dist'));
  const apiKey = String(options.apiKey ?? process.env.CONVAI_API_KEY ?? '').trim();
  const connectUrl = String(
    options.connectUrl ?? process.env.CONVAI_CONNECT_URL ?? 'https://api.convai.com/user/connect',
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionSecret = String(options.sessionSecret ?? process.env.CONVAI_SESSION_SECRET ?? '').trim();
  const staticFiles = indexStaticFiles(distDirectory);
  const spaIndex = staticFiles.get('/index.html');
  const tokenRateLimited = createRateLimiter({
    limit: options.tokenRateLimit ?? 30,
    windowMs: options.tokenRateWindowMs ?? 60_000,
  });
  const convaiSessionHandler = createConvaiSessionHandler({
    fetchImpl,
    sessionSecret,
    decryptUrl: options.decryptUrl,
  });
  const convaiLogoutHandler = createConvaiLogoutHandler();
  const creatorOptionsHandler = createCreatorOptionsHandler({
    fetchImpl,
    sessionSecret,
    apiBase: options.creatorApiBase,
  });
  const creatorCharacterHandler = createCreatorCharacterHandler({
    fetchImpl,
    sessionSecret,
    apiBase: options.creatorApiBase,
  });

  const refreshMarginMs = 5 * 60 * 1000;
  let cachedToken = null;
  let inFlightToken = null;

  async function mintToken() {
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

  async function getToken() {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - refreshMarginMs > now) return cachedToken;
    if (!inFlightToken) {
      inFlightToken = mintToken()
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

  function serveStatic(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      return;
    }

    const filePath = staticFiles.get(path) ?? spaIndex;
    if (!filePath) {
      sendJson(res, 503, { error: 'build_output_missing' });
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const hashedAsset = /-[A-Za-z0-9_-]{8,}\./.test(filePath);
    const size = statSync(filePath).size;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Cache-Control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Length': size,
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  }

  async function handleRequest(req, res) {
    const path = decodeRequestPath(req);
    if (path === null) {
      sendJson(res, 400, { error: 'invalid_url_encoding' });
      return;
    }

    if (path === '/healthz') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (path === '/readyz') {
      sendJson(
        res,
        apiKey && sessionSecret.length >= 32 && spaIndex ? 200 : 503,
        apiKey && sessionSecret.length >= 32 && spaIndex
          ? { status: 'ready' }
          : { status: 'not_ready', error: !apiKey ? 'convai_key_unconfigured' : sessionSecret.length < 32 ? 'convai_session_unconfigured' : 'build_output_missing' },
      );
      return;
    }

    if (path === '/api/auth/convai/session') {
      await convaiSessionHandler(req, res);
      return;
    }

    if (path === '/api/auth/convai/logout') {
      await convaiLogoutHandler(req, res);
      return;
    }

    if (path === '/api/convai/creator/options') {
      await creatorOptionsHandler(req, res);
      return;
    }

    if (path === '/api/convai/creator/characters') {
      await creatorCharacterHandler(req, res);
      return;
    }

    if (path === '/api/convai/token') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
        return;
      }
      if (!hasSameOrigin(req)) {
        sendJson(res, 403, { error: 'cross_origin_request_denied' });
        return;
      }
      if (tokenRateLimited(req)) {
        sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
        return;
      }
      if (!apiKey) {
        sendJson(res, 503, { error: 'convai_key_unconfigured' });
        return;
      }

      try {
        const { token, expiresAtMs } = await getToken();
        sendJson(res, 200, { authToken: token, expiresAt: new Date(expiresAtMs).toISOString() });
      } catch (error) {
        console.error('[convai-token]', error instanceof Error ? error.message : 'unknown failure');
        sendJson(res, 502, { error: 'convai_connect_failed' });
      }
      return;
    }

    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    serveStatic(req, res, path);
  }

  return createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      console.error('[server]', error instanceof Error ? error.message : 'unknown failure');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_server_error' });
      else res.destroy();
    });
  });
}

export function startChessBuddyServer() {
  const port = Number(process.env.PORT || 8080);
  const server = createChessBuddyServer();
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    const keyStatus = process.env.CONVAI_API_KEY?.trim() ? 'configured' : 'MISSING';
    const sessionStatus = (process.env.CONVAI_SESSION_SECRET?.trim().length ?? 0) >= 32 ? 'configured' : 'MISSING';
    console.log(`[chessbuddy] listening on :${boundPort} (Convai key ${keyStatus}; session secret ${sessionStatus})`);
  });

  const shutdown = (signal) => {
    console.log(`[chessbuddy] ${signal}; shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === MODULE_PATH) {
  startChessBuddyServer();
}

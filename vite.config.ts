import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { OAuth2Client } from 'google-auth-library';

const LOG_FILE = path.resolve(__dirname, 'debug.log');
const AUTH_COOKIE = 'classic_chess_auth';
const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

type AuthSessionUser = {
  id: string;
  name: string;
  email: string;
  picture?: string;
};

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const value = Array.isArray(header) ? header.join(';') : header ?? '';
  return value.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) return cookies;
    cookies[rawName] = decodeURIComponent(rawValue.join('=') ?? '');
    return cookies;
  }, {});
}

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: import('node:http').ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function clearAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function createAuthCookie(sessionId: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE_SECONDS}${secure}`;
}

function isSameOrigin(req: import('node:http').IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function logServerPlugin(datasetToolsEnabled: boolean, googleClientId: string): Plugin {
  const sessions = new Map<string, AuthSessionUser>();
  const googleClient = new OAuth2Client();

  return {
    name: 'chess-log-server',
    configureServer(server) {
      // Truncate debug.log on every dev-server start so the file only contains the most
      // recent run. Previous sessions are gone — keep what's useful, ditch the noise.
      fs.writeFileSync(LOG_FILE, `=== Debug log session started ${new Date().toISOString()} ===\n`);

      server.middlewares.use('/api/log', (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const lines: string[] = JSON.parse(body);
            fs.appendFileSync(LOG_FILE, lines.join('\n') + '\n');
          } catch {}
          res.writeHead(204);
          res.end();
        });
      });

      server.middlewares.use('/api/auth/me', (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        const sessionId = parseCookies(req.headers.cookie)[AUTH_COOKIE];
        const user = sessionId ? sessions.get(sessionId) : null;
        if (!user) {
          sendJson(res, 401, { user: null });
          return;
        }
        sendJson(res, 200, { user });
      });

      server.middlewares.use('/api/auth/logout', (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        const sessionId = parseCookies(req.headers.cookie)[AUTH_COOKIE];
        if (sessionId) sessions.delete(sessionId);
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearAuthCookie() });
      });

      server.middlewares.use('/api/auth/google', (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        if (!isSameOrigin(req)) {
          sendJson(res, 403, { error: 'Invalid sign-in origin.' });
          return;
        }

        void readJsonBody(req)
          .then(async (body) => {
            const credential = typeof (body as { credential?: unknown }).credential === 'string'
              ? (body as { credential: string }).credential
              : '';
            const clientId = googleClientId || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;

            if (!clientId) {
              sendJson(res, 500, { error: 'GOOGLE_CLIENT_ID is not configured.' });
              return;
            }
            if (!credential) {
              sendJson(res, 400, { error: 'Missing Google credential.' });
              return;
            }

            const ticket = await googleClient.verifyIdToken({
              idToken: credential,
              audience: clientId,
            });
            const payload = ticket.getPayload();
            if (!payload?.sub || !payload.email) {
              sendJson(res, 401, { error: 'Invalid Google credential.' });
              return;
            }

            const user: AuthSessionUser = {
              id: payload.sub,
              name: payload.name ?? payload.email,
              email: payload.email,
              picture: payload.picture,
            };
            const sessionId = crypto.randomUUID();
            sessions.set(sessionId, user);
            sendJson(res, 200, { user }, { 'Set-Cookie': createAuthCookie(sessionId) });
          })
          .catch((err) => {
            console.error('Google auth failed:', err);
            sendJson(res, 401, { error: 'Google sign-in failed.' });
          });
      });

      if (datasetToolsEnabled) {
        const DATASET_FILE = path.resolve(__dirname, 'dataset.json');

        server.middlewares.use('/api/dataset', (req, res) => {
          if (req.method === 'GET') {
            try {
              if (fs.existsSync(DATASET_FILE)) {
                const data = fs.readFileSync(DATASET_FILE, 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('[]');
              }
            } catch {
              res.writeHead(500);
              res.end('Error reading dataset');
            }
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const item = JSON.parse(body);
                let dataset: unknown[] = [];
                if (fs.existsSync(DATASET_FILE)) {
                  const parsed = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf-8'));
                  if (Array.isArray(parsed)) dataset = parsed;
                }
                dataset.push(item);
                fs.writeFileSync(DATASET_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: dataset.length }));
              } catch {
                res.writeHead(400);
                res.end('Invalid JSON or write error');
              }
            });
            return;
          }

          if (req.method === 'DELETE') {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body);
                if (payload.clearAll) {
                  fs.writeFileSync(DATASET_FILE, '[]', 'utf-8');
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true, count: 0 }));
                } else if (payload.timestamp) {
                  let dataset: Array<{ timestamp?: string }> = [];
                  if (fs.existsSync(DATASET_FILE)) {
                    const parsed = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf-8'));
                    if (Array.isArray(parsed)) dataset = parsed;
                  }
                  const filtered = dataset.filter((entry) => entry.timestamp !== payload.timestamp);
                  fs.writeFileSync(DATASET_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ success: true, count: filtered.length }));
                } else {
                  res.writeHead(400);
                  res.end('Missing clearAll or timestamp');
                }
              } catch {
                res.writeHead(400);
                res.end('Invalid delete payload');
              }
            });
            return;
          }

          res.writeHead(405);
          res.end();
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const datasetToolsEnabled = mode === 'dataset';
  const env = loadEnv(mode, process.cwd(), '');
  const googleClientId = env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || '';

  return {
    base: './',
    define: {
      __DATASET_TOOLS_ENABLED__: JSON.stringify(datasetToolsEnabled),
    },
    plugins: [react(), logServerPlugin(datasetToolsEnabled, googleClientId)],
    test: {
      exclude: ['**/node_modules/**', '**/dist/**', 'misc/**'],
      server: {
        deps: {
          // The SDK's ESM dist uses extensionless relative imports; let Vite
          // transform it instead of Node's strict ESM resolver.
          inline: ['@convai/web-sdk'],
        },
      },
    },
  };
});

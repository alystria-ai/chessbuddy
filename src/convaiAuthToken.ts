import { debugLog } from './debugLog';

const TOKEN_ENDPOINT = '/api/convai/token';
const REFRESH_MARGIN_MS = 4 * 60 * 1000;

let endpointUnavailable = false;
let cached: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string> | null = null;

export function isAuthTokenEndpointKnownUnavailable(): boolean {
  return endpointUnavailable;
}

export function resetConvaiAuthTokenCache(): void {
  endpointUnavailable = false;
  cached = null;
  inFlight = null;
}

async function requestToken(): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });

  if (response.status === 404) {
    endpointUnavailable = true;
    throw new Error('token endpoint not deployed');
  }
  if (!response.ok) throw new Error(`token endpoint responded ${response.status}`);

  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    endpointUnavailable = true;
    throw new Error('token endpoint returned a non-JSON response');
  }

  const data = await response.json() as { authToken?: string; expiresAt?: string };
  if (!data.authToken?.trim()) throw new Error('token endpoint returned no authToken');

  const parsedExpiry = data.expiresAt ? Date.parse(data.expiresAt) : Number.NaN;
  cached = {
    token: data.authToken.trim(),
    expiresAtMs: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 60 * 60 * 1000,
  };
  debugLog('ConvaiAuth', `Fetched short-lived auth token (expires ${data.expiresAt ?? 'unknown'})`);
  return cached.token;
}

export async function getConvaiAuthToken(): Promise<string | null> {
  if (endpointUnavailable) return null;
  if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > Date.now()) return cached.token;

  if (!inFlight) {
    inFlight = requestToken().finally(() => {
      inFlight = null;
    });
  }

  try {
    return await inFlight;
  } catch (error) {
    debugLog('ConvaiAuth', `Server token unavailable (${(error as Error).message})`);
    return null;
  }
}

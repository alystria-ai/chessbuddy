import { debugLog } from './debugLog';
import type { AuthUser } from './auth';
import { CONVAI_ACCOUNT_FEATURES_ENABLED } from './featureFlags';

export type ConvaiAuthSession = {
  authenticated: boolean;
  email: string;
  username: string;
  photoUrl: string;
  companyName?: string;
  companyRole?: string;
  providers?: string[];
};

export type ConvaiAuthFetchResult = {
  session: ConvaiAuthSession | null;
  reason: string | null;
};

const DEFAULT_LOGIN_URL = 'https://login.convai.com';
const CONVAI_AUTH_PENDING_KEY = 'classic-chess.convaiAuthPending.v1';
export const CONVAI_AUTH_COOKIE = 'CONVAI_AUTH';
export const CONVAI_API_KEY_COOKIE = 'CONVAI_API_KEY';
export const CONVAI_SIGN_IN_UI_ENABLED = CONVAI_ACCOUNT_FEATURES_ENABLED;

let sessionFetchPromise: Promise<ConvaiAuthFetchResult> | null = null;

function convaiLog(message: string): void {
  if (import.meta.env.DEV) debugLog('ConvaiAuth', message);
}

export function isConvaiAuthOffered(): boolean {
  return CONVAI_SIGN_IN_UI_ENABLED;
}

export function isConvaiAuthConfigured(): boolean {
  return import.meta.env.VITE_CONVAI_AUTH_ENABLED?.trim().toLowerCase() !== 'false';
}

export function getConvaiLoginUrl(): string {
  return import.meta.env.VITE_CONVAI_LOGIN_URL?.trim() || DEFAULT_LOGIN_URL;
}

export function getConvaiCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1].trim()); } catch { return match[1].trim(); }
}

function reasonForStatus(status: number, body: { error?: unknown }): string {
  const code = typeof body.error === 'string' ? body.error : '';
  if (code === 'convai_api_key_missing') return 'Your Convai account did not provide an API key.';
  if (code === 'convai_session_unconfigured') return 'Convai account sessions are not configured on this deployment.';
  if (status === 401) return 'Your Convai session could not be verified. Sign in again.';
  return 'Could not establish your secure Convai session.';
}

async function exchangeOrRestoreSession(): Promise<ConvaiAuthFetchResult> {
  const encryptedAuth = getConvaiCookie(CONVAI_AUTH_COOKIE);
  const encryptedApiKey = getConvaiCookie(CONVAI_API_KEY_COOKIE);
  const response = await fetch('/api/auth/convai/session', {
    method: encryptedAuth ? 'POST' : 'GET',
    credentials: 'include',
    headers: encryptedAuth ? { 'Content-Type': 'application/json' } : undefined,
    body: encryptedAuth ? JSON.stringify({ encryptedAuth, ...(encryptedApiKey ? { encryptedApiKey } : {}) }) : undefined,
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as { session?: ConvaiAuthSession; error?: unknown };
  if (!response.ok || !body.session) return { session: null, reason: reasonForStatus(response.status, body) };
  return { session: body.session, reason: null };
}

export async function fetchConvaiAuthSessionResult(): Promise<ConvaiAuthFetchResult> {
  if (!isConvaiAuthConfigured()) return { session: null, reason: 'Convai auth is disabled for this host.' };
  if (sessionFetchPromise) return sessionFetchPromise;
  sessionFetchPromise = exchangeOrRestoreSession()
    .catch((error) => ({
      session: null,
      reason: error instanceof Error ? error.message : 'Unexpected Convai session error.',
    }))
    .finally(() => { sessionFetchPromise = null; });
  return sessionFetchPromise;
}

export async function fetchConvaiAuthSession(): Promise<ConvaiAuthSession | null> {
  return (await fetchConvaiAuthSessionResult()).session;
}

export function buildConvaiLoginRedirectUrl(returnUrl?: string): string {
  const loginUrl = new URL(getConvaiLoginUrl());
  loginUrl.searchParams.set('redirect', returnUrl ?? window.location.href);
  return loginUrl.toString();
}

export function signInWithConvaiRedirect(returnUrl?: string): void {
  window.location.href = buildConvaiLoginRedirectUrl(returnUrl);
}

export function markConvaiAuthPending(): void {
  try { window.sessionStorage.setItem(CONVAI_AUTH_PENDING_KEY, '1'); } catch {}
}

export function isConvaiAuthPending(): boolean {
  try { return window.sessionStorage.getItem(CONVAI_AUTH_PENDING_KEY) === '1'; } catch { return false; }
}

export function clearConvaiAuthPending(): void {
  try { window.sessionStorage.removeItem(CONVAI_AUTH_PENDING_KEY); } catch {}
}

export function convaiSessionToAuthUser(session: ConvaiAuthSession): AuthUser {
  const email = session.email.trim();
  const username = session.username.trim();
  const id = email || username;
  if (!id) throw new Error('Convai session is missing user identity.');
  return {
    id,
    name: username || email || 'Convai User',
    email: email || username,
    picture: session.photoUrl?.trim() || undefined,
    provider: 'convai',
  };
}

export async function signOutConvai(): Promise<void> {
  try {
    await fetch('/api/auth/convai/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    convaiLog('Server session logout failed; local account state was still cleared.');
  }
}

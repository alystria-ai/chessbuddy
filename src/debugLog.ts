// Human-readable structured debug log.
// In dev: batches entries every 200 ms and POSTs to /api/log (written to debug.log).
// Deduplicates: identical [scope+message] within 3 s is suppressed.
// Also keeps an in-memory ring buffer so the Copy Logs button can dump the session.

const DEV = import.meta.env.DEV;
// Console output is dev-only by default: in production the steady Lipsync/
// Convai/PortraitDebug chatter is pure overhead (string serialization + console
// I/O on the main thread). The in-memory ring buffer still records everything
// for the Copy Logs button; appending "debug" to the URL query (e.g.
// ?portraitDebug=basic or ?debug) re-enables live console output in prod.
const CONSOLE_ENABLED =
  DEV || (typeof location !== 'undefined' && location.search.includes('debug'));
const DEDUP_WINDOW_MS = 3000;
const FLUSH_INTERVAL_MS = 200;
const MAX_MESSAGE_LENGTH = 700;
const MAX_BUFFER_ENTRIES = 2000;
const SLOW_DEDUP_SCOPES = new Set(['CoachCard', 'ReallusionCharacter', 'ConvaiAuth', 'PortraitDebug']);

// key → last timestamp
const recentKeys = new Map<string, number>();
let batch: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const entries: string[] = [];

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (batch.length === 0) return;
    const lines = batch.splice(0);
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lines),
    }).catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export function debugLog(scope: string, message: string, ...args: unknown[]): void {
  // Flatten extra args into the message string for dedup key and display
  const extra = args.length
    ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    : '';
  const raw = `${message}${extra}`;
  const full = raw.length > MAX_MESSAGE_LENGTH
    ? `${raw.slice(0, MAX_MESSAGE_LENGTH)}... [truncated ${raw.length - MAX_MESSAGE_LENGTH} chars]`
    : raw;
  const key = `${scope}|${full}`;

  const now = Date.now();
  const last = recentKeys.get(key);
  const dedupWindow = SLOW_DEDUP_SCOPES.has(scope) ? 30000 : DEDUP_WINDOW_MS;
  if (last !== undefined && now - last < dedupWindow) return;
  recentKeys.set(key, now);

  // Prune old entries to avoid unbounded map growth
  if (recentKeys.size > 200) {
    for (const [k, t] of recentKeys) {
      if (now - t > 30000) recentKeys.delete(k);
    }
  }

  const line = `[${timestamp()}] [${scope}] ${full}`;
  if (CONSOLE_ENABLED) console.info(line);

  entries.push(line);
  if (entries.length > MAX_BUFFER_ENTRIES) entries.splice(0, entries.length - MAX_BUFFER_ENTRIES);

  if (DEV) {
    batch.push(line);
    scheduleFlush();
  }
}

export function getLogText(): string {
  return entries.join('\n');
}

export async function copyLogToClipboard(): Promise<void> {
  const text = getLogText();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

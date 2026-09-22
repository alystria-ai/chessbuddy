export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function firstHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

export function requestHost(request) {
  return firstHeaderValue(request.headers?.['x-forwarded-host'])
    || firstHeaderValue(request.headers?.host);
}

export function hasSameOrigin(request) {
  const fetchSite = firstHeaderValue(request.headers?.['sec-fetch-site']);
  if (fetchSite === 'cross-site') return false;

  const origin = firstHeaderValue(request.headers?.origin);
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === requestHost(request).toLowerCase();
  } catch {
    return false;
  }
}

export function requestAddress(request) {
  return firstHeaderValue(request.headers?.['x-forwarded-for'])
    || request.socket?.remoteAddress
    || 'unknown';
}

export function sendJson(response, status, body, extraHeaders = {}) {
  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...extraHeaders })) {
    response.setHeader(name, value);
  }
  response.statusCode = status;
  if (response.req?.method === 'HEAD') {
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export function createRateLimiter({ limit, windowMs }) {
  const windows = new Map();
  let lastSweepAt = 0;

  return (request) => {
    const now = Date.now();
    if (now - lastSweepAt > windowMs) {
      lastSweepAt = now;
      for (const [address, entry] of windows) {
        if (entry.resetAt <= now) windows.delete(address);
      }
    }

    const address = requestAddress(request);
    const current = windows.get(address);
    if (!current || current.resetAt <= now) {
      windows.set(address, { count: 1, resetAt: now + windowMs });
      return false;
    }

    current.count += 1;
    return current.count > limit;
  };
}

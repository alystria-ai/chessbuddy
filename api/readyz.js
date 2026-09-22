import { sendJson } from './_lib/http.js';

export default function readinessHandler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    return;
  }

  const apiKey = String(process.env.CONVAI_API_KEY ?? '').trim();
  const sessionSecret = String(process.env.CONVAI_SESSION_SECRET ?? '').trim();
  const ready = Boolean(apiKey && sessionSecret.length >= 32);
  sendJson(
    response,
    ready ? 200 : 503,
    ready
      ? { status: 'ready' }
      : { status: 'not_ready', error: apiKey ? 'convai_session_unconfigured' : 'convai_key_unconfigured' },
  );
}

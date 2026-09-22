import { sendJson } from './_lib/http.js';

export default function healthHandler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    return;
  }
  sendJson(response, 200, { status: 'ok' });
}

export async function readJsonBody(request, { maxBytes = 64 * 1024 } = {}) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === 'string') {
    if (Buffer.byteLength(request.body) > maxBytes) throw new Error('request_too_large');
    return request.body ? JSON.parse(request.body) : {};
  }

  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > maxBytes) throw new Error('request_too_large');
  }
  return body ? JSON.parse(body) : {};
}

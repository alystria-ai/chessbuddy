import { createRateLimiter, hasSameOrigin, sendJson } from './http.js';
import { readJsonBody } from './body.js';
import { convaiSessionFromRequest } from './convai-session.js';

const API_BASE = 'https://api.convai.com';
const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash',
  'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-4o',
  'claude-4-sonnet', 'claude-3-7-sonnet', 'claude-opus-4.1', 'claude-opus-4',
  'gemma-3n-e4b', 'gemma-3n-e2b', 'llama-4-maverick', 'llama-4-scout', 'llama-3-70B',
]);

function upstreamHeaders(apiKey) {
  return { 'CONVAI-API-KEY': apiKey, 'Content-Type': 'application/json' };
}

async function responseBody(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function planFailure(status, body) {
  const detail = JSON.stringify(body).toLowerCase();
  return status === 401 || status === 403 || detail.includes('professional') || detail.includes('subscription') || detail.includes('plan');
}

function requireSession(request, response, secret) {
  try {
    const session = convaiSessionFromRequest(request, secret);
    if (!session) sendJson(response, 401, { error: 'convai_sign_in_required' });
    return session;
  } catch {
    sendJson(response, 503, { error: 'convai_session_unconfigured' });
    return null;
  }
}

export function createCreatorOptionsHandler(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rateLimited = createRateLimiter({ limit: options.rateLimit ?? 30, windowMs: 60_000 });
  return async function creatorOptionsHandler(request, response) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      return;
    }
    if (rateLimited(request)) {
      sendJson(response, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
      return;
    }
    const secret = options.sessionSecret ?? process.env.CONVAI_SESSION_SECRET ?? '';
    const session = requireSession(request, response, secret);
    if (!session) return;
    try {
      const headers = upstreamHeaders(session.apiKey);
      const [voicesResponse, languagesResponse] = await Promise.all([
        fetchImpl(`${options.apiBase ?? API_BASE}/tts/get_available_voices`, { headers }),
        fetchImpl(`${options.apiBase ?? API_BASE}/tts/get_available_languages`, { headers }),
      ]);
      const [voices, languages] = await Promise.all([responseBody(voicesResponse), responseBody(languagesResponse)]);
      if (!voicesResponse.ok || !languagesResponse.ok) {
        const isPlan = planFailure(voicesResponse.status, voices) || planFailure(languagesResponse.status, languages);
        sendJson(response, isPlan ? 403 : 502, { error: isPlan ? 'convai_plan_required' : 'convai_creator_options_failed' });
        return;
      }
      sendJson(response, 200, { voices, languages });
    } catch (error) {
      console.error('[convai-creator-options]', error instanceof Error ? error.message : 'unknown failure');
      sendJson(response, 502, { error: 'convai_creator_options_failed' });
    }
  };
}

function validatedCreateInput(body) {
  const charName = typeof body.charName === 'string' ? body.charName.trim() : '';
  const voiceType = typeof body.voiceType === 'string' ? body.voiceType.trim() : '';
  const backstory = typeof body.backstory === 'string' ? body.backstory.trim() : '';
  const speakingStyleDescription = typeof body.speakingStyleDescription === 'string' ? body.speakingStyleDescription.trim() : '';
  const sampleDialogue = typeof body.sampleDialogue === 'string' ? body.sampleDialogue.trim() : '';
  const languageCodes = Array.isArray(body.languageCodes)
    ? body.languageCodes.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 8)
    : [];
  const model = typeof body.model === 'string' && ALLOWED_MODELS.has(body.model) ? body.model : 'gemini-2.5-flash-lite';
  const temperature = Number.isFinite(Number(body.temperature))
    ? Math.max(0, Math.min(1, Number(body.temperature)))
    : 0.45;
  if (!charName || charName.length > 80 || !voiceType || voiceType.length > 180 || !backstory || backstory.length > 12_000) return null;
  if (speakingStyleDescription.length > 8_000 || sampleDialogue.length > 12_000) return null;
  return { charName, voiceType, backstory, speakingStyleDescription, sampleDialogue, languageCodes, model, temperature };
}

export function createCreatorCharacterHandler(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rateLimited = createRateLimiter({ limit: options.rateLimit ?? 5, windowMs: options.rateWindowMs ?? 60 * 60 * 1000 });
  return async function creatorCharacterHandler(request, response) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
      return;
    }
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, { error: 'cross_origin_request_denied' });
      return;
    }
    if (rateLimited(request)) {
      sendJson(response, 429, { error: 'rate_limited' }, { 'Retry-After': '3600' });
      return;
    }
    const secret = options.sessionSecret ?? process.env.CONVAI_SESSION_SECRET ?? '';
    const session = requireSession(request, response, secret);
    if (!session) return;

    try {
      const body = await readJsonBody(request, { maxBytes: 48 * 1024 });
      const input = validatedCreateInput(body);
      if (!input) {
        sendJson(response, 400, { error: 'invalid_character_configuration' });
        return;
      }
      const headers = upstreamHeaders(session.apiKey);
      const apiBase = options.apiBase ?? API_BASE;
      const createBody = {
        charName: input.charName,
        voiceType: input.voiceType,
        backstory: input.backstory,
        ...(input.speakingStyleDescription ? { speaking_style_description: input.speakingStyleDescription } : {}),
        ...(input.sampleDialogue ? { speaking_style_sample_dialogues: input.sampleDialogue } : {}),
      };
      const createResponse = await fetchImpl(`${apiBase}/character/create`, {
        method: 'POST', headers, body: JSON.stringify(createBody),
      });
      const created = await responseBody(createResponse);
      if (!createResponse.ok) {
        const isPlan = planFailure(createResponse.status, created);
        sendJson(response, isPlan ? 403 : 502, { error: isPlan ? 'convai_plan_required' : 'convai_character_create_failed' });
        return;
      }
      const charID = String(created.charID ?? created.character_id ?? created.id ?? '').trim();
      if (!charID) {
        sendJson(response, 502, { error: 'convai_character_id_missing' });
        return;
      }
      const updateResponse = await fetchImpl(`${apiBase}/character/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          charID,
          model_group_name: input.model,
          temperature: input.temperature,
          languageCodes: input.languageCodes,
        }),
      });
      const updated = await responseBody(updateResponse);
      if (!updateResponse.ok) {
        await fetchImpl(`${apiBase}/character/delete`, {
          method: 'POST', headers, body: JSON.stringify({ charID }),
        }).catch(() => undefined);
        const isPlan = planFailure(updateResponse.status, updated);
        sendJson(response, isPlan ? 403 : 502, { error: isPlan ? 'convai_plan_required' : 'convai_character_update_failed' });
        return;
      }
      sendJson(response, 201, { charID });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.error('[convai-character-create]', message || 'unknown failure');
      sendJson(response, message === 'request_too_large' ? 413 : 502, { error: 'convai_character_create_failed' });
    }
  };
}

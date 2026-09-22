export type VoiceOption = { name: string; value: string; gender: string; languages: string[]; sampleLink?: string };
export type LanguageOption = { code: string; name: string };

export const MODEL_OPTIONS = [
  { label: 'Gemini 2.5 Flash Lite (recommended)', value: 'gemini-2.5-flash-lite' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
  { label: 'GPT-4.1 mini', value: 'gpt-4.1-mini' },
  { label: 'GPT-4o mini', value: 'gpt-4o-mini' },
  { label: 'Claude 4 Sonnet', value: 'claude-4-sonnet' },
  { label: 'Llama 4 Scout', value: 'llama-4-scout' },
] as const;

export const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

function normalizeVoices(payload: unknown): VoiceOption[] {
  if (!payload || typeof payload !== 'object') return [];
  const voices: VoiceOption[] = [];
  for (const section of Object.values(payload as Record<string, unknown>)) {
    if (!Array.isArray(section)) continue;
    for (const item of section) {
      if (!item || typeof item !== 'object') continue;
      for (const [name, details] of Object.entries(item as Record<string, unknown>)) {
        if (!details || typeof details !== 'object') continue;
        const data = details as Record<string, unknown>;
        const value = String(data.voice_value ?? '');
        if (!value) continue;
        voices.push({
          name,
          value,
          gender: String(data.gender ?? 'Unknown'),
          languages: Array.isArray(data.lang_codes) ? data.lang_codes.map(String) : [],
          sampleLink: typeof data.sample_link === 'string' ? data.sample_link : undefined,
        });
      }
    }
  }
  return voices;
}

function normalizeLanguages(payload: unknown): LanguageOption[] {
  if (!Array.isArray(payload)) return [];
  const languages: LanguageOption[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    for (const details of Object.values(item as Record<string, unknown>)) {
      if (!details || typeof details !== 'object') continue;
      const data = details as Record<string, unknown>;
      const code = String(data.lang_code ?? '');
      if (code) languages.push({ code, name: String(data.lang_name ?? code) });
    }
  }
  return languages;
}

function apiError(status: number, code: unknown): Error {
  if (code === 'convai_plan_required') {
    return new Error('Creating characters requires a Convai Professional plan or higher. Upgrade your Convai account, then try again.');
  }
  if (status === 401 || code === 'convai_sign_in_required') {
    return new Error('Your secure Convai session has expired. Sign in with Convai again.');
  }
  if (status === 429) return new Error('Too many creation requests. Please wait and try again.');
  return new Error('Convai could not complete character setup. Please try again.');
}

export async function fetchCreatorOptions(): Promise<{ voices: VoiceOption[]; languages: LanguageOption[] }> {
  const response = await fetch('/api/convai/creator/options', { credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as { voices?: unknown; languages?: unknown; error?: unknown };
  if (!response.ok) throw apiError(response.status, body.error);
  return { voices: normalizeVoices(body.voices), languages: normalizeLanguages(body.languages) };
}

export function filterVoicesForLanguage(voices: VoiceOption[], languageCode: string): VoiceOption[] {
  const selected = languageCode.toLowerCase();
  const compatible = voices.filter((voice) => voice.languages.some((code) => {
    const candidate = code.toLowerCase();
    return candidate === selected || candidate.split('-')[0] === selected.split('-')[0];
  }));
  return compatible.length ? compatible : voices;
}

export function pickDefaultVoice(voices: VoiceOption[], languageCode: string): string {
  const compatible = filterVoicesForLanguage(voices, languageCode);
  return compatible.find((voice) => voice.languages.some((code) => code.toLowerCase().startsWith('en')))?.value
    ?? compatible[0]?.value
    ?? '';
}

export async function createConvaiCharacter(input: {
  charName: string;
  voiceType: string;
  backstory: string;
  languageCodes: string[];
  model: string;
  temperature: number;
  speakingStyleDescription?: string;
  sampleDialogue?: string;
}): Promise<{ charID: string }> {
  const response = await fetch('/api/convai/creator/characters', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as { charID?: unknown; error?: unknown };
  if (!response.ok) throw apiError(response.status, body.error);
  const charID = typeof body.charID === 'string' ? body.charID.trim() : '';
  if (!charID) throw new Error('Convai created the character but returned no character ID.');
  return { charID };
}

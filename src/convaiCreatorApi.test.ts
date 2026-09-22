import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConvaiCharacter, fetchCreatorOptions } from './convaiCreatorApi';

afterEach(() => vi.restoreAllMocks());

describe('Convai creator client', () => {
  it('normalizes account voices and languages through same-origin endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      voices: { female: [{ Ava: { voice_value: 'ava', gender: 'Female', lang_codes: ['en-US'] } }] },
      languages: [{ English: { lang_code: 'en-US', lang_name: 'English' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const options = await fetchCreatorOptions();
    expect(options.voices[0]).toMatchObject({ name: 'Ava', value: 'ava' });
    expect(options.languages).toEqual([{ code: 'en-US', name: 'English' }]);
  });

  it('returns the real Convai character id and explains plan restrictions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ charID: 'real-character-id' }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'convai_plan_required' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const input = { charName: 'Coach', voiceType: 'ava', backstory: 'Backstory', languageCodes: ['en-US'], model: 'gemini-2.5-flash-lite', temperature: 0.45 };
    await expect(createConvaiCharacter(input)).resolves.toEqual({ charID: 'real-character-id' });
    await expect(createConvaiCharacter(input)).rejects.toThrow(/Professional plan/i);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/convai/creator/characters');
  });
});

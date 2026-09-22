import type { BuiltinCoachId, CoachConfig } from './coachConfig';
import { COACHES } from './coachConfig';
import { CONVAI_ACCOUNT_FEATURES_ENABLED } from './featureFlags';

const STORAGE_KEY = 'classic-chess.customCoaches.v1';

/** Model/appearance fallback for coaches saved before the picker existed. */
const DEFAULT_BASE_COACH_ID: BuiltinCoachId = 'leila';

export type StoredCustomCoach = {
  source: 'convai-character';
  id: string;
  name: string;
  characterId: string;
  backstory: string;
  createdAt: string;
  speakingStyleDescription?: string;
  sampleDialogue?: string;
  /** Which builtin coach supplies the 3D model/appearance (default: leila). */
  baseCoachId?: BuiltinCoachId;
};

/** A malformed stored entry (e.g. missing backstory) would throw in storedCoachToConfig. */
function isValidStoredCoach(value: unknown): value is StoredCustomCoach {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' && record.id.startsWith('custom-')
    && record.source === 'convai-character'
    && typeof record.name === 'string'
    && typeof record.characterId === 'string'
    && typeof record.backstory === 'string'
  );
}

export function loadCustomCoaches(): StoredCustomCoach[] {
  if (!CONVAI_ACCOUNT_FEATURES_ENABLED) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidStoredCoach);
    // Remove the retired local-persona records. Only characters proven to
    // have been created through the authenticated Convai API survive.
    if (valid.length !== parsed.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveCustomCoach(entry: StoredCustomCoach): void {
  const existing = loadCustomCoaches().filter((c) => c.id !== entry.id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...existing].slice(0, 12)));
}

export function storedCoachToConfig(stored: StoredCustomCoach): CoachConfig {
  // The selected builtin supplies the local 3D appearance. characterId is the
  // real Convai character created in the signed-in user's account.
  const baseId = stored.baseCoachId && COACHES.some((c) => c.id === stored.baseCoachId)
    ? stored.baseCoachId
    : DEFAULT_BASE_COACH_ID;
  const base = COACHES.find((c) => c.id === baseId)!;
  return {
    id: stored.id as CoachConfig['id'],
    name: stored.name,
    title: 'Custom Coach',
    assetName: base.assetName,
    portraitFile: base.portraitFile,
    portraitFocusY: base.portraitFocusY,
    modelFile: base.modelFile,
    idleFile: base.idleFile,
    characterId: stored.characterId,
    bgColor: base.bgColor,
    accent: base.accent,
    difficultyIds: ['beginner', 'intermediate', 'advanced'],
    voiceStyle: stored.speakingStyleDescription?.trim() || 'Warm and adaptive.',
    chessFocus: stored.backstory.slice(0, 120) || 'General chess coaching.',
    promptStyle: [
      `I speak in first person as ${stored.name}. ${stored.backstory}`,
      stored.speakingStyleDescription?.trim() ? `Speaking style: ${stored.speakingStyleDescription.trim()}` : '',
      stored.sampleDialogue?.trim() ? `Sample lines in my voice: ${stored.sampleDialogue.trim()}` : '',
    ].filter(Boolean).join(' '),
    hintStyle: 'I give progressive hints tied to the position.',
  };
}

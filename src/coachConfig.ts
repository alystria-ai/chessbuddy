import { loadCustomCoaches, storedCoachToConfig } from './customCoaches';

export type BuiltinCoachId = 'magnus' | 'sofia' | 'arjun' | 'leila';
export type CoachId = BuiltinCoachId | `custom-${string}`;

export type DifficultyId = 'new' | 'beginner' | 'intermediate' | 'advanced' | 'expert';

export const DEFAULT_PORTRAIT_FILE = 'coach-portraits/sofia.png';

export type CoachConfig = {
  id: CoachId;
  name: string;
  title: string;
  assetName: 'Vincent' | 'Tyler' | 'Cassandra' | 'Leila' | 'Sofia';
  portraitFile: string;
  /** Vertical focus when baking menu thumbs — must match scripts/coachPortraitCrop.mjs */
  portraitFocusY?: number;
  modelFile: string;
  idleFile: string;
  /** LTM-enabled Convai character for signed-in Google users. */
  characterId: string;
  /** Optional LTM-disabled clone for anonymous guests (env: VITE_CONVAI_GUEST_CHARACTER_*). */
  guestCharacterId?: string;
  bgColor: string;
  accent: string;
  difficultyIds: DifficultyId[];
  voiceStyle: string;
  chessFocus: string;
  promptStyle: string;
  hintStyle: string;
};

export type DifficultyConfig = {
  id: DifficultyId;
  label: string;
  stockfishSkill: number;
  elo: string;
  moveTimeMs: number;
  curriculum: string;
  explanationDepth: string;
};

export const DIFFICULTIES: DifficultyConfig[] = [
  {
    id: 'new',
    label: 'New',
    stockfishSkill: 2,
    elo: '<= 800',
    moveTimeMs: 520,
    curriculum: 'piece names, legal moves, checks, captures, threats, king safety, defended and undefended pieces, basic development, and why castling matters',
    explanationDepth: 'Use plain beginner language. Explain one chess idea with no jargon unless you immediately define it.',
  },
  {
    id: 'beginner',
    label: 'Beginner',
    stockfishSkill: 5,
    elo: '800-1200',
    moveTimeMs: 650,
    curriculum: 'opening principles, loose pieces, simple pins and forks, piece safety, center control, castling, and the checks-captures-threats thinking routine',
    explanationDepth: 'Use clear teaching language. Name common patterns and briefly explain why they matter.',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    stockfishSkill: 12,
    elo: '1200-1600',
    moveTimeMs: 850,
    curriculum: 'candidate moves, forcing lines, development lead, pawn breaks, weak squares, pins, discovered attacks, outposts, open files, and basic endgame conversion',
    explanationDepth: 'Use real chess vocabulary and connect the move to a plan or calculation line.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    stockfishSkill: 19,
    elo: '1600-2000',
    moveTimeMs: 1100,
    curriculum: 'calculation trees, prophylaxis, initiative, imbalances, pawn structure, exchange decisions, converting advantages, defensive resources, and engine-style candidate comparison',
    explanationDepth: 'Be concise but dense. Reference concrete chess concepts and explain the critical branch.',
  },
  {
    id: 'expert',
    label: 'Expert',
    stockfishSkill: 20,
    elo: '2000+',
    moveTimeMs: 1450,
    curriculum: 'evaluation swings, move-order nuance, strategic concessions, endgame tablebase-style precision, defensive resources, and long forcing variations',
    explanationDepth: 'Assume a strong student. Use compact expert language and focus only on critical moments.',
  },
];

export const COACHES: CoachConfig[] = [
  {
    id: 'magnus',
    name: 'Magnus',
    title: 'The Grandmaster',
    assetName: 'Vincent',
    portraitFile: 'coach-portraits/magnus.png',
    portraitFocusY: 14,
    modelFile: 'magnus.glb',
    idleFile: 'magnus-animations.glb',
    characterId: 'da1ff068-477c-11f1-a121-42010a7be02c',
    bgColor: '#b9c2bf',
    accent: '#b99a61',
    difficultyIds: ['advanced', 'expert'],
    voiceStyle: 'Measured, sparse, authoritative.',
    chessFocus: 'Positional understanding, conversion, long-term plans.',
    promptStyle: 'I speak as Magnus in first person, never as an outside narrator. I reference concrete calculation, evaluation, and study themes such as prophylaxis, weak squares, conversion, and endgame technique.',
    hintStyle: 'I give the smallest useful clue first, then the candidate idea, then the move. I connect each hint to a serious study habit such as candidate moves or prophylaxis.',
  },
  {
    id: 'sofia',
    name: 'Sofia',
    title: 'The Tactician',
    // MetaHuman-rigged Sofia: her mesh, portrait and animations are her own
    // (assetName drives the mesh's material/lipsync/scale tuning).
    assetName: 'Sofia',
    portraitFile: 'coach-portraits/sofia.png',
    portraitFocusY: 14,
    modelFile: 'sofia.glb',
    idleFile: 'sofia-animations.glb',
    characterId: '9f3c8e20-477c-11f1-a6c8-42010a7be02c',
    bgColor: '#c3cbc6',
    accent: '#c19b64',
    difficultyIds: ['intermediate', 'advanced'],
    voiceStyle: 'Punchy, direct, energetic about tactics.',
    chessFocus: 'Combinations, forcing moves, initiative, attacking chances.',
    promptStyle: 'I speak as Sofia in first person, never as an outside narrator. I make tactics feel like calculation class: checks, captures, threats, pins, forks, discovered attacks, deflection, overload, and king safety.',
    hintStyle: 'I point toward forcing moves first, then name the tactical motif, then give the move. I explain why the tactic works, not just that it works.',
  },
  {
    id: 'arjun',
    name: 'Arjun',
    title: 'The Patient Teacher',
    assetName: 'Tyler',
    portraitFile: 'coach-portraits/arjun.png',
    portraitFocusY: 15,
    modelFile: 'arjun.glb',
    idleFile: 'character-assets/chess-avatars-v2/arjun-chess-animations/body/Anim_M01_BoardIdle.glb',
    characterId: 'f465b7aa-477c-11f1-b82a-42010a7be02c',
    bgColor: '#cbc4bb',
    accent: '#bd7655',
    difficultyIds: ['new', 'beginner'],
    voiceStyle: 'Warm, nurturing, explanatory.',
    chessFocus: 'Basics, piece safety, opening principles, confidence.',
    promptStyle: 'I speak as Arjun in first person, never as an outside narrator. I teach like a patient classroom coach: piece safety, development, center control, castling, simple tactics, and thinking routines.',
    hintStyle: 'I offer gentle scaffolding: first where to look, then the concept, then the move. I explain the why in beginner language.',
  },
  {
    id: 'leila',
    name: 'Leila',
    title: 'The Strategist',
    assetName: 'Leila',
    portraitFile: 'coach-portraits/leila.png',
    portraitFocusY: 14,
    modelFile: 'leila.glb',
    idleFile: 'leila-animations.glb',
    characterId: 'c1f0a244-477c-11f1-acd0-42010a7be02c',
    bgColor: '#c8c1c4',
    accent: '#b886a6',
    difficultyIds: ['beginner', 'intermediate', 'advanced'],
    voiceStyle: 'Reflective, considered, big-picture.',
    chessFocus: 'Pawn structures, piece activity, endgames, slow advantages.',
    promptStyle: 'I speak as Leila in first person, never as an outside narrator. I connect moves to plans using pawn structure, weak squares, outposts, open files, exchanges, endgames, and improving the worst piece.',
    hintStyle: 'I frame hints around the plan first: weak squares, pawn breaks, improving pieces, or simplifying. Then I reveal the move only when appropriate.',
  },
];

function guestCharacterIdFromEnv(coachId: BuiltinCoachId): string | undefined {
  const envByCoach: Record<BuiltinCoachId, string | undefined> = {
    magnus: import.meta.env.VITE_CONVAI_GUEST_CHARACTER_MAGNUS,
    sofia: import.meta.env.VITE_CONVAI_GUEST_CHARACTER_SOFIA,
    arjun: import.meta.env.VITE_CONVAI_GUEST_CHARACTER_ARJUN,
    leila: import.meta.env.VITE_CONVAI_GUEST_CHARACTER_LEILA,
  };
  const value = envByCoach[coachId]?.trim();
  return value || undefined;
}

for (const coach of COACHES) {
  if (coach.id === 'magnus' || coach.id === 'sofia' || coach.id === 'arjun' || coach.id === 'leila') {
    coach.guestCharacterId = guestCharacterIdFromEnv(coach.id);
  }
}

/** Signed-in users keep LTM characters; guests use optional LTM-off clones. */
export function resolveConvaiCharacterId(coach: CoachConfig, signedInWithLtm: boolean): string {
  if (signedInWithLtm) return coach.characterId;
  return coach.guestCharacterId?.trim() || coach.characterId;
}

export const DEFAULT_COACH = COACHES.find((c) => c.id === 'sofia') ?? COACHES[1];
export const DEFAULT_DIFFICULTY = DIFFICULTIES[1];

/**
 * Cache-buster for the pre-rendered portrait PNGs. Their URLs never change,
 * so browsers and the Pages CDN keep serving stale art after a re-render —
 * bump this whenever portraits are regenerated (see scripts/render-coach-
 * portrait.mjs). V28 restores Sofia's fully authored eye aperture while
 * retaining the requested player-facing head and model pose.
 */
const PORTRAIT_VERSION = 31;
const MAGNUS_PORTRAIT_VERSION = 31;

function portraitVersion(portraitFile: string): number {
  return /(?:^|\/)magnus(?:-thumb)?\.png$/i.test(portraitFile)
    ? MAGNUS_PORTRAIT_VERSION
    : PORTRAIT_VERSION;
}

export function getCoachPortraitUrl(coach: Pick<CoachConfig, 'portraitFile'>): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const portrait = coach.portraitFile || DEFAULT_PORTRAIT_FILE;
  return `${base}${portrait}?v=${portraitVersion(portrait)}`;
}

/** The tall game window always uses the full 3:4 pose-matched portrait. */
export function getCoachWarmupPortraitUrl(
  coach: Pick<CoachConfig, 'id' | 'portraitFile'>,
): string {
  return getCoachPortraitUrl(coach);
}

export function getCoachPortraitThumbUrl(coach: Pick<CoachConfig, 'portraitFile'>): string {
  const portrait = coach.portraitFile || DEFAULT_PORTRAIT_FILE;
  if (!/coach-portraits\/[^/]+\.png$/i.test(portrait)) {
    return getCoachPortraitUrl(coach);
  }
  return getCoachPortraitUrl({ portraitFile: portrait.replace(/\.png$/i, '-thumb.png') });
}

/**
 * Custom-coach configs are cached by content so repeated getCoach/getAllCoaches
 * calls return stable object identities. Without this, React effects that list
 * `coach` in their deps re-fired on every render for custom coaches (repeated
 * connectCoach/context churn); builtins were safe only because they alias
 * stable COACHES entries.
 */
const customCoachConfigCache = new Map<string, { raw: string; config: CoachConfig }>();

function cachedCustomCoachConfig(stored: ReturnType<typeof loadCustomCoaches>[number]): CoachConfig {
  const raw = JSON.stringify(stored);
  const cached = customCoachConfigCache.get(stored.id);
  if (cached && cached.raw === raw) return cached.config;
  const config = storedCoachToConfig(stored);
  customCoachConfigCache.set(stored.id, { raw, config });
  return config;
}

export function getAllCoaches(): CoachConfig[] {
  const custom = loadCustomCoaches().map(cachedCustomCoachConfig);
  return [...COACHES, ...custom];
}

export function getCoach(id: CoachId): CoachConfig {
  const builtin = COACHES.find((coach) => coach.id === id);
  if (builtin) return builtin;
  const custom = loadCustomCoaches().find((c) => c.id === id);
  if (custom) return cachedCustomCoachConfig(custom);
  return DEFAULT_COACH;
}

export function getDifficulty(id: DifficultyId): DifficultyConfig {
  return DIFFICULTIES.find((difficulty) => difficulty.id === id) ?? DEFAULT_DIFFICULTY;
}

export function suggestedDifficultyForCoach(coach: CoachConfig, current: DifficultyConfig): DifficultyConfig {
  if (coach.difficultyIds.includes(current.id)) return current;
  return getDifficulty(coach.difficultyIds[0]);
}

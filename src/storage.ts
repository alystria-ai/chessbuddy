import type { CoachId, DifficultyId } from './coachConfig';

export type MoveSnapshot = {
  san: string;
  from: string;
  to: string;
  piece: string;
  captured?: string;
  color: 'w' | 'b';
  by: string;
  fenBefore: string;
  fenAfter: string;
};

export type KeyMoment = {
  moveNumber: number;
  label: string;
  description: string;
  bestMove?: string;
};

export type AnalysisSummary = {
  opening: string;
  whiteAccuracy: number;
  blackAccuracy: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  /** Number of player moves with complete engine data. Added in critical-v1. */
  gradedMoves?: number;
  /** Total player moves available for grading. Added in critical-v1. */
  totalUserMoves?: number;
  /** Mean raw evaluation loss across graded moves. Added in critical-v1. */
  averageCentipawnLoss?: number;
  /** Versioned because this score is intentionally stricter than vendor accuracy. */
  scoringModel?: 'critical-v1';
  keyMoments: KeyMoment[];
  tips: string[];
};

export type StoredGameSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: 'quick-play' | 'puzzle';
  coachId: CoachId;
  difficultyId: DifficultyId;
  result: string;
  finalFen: string;
  hintsUsed: number;
  moves: MoveSnapshot[];
  analysis?: AnalysisSummary;
};

const STORAGE_KEY = 'classic-chess.sessions.v1';

export function loadSessions(): StoredGameSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSession(session: StoredGameSession): void {
  const sessions = loadSessions();
  const next = [session, ...sessions.filter((item) => item.id !== session.id)].slice(0, 50);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function deleteSession(id: string): void {
  const next = loadSessions().filter((session) => session.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function createSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable.');
  }

  // Preserve the existing 13-hex-character suffix while removing the
  // predictable fallback (CodeQL: js/insecure-randomness).
  const bytes = cryptoApi.getRandomValues(new Uint8Array(7));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 13);
  return `game-${Date.now()}-${suffix}`;
}

const PUZZLE_PROGRESS_KEY = 'classic-chess.puzzleProgress.v1';

export type PuzzleProgress = Partial<Record<DifficultyId, string[]>>;

export function loadPuzzleProgress(): PuzzleProgress {
  try {
    const raw = window.localStorage.getItem(PUZZLE_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function markPuzzleCompleted(difficulty: DifficultyId, puzzleId: string): void {
  const progress = loadPuzzleProgress();
  const existing = progress[difficulty] ?? [];
  if (existing.includes(puzzleId)) return;
  progress[difficulty] = [...existing, puzzleId];
  window.localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
}

export function resetPuzzleProgress(difficulty: DifficultyId): void {
  const progress = loadPuzzleProgress();
  delete progress[difficulty];
  window.localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(progress));
}

export type CoachingControlMode = 'game' | 'coach';

const COACHING_CONTROL_KEY = 'classic-chess.coachingControlMode.v1';
const DEFAULT_COACHING_CONTROL_MODE: CoachingControlMode = 'coach';

export function loadCoachingControlMode(): CoachingControlMode {
  try {
    const raw = window.localStorage.getItem(COACHING_CONTROL_KEY);
    if (raw === 'game' || raw === 'coach') return raw;
    return DEFAULT_COACHING_CONTROL_MODE;
  } catch {
    return DEFAULT_COACHING_CONTROL_MODE;
  }
}

export function saveCoachingControlMode(mode: CoachingControlMode): void {
  try {
    window.localStorage.setItem(COACHING_CONTROL_KEY, mode);
  } catch {
    // localStorage may be unavailable (private mode, quota); ignore so the toggle still works in-session.
  }
}

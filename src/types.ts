import type { CoachId, DifficultyId } from './coachConfig';

export type Side = 'w' | 'b';

export type CoachMessage = {
  speaker: string;
  text: string;
};

export type MoveRecord = {
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

export type GameSetup = {
  coachId: CoachId;
  difficultyId: DifficultyId;
};

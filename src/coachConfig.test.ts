import { describe, expect, it } from 'vitest';
import {
  COACHES,
  DIFFICULTIES,
  getCoach,
  getCoachPortraitThumbUrl,
  getCoachWarmupPortraitUrl,
  getDifficulty,
  resolveConvaiCharacterId,
  suggestedDifficultyForCoach,
} from './coachConfig';

describe('coach configuration', () => {
  it('defines the four feedback coaches', () => {
    expect(COACHES.map((coach) => coach.name)).toEqual(['Magnus', 'Sofia', 'Arjun', 'Leila']);
  });

  it('uses the current Convai dashboard character ids', () => {
    expect(COACHES.map((coach) => coach.characterId)).toEqual([
      'da1ff068-477c-11f1-a121-42010a7be02c',
      '9f3c8e20-477c-11f1-a6c8-42010a7be02c',
      'f465b7aa-477c-11f1-b82a-42010a7be02c',
      'c1f0a244-477c-11f1-acd0-42010a7be02c',
    ]);
  });

  it('maps all difficulty ids to stockfish skill levels', () => {
    expect(DIFFICULTIES.map((difficulty) => difficulty.stockfishSkill)).toEqual([2, 5, 12, 19, 20]);
  });

  it('uses LTM characters for signed-in users and guest clones when configured', () => {
    const leila = getCoach('leila');
    expect(resolveConvaiCharacterId(leila, true)).toBe(leila.characterId);
    expect(resolveConvaiCharacterId(leila, false)).toBe(leila.guestCharacterId ?? leila.characterId);
  });

  it('uses the full portrait during WebGL warmup and reserves the square crop for avatars', () => {
    const arjun = getCoach('arjun');
    const sofia = getCoach('sofia');
    const magnus = getCoach('magnus');
    expect(getCoachWarmupPortraitUrl(arjun)).toContain('/coach-portraits/arjun.png?v=31');
    expect(getCoachWarmupPortraitUrl(arjun)).not.toContain('-thumb.png');
    expect(getCoachWarmupPortraitUrl(sofia)).toContain('/coach-portraits/sofia.png?v=31');
    expect(getCoachWarmupPortraitUrl(sofia)).not.toContain('-thumb.png');
    expect(getCoachPortraitThumbUrl(arjun)).toContain('/coach-portraits/arjun-thumb.png?v=31');
    expect(getCoachWarmupPortraitUrl(magnus)).toContain('/coach-portraits/magnus.png?v=31');
    expect(getCoachPortraitThumbUrl(magnus)).toContain('/coach-portraits/magnus-thumb.png?v=31');
  });

  it('falls back to a supported difficulty when a coach does not support the current one', () => {
    const magnus = getCoach('magnus');
    const beginner = getDifficulty('beginner');
    expect(suggestedDifficultyForCoach(magnus, beginner).id).toBe('advanced');
  });
});

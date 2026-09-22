import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COACHES } from './coachConfig';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_PATH = path.join(ROOT, 'misc', 'portrait-picker-preview.png');
const ANALYSIS_PATH = path.join(ROOT, 'misc', 'portrait-debug', 'portrait-analysis.json');

type CropModule = {
  COACH_THUMB_CROPS: Record<string, { focusY: number }>;
  BUILTIN_COACH_IDS: string[];
};

type PortraitAnalysis = {
  coachId: string;
  headClippedSuspect: boolean;
  tPoseSuspect: boolean;
};

async function loadCropModule(): Promise<CropModule> {
  return import('../scripts/coachPortraitCrop.mjs') as Promise<CropModule>;
}

describe('coach portrait picker crops', () => {
  it('keeps coachConfig portraitFocusY in sync with scripts/coachPortraitCrop.mjs', async () => {
    const { COACH_THUMB_CROPS } = await loadCropModule();
    for (const coach of COACHES) {
      if (!(coach.id in COACH_THUMB_CROPS)) continue;
      expect(coach.portraitFocusY).toBe(COACH_THUMB_CROPS[coach.id].focusY);
    }
  });

  it('generates picker preview and passes framing heuristics for magnus and leila', async () => {
    execSync('node scripts/preview-coach-portrait-picker.mjs', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    expect(fs.existsSync(PREVIEW_PATH)).toBe(true);
    expect(fs.existsSync(ANALYSIS_PATH)).toBe(true);

    const analysis = JSON.parse(fs.readFileSync(ANALYSIS_PATH, 'utf8')) as PortraitAnalysis[];
    const magnus = analysis.find((row) => row.coachId === 'magnus');
    const leila = analysis.find((row) => row.coachId === 'leila');

    expect(magnus).toBeDefined();
    expect(leila).toBeDefined();
    expect(magnus!.headClippedSuspect).toBe(false);
    expect(leila!.headClippedSuspect).toBe(false);
    expect(magnus!.tPoseSuspect).toBe(false);
    expect(leila!.tPoseSuspect).toBe(false);

    // Open misc/portrait-picker-preview.png for human visual sign-off after portrait changes.

    const stat = fs.statSync(PREVIEW_PATH);
    expect(stat.size).toBeGreaterThan(10_000);
  });
});

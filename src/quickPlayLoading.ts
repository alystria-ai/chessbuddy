import { debugLog } from './debugLog';

export const QUICK_PLAY_PHASES = {
  AVATAR: 1,
  CONVAI_CONNECT: 2,
  CONVAI_CONNECTED: 3,
  CONVAI_READY: 4,
  GAME_SETUP: 5,
  WELCOME: 6,
  REVEAL: 7,
} as const;

const PHASE_RANGES: Record<number, { start: number; end: number; label: string }> = {
  [QUICK_PLAY_PHASES.AVATAR]: { start: 0, end: 36, label: 'avatar' },
  [QUICK_PLAY_PHASES.CONVAI_CONNECT]: { start: 36, end: 48, label: 'convai-connect' },
  [QUICK_PLAY_PHASES.CONVAI_CONNECTED]: { start: 48, end: 60, label: 'convai-connected' },
  [QUICK_PLAY_PHASES.CONVAI_READY]: { start: 60, end: 72, label: 'convai-ready' },
  [QUICK_PLAY_PHASES.GAME_SETUP]: { start: 72, end: 84, label: 'game-setup' },
  [QUICK_PLAY_PHASES.WELCOME]: { start: 84, end: 96, label: 'welcome' },
  [QUICK_PLAY_PHASES.REVEAL]: { start: 96, end: 100, label: 'reveal' },
};

export function computePhaseProgress(phase: number, subProgress = 0): number {
  const range = PHASE_RANGES[phase];
  if (!range) return 0;
  const sub = Math.max(0, Math.min(1, subProgress));
  return Math.round(range.start + (range.end - range.start) * sub);
}

export type QuickPlayLoadingReporter = {
  enterPhase: (phase: number, userMessage: string, logDetail?: string) => void;
  setSubProgress: (subProgress: number, userMessage?: string, logDetail?: string) => void;
  getPhase: () => number;
  elapsedLabel: () => string;
};

export function createQuickPlayLoadingReporter(
  onUpdate: (progress: number, step: string) => void,
  scope = 'Loading',
): QuickPlayLoadingReporter {
  const startedAt = performance.now();
  let phase = 0;
  let lastProgress = 0;
  let lastStep = '';

  const elapsedLabel = () => {
    const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
    return `+${secs}s`;
  };

  const publish = (nextProgress: number, step: string, logDetail?: string) => {
    const progress = Math.max(lastProgress, Math.min(100, nextProgress));
    lastProgress = progress;
    lastStep = step;
    onUpdate(progress, step);
    if (logDetail) {
      debugLog(scope, `${logDetail} (${progress}%) ${elapsedLabel()}`);
    }
  };

  return {
    getPhase: () => phase,
    elapsedLabel,
    enterPhase(nextPhase, userMessage, logDetail) {
      if (nextPhase < phase) return;
      phase = nextPhase;
      const range = PHASE_RANGES[nextPhase];
      const detail = logDetail ?? `Phase: ${range?.label ?? nextPhase} — ${userMessage}`;
      publish(computePhaseProgress(nextPhase, 0), userMessage, detail);
    },
    setSubProgress(subProgress, userMessage, logDetail) {
      if (!phase) return;
      const progress = computePhaseProgress(phase, subProgress);
      const step = userMessage ?? lastStep;
      if (progress < lastProgress && !userMessage) return;
      publish(progress, step, logDetail);
    },
  };
}

export function avatarLoadingMessage(coachName: string, percent: number): string | undefined {
  if (percent < 12) return `Bringing ${coachName} into the room...`;
  if (percent < 45) return `Fetching ${coachName}'s portrait...`;
  if (percent < 78) return `Almost ready — ${coachName} is nearly here...`;
  if (percent < 100) return `Putting the finishing touches on ${coachName}...`;
  return undefined;
}

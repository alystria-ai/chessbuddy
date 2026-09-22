import { useEffect, useRef, type MutableRefObject } from 'react';
import { useProgress } from '@react-three/drei';
import { debugLog } from './debugLog';
import {
  QUICK_PLAY_PHASES,
  avatarLoadingMessage,
  type QuickPlayLoadingReporter,
} from './quickPlayLoading';

type Props = {
  coachName: string;
  reporterRef: MutableRefObject<QuickPlayLoadingReporter | null>;
};

function basename(url: string): string {
  const clean = url.split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || url;
}

export default function AvatarLoadProgress({ coachName, reporterRef }: Props) {
  const { progress, active, loaded, total, item } = useProgress();
  const lastLoggedDecile = useRef(-1);

  useEffect(() => {
    const reporter = reporterRef.current;
    if (!reporter || reporter.getPhase() !== QUICK_PLAY_PHASES.AVATAR) return;

    const sub = Math.max(0, Math.min(1, progress / 100));
    const message = avatarLoadingMessage(coachName, progress);
    reporter.setSubProgress(sub, message);

    if (!active && progress >= 100) {
      debugLog('Loading', `Portrait assets finished downloading ${reporter.elapsedLabel()}`);
      return;
    }

    if (!active) return;

    const decile = Math.floor(progress / 10);
    if (decile !== lastLoggedDecile.current) {
      lastLoggedDecile.current = decile;
      const asset = item ? basename(item) : 'assets';
      debugLog(
        'Loading',
        `Portrait download ${Math.round(progress)}% (${loaded}/${total}) — ${asset} ${reporter.elapsedLabel()}`,
      );
    }
  }, [progress, active, loaded, total, item, coachName, reporterRef]);

  return null;
}

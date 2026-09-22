import type { ReactNode } from 'react';
import { useThemeCopy } from './themeCopy';

type Props = {
  progress: number;
  step: string;
  children?: ReactNode;
};

const PIECES = ['\u2659', '\u2658', '\u2657', '\u2656', '\u2655'];
const LINES = [
  'Polishing the bishops. They insisted.',
  'Teaching the knights to stop jumping to conclusions.',
  'Asking the queen to keep it reasonable. She declined.',
  'Convincing the pawns this is their big character arc.',
  'Waking the coaches before the rooks start arguing.',
];

export default function LoadingScreen({ progress, step, children }: Props) {
  const line = LINES[Math.floor(Date.now() / 3500) % LINES.length];
  const themeCopy = useThemeCopy();

  return (
    <div className="loading-screen" data-screen="loading" data-screen-state={progress >= 100 ? 'ready' : 'pending'}>
      <div className="loading-pieces" aria-hidden="true">
        {PIECES.map((piece, index) => (
          <span key={piece} style={{ animationDelay: `${index * 120}ms` }}>
            {piece}
          </span>
        ))}
      </div>
      <h1 aria-label="Chessbuddy">{themeCopy.productTitle}</h1>
      <p className="loading-step">{step}</p>
      <div className="loading-track">
        <div className="loading-fill" style={{ width: `${progress}%` }} />
      </div>
      <small className="loading-quip">{line}</small>
      {children && <div className="loading-prewarm" aria-hidden="true">{children}</div>}
    </div>
  );
}

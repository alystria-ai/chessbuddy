import { useMemo, type CSSProperties } from 'react';

/**
 * Pure-CSS confetti burst. Mount it inside any `position: relative` container
 * (it fills the container and ignores pointer events); unmount whenever — the
 * particles fall once (`animation-fill-mode: forwards`) and end invisible.
 * Re-mount with a changing React `key` to fire again.
 */

const DEFAULT_PALETTE = ['#d9a441', '#f4ead8', '#8f5f86', '#1f8a6b', '#b8684d', '#4d6b8f'];

type ConfettiPiece = {
  left: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
  shape: number;
};

export function ConfettiBurst({
  count = 40,
  palette = DEFAULT_PALETTE,
  className,
}: {
  count?: number;
  palette?: string[];
  className?: string;
}) {
  const pieces = useMemo<ConfettiPiece[]>(
    () => Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      duration: 1.5 + Math.random() * 1.3,
      drift: (Math.random() * 2 - 1) * 90,
      spin: (Math.random() * 2 - 1) * 640,
      size: 5 + Math.random() * 5,
      color: palette[i % palette.length],
      shape: i % 3,
    })),
    [count, palette],
  );

  return (
    <div className={`confetti-burst ${className ?? ''}`.trim()} aria-hidden="true">
      {pieces.map((piece, i) => (
        <span
          key={i}
          className={`confetti-piece confetti-shape-${piece.shape}`}
          style={{
            left: `${piece.left}%`,
            width: `${piece.size}px`,
            height: `${piece.shape === 2 ? piece.size * 0.45 : piece.size}px`,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            '--confetti-drift': `${piece.drift}px`,
            '--confetti-spin': `${piece.spin}deg`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

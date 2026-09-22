import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Library, SlidersHorizontal, UserRoundPlus, X } from 'lucide-react';
import {
  DIFFICULTIES,
  getAllCoaches,
  getCoachPortraitThumbUrl,
  suggestedDifficultyForCoach,
  type CoachId,
  type DifficultyId,
} from './coachConfig';
import type { CoachingControlMode } from './storage';

type SetupProps = {
  open: boolean;
  coachId: CoachId;
  difficultyId: DifficultyId;
  coachingControlMode: CoachingControlMode;
  onCoachChange: (coachId: CoachId) => void;
  onDifficultyChange: (difficultyId: DifficultyId) => void;
  onCoachingControlModeChange: (mode: CoachingControlMode) => void;
  onClose: () => void;
};

export function GameSetupPanel({
  open,
  coachId,
  difficultyId,
  coachingControlMode,
  onCoachChange,
  onDifficultyChange,
  onCoachingControlModeChange,
  onClose,
}: SetupProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const coaches = getAllCoaches();

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (!previousFocus) return;
    window.requestAnimationFrame(() => {
      previousFocus.focus({ preventScroll: true });
    });
  }, [open]);

  const closeSettings = () => {
    onCloseRef.current();
  };

  const handleClosePointer = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    closeSettings();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="game-setup-scrim"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) closeSettings();
      }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) closeSettings();
      }}
    >
      <section
        className="game-setup-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-setup-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="game-setup-header">
          <div>
            <span>Advanced options</span>
            <h2 id="game-setup-title">Game settings</h2>
            <p>These defaults are ready to play. Change only what matters to you.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeSettings();
            }}
            onPointerDown={handleClosePointer}
            aria-label="Close game settings"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="game-setup-group">
          <div className="game-setup-label">
            <strong>Coach</strong>
            <small>Who joins you at the board</small>
          </div>
          <div className="game-ready-coach-picker">
            {coaches.map((coach) => (
              <button
                key={coach.id}
                type="button"
                className={coach.id === coachId ? 'is-selected' : ''}
                aria-pressed={coach.id === coachId}
                onClick={() => {
                  onCoachChange(coach.id);
                  const current = DIFFICULTIES.find((item) => item.id === difficultyId) ?? DIFFICULTIES[0];
                  onDifficultyChange(suggestedDifficultyForCoach(coach, current).id);
                }}
              >
                <img src={getCoachPortraitThumbUrl(coach)} alt="" width={384} height={384} />
                <span>
                  <strong>{coach.name}</strong>
                  <small>{coach.title}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="game-setup-group">
          <div className="game-setup-label">
            <strong>Challenge</strong>
            <small>AI strength and explanation depth</small>
          </div>
          <div className="game-ready-difficulty-picker" role="radiogroup" aria-label="Challenge level">
            {DIFFICULTIES.map((difficulty) => (
              <button
                key={difficulty.id}
                type="button"
                role="radio"
                aria-checked={difficulty.id === difficultyId}
                className={difficulty.id === difficultyId ? 'is-selected' : ''}
                onClick={() => onDifficultyChange(difficulty.id)}
              >
                <strong>{difficulty.label}</strong>
                <small>{difficulty.elo}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="game-setup-group game-setup-coaching">
          <div className="game-setup-label">
            <strong>Coaching</strong>
            <small>Both modes keep the board and moves equally fast</small>
          </div>
          <div className="game-ready-mode-picker" role="radiogroup" aria-label="Coaching style">
            <button
              type="button"
              role="radio"
              aria-checked={coachingControlMode === 'coach'}
              className={coachingControlMode === 'coach' ? 'is-selected' : ''}
              onClick={() => onCoachingControlModeChange('coach')}
            >
              <strong>Coach decides</strong>
              <small>Advice whenever your coach sees a useful moment</small>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={coachingControlMode === 'game'}
              className={coachingControlMode === 'game' ? 'is-selected' : ''}
              onClick={() => onCoachingControlModeChange('game')}
            >
              <strong>Key moments</strong>
              <small>Commentary only for important teaching moments</small>
            </button>
          </div>
        </div>

        <footer className="game-setup-footer">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeSettings();
            }}
            onPointerDown={handleClosePointer}
          >
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

type MoreProps = {
  open: boolean;
  onClose: () => void;
  onTactics: () => void;
  onGames: () => void;
  onCreator: () => void;
  creatorEnabled: boolean;
  onSettings: () => void;
};

export function ReadyMoreMenu({
  open,
  onClose,
  onTactics,
  onGames,
  onCreator,
  creatorEnabled,
  onSettings,
}: MoreProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (!previousFocus) return;
    window.requestAnimationFrame(() => {
      previousFocus.focus({ preventScroll: true });
    });
  }, [open]);

  if (!open) return null;

  const run = (action: () => void) => {
    onClose();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(action);
    });
  };

  return (
    <div
      className="ready-more-scrim"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="ready-more-sheet" role="dialog" aria-modal="true" aria-labelledby="ready-more-title">
        <header>
          <div>
            <span>Chessbuddy</span>
            <h2 id="ready-more-title">More</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close more options">
            <X aria-hidden="true" />
          </button>
        </header>
        <nav aria-label="More ways to play">
          <button type="button" onClick={() => run(onTactics)}>
            <BookOpen aria-hidden="true" />
            <span><strong>Tactics</strong><small>Practice focused positions</small></span>
          </button>
          <button type="button" onClick={() => run(onGames)}>
            <Library aria-hidden="true" />
            <span><strong>Game Library</strong><small>Continue and review saved games</small></span>
          </button>
          {creatorEnabled && (
            <button type="button" onClick={() => run(onCreator)}>
              <UserRoundPlus aria-hidden="true" />
              <span><strong>Create a Coach</strong><small>Build a personal coach</small></span>
            </button>
          )}
          <button type="button" onClick={() => run(onSettings)}>
            <SlidersHorizontal aria-hidden="true" />
            <span><strong>Game settings</strong><small>Coach, challenge and coaching style</small></span>
          </button>
        </nav>
      </aside>
    </div>
  );
}

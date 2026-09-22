import { useState, type ReactNode } from 'react';
import { getAllCoaches, DIFFICULTIES, suggestedDifficultyForCoach, getCoachPortraitThumbUrl, type CoachId, type DifficultyId } from './coachConfig';
import { PUZZLES } from './puzzles';
import type { CoachingControlMode } from './storage';
import Tooltip from './Tooltip';
import { playUiSound, unlockUiAudio } from './uiSounds';
import { useThemeCopy } from './themeCopy';

type Mode = 'quickplay' | 'puzzles';

const PUZZLE_DIFFICULTY_LABELS: Record<string, string> = {
  new: 'Mate in 1, free pieces',
  beginner: 'Forks, pins, skewers',
  intermediate: 'Multi-step tactics',
  advanced: 'Defense & endgames',
  expert: 'Strategic & prophylaxis',
};

const COACHING_CONTROL_TOOLTIP =
  'Coach mode shares every position with your coach. Game mode asks for commentary only at key teaching moments.';

const COACHING_CONTROL_OPTIONS: Array<{ value: CoachingControlMode; label: string; description: string; tooltip: string }> = [
  {
    value: 'coach',
    label: 'Coach',
    description: 'Your coach decides when advice is useful.',
    tooltip: 'Your coach sees every position and chooses when to comment.',
  },
  {
    value: 'game',
    label: 'Game',
    description: 'The app requests advice at key moments.',
    tooltip: 'Commentary is limited to tactics, captures, and king-safety moments.',
  },
];

type Props = {
  coachId: CoachId;
  difficultyId: DifficultyId;
  savedGameCount: number;
  coachingControlMode: CoachingControlMode;
  onCoachChange: (coachId: CoachId) => void;
  onDifficultyChange: (difficultyId: DifficultyId) => void;
  onCoachingControlModeChange: (mode: CoachingControlMode) => void;
  onQuickPlay: () => void;
  onPuzzles: () => void;
  onGames: () => void;
  onCreator: () => void;
  creatorEnabled: boolean;
  onDataset?: () => void;
  authSlot?: ReactNode;
};

export default function MenuScreen({
  coachId,
  difficultyId,
  savedGameCount,
  coachingControlMode,
  onCoachChange,
  onDifficultyChange,
  onCoachingControlModeChange,
  onQuickPlay,
  onPuzzles,
  onGames,
  onCreator,
  creatorEnabled,
  onDataset,
  authSlot,
}: Props) {
  const [selectedMode, setSelectedMode] = useState<Mode>('quickplay');
  const coaches = getAllCoaches();
  const selectedCoach = coaches.find((coach) => coach.id === coachId) ?? coaches[0];
  const themeCopy = useThemeCopy();

  const isPuzzles = selectedMode === 'puzzles';
  const difficultyLabel = isPuzzles ? themeCopy.puzzleSetupLabel : themeCopy.skillSetupLabel;
  const difficultyNote = isPuzzles
    ? 'Sets the type of puzzle you face — pick what suits your current training focus.'
    : 'Controls how strong the AI plays and how deep the coaching commentary goes.';

  function puzzleCountForDifficulty(id: DifficultyId) {
    return PUZZLES.filter((p) => p.difficultyId === id).length;
  }

  return (
    <main className="menu-screen app-menu" data-screen="menu" data-screen-state={selectedMode}>
      <section className="menu-workspace" aria-label="Chessbuddy setup">
        <div className="menu-heading">
          <div className="menu-heading-row">
            <p className="eyebrow">{themeCopy.menuEyebrow}</p>
            {authSlot && <div className="menu-auth-slot">{authSlot}</div>}
          </div>
          <h1 aria-label="Chessbuddy">{themeCopy.productTitle}</h1>
          <p>{themeCopy.menuIntro}</p>
        </div>

        <div className="mode-grid">
          <button
            className={`mode-tile primary-tile${selectedMode === 'quickplay' ? ' selected-mode-tile' : ''}`}
            aria-label="Play a Game"
            onClick={() => setSelectedMode('quickplay')}
          >
            <span>{themeCopy.quickPlayLabel}</span>
            <strong>{themeCopy.quickPlayDescription}</strong>
          </button>
          <button
            className={`mode-tile${selectedMode === 'puzzles' ? ' selected-mode-tile' : ''}`}
            aria-label="Tactics"
            onClick={() => setSelectedMode('puzzles')}
          >
            <span>{themeCopy.puzzlesLabel}</span>
            <strong>{themeCopy.puzzlesDescription}</strong>
          </button>
          <button className="mode-tile" aria-label="Game Library" onClick={onGames}>
            <span>{themeCopy.gamesLabel}</span>
            <strong>{savedGameCount ? `${savedGameCount} saved sessions` : themeCopy.gamesEmptyDescription}</strong>
          </button>
          {creatorEnabled && (
            <button className="mode-tile" aria-label="Create a Coach" onClick={onCreator}>
              <span>{themeCopy.customCoachLabel}</span>
              <strong>{themeCopy.customCoachDescription}</strong>
            </button>
          )}
          {onDataset && (
            <button className="mode-tile" onClick={onDataset}>
              <span>Dialogue Dataset</span>
              <strong>View logged dialogue cases &amp; AI speaking behaviors</strong>
            </button>
          )}
        </div>

        <section className="setup-panel">
          <div className="setup-panel-coach">
            <p className="eyebrow" aria-label="Coach">{themeCopy.coachSetupLabel}</p>
            <div className="coach-picker">
              {coaches.map((coach) => (
                <button
                  key={coach.id}
                  className={coach.id === coachId ? 'selected-option' : ''}
                  onClick={() => {
                    onCoachChange(coach.id);
                    onDifficultyChange(suggestedDifficultyForCoach(coach, DIFFICULTIES.find((item) => item.id === difficultyId) ?? DIFFICULTIES[0]).id);
                  }}
                  style={{ borderColor: coach.id === coachId ? coach.accent : undefined }}
                >
                  <span className="coach-picker-avatar-wrap" aria-hidden="true">
                    <img
                      className="coach-picker-avatar coach-picker-avatar--baked"
                      src={getCoachPortraitThumbUrl(coach)}
                      alt=""
                      width={384}
                      height={384}
                      decoding="async"
                      draggable={false}
                    />
                  </span>
                  <span className="coach-picker-label">
                    <span>{coach.name}</span>
                    <small>{coach.title}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow" aria-label={isPuzzles ? 'Puzzle Challenge' : 'Skill Level'}>{difficultyLabel}</p>
            <p className="difficulty-note">{difficultyNote}</p>
            <div className="difficulty-picker">
              {DIFFICULTIES.map((difficulty) => {
                const count = isPuzzles ? puzzleCountForDifficulty(difficulty.id) : 0;
                return (
                  <button
                    key={difficulty.id}
                    className={difficulty.id === difficultyId ? 'selected-option' : ''}
                    onClick={() => onDifficultyChange(difficulty.id)}
                  >
                    <span>{difficulty.label}</span>
                    <small>
                      {isPuzzles
                        ? `${PUZZLE_DIFFICULTY_LABELS[difficulty.id] ?? difficulty.elo} · ${count} puzzle${count !== 1 ? 's' : ''}`
                        : difficulty.elo}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="coach-summary-stack">
            <div className="coach-summary">
              <p className="eyebrow">{selectedCoach.name}</p>
              <h2>{selectedCoach.title}</h2>
              <p>{selectedCoach.chessFocus}</p>
              <small>{selectedCoach.voiceStyle}</small>
            </div>

            <div
              className="coaching-control-card"
              role="group"
              aria-labelledby="coaching-control-heading"
            >
              <div className="coaching-control-header">
                <p
                  className="eyebrow coaching-control-heading"
                  id="coaching-control-heading"
                >
                  Coaching Control
                </p>
                <Tooltip text={COACHING_CONTROL_TOOLTIP} wide placement="left">
                  <span
                    className="coaching-control-info"
                    role="img"
                    aria-label="About coaching control"
                    tabIndex={0}
                  >
                    ?
                  </span>
                </Tooltip>
              </div>
              <p className="coaching-control-sub">
                {COACHING_CONTROL_OPTIONS.find((opt) => opt.value === coachingControlMode)?.description}
              </p>
              <div
                className="coaching-control-toggle"
                role="radiogroup"
                aria-label="Coaching control mode"
              >
                {COACHING_CONTROL_OPTIONS.map((option) => {
                  const isSelected = option.value === coachingControlMode;
                  return (
                    <Tooltip key={option.value} text={option.tooltip} placement="top">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`coaching-control-option${isSelected ? ' is-selected' : ''}`}
                        onClick={() => {
                          unlockUiAudio();
                          playUiSound('toggle');
                          onCoachingControlModeChange(option.value);
                        }}
                      >
                        {option.label}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <div className="mode-launch">
          {isPuzzles ? (
            <button className="menu-play" aria-label="Start tactics" onClick={() => { unlockUiAudio(); playUiSound('confirm'); onPuzzles(); }}>
              {themeCopy.puzzlesAction}
            </button>
          ) : (
            <button className="menu-play" aria-label="Start game" onClick={() => { unlockUiAudio(); playUiSound('confirm'); onQuickPlay(); }}>
              {themeCopy.quickPlayAction}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

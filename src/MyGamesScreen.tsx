import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCoach, getDifficulty } from './coachConfig';
import { clickBack, playUiSound, unlockUiAudio } from './uiSounds';
import Tooltip from './Tooltip';
import type { AnalysisSummary, StoredGameSession } from './storage';
import { ChessBoard } from './ChessBoard';

/** A saved game is resumable while it has no recorded result yet. */
export function isUnfinished(session: StoredGameSession): boolean {
  return session.result === 'In progress';
}

export default function MyGamesScreen({
  sessions,
  onBack,
  onDelete,
  onPlayFrom,
}: {
  sessions: StoredGameSession[];
  onBack: () => void;
  onDelete: (id: string) => void;
  /** Play this game from `ply` half-moves in (ply === moves.length resumes it). */
  onPlayFrom: (session: StoredGameSession, ply: number) => void;
}) {
  const [selectedId, setSelectedId] = useState(sessions[0]?.id ?? '');
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];

  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(sessions[0].id);
  }, [selectedId, sessions]);

  return (
    <main
      className="game-screen"
      data-screen="games"
      data-screen-state={selected ? 'selected' : 'empty'}
    >
      <header className="topbar">
        <button onClick={() => clickBack(onBack)}>Menu</button>
        <h1>Game Library</h1>
        <div className="topbar-actions"><span>{sessions.length} saved</span></div>
      </header>
      <div className="games-layout">
        <section className="panel-card games-list">
          <p className="eyebrow">Sessions</p>
          {sessions.length === 0 && <p>No saved games yet. Start a game and it will appear here.</p>}
          {sessions.map((session) => {
            const coach = getCoach(session.coachId);
            return (
              <button key={session.id} className={session.id === selected?.id ? 'selected-option' : ''} onClick={() => setSelectedId(session.id)}>
                <strong>
                  {coach.name} - {getDifficulty(session.difficultyId).label}
                  {isUnfinished(session) && <span className="session-badge">Unfinished</span>}
                </strong>
                <span>{new Date(session.updatedAt).toLocaleString()} - {session.result}</span>
              </button>
            );
          })}
          {selected && <button className="ghost-action danger-action" onClick={() => onDelete(selected.id)}>Delete selected</button>}
        </section>
        {selected && <ReplayViewer session={selected} onPlayFrom={onPlayFrom} />}
      </div>
    </main>
  );
}

function ReplayViewer({
  session,
  onPlayFrom,
}: {
  session: StoredGameSession;
  onPlayFrom: (session: StoredGameSession, ply: number) => void;
}) {
  const [ply, setPly] = useState(session.moves.length);
  const game = useMemo(() => new Chess(ply === 0 ? undefined : session.moves[Math.max(0, ply - 1)]?.fenAfter), [ply, session.moves]);

  useEffect(() => {
    setPly(session.moves.length);
  }, [session.id, session.moves.length]);

  const atEnd = ply >= session.moves.length;
  const canResume = isUnfinished(session);
  // Only White (the student) can be on move for a playable position.
  const playableFromHere = game.turn() === 'w' && !game.isGameOver();

  return (
    <section className="replay-layout">
      <ChessBoard game={game} lastMove={session.moves[Math.max(0, ply - 1)]} />
      <aside className="panel-card replay-panel">
        <p className="eyebrow">{getCoach(session.coachId).name} Review</p>
        <h2>{session.result}</h2>
        <p>{session.analysis?.opening ?? 'Analysis pending or not generated yet.'}</p>

        {/* Continue the game, or branch off from whatever move is on the
            board. Both need the student to be on move in that position. */}
        <div className="replay-play-actions">
          <Tooltip
            text={
              playableFromHere
                ? (atEnd && canResume
                    ? 'Pick this game back up where you left off'
                    : `Play a new game from move ${Math.ceil(ply / 2) || 1}`)
                : 'Step to a position where it is your move'
            }
            placement="top"
          >
            <button
              type="button"
              className="primary-action"
              disabled={!playableFromHere}
              onClick={() => { unlockUiAudio(); playUiSound('confirm'); onPlayFrom(session, ply); }}
            >
              {atEnd && canResume ? 'Resume game' : `Replay from move ${Math.ceil(ply / 2) || 1}`}
            </button>
          </Tooltip>
        </div>

        <div className="replay-controls">
          <Tooltip text="Start" placement="top">
            <button aria-label="Start" onClick={() => { unlockUiAudio(); playUiSound('nav'); setPly(0); }}><ChevronsLeft size={18} /></button>
          </Tooltip>
          <Tooltip text="Previous" placement="top">
            <button aria-label="Previous" onClick={() => { unlockUiAudio(); playUiSound('nav'); setPly((value) => Math.max(0, value - 1)); }}><ChevronLeft size={18} /></button>
          </Tooltip>
          <span>{ply}/{session.moves.length}</span>
          <Tooltip text="Next" placement="top">
            <button aria-label="Next" onClick={() => { unlockUiAudio(); playUiSound('nav'); setPly((value) => Math.min(session.moves.length, value + 1)); }}><ChevronRight size={18} /></button>
          </Tooltip>
          <Tooltip text="End" placement="top">
            <button aria-label="End" onClick={() => { unlockUiAudio(); playUiSound('nav'); setPly(session.moves.length); }}><ChevronsRight size={18} /></button>
          </Tooltip>
        </div>
        <ol className="replay-moves invisible-scroll">
          {session.moves.map((move, index) => (
            <li key={`${move.san}-${index}`}>
              <button className={ply === index + 1 ? 'selected-option' : ''} onClick={() => setPly(index + 1)}>
                {index + 1}. {move.by} {move.san}
              </button>
            </li>
          ))}
        </ol>
        {session.analysis && <AnalysisPanel analysis={session.analysis} pending={false} compact />}
      </aside>
    </section>
  );
}

function AnalysisPanel({ analysis, pending, compact = false }: { analysis: AnalysisSummary | null; pending: boolean; compact?: boolean }) {
  return (
    <div className={`panel-card analysis-card ${compact ? 'compact-analysis' : ''}`}>
      <p className="eyebrow">Post-game Analysis</p>
      {pending && <p>Stockfish is reviewing key moments...</p>}
      {analysis && (
        <>
          <div className="accuracy-grid">
            <span>
              Critical score {analysis.scoringModel === 'critical-v1' && (analysis.gradedMoves ?? 0) === 0
                ? '—'
                : `${analysis.whiteAccuracy}%`}
            </span>
            {typeof analysis.gradedMoves === 'number' && typeof analysis.totalUserMoves === 'number' && (
              <span>{analysis.gradedMoves}/{analysis.totalUserMoves} moves graded</span>
            )}
          </div>
          <p>{analysis.opening}</p>
          <p>{analysis.blunders} blunders, {analysis.mistakes} mistakes, {analysis.inaccuracies} inaccuracies</p>
          <ol>
            {analysis.keyMoments.map((moment) => (
              <li key={`${moment.moveNumber}-${moment.label}`}>
                <strong>{moment.label}</strong> {moment.description}
              </li>
            ))}
          </ol>
          <ul>
            {analysis.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { getCoach, getDifficulty, type CoachId, type DifficultyId } from './coachConfig';
import { ChessBoard } from './ChessBoard';
import type { CoachingControlMode } from './storage';

export type DatasetEntry = {
  timestamp: string;
  coachId: CoachId;
  coachName: string;
  difficultyId: DifficultyId;
  fen: string;
  dynamicInfo: string;
  prompt?: string;
  coachResponse: string;
  wasSilent: boolean;
  sessionId?: string;
  coachingControlMode?: CoachingControlMode;
  expectedResponse?: 'silent' | 'talk';
};

type Props = {
  onBack: () => void;
};

export default function DatasetScreen({ onBack }: Props) {
  const [entries, setEntries] = useState<DatasetEntry[]>([]);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((c) => (c === msg ? '' : c));
    }, 3000);
  }

  async function fetchDataset() {
    try {
      setLoading(true);
      const res = await fetch('/api/dataset');
      if (res.ok) {
        const data = (await res.json()) as DatasetEntry[];
        setEntries(data);
        if (data.length > 0 && !selectedTimestamp) {
          setSelectedTimestamp(data[data.length - 1].timestamp);
        }
      } else {
        setError('Failed to fetch dataset.');
      }
    } catch {
      setError('Error connecting to dataset API.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchDataset();
    // We only want to fetch once on mount; selectedTimestamp seeding handled inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => {
    return entries.find((e) => e.timestamp === selectedTimestamp) || entries[entries.length - 1];
  }, [entries, selectedTimestamp]);

  useEffect(() => {
    if (selected && selected.timestamp !== selectedTimestamp) {
      setSelectedTimestamp(selected.timestamp);
    }
  }, [selected, selectedTimestamp]);

  const game = useMemo(() => {
    try {
      return new Chess(selected?.fen || undefined);
    } catch {
      return new Chess();
    }
  }, [selected?.fen]);

  async function handleDelete(timestamp: string) {
    if (!confirm('Are you sure you want to delete this dataset entry?')) return;
    try {
      const res = await fetch('/api/dataset', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp }),
      });
      if (res.ok) {
        showToast('Entry deleted successfully.');
        setEntries((prev) => prev.filter((e) => e.timestamp !== timestamp));
        if (selectedTimestamp === timestamp) {
          setSelectedTimestamp('');
        }
      } else {
        showToast('Failed to delete entry.');
      }
    } catch {
      showToast('Error deleting entry.');
    }
  }

  async function handleClearAll() {
    if (!confirm('WARNING: Are you sure you want to clear the ENTIRE dataset? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/dataset', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });
      if (res.ok) {
        setEntries([]);
        setSelectedTimestamp('');
        showToast('Dataset cleared successfully.');
      } else {
        showToast('Failed to clear dataset.');
      }
    } catch {
      showToast('Error clearing dataset.');
    }
  }

  return (
    <main
      className="game-screen"
      data-screen="dataset"
      data-screen-state={loading ? 'loading' : error ? 'error' : selected ? 'selected' : 'empty'}
    >
      <header className="topbar">
        <button onClick={onBack}>Menu</button>
        <h1>Dialogue Dataset</h1>
        <div className="topbar-actions">
          <span>
            {entries.length} Exchange{entries.length !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      <div className="games-layout">
        <section className="panel-card games-list dataset-list-panel">
          <p className="eyebrow">Logged dialogue</p>
          {loading && <p className="dataset-loading-text">Loading dataset...</p>}
          {error && <p className="dataset-error-text">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="dataset-empty-text">
              No logged dialogue exchanges yet. Start a Quick Play game, let the coach update, and press the + icon to log exchanges.
            </p>
          )}

          <div className="dataset-scrollable invisible-scroll">
            {entries.map((entry) => {
              const coach = getCoach(entry.coachId);
              const difficulty = getDifficulty(entry.difficultyId);
              const dateStr = new Date(entry.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const isSelected = entry.timestamp === selected?.timestamp;
              return (
                <button
                  key={entry.timestamp}
                  className={`dataset-option-btn${isSelected ? ' selected-option' : ''}`}
                  onClick={() => setSelectedTimestamp(entry.timestamp)}
                >
                  <div className="dataset-option-row">
                    <strong>
                      {coach.name} ({difficulty.label})
                    </strong>
                    <small>{dateStr}</small>
                  </div>
                  <span className={`dataset-option-line ${entry.wasSilent ? 'is-silent' : 'is-spoken'}`}>
                    {entry.wasSilent ? 'Silent' : `"${entry.coachResponse}"`}
                  </span>
                </button>
              );
            })}
          </div>

          {entries.length > 0 && (
            <button className="ghost-action danger-action dataset-clear-btn" onClick={handleClearAll}>
              Clear Entire Dataset
            </button>
          )}
        </section>

        {selected ? (
          <div className="dataset-detail-layout">
            <div className="dataset-board-wrap">
              <ChessBoard game={game} />
            </div>

            <aside className="panel-card replay-panel dataset-details-panel">
              <div>
                <p className="eyebrow">Dialogue Evaluation</p>
                <h2 className="dataset-detail-title">
                  {selected.coachName}
                  <span className={`dataset-badge ${selected.wasSilent ? 'badge-silent' : 'badge-speaking'}`}>
                    {selected.wasSilent ? 'Abstained (Silent)' : 'Spoke'}
                  </span>
                </h2>
                <small className="dataset-detail-meta">
                  Logged at {new Date(selected.timestamp).toLocaleString()} · FEN: {selected.fen.slice(0, 30)}...
                </small>
                {(selected.coachingControlMode || selected.expectedResponse) && (
                  <div className="dataset-detail-tags">
                    {selected.coachingControlMode && (
                      <span className="dataset-mini-badge">
                        Mode: {selected.coachingControlMode === 'coach' ? 'Coach decides' : 'Game decides'}
                      </span>
                    )}
                    {selected.expectedResponse && (
                      <span className="dataset-mini-badge">Expected: {selected.expectedResponse}</span>
                    )}
                  </div>
                )}
              </div>

              {selected.prompt && (
                <div className="dataset-detail-section">
                  <span className="dataset-detail-label">User Prompt</span>
                  <div className="dataset-detail-text">{selected.prompt}</div>
                </div>
              )}

              <div className="dataset-detail-section">
                <span className="dataset-detail-label">Dynamic Config Context (LLM Input)</span>
                <div className="dataset-detail-text dataset-detail-mono invisible-scroll">{selected.dynamicInfo}</div>
              </div>

              <div className="dataset-detail-section">
                <span className="dataset-detail-label">Coach Speech Output</span>
                <div className={`dataset-detail-text dataset-detail-output ${selected.wasSilent ? 'is-silent' : ''}`}>
                  {selected.wasSilent
                    ? 'No response. The coach chose to remain silent based on the chess position.'
                    : selected.coachResponse}
                </div>
              </div>

              <div className="dataset-detail-actions">
                <button
                  className="ghost-action danger-action dataset-delete-btn"
                  onClick={() => handleDelete(selected.timestamp)}
                >
                  Delete This Entry
                </button>
              </div>
            </aside>
          </div>
        ) : (
          <div className="dataset-empty-pane">
            Select a dialogue exchange on the left to analyze its context and chess position.
          </div>
        )}
      </div>

      {toastMessage && (
        <div className="toast-notification" role="status" aria-live="polite">
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  );
}

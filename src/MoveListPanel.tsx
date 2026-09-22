import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, ListOrdered, LocateFixed, X } from 'lucide-react';
import { buildMovePairs } from './chessHelpers';
import type { MoveRecord } from './types';
import { playUiSound, unlockUiAudio } from './uiSounds';
import { useFloatingPanel } from './useFloatingPanel';

const MOVE_LIST_POSITION_KEY = 'chessbuddy.floatingPanel.moveList.v1';

export default function MoveListPanel({
  history,
  description,
}: {
  history: MoveRecord[];
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pairs = useMemo(() => buildMovePairs(history), [history]);
  const close = useCallback(() => setOpen(false), []);
  const floating = useFloatingPanel({
    open,
    storageKey: MOVE_LIST_POSITION_KEY,
    anchorRef,
    panelRef,
    onRequestClose: close,
    verticalOffset: -54,
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      anchorRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [history.length, open]);

  return (
    <div className="move-list-wrap">
      <button
        ref={anchorRef}
        type="button"
        className={`rail-tool rail-move-list${open ? ' is-active' : ''}`}
        title="Open move list"
        aria-label="Move list"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'move-list-panel' : undefined}
        onClick={() => {
          unlockUiAudio();
          playUiSound('tap');
          setOpen((value) => !value);
        }}
      >
        <ListOrdered aria-hidden="true" />
        {description ? (
          <span><strong>Moves</strong><small>{description}</small></span>
        ) : (
          <small>Moves</small>
        )}
      </button>

      {open && createPortal(
        <div
          id="move-list-panel"
          ref={panelRef}
          className="dev-menu-panel move-list-panel floating-utility-panel"
          style={floating.style}
          role="dialog"
          aria-labelledby="move-list-title"
          onPointerDownCapture={floating.bringToFront}
        >
          <header
            className="dev-menu-head floating-panel-drag-handle"
            aria-label="Move Move list panel. Use arrow keys for precise movement."
            {...floating.dragHandleProps}
          >
            <span className="dev-menu-heading-icon"><ListOrdered aria-hidden="true" /></span>
            <span>
              <strong id="move-list-title">Move list</strong>
              <small>Live game notation</small>
            </span>
            <span className="move-list-count">{history.length} ply</span>
            <GripHorizontal className="floating-panel-grip" aria-hidden="true" />
            <button
              type="button"
              className="floating-panel-close"
              data-drag-ignore
              onClick={close}
              aria-label="Close move list"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div ref={listRef} className="move-list-scroll" aria-live="polite">
            {pairs.length === 0 ? (
              <div className="move-list-empty">
                <ListOrdered aria-hidden="true" />
                <strong>No moves yet</strong>
                <span>Your game notation will appear here.</span>
              </div>
            ) : pairs.map(([white, black], index) => (
              <div className="move-list-row" key={index} data-move-number={index + 1}>
                <span className="move-list-number">{index + 1}.</span>
                <span className={`move-list-move${white?.historyIdx === history.length - 1 ? ' is-latest' : ''}`}>
                  {white?.san ?? '—'}
                </span>
                <span className={`move-list-move is-black${black?.historyIdx === history.length - 1 ? ' is-latest' : ''}`}>
                  {black?.san ?? '…'}
                </span>
              </div>
            ))}
          </div>

          <footer className="dev-menu-foot move-list-foot">
            <span>{pairs.length ? `${pairs.length} full move${pairs.length === 1 ? '' : 's'} shown` : 'Waiting for the first move'}</span>
            <button type="button" onClick={floating.resetPosition}>
              <LocateFixed aria-hidden="true" />
              Reset position
            </button>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
}

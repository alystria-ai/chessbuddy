import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

export type FloatingPanelPoint = Readonly<{ left: number; top: number }>;
export type FloatingPanelSize = Readonly<{ width: number; height: number }>;
export type FloatingPanelViewport = Readonly<{ width: number; height: number }>;

const PANEL_MARGIN = 12;
let floatingPanelZ = 240;

function nextFloatingPanelZ(): number {
  floatingPanelZ += 1;
  return floatingPanelZ;
}

export function clampFloatingPanelPosition(
  point: FloatingPanelPoint,
  panel: FloatingPanelSize,
  viewport: FloatingPanelViewport,
  margin = PANEL_MARGIN,
): FloatingPanelPoint {
  return {
    left: Math.max(margin, Math.min(point.left, Math.max(margin, viewport.width - panel.width - margin))),
    top: Math.max(margin, Math.min(point.top, Math.max(margin, viewport.height - panel.height - margin))),
  };
}

export function positionFloatingPanelBesideAnchor(
  anchor: DOMRect,
  panel: FloatingPanelSize,
  viewport: FloatingPanelViewport,
  verticalOffset = -72,
): FloatingPanelPoint {
  const gap = 12;
  const preferredRight = anchor.right + gap;
  const left = preferredRight + panel.width <= viewport.width - PANEL_MARGIN
    ? preferredRight
    : anchor.left - panel.width - gap;
  return clampFloatingPanelPosition(
    { left, top: anchor.top + verticalOffset },
    panel,
    viewport,
  );
}

function readStoredPosition(storageKey: string): FloatingPanelPoint | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelPoint>;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: Number(parsed.left), top: Number(parsed.top) };
  } catch {
    return null;
  }
}

function storePosition(storageKey: string, point: FloatingPanelPoint | null): void {
  try {
    if (point) window.localStorage.setItem(storageKey, JSON.stringify(point));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Private browsing may reject storage; dragging still works for this mount.
  }
}

type Options = {
  open: boolean;
  storageKey: string;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  onRequestClose: () => void;
  verticalOffset?: number;
};

export function useFloatingPanel({
  open,
  storageKey,
  anchorRef,
  panelRef,
  onRequestClose,
  verticalOffset = -72,
}: Options) {
  const persistedPositionRef = useRef<FloatingPanelPoint | null>(null);
  const positionRef = useRef<FloatingPanelPoint | null>(null);
  const initializedStorageRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: FloatingPanelPoint;
  } | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const bringToFront = useCallback(() => {
    const zIndex = nextFloatingPanelZ();
    setStyle((current) => ({ ...current, zIndex }));
  }, []);

  const place = useCallback((forceAnchor = false) => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panelElement = panelRef.current;
    if (!anchor || !panelElement || anchor.width === 0 || anchor.height === 0) {
      onRequestClose();
      return;
    }
    if (!initializedStorageRef.current) {
      initializedStorageRef.current = true;
      persistedPositionRef.current = readStoredPosition(storageKey);
    }
    const panel = {
      width: panelElement.offsetWidth,
      height: panelElement.offsetHeight,
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const preferred = !forceAnchor && persistedPositionRef.current
      ? persistedPositionRef.current
      : positionFloatingPanelBesideAnchor(anchor, panel, viewport, verticalOffset);
    const point = clampFloatingPanelPosition(preferred, panel, viewport);
    positionRef.current = point;
    if (!forceAnchor && persistedPositionRef.current) persistedPositionRef.current = point;
    setStyle({
      position: 'fixed',
      left: point.left,
      top: point.top,
      visibility: 'visible',
      zIndex: nextFloatingPanelZ(),
    });
  }, [anchorRef, onRequestClose, panelRef, storageKey, verticalOffset]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' });
      return undefined;
    }
    place();
    const frame = window.requestAnimationFrame(() => place());
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      dragRef.current = null;
    };
  }, [open, place]);

  const updateDraggedPosition = useCallback((point: FloatingPanelPoint) => {
    const panelElement = panelRef.current;
    if (!panelElement) return;
    const next = clampFloatingPanelPosition(
      point,
      { width: panelElement.offsetWidth, height: panelElement.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    positionRef.current = next;
    persistedPositionRef.current = next;
    setStyle((current) => ({ ...current, ...next, visibility: 'visible' }));
  }, [panelRef]);

  const onDragPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('button, input, select, textarea, a, [data-drag-ignore]')) return;
    const panelElement = panelRef.current;
    if (!panelElement) return;
    const rect = panelElement.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { left: rect.left, top: rect.top },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    bringToFront();
    event.preventDefault();
  }, [bringToFront, panelRef]);

  const onDragPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateDraggedPosition({
      left: drag.origin.left + event.clientX - drag.startX,
      top: drag.origin.top + event.clientY - drag.startY,
    });
  }, [updateDraggedPosition]);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    storePosition(storageKey, persistedPositionRef.current);
  }, [storageKey]);

  const onDragKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = event.shiftKey ? 48 : 16;
    updateDraggedPosition({
      left: rect.left + direction[0] * step,
      top: rect.top + direction[1] * step,
    });
    storePosition(storageKey, persistedPositionRef.current);
    bringToFront();
    event.preventDefault();
  }, [bringToFront, panelRef, storageKey, updateDraggedPosition]);

  const resetPosition = useCallback(() => {
    persistedPositionRef.current = null;
    positionRef.current = null;
    storePosition(storageKey, null);
    place(true);
  }, [place, storageKey]);

  return {
    style,
    bringToFront,
    resetPosition,
    dragHandleProps: {
      onPointerDown: onDragPointerDown,
      onPointerMove: onDragPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown: onDragKeyDown,
      tabIndex: 0,
    },
  };
}

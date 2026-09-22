type VisionSourceHandle = {
  track: MediaStreamTrack;
  unpublish: () => Promise<void>;
  cleanup?: () => void;
};

import { debugLog } from './debugLog';

const DEFAULT_BOARD_SELECTOR = '.game-stage .chess-board';
const FALLBACK_BOARD_SELECTOR = '.chess-board';
const VISION_FPS = 1;
const LIVE_REDRAW_MS = 500;
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

type BoardOrientation = 'w' | 'b';

const PIECE_GLYPHS: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

export type BoardVisionSession = {
  refresh: () => boolean;
  updateFromFen: (fen: string, orientation?: BoardOrientation) => boolean;
  stop: () => void;
  isPublished: () => boolean;
};

function visionErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function findBoardElement(selector = DEFAULT_BOARD_SELECTOR): HTMLElement | null {
  return (
    document.querySelector(selector)
    ?? document.querySelector(FALLBACK_BOARD_SELECTOR)
  ) as HTMLElement | null;
}

async function waitForBoardElement(selector = DEFAULT_BOARD_SELECTOR, timeoutMs = 8000): Promise<HTMLElement | null> {
  const start = Date.now();
  let boardEl = findBoardElement(selector);
  while (!boardEl && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    boardEl = findBoardElement(selector);
  }
  return boardEl;
}

function sizeCanvasForBoard(canvas: HTMLCanvasElement, boardEl?: HTMLElement | null): { width: number; height: number } {
  const width = Math.max(320, Math.min(640, Math.round(boardEl?.getBoundingClientRect().width || 480)));
  const height = width;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
}

function renderBoardFromDom(
  boardEl: HTMLElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const squares = boardEl.querySelectorAll('.square');
  if (!squares.length) return false;
  ctx.clearRect(0, 0, width, height);
  const squareW = width / 8;
  const squareH = height / 8;

  squares.forEach((sq) => {
    const el = sq as HTMLElement;
    const style = getComputedStyle(el);
    const bg = style.backgroundColor || (el.classList.contains('light') ? '#f0d9b5' : '#b58863');
    const label = el.getAttribute('aria-label') ?? '';
    const file = label.charCodeAt(0) - 97;
    const rank = Number(label[1]);
    if (file < 0 || file > 7 || !rank) return;
    const row = 8 - rank;
    ctx.fillStyle = bg;
    ctx.fillRect(file * squareW, row * squareH, squareW, squareH);

    const piece = el.querySelector('.piece');
    if (piece) {
      ctx.fillStyle = piece.classList.contains('white-piece') ? '#f8f8f2' : '#1a1a1a';
      ctx.strokeStyle = piece.classList.contains('white-piece') ? '#333' : '#f8f8f2';
      ctx.lineWidth = 1;
      ctx.font = `bold ${Math.floor(squareH * 0.62)}px "Segoe UI Symbol", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = piece.textContent ?? '';
      const cx = file * squareW + squareW / 2;
      const cy = row * squareH + squareH / 2;
      ctx.strokeText(glyph, cx, cy);
      ctx.fillText(glyph, cx, cy);
    }
  });

  return true;
}

function renderBoardFromFen(
  fen: string,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: BoardOrientation,
): boolean {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return false;

  const ranks = placement.split('/');
  if (ranks.length !== 8) return false;

  ctx.clearRect(0, 0, width, height);
  const squareW = width / 8;
  const squareH = height / 8;

  for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
      const visualFile = orientation === 'w' ? fileIndex : 7 - fileIndex;
      const visualRank = orientation === 'w' ? rankIndex : 7 - rankIndex;
      const isLight = (rankIndex + fileIndex) % 2 === 0;
      ctx.fillStyle = isLight ? '#e3cfa6' : '#6d7a55';
      ctx.fillRect(visualFile * squareW, visualRank * squareH, squareW, squareH);
    }
  }

  for (let fenRankIndex = 0; fenRankIndex < 8; fenRankIndex++) {
    const rankText = ranks[fenRankIndex];
    let fileIndex = 0;
    for (const token of rankText) {
      const empty = Number(token);
      if (Number.isInteger(empty) && empty > 0) {
        fileIndex += empty;
        continue;
      }

      if (fileIndex > 7) return false;
      const visualFile = orientation === 'w' ? fileIndex : 7 - fileIndex;
      const visualRank = orientation === 'w' ? fenRankIndex : 7 - fenRankIndex;
      const x = visualFile * squareW;
      const y = visualRank * squareH;

      const glyph = PIECE_GLYPHS[token];
      if (glyph) {
        const isWhite = token === token.toUpperCase();
        ctx.fillStyle = isWhite ? '#f8f8f2' : '#1a1a1a';
        ctx.strokeStyle = isWhite ? '#333' : '#f8f8f2';
        ctx.lineWidth = 1;
        ctx.font = `bold ${Math.floor(squareH * 0.62)}px "Segoe UI Symbol", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = x + squareW / 2;
        const cy = y + squareH / 2;
        ctx.strokeText(glyph, cx, cy);
        ctx.fillText(glyph, cx, cy);
      }

      fileIndex += 1;
    }
    if (fileIndex !== 8) return false;
  }

  return true;
}

async function waitForRoomReady(client: any, timeoutMs = 10000): Promise<boolean> {
  const room = client?.room;
  if (!room) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = room.state;
    if (state === 'connected' && room.localParticipant) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return room.state === 'connected' && Boolean(room.localParticipant);
}

function primeCanvasTrack(canvas: HTMLCanvasElement): void {
  const stream = canvas.captureStream?.(VISION_FPS);
  const track = stream?.getVideoTracks?.()[0] as CanvasCaptureMediaStreamTrack | undefined;
  track?.requestFrame?.();
}

/**
 * Publish a live chess-board canvas via Convai Vision Dynamic Context.
 * Requires enableVideo + visionInputConfig on the client and vision enabled on the character dashboard.
 */
export async function publishBoardVisionCanvas(
  client: any,
  selector = DEFAULT_BOARD_SELECTOR,
  initialFen = STARTING_FEN,
  options: { readyWaitMs?: number } = {},
): Promise<BoardVisionSession | null> {
  const videoControls = client?.videoControls;
  const publishCanvas = videoControls?.publishCanvas;
  if (typeof publishCanvas !== 'function') {
    debugLog('BoardVision', 'Client videoControls.publishCanvas is unavailable');
    return null;
  }

  const boardEl = await waitForBoardElement(selector);
  if (!boardEl) {
    debugLog('BoardVision', 'Board element not found — will render from FEN fallback');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { width, height } = sizeCanvasForBoard(canvas, boardEl);
  const renderedFromDom = boardEl ? renderBoardFromDom(boardEl, ctx, width, height) : false;
  if (!renderedFromDom && !renderBoardFromFen(initialFen, ctx, width, height, 'w')) {
    debugLog('BoardVision', 'Could not render board snapshot');
    return null;
  }

  primeCanvasTrack(canvas);

  let visionHandle: VisionSourceHandle | null = null;
  let published = false;
  let latestFen = renderedFromDom ? '' : initialFen;
  let latestOrientation: BoardOrientation = 'w';
  let redrawTimer: ReturnType<typeof window.setInterval> | null = null;

  const requestFrame = () => {
    const track = visionHandle?.track as CanvasCaptureMediaStreamTrack & { requestFrame?: () => void };
    track?.requestFrame?.();
  };

  const refresh = () => {
    const currentBoard = findBoardElement(selector);
    if (!currentBoard && !latestFen) return false;
    const nextSize = sizeCanvasForBoard(canvas, currentBoard);
    const rendered = latestFen
      ? renderBoardFromFen(latestFen, ctx, nextSize.width, nextSize.height, latestOrientation)
      : currentBoard
        ? renderBoardFromDom(currentBoard, ctx, nextSize.width, nextSize.height)
        : false;
    if (rendered) requestFrame();
    return rendered;
  };

  const updateFromFen = (fen: string, orientation: BoardOrientation = 'w') => {
    if (!fen.trim()) return false;
    latestFen = fen;
    latestOrientation = orientation;
    const currentBoard = findBoardElement(selector);
    if (currentBoard) sizeCanvasForBoard(canvas, currentBoard);
    const rendered = renderBoardFromFen(latestFen, ctx, canvas.width, canvas.height, latestOrientation);
    if (rendered) requestFrame();
    return rendered;
  };

  const stop = async () => {
    if (redrawTimer) {
      window.clearInterval(redrawTimer);
      redrawTimer = null;
    }
    if (visionHandle) {
      try {
        await visionHandle.unpublish();
      } catch {}
      try {
        visionHandle.cleanup?.();
      } catch {}
      visionHandle = null;
    }
    published = false;
  };

  await waitForRoomReady(client, options.readyWaitMs ?? 10000);

  if (client?.room?.state !== 'connected') {
    debugLog('BoardVision', `Room not connected (state=${client?.room?.state ?? 'missing'}) — skipping publish`);
    await stop();
    return null;
  }
  try {
    visionHandle = await publishCanvas.call(videoControls, canvas, {
      source: 'canvas',
      name: 'chess-board',
      fps: VISION_FPS,
      stopTrackOnUnpublish: true,
    });
    published = true;
    redrawTimer = window.setInterval(refresh, LIVE_REDRAW_MS);
    debugLog('BoardVision', `Published chess-board canvas vision (${width}x${height} @ ${VISION_FPS}fps)`);
    return {
      refresh,
      updateFromFen,
      stop: () => { void stop(); },
      isPublished: () => published,
    };
  } catch (err) {
    debugLog('BoardVision', `publishCanvas failed: ${visionErrorMessage(err)}`);
    await stop();
    return null;
  }
}

/** Retry publishing board vision until the board is ready or attempts are exhausted. */
export async function ensureBoardVisionCanvas(
  client: any,
  existing: BoardVisionSession | null | undefined,
  options: { fen?: string; attempts?: number; delayMs?: number; readyWaitMs?: number } = {},
): Promise<BoardVisionSession | null> {
  if (existing?.isPublished()) {
    if (options.fen?.trim()) existing.updateFromFen(options.fen);
    else existing.refresh();
    return existing;
  }

  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 600;
  let last: BoardVisionSession | null = existing ?? null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs * attempt));
    }
    last = await publishBoardVisionCanvas(client, undefined, options.fen, {
      readyWaitMs: options.readyWaitMs,
    });
    if (last?.isPublished()) return last;
  }

  return last;
}

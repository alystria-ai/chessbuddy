import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor, useGLTF } from '@react-three/drei';
import {
  getCoachPortraitUrl,
  getCoachWarmupPortraitUrl,
  type CoachConfig,
} from './coachConfig';
import { chessConvai } from './convaiManager';
import { debugLog } from './debugLog';
import ReallusionCharacter from './ReallusionCharacter';
import PortraitScene from './PortraitScene';
import Tooltip from './Tooltip';
import { isMobilePortrait } from './isMobilePortrait';
import {
  attachPortraitWebGLContextListeners,
  logPortraitBootstrap,
  logPortraitReadyState,
  logPortraitWebGLCapabilities,
  nextCanvasMountCount,
} from './portraitDebug';
import { playUiSound, unlockUiAudio } from './uiSounds';
import MicButton, { VoiceMuteButton } from './MicButton';
import { ArrowUp, Flag, Menu } from 'lucide-react';
import { getLipsyncTuningSnapshot, subscribeLipsyncTuning } from './lipsyncTuning';
import { mobileWarmupObjectPosition } from './portraitWarmup';
import { clearCoachAssetCaches, coachAssetUrl, mobileModelFile } from './coachAssetPreload';
import {
  resolveMobilePortraitQuality,
  readMobilePortraitSignals,
} from './mobilePortraitQuality';
import {
  CHARACTER_LOOK,
  CHARACTER_LOOK_TECHNIQUE,
  clampPortraitRenderScale,
  minimumPortraitRenderScale,
  nextPortraitPerformanceState,
  portraitPerformanceBounds,
  preferredDesktopPortraitDevicePixelRatio,
  characterColorGradeFilter,
} from './characterLook';
import { dollyCharacterCamera } from './characterWindowCamera';
import {
  resolvePortraitLightIntensityScale,
  resolvePortraitToneMappingExposure,
} from './portraitQualityTuning';
import portraitPresentation from '../docs/character-models/chess-avatars-v2/portrait-presentation.json';
import type { CoachConversationMessage } from './coachConversation';

// URL derivation is shared with coachAssetPreload so the menu warms exactly
// the entries this card later reads from drei's cache.
const assetUrl = coachAssetUrl;

/** Cap render resolution on the weakest phones. Higher tiers raise this. */
const MOBILE_MAX_DPR = 1.5;

/** Authored in japanese-refinement.css; only used where computed styles are
 *  unavailable (unit tests, any non-browser render). */
const PORTRAIT_STAGE_CLEAR_FALLBACK = '#e5ebe7';

/** A studio vignette darkens the canvas corners, which draws the portrait's
 *  rectangle back in now that she sits directly on the page. The backdrop is
 *  therefore flat: the field has to read as the page, not as a lit wall. */
const PORTRAIT_STAGE_BACKDROP_STRENGTH = 0;

/**
 * The portrait is presented as a cutout on the page, so the composed canvas has
 * to land on the tone the stylesheet paints around it — any mismatch draws the
 * canvas rectangle back in. The stylesheet owns both the page tone and the
 * clear colour that renders as that tone through the character grade.
 */
function readPortraitStageClear(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return PORTRAIT_STAGE_CLEAR_FALLBACK;
  }
  const authored = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--portrait-stage-clear')
    .trim();
  return authored || PORTRAIT_STAGE_CLEAR_FALLBACK;
}

/** Give slow mobile connections time to fetch the model before declaring failure. */
const PORTRAIT_LOAD_WATCHDOG_MS = 90_000;
const PORTRAIT_RETRY_DELAY_MS = 1_200;
/** Ignore shader compilation and texture-upload stalls before judging steady-state FPS. */
const PORTRAIT_PERFORMANCE_WARMUP_MS = 2_500;

/** Layout QA renders dozens of routes and sizes in quick succession. Use the
 * already-approved baked portrait there so WebGL compilation cannot stall UI
 * timers or hide responsive defects. Production and normal development still
 * use the full live character path. */
const VISUAL_QA_MODE = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('headless');

const FRAMING_BY_ASSET: Record<string, {
  topInsetWorld: number;
  portraitCropBias: number;
  horizontalOffset: number;
  /** Uniform scale applied to the model before framing. MetaHuman exports are
   *  in centimetres (~163 units tall), so every coach scales to metres for
   *  the camera framing (all coaches are MetaHuman since 2026-07-24). */
  modelScale?: number;
  modelYawDegrees?: number;
  /** Optional coach-specific live-window crop. Baked portraits keep their
   * approved framing and other coaches retain the shared camera zoom. */
  liveCameraZoom?: number;
}> = Object.fromEntries(
  Object.values(portraitPresentation.coaches).map(({ assetName, framing }) => [assetName, framing]),
);

/** Compact-phone portrait adjustment: the coach becomes a smaller backdrop
 *  figure left of the chat window instead of filling the frame. Zoom > 1
 *  tightens the upper-body crop; horizontal offset nudges her in world units. */
const DEFAULT_MOBILE_COMPACT = {
  cameraZoom: 0.94,
  horizontalOffset: -0.012,
  portraitCropBias: -0.01,
} as const;

type PortraitHandoffPhase = 'waiting' | 'done';

type Props = {
  coach: CoachConfig;
  status: string;
  lastLine?: string;
  onReady?: () => void;
  onAddToDataset?: () => void;
  chatOpen?: boolean;
  /** Keep the conversation area visible before the first message arrives. */
  showEmptyConversation?: boolean;
  /** Inline chat input (rendered under the coach's reply when chatOpen). */
  chatInput?: string;
  chatBusy?: boolean;
  boardThinking?: boolean;
  playerWon?: boolean;
  onChatInputChange?: (value: string) => void;
  onChatSend?: () => void;
  /** Mobile: resign from the bottom action row. */
  onResign?: () => void;
  /** Mobile: open the game menu from the bottom action row. */
  onMenu?: () => void;
  mic?: ReactNode;
  previewMode?: boolean;
  messages?: readonly CoachConversationMessage[];
};

type CharacterErrorBoundaryProps = {
  children: ReactNode;
  onError: (error: Error) => void;
  resetKey: string;
};

class CharacterErrorBoundary extends Component<CharacterErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  componentDidUpdate(prevProps: CharacterErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function CoachCard({
  coach,
  status,
  lastLine,
  onReady,
  onAddToDataset,
  chatOpen = false,
  showEmptyConversation = false,
  chatInput,
  chatBusy = false,
  boardThinking = false,
  playerWon = false,
  onChatInputChange,
  onChatSend,
  onResign,
  onMenu,
  mic,
  previewMode = false,
  messages = [],
}: Props) {
  const tuning = useSyncExternalStore(
    subscribeLipsyncTuning,
    getLipsyncTuningSnapshot,
    getLipsyncTuningSnapshot,
  ).values;
  const [isMobileCanvas] = useState(() => isMobilePortrait());
  const framing = FRAMING_BY_ASSET[coach.assetName] ?? FRAMING_BY_ASSET.Leila;
  const coachMobileCompact = Object.values(portraitPresentation.coaches).find(
    (entry) => entry.assetName === coach.assetName,
  ) as { mobileCompact?: Partial<typeof DEFAULT_MOBILE_COMPACT & { warmupObjectPosition?: string }> } | undefined;
  const mobileCompact = isMobileCanvas
    ? { ...DEFAULT_MOBILE_COMPACT, ...coachMobileCompact?.mobileCompact }
    : null;
  // Phones turn the portrait into a full-band backdrop with the chat window
  // docked to her right, so she steps back (smaller), down and left instead of
  // filling the frame the way the desktop side card does.
  const mobileZoom = mobileCompact?.cameraZoom ?? 1;
  const liveCameraZoom = (framing.liveCameraZoom ?? tuning.portraitCameraZoom) * mobileZoom;
  const portraitCameraPosition = useMemo(
    () => dollyCharacterCamera(
      CHARACTER_LOOK.camera.position,
      CHARACTER_LOOK.camera.lookAt,
      liveCameraZoom,
    ),
    [liveCameraZoom],
  );
  const characterFraming = useMemo(() => ({
    cameraZ: portraitCameraPosition[2] - CHARACTER_LOOK.camera.lookAt[2],
    fov: CHARACTER_LOOK.camera.fov,
    lookAtY: CHARACTER_LOOK.camera.lookAt[1],
    topInsetWorld: framing.topInsetWorld,
    portraitCropBias: framing.portraitCropBias + (mobileCompact?.portraitCropBias ?? 0),
    horizontalOffset: framing.horizontalOffset + (mobileCompact?.horizontalOffset ?? 0),
    modelScale: framing.modelScale ?? 1,
    modelYawDegrees: framing.modelYawDegrees ?? 0,
    presentationZoom: liveCameraZoom,
  }), [
    framing.horizontalOffset,
    framing.modelScale,
    framing.modelYawDegrees,
    framing.portraitCropBias,
    framing.topInsetWorld,
    portraitCameraPosition,
    liveCameraZoom,
    isMobileCanvas,
    mobileCompact?.horizontalOffset,
    mobileCompact?.portraitCropBias,
  ]);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const characterWindowRef = useRef<HTMLDivElement>(null);
  const readyNotifiedRef = useRef<string | null>(null);
  const [mobileQuality] = useState(() => (
    isMobilePortrait()
      ? resolveMobilePortraitQuality(readMobilePortraitSignals())
      : null
  ));
  const [stageBgColor] = useState(readPortraitStageClear);
  const [readyCharacterKey, setReadyCharacterKey] = useState<string | null>(null);
  const [characterFailed, setCharacterFailed] = useState(false);
  const [liveCanvasMounted, setLiveCanvasMounted] = useState(
    () => !previewMode || VISUAL_QA_MODE,
  );
  /** 0 = first try, 1 = one automatic retry; after that the static portrait takes over. */
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [useImageFallback, setUseImageFallback] = useState(VISUAL_QA_MODE);
  const retryTimerRef = useRef<number | null>(null);
  const [syncModelKey, setSyncModelKey] = useState<string | null>(null);
  const [syncLoadAttempt, setSyncLoadAttempt] = useState<number | null>(null);
  const [canvasDpr, setCanvasDpr] = useState(() => (
    preferredDesktopPortraitDevicePixelRatio(window.devicePixelRatio || 1)
  ));
  const [portraitPerformance, setPortraitPerformance] = useState({
    adaptiveRenderScale: 1,
    balancedRendering: false,
  });
  const { adaptiveRenderScale, balancedRendering } = portraitPerformance;
  const adaptiveQualityEnabled = tuning.adaptiveQualityEnabled >= 0.5;
  const effectiveBalancedRendering = adaptiveQualityEnabled && balancedRendering;
  // PerformanceMonitor cannot react until after the first valid portrait
  // frame. On lower-memory phones the desktop post stack can lose the WebGL
  // context during model/shader startup, before adaptation ever begins. Keep
  // the default adaptive mobile path inside a conservative allocation budget;
  // Dev Options can still disable adaptive quality to force the uncapped path.
  // Only the weakest phones start inside a conservative allocation budget.
  // Capable phones keep their tier settings; the adaptive monitor can still
  // step down after the first frames if the GPU misses its budget.
  const protectMobileGpuDuringStartup = isMobileCanvas
    && adaptiveQualityEnabled
    && mobileQuality?.tier === 'economy';
  const effectiveAoQualityLevel = protectMobileGpuDuringStartup
    ? 0
    : (mobileQuality?.aoQualityLevel ?? tuning.aoQualityLevel);
  const effectiveMsaaQualityLevel = protectMobileGpuDuringStartup
    ? 0
    : (mobileQuality?.msaaQualityLevel ?? tuning.msaaQualityLevel);
  const effectiveShadowQualityLevel = protectMobileGpuDuringStartup
    ? 0
    : (mobileQuality?.shadowQualityLevel ?? tuning.shadowQualityLevel);
  const [performanceMonitoringReady, setPerformanceMonitoringReady] = useState(false);
  const [mobileDpr, setMobileDpr] = useState(
    () => Math.min(window.devicePixelRatio || 1, mobileQuality?.maxDpr ?? MOBILE_MAX_DPR),
  );
  const useMobileLook = Boolean(mobileQuality?.useMobileModel ?? isMobileCanvas);
  const desktopQualityDpr = Math.min(
    CHARACTER_LOOK_TECHNIQUE.maxDevicePixelRatio,
    canvasDpr * tuning.portraitResolutionScale,
  );
  const basePortraitDpr = isMobileCanvas ? mobileDpr : desktopQualityDpr;
  // A 1x buffer stretched over a 2x/3x phone panel visibly blurs facial detail.
  // Keep the tier's allocation budget; adapt effects instead of downsampling it.
  const minimumAdaptiveRenderScale = minimumPortraitRenderScale(
    basePortraitDpr,
    isMobileCanvas ? basePortraitDpr : undefined,
  );
  // Clamp synchronously as well as persisting the correction in the effect
  // below. A browser zoom/display move can lower devicePixelRatio between
  // renders; using the raw stale state here would briefly resize the backing
  // buffer below native density before the effect repaired it.
  const effectiveAdaptiveRenderScale = clampPortraitRenderScale(
    adaptiveQualityEnabled ? adaptiveRenderScale : 1,
    minimumAdaptiveRenderScale,
  );
  const portraitDpr = basePortraitDpr * effectiveAdaptiveRenderScale;
  const effectiveModelFile = isMobileCanvas && (mobileQuality?.useMobileModel ?? true)
    ? mobileModelFile(coach.modelFile)
    : coach.modelFile;
  const warmupPortraitUrl = getCoachWarmupPortraitUrl(coach);
  const mobileWarmupObjectPositionValue = isMobileCanvas
    ? (mobileCompact?.warmupObjectPosition
      ?? mobileWarmupObjectPosition(characterFraming.horizontalOffset, mobileZoom))
    : null;
  const characterWindowStyle = mobileWarmupObjectPositionValue
    ? ({ '--mobile-warmup-object-position': mobileWarmupObjectPositionValue } as CSSProperties)
    : undefined;
  const effectiveIdleFile = coach.idleFile;
  const modelUrl = assetUrl(effectiveModelFile);
  const idleUrl = assetUrl(effectiveIdleFile);
  const modelKey = `${coach.id}:${modelUrl}:${idleUrl}`;
  const characterResetKey = `${modelKey}:attempt${loadAttempt}`;
  // Keyed readiness hides a replacement canvas in its very first React commit,
  // before the coach-switch reset effect runs.
  const characterReady = readyCharacterKey === characterResetKey;
  const portraitHandoffPhase: PortraitHandoffPhase = characterReady ? 'done' : 'waiting';
  const [displayedLine, setDisplayedLine] = useState('');
  const revealTargetRef = useRef('');
  const revealShownRef = useRef('');
  const [micEnabled, setMicEnabled] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const suppressThinkingUntilRef = useRef(0);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (liveCanvasMounted) return undefined;
    if (!previewMode) {
      setLiveCanvasMounted(true);
      return undefined;
    }
    // Let the board, controls and lightweight portrait own the initial input
    // window. The GLB fetch begins in the preload effect below, but delaying
    // shader compilation prevents an eager WebGL mount from swallowing a fast
    // first click. Play itself cancels this grace and reveals the game first.
    const timer = window.setTimeout(() => setLiveCanvasMounted(true), 2_500);
    return () => window.clearTimeout(timer);
  }, [liveCanvasMounted, previewMode]);

  const handlePortraitPerformanceDecline = useCallback(({ fps }: { fps: number }) => {
    // Preserve native pixel density first: reducing DPR before AO was the
    // visible source of stair-stepping on DPR-1 desktops.
    setPortraitPerformance((current) => {
      const next = nextPortraitPerformanceState(
        current.adaptiveRenderScale,
        current.balancedRendering,
        minimumAdaptiveRenderScale,
      );
      if (!current.balancedRendering) {
        debugLog(
          'PortraitPerformance',
          `Using balanced post-processing coach=${coach.id} after ${fps}fps`,
        );
      } else if (next.scale < current.adaptiveRenderScale - 0.001) {
        debugLog(
          'PortraitPerformance',
          `Reducing coach=${coach.id} render scale ${current.adaptiveRenderScale.toFixed(2)}`
          + `->${next.scale.toFixed(2)} after ${fps}fps`,
        );
      }
      return {
        adaptiveRenderScale: next.scale,
        balancedRendering: next.balanced,
      };
    });
  }, [coach.id, minimumAdaptiveRenderScale]);

  useEffect(() => {
    if (adaptiveQualityEnabled) return;
    setPortraitPerformance({ adaptiveRenderScale: 1, balancedRendering: false });
  }, [adaptiveQualityEnabled]);

  // Desktop keeps its auto-focused composer. Mobile keeps the composer visible
  // after Play, but never summons the software keyboard automatically.
  useEffect(() => {
    if (chatOpen && !isMobileCanvas) {
      chatInputRef.current?.focus();
    }
  }, [chatOpen, isMobileCanvas]);

  useEffect(() => chessConvai.onStatus((s) => {
    const now = Date.now();
    if (s.speaking) suppressThinkingUntilRef.current = now + 300;
    setMicEnabled(s.micEnabled);
    setBotSpeaking(s.speaking);
    setBotThinking(s.thinking && !s.speaking && now >= suppressThinkingUntilRef.current);
  }), []);

  useEffect(() => chessConvai.onUserTranscript((text) => {
    setUserSpeaking(Boolean(text.trim()));
  }), []);

  // Kick the GLB fetches as soon as the card knows its URLs. An effect, not a
  // render-body call: CoachCard re-renders on every status emit and typewriter
  // tick, and side effects in the render body double-fire under StrictMode.
  useEffect(() => {
    if (VISUAL_QA_MODE || useImageFallback) return;
    useGLTF.preload(modelUrl);
    useGLTF.preload(idleUrl);
    debugLog('CoachCard', `Rendering coach=${coach.id} model=${effectiveModelFile} mobile=${isMobileCanvas}`);
  }, [modelUrl, idleUrl, coach.id, effectiveModelFile, isMobileCanvas, useImageFallback]);

  useEffect(() => {
    // Browser zoom and moving between monitors can change devicePixelRatio
    // after the adaptive path has already reduced its scale. Restore the floor
    // immediately so a former DPR-2 scale cannot become subnative at DPR 1.
    setPortraitPerformance((current) => ({
      ...current,
      adaptiveRenderScale: clampPortraitRenderScale(
        current.adaptiveRenderScale,
        minimumAdaptiveRenderScale,
      ),
    }));
  }, [minimumAdaptiveRenderScale]);

  useEffect(() => {
    const el = characterWindowRef.current;
    if (!el) return;

    const updateDpr = () => {
      const ratio = window.devicePixelRatio || 1;
      if (isMobileCanvas) {
        setMobileDpr(Math.min(ratio, mobileQuality?.maxDpr ?? MOBILE_MAX_DPR));
        return;
      }
      setCanvasDpr(preferredDesktopPortraitDevicePixelRatio(ratio));
    };

    updateDpr();
    const observer = new ResizeObserver(updateDpr);
    observer.observe(el);
    window.addEventListener('resize', updateDpr);
    const resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    resolutionQuery.addEventListener?.('change', updateDpr);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateDpr);
      resolutionQuery.removeEventListener?.('change', updateDpr);
    };
  }, [isMobileCanvas, mobileQuality]);

  useEffect(() => {
    if (syncModelKey === null) {
      setSyncModelKey(modelKey);
      setSyncLoadAttempt(loadAttempt);
      return;
    }
    if (modelKey === syncModelKey && loadAttempt === syncLoadAttempt) return;

    readyNotifiedRef.current = null;
    setReadyCharacterKey(null);

    if (modelKey !== syncModelKey) {
      setSyncModelKey(modelKey);
      setSyncLoadAttempt(0);
      setCharacterFailed(false);
      setLoadAttempt(0);
      setUseImageFallback(VISUAL_QA_MODE);
      return;
    }

    setSyncLoadAttempt(loadAttempt);
  }, [
    loadAttempt,
    modelKey,
    syncLoadAttempt,
    syncModelKey,
  ]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
  }, []);

  const handleCharacterReady = useCallback(() => {
    if (readyNotifiedRef.current === characterResetKey) return;
    readyNotifiedRef.current = characterResetKey;
    debugLog('CoachCard', `Portrait ready for coach=${coach.id}`);
    setReadyCharacterKey(characterResetKey);
    onReady?.();
  }, [onReady, coach.id, characterResetKey]);

  useEffect(() => {
    const canvas = characterWindowRef.current?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    canvas.dataset.portraitResolutionScale = tuning.portraitResolutionScale.toFixed(2);
    canvas.dataset.portraitHairAlphaCoverage = String(tuning.hairAlphaCoverage >= 0.5);
    canvas.dataset.portraitCameraZoom = liveCameraZoom.toFixed(2);
    canvas.dataset.portraitContrast = String(tuning.portraitContrastPercent);
    canvas.dataset.portraitAdaptiveQuality = String(adaptiveQualityEnabled);
    if (mobileQuality) {
      canvas.dataset.portraitMobileTier = mobileQuality.tier;
      canvas.dataset.portraitMobileModel = String(mobileQuality.useMobileModel);
      canvas.dataset.portraitMobileMaxDpr = String(mobileQuality.maxDpr);
    }
  }, [
    adaptiveQualityEnabled,
    characterReady,
    mobileQuality,
    tuning.hairAlphaCoverage,
    liveCameraZoom,
    tuning.portraitContrastPercent,
    tuning.portraitResolutionScale,
  ]);

  useEffect(() => {
    setPerformanceMonitoringReady(false);
    if (!characterReady || useImageFallback) return;
    const timer = window.setTimeout(
      () => setPerformanceMonitoringReady(true),
      PORTRAIT_PERFORMANCE_WARMUP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [characterReady, useImageFallback, modelKey]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const debugWindow = window as Window & {
      __chessPortraitPerformanceQa?: Record<string, {
        decline: () => void;
        sample: () => {
          adaptiveRenderScale: number;
          balancedRendering: boolean;
          minimumAdaptiveRenderScale: number;
          basePortraitDpr: number;
        };
      }>;
    };
    debugWindow.__chessPortraitPerformanceQa ??= {};
    const entry = {
      decline: () => handlePortraitPerformanceDecline({ fps: 10 }),
      sample: () => ({
        adaptiveRenderScale,
        balancedRendering: effectiveBalancedRendering,
        minimumAdaptiveRenderScale,
        basePortraitDpr,
      }),
    };
    debugWindow.__chessPortraitPerformanceQa[coach.id] = entry;
    return () => {
      if (debugWindow.__chessPortraitPerformanceQa?.[coach.id] === entry) {
        delete debugWindow.__chessPortraitPerformanceQa[coach.id];
      }
    };
  }, [
    adaptiveRenderScale,
    effectiveBalancedRendering,
    basePortraitDpr,
    coach.id,
    handlePortraitPerformanceDecline,
    minimumAdaptiveRenderScale,
  ]);

  useEffect(() => {
    if (!characterReady) return;
    const immediate = window.setTimeout(() => {
      logPortraitReadyState({
        coachId: coach.id,
        characterWindowEl: characterWindowRef.current,
        characterReady: true,
      });
    }, 100);
    return () => window.clearTimeout(immediate);
  }, [characterReady, coach.id]);

  const handleCharacterError = useCallback((error: Error) => {
    debugLog('CoachCard', `Character failed for coach=${coach.id} attempt=${loadAttempt}: ${error.message}`);
    // Either Suspense load may have failed. Drop both parsed entries so the
    // single retry cannot immediately replay a rejected model or idle promise.
    clearCoachAssetCaches([modelUrl, idleUrl]);
    if (loadAttempt === 0) {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        debugLog('CoachCard', `Retrying portrait load for coach=${coach.id}`);
        setLoadAttempt(1);
      }, PORTRAIT_RETRY_DELAY_MS);
      return;
    }
    // Second failure: keep the coach present with the static portrait so the
    // game stays fully playable.
    debugLog('CoachCard', `Falling back to static portrait for coach=${coach.id}`);
    setCharacterFailed(true);
    setUseImageFallback(true);
  }, [coach.id, loadAttempt, modelUrl, idleUrl]);

  // If the 3D portrait produced neither a frame nor an error in time (stalled
  // download, silently dead context), treat it as a failure.
  useEffect(() => {
    if (characterReady || useImageFallback) return;
    const watchdog = window.setTimeout(() => {
      handleCharacterError(new Error(`watchdog: portrait not ready after ${PORTRAIT_LOAD_WATCHDOG_MS}ms`));
    }, PORTRAIT_LOAD_WATCHDOG_MS);
    return () => window.clearTimeout(watchdog);
  }, [characterReady, useImageFallback, handleCharacterError]);

  // The static portrait counts as "ready" — the game flow must not wait forever.
  useEffect(() => {
    if (useImageFallback) handleCharacterReady();
  }, [useImageFallback, handleCharacterReady]);

  // Keep the typewriter target in sync with the latest coach line. When the new
  // text isn't a continuation of what's already shown (i.e. a brand-new line),
  // restart the reveal from the beginning.
  useEffect(() => {
    const target = lastLine ?? '';
    revealTargetRef.current = target;
    if (!target || !target.startsWith(revealShownRef.current)) {
      revealShownRef.current = '';
      setDisplayedLine('');
    }
  }, [lastLine]);

  // Reveal the coach line smoothly at roughly her speaking cadence so the caption
  // streams in as she talks instead of appearing all at once when speech ends.
  // The rAF loop only runs while there is text left to reveal — `lastLine`
  // changes restart it — instead of waking every frame for the card's lifetime.
  useEffect(() => {
    const CHARS_PER_SEC = 26;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const target = revealTargetRef.current;
      const shown = revealShownRef.current;
      if (shown.length < target.length) {
        carry += (dt / 1000) * CHARS_PER_SEC;
        if (carry >= 1) {
          const add = Math.min(target.length - shown.length, Math.floor(carry));
          carry -= add;
          const nextShown = target.slice(0, shown.length + add);
          revealShownRef.current = nextShown;
          setDisplayedLine(nextShown);
        }
        raf = requestAnimationFrame(loop);
        return;
      }
      raf = 0; // fully revealed — idle until the next lastLine change
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [lastLine]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    if (!displayedLine && !messages.length) {
      wrap.classList.remove('is-clipped');
      wrap.scrollTop = 0;
      return;
    }

    const raf = requestAnimationFrame(() => {
      // The responsive shell owns this track's height. Content may scroll, but
      // it must never resize the character viewport while a line types in.
      wrap.classList.toggle('is-clipped', wrap.scrollHeight > wrap.clientHeight + 1);
      // Keep the newest revealed text in view while the line types out.
      wrap.scrollTop = wrap.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [displayedLine, messages.length]);

  return (
    <section
      className={`coach-card character-card${chatOpen ? ' has-chat' : ''}${displayedLine ? ' has-guidance' : ''}${previewMode ? ' is-preview' : ''}`}
      data-coach-id={coach.id}
      aria-label={`${coach.name} chess coach`}
    >
      <div
        ref={characterWindowRef}
        className={`character-window${characterReady ? ' is-ready' : ''}${portraitHandoffPhase === 'done' ? ' is-handoff-complete' : ''}${characterFailed ? ' has-error' : ''}`}
        style={characterWindowStyle}
        data-portrait-handoff={portraitHandoffPhase}
        data-portrait-performance-monitor={
          useImageFallback ? 'disabled' : (performanceMonitoringReady ? 'active' : 'warming')
        }
      >
        {!useImageFallback && portraitHandoffPhase !== 'done' && (
          <img
            className="character-warmup-img"
            src={warmupPortraitUrl}
            srcSet={`${warmupPortraitUrl} 1200w`}
            sizes="(max-width: 767px) 50vw, 280px"
            alt=""
            width={1200}
            height={1600}
            decoding="sync"
            aria-hidden="true"
            style={mobileWarmupObjectPositionValue
              ? { objectPosition: mobileWarmupObjectPositionValue }
              : undefined}
          />
        )}
        {previewMode && !characterReady && !isMobileCanvas && (
          <img
            className="character-ready-poster"
            src={getCoachPortraitUrl(coach)}
            alt=""
            width={1200}
            height={1600}
            decoding="async"
            aria-hidden="true"
          />
        )}
        {useImageFallback ? (
          <img
            className="character-fallback-img"
            src={getCoachPortraitUrl(coach)}
            alt={`${coach.name} portrait`}
          />
        ) : liveCanvasMounted ? (
        <Canvas
          key={characterResetKey}
          frameloop="always"
          camera={{
            position: portraitCameraPosition,
            fov: CHARACTER_LOOK.camera.fov,
            near: 0.05,
            far: 20,
          }}
          dpr={portraitDpr}
          gl={{
            antialias: false,
            alpha: isMobileCanvas,
            premultipliedAlpha: true,
            powerPreference: 'high-performance',
            // Mobile recovery samples the displayed face after render. Keep
            // the small portrait buffer available so a valid composed frame
            // is not misread as black after browser presentation.
            preserveDrawingBuffer: isMobileCanvas,
          }}
          style={{
            background: isMobileCanvas ? 'transparent' : stageBgColor,
            filter: characterColorGradeFilter(tuning.portraitContrastPercent),
          }}
          onCreated={({ camera, gl }) => {
            gl.debug.checkShaderErrors = import.meta.env.DEV;
            attachPortraitWebGLContextListeners(gl, () => {
              handleCharacterError(new Error('webglcontextlost'));
            });
            logPortraitWebGLCapabilities(gl);
            const mountCount = nextCanvasMountCount();
            debugLog('CoachCard', `3D scene ready for coach=${coach.id} mount=${mountCount}`);
            camera.lookAt(...CHARACTER_LOOK.camera.lookAt);
            if (isMobileCanvas) gl.setClearColor(0x000000, 0);
            else gl.setClearColor(stageBgColor, 1);
            requestAnimationFrame(() => {
              logPortraitBootstrap({
                coachId: coach.id,
                modelFile: effectiveModelFile,
                mountCount,
                isMobile: isMobileCanvas,
                characterWindowEl: characterWindowRef.current,
                canvasEl: characterWindowRef.current?.querySelector('canvas') ?? null,
                characterReady: false,
                bgColor: stageBgColor,
                gl,
              });
            });
          }}
        >
          {characterReady && performanceMonitoringReady && adaptiveQualityEnabled && (
            <PerformanceMonitor
              ms={500}
              iterations={3}
              threshold={0.66}
              bounds={portraitPerformanceBounds}
              onDecline={handlePortraitPerformanceDecline}
            />
          )}
          <PortraitScene
            bgColor={stageBgColor}
            enablePostProcessing={mobileQuality?.enablePostProcessing ?? true}
            enableEnvironment={mobileQuality?.enableEnvironment ?? true}
            balancedRendering={effectiveBalancedRendering}
            aoQualityLevel={effectiveAoQualityLevel}
            aoIntensity={tuning.aoIntensity}
            aoRadius={tuning.aoRadius}
            msaaQualityLevel={effectiveMsaaQualityLevel}
            smaaQualityLevel={mobileQuality?.smaaQualityLevel ?? tuning.smaaQualityLevel}
            toneMappingEnabled={tuning.toneMappingEnabled >= 0.5}
            toneMappingExposure={resolvePortraitToneMappingExposure(
              useMobileLook,
              CHARACTER_LOOK.renderer.toneMappingExposure,
            )}
            lightIntensityScale={resolvePortraitLightIntensityScale(useMobileLook)}
            shadowQualityLevel={effectiveShadowQualityLevel}
            studioBackdropStrength={PORTRAIT_STAGE_BACKDROP_STRENGTH}
            environmentIntensity={tuning.environmentIntensity}
            pageCutout={isMobileCanvas}
          >
            <CharacterErrorBoundary resetKey={characterResetKey} onError={handleCharacterError}>
              <Suspense fallback={null}>
                <ReallusionCharacter
                  coachId={coach.id as import('./coachConfig').CoachId}
                  assetName={coach.assetName}
                  charUrl={modelUrl}
                  animUrl={idleUrl}
                  mobileVariant={isMobileCanvas}
                  usePennerSkin={!isMobileCanvas}
                  authoredPerformance={mobileQuality?.useAuthoredPerformance}
                  hairAlphaCoverage={tuning.hairAlphaCoverage >= 0.5}
                  textureAnisotropy={
                    mobileQuality?.textureAnisotropy ?? tuning.textureAnisotropy
                  }
                  environmentRoughnessFloor={tuning.environmentRoughnessFloor}
                  skinSssStrength={tuning.skinSssStrength}
                  environmentIntensity={tuning.environmentIntensity}
                  bgColor={stageBgColor}
                  responseThinking={botThinking}
                  userSpeaking={userSpeaking}
                  userEngaged={Boolean(chatBusy && !boardThinking)}
                  playerWon={playerWon}
                  onReady={handleCharacterReady}
                  framing={characterFraming}
                />
              </Suspense>
            </CharacterErrorBoundary>
          </PortraitScene>
        </Canvas>
        ) : null}
        {!characterReady && (
          <div className="character-loading" aria-live="polite">
            <span className="character-loading-mark">{characterFailed ? '!' : coach.name.charAt(0)}</span>
            <strong>{characterFailed ? 'Coach could not load' : `Loading ${coach.name}`}</strong>
          </div>
        )}
        {characterReady && (
          <CharacterActivity
            micEnabled={micEnabled}
            thinking={botThinking}
            botSpeaking={botSpeaking}
          />
        )}
        {/* Voice mute rides the top-right corner of the portrait itself,
            the way the Convai dashboard puts speaker control on the tile. */}
        {!isMobileCanvas && <VoiceMuteButton />}
      </div>
      <div className="character-caption">
        <div className="caption-info">
          <strong>{coach.name}</strong>
          <span>{status}</span>
        </div>
        <div className="caption-actions">
          {!isMobileCanvas && mic}
          {onAddToDataset && (
            <Tooltip text="Log this dialogue exchange to dataset" placement="top">
              <button
                type="button"
                className="add-dataset-btn"
                onClick={() => {
                  unlockUiAudio();
                  playUiSound('tap');
                  onAddToDataset();
                }}
                aria-label="Add to dataset"
              >
                +
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {(() => {
        const chatPanel = (
          <>
            <div
              ref={wrapRef}
              className={`coach-line-wrap${messages.length || showEmptyConversation ? ' has-conversation' : ''}`}
              role={messages.length || showEmptyConversation ? 'log' : undefined}
              aria-label={messages.length || showEmptyConversation ? `Conversation with ${coach.name}` : undefined}
              aria-live="polite"
              aria-atomic="false"
            >
              {messages.length ? (
                <div className="coach-conversation-list">
                  {messages.map((message, index) => (
                    <article
                      key={message.id}
                      ref={index === messages.length - 1 && message.role === 'coach' ? lineRef : undefined}
                      className={`coach-message is-${message.role}`}
                    >
                      {!isMobileCanvas && (
                        <span className="coach-message-author">
                          {message.role === 'user' ? 'You' : coach.name}
                        </span>
                      )}
                      <p>{message.text}</p>
                    </article>
                  ))}
                </div>
              ) : displayedLine ? (
                <p ref={lineRef} className="coach-line">{displayedLine}</p>
              ) : showEmptyConversation ? (
                <div className="coach-conversation-empty">
                  <strong>Review chat is ready</strong>
                  <span>Ask {coach.name} about the game or any move.</span>
                </div>
              ) : null}
            </div>
            {isMobileCanvas && (
              <div className="coach-chat-toolbar" aria-label="Game controls">
                {onMenu && (
                  <button
                    type="button"
                    className="audio-btn coach-menu-btn"
                    onClick={() => {
                      unlockUiAudio();
                      playUiSound('tap');
                      onMenu();
                    }}
                    aria-label="Game menu"
                  >
                    <Menu size={17} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                )}
                <VoiceMuteButton showTooltip={false} overlay={false} />
                <MicButton className="coach-mic-btn" showTooltip={false} />
                <button
                  type="button"
                  className="audio-btn coach-resign-btn"
                  onClick={() => {
                    unlockUiAudio();
                    playUiSound('tap');
                    onResign?.();
                  }}
                  aria-label={onResign ? 'Resign game' : 'Resign unavailable before game'}
                  disabled={!onResign}
                >
                  <Flag size={17} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </div>
            )}
            {chatOpen && onChatSend && (
              <div className="coach-chat-row">
                <input
                  ref={chatInputRef}
                  type="text"
                  className="coach-chat-input"
                  value={chatInput ?? ''}
                  aria-busy={chatBusy || undefined}
                  onChange={(event) => onChatInputChange?.(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !chatBusy && (chatInput ?? '').trim()) {
                      event.preventDefault();
                      onChatSend();
                    }
                  }}
                  placeholder={chatBusy ? 'Type your next message...' : `Ask ${coach.name}...`}
                  aria-label={`Ask ${coach.name}`}
                />
                <button
                  type="button"
                  className="coach-chat-send"
                  onClick={() => {
                    onChatSend();
                  }}
                  aria-label="Send message"
                  disabled={chatBusy || !(chatInput ?? '').trim()}
                >
                  <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        );

        if (isMobileCanvas) {
          return <div className="coach-chat-panel">{chatPanel}</div>;
        }

        return chatPanel;
      })()}
    </section>
  );
}

/**
 * Overlays the character window with a compact status chip for live mic listening or
 * coach thinking. Speech itself is handled by the caption below the portrait.
 */
function CharacterActivity({
  micEnabled,
  thinking,
  botSpeaking,
}: {
  micEnabled: boolean;
  thinking: boolean;
  botSpeaking: boolean;
}) {
  const mode = thinking ? 'thinking' : (micEnabled && !botSpeaking) ? 'listening' : null;
  if (!mode) return null;

  return (
    <div className={`coach-activity-chip is-${mode}`} aria-live="polite">
      {mode === 'thinking' ? (
        <>
          <span>Thinking</span>
          <span className="activity-dots"><i /><i /><i /></span>
        </>
      ) : (
        <>
          <span className="activity-mic-dot" />
          <span>Listening</span>
        </>
      )}
    </div>
  );
}

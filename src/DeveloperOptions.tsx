import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, LocateFixed, RotateCcw, SlidersHorizontal, Wrench, X } from 'lucide-react';
import { debugLog } from './debugLog';
import {
  formatLipsyncTuningValue,
  getLipsyncTuningSnapshot,
  getLipsyncTuningValuesForCoach,
  hasCoachPoseTuningOverrides,
  LIPSYNC_TUNING_CONTROLS,
  setLipsyncTuningMode,
  setLipsyncTuningValueForCoach,
  subscribeLipsyncTuning,
  type LipsyncTuningControl,
} from './lipsyncTuning';
import { playUiSound, unlockUiAudio } from './uiSounds';
import { useFloatingPanel } from './useFloatingPanel';

const DEVELOPER_PANEL_POSITION_KEY = 'chessbuddy.floatingPanel.developerOptions.v1';

function NumericSlider({ control, coachId }: { control: LipsyncTuningControl; coachId: string }) {
  useSyncExternalStore(
    subscribeLipsyncTuning,
    getLipsyncTuningSnapshot,
    getLipsyncTuningSnapshot,
  );
  const value = getLipsyncTuningValuesForCoach(coachId)[control.key];
  const id = `dev-tuning-${control.key}`;

  return (
    <label className="dev-slider" htmlFor={id}>
      <span className="dev-slider-head">
        <span className="dev-slider-label">{control.label}</span>
        <output className="dev-slider-value" htmlFor={id}>{formatLipsyncTuningValue(control, value)}</output>
      </span>
      <input
        id={id}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        aria-label={control.label}
        aria-valuetext={formatLipsyncTuningValue(control, value)}
        onChange={(event) => setLipsyncTuningValueForCoach(
          coachId,
          control.key,
          Number(event.currentTarget.value),
        )}
      />
      <span className="dev-slider-desc">{control.description}</span>
    </label>
  );
}

export default function DeveloperOptions({
  coachId,
  description,
}: {
  coachId: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const snapshot = useSyncExternalStore(
    subscribeLipsyncTuning,
    getLipsyncTuningSnapshot,
    getLipsyncTuningSnapshot,
  );
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [renderStatus, setRenderStatus] = useState<{
    dpr: string;
    msaa: string;
    smaa: string;
    ao: string;
    tone: string;
    exposure: string;
    lights: string;
    shadow: string;
    environment: string;
    iblFloor: string;
    sss: string;
    backdrop: string;
    balanced: string;
  } | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const floating = useFloatingPanel({
    open,
    storageKey: DEVELOPER_PANEL_POSITION_KEY,
    anchorRef,
    panelRef,
    onRequestClose: close,
  });
  const activeMode = hasCoachPoseTuningOverrides(coachId) ? 'custom' : snapshot.mode;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      anchorRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return undefined;
    const sample = () => {
      const canvas = document.querySelector('.character-window canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        setRenderStatus(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      setRenderStatus({
        dpr: rect.width > 0 ? (canvas.width / rect.width).toFixed(2) : '—',
        msaa: canvas.dataset.portraitMsaaSamples ?? '—',
        smaa: canvas.dataset.portraitSmaaQuality ?? '—',
        ao: canvas.dataset.portraitAoQuality ?? '—',
        tone: canvas.dataset.portraitToneMapping ?? '—',
        exposure: canvas.dataset.portraitToneMappingExposure ?? '—',
        lights: canvas.dataset.portraitLightIntensityScale ?? '—',
        shadow: canvas.dataset.portraitShadowQuality ?? '—',
        environment: canvas.dataset.portraitEnvironmentIntensity ?? '—',
        iblFloor: canvas.dataset.portraitIblRoughnessFloor ?? '—',
        sss: canvas.dataset.portraitSssStrength ?? '—',
        backdrop: canvas.dataset.portraitBackdropStrength ?? '—',
        balanced: canvas.dataset.portraitBalancedRendering === 'true' ? 'balanced' : 'full',
      });
    };
    sample();
    const interval = window.setInterval(sample, 400);
    return () => window.clearInterval(interval);
  }, [open]);

  const selectMode = (mode: 'tuned' | 'pure') => {
    setLipsyncTuningMode(mode);
    playUiSound('tap');
    debugLog('DevMenu', `Lipsync comparison mode -> ${mode}`);
  };

  const statusLabel = activeMode === 'tuned'
    ? 'Chessbuddy tuned'
    : activeMode === 'pure'
      ? 'Pure NeuroSync'
      : 'Custom comparison';

  return (
    <div className="dev-menu-wrap">
      <button
        ref={anchorRef}
        type="button"
        className={`rail-tool rail-developer-options${open ? ' is-active' : ''}${activeMode !== 'tuned' ? ' has-override' : ''}`}
        title="Developer options"
        aria-label="Developer options"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'developer-options-panel' : undefined}
        onClick={() => {
          unlockUiAudio();
          playUiSound('tap');
          setOpen((value) => !value);
        }}
      >
        <SlidersHorizontal aria-hidden="true" />
        {description ? (
          <span><strong>Dev</strong><small>{description}</small></span>
        ) : (
          <small>Dev</small>
        )}
      </button>

      {open && createPortal(
        <div
          id="developer-options-panel"
          ref={panelRef}
          className="dev-menu-panel dev-tuning-panel floating-utility-panel"
          style={floating.style}
          role="dialog"
          aria-labelledby="developer-options-title"
          data-tuning-mode={activeMode}
          onPointerDownCapture={floating.bringToFront}
        >
          <header
            className="dev-menu-head floating-panel-drag-handle"
            aria-label="Move Developer options panel. Use arrow keys for precise movement."
            {...floating.dragHandleProps}
          >
            <span className="dev-menu-heading-icon"><Wrench aria-hidden="true" /></span>
            <span>
              <strong id="developer-options-title">Developer options</strong>
              <small>Live facial comparison</small>
            </span>
            <span className={`dev-mode-badge is-${activeMode}`}>{statusLabel}</span>
            <GripHorizontal className="floating-panel-grip" aria-hidden="true" />
            <button
              type="button"
              className="floating-panel-close"
              data-drag-ignore
              onClick={close}
              aria-label="Close developer options"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="dev-menu-scroll">
            <button
              className="dev-menu-row dev-master-row"
              type="button"
              onClick={() => selectMode(activeMode === 'tuned' ? 'pure' : 'tuned')}
              role="switch"
              aria-checked={activeMode === 'tuned'}
            >
              <span className="dev-menu-row-text">
                <span className="dev-menu-row-title">Use Chessbuddy tuning</span>
                <span className="dev-menu-row-desc">
                  Turn off for raw 1:1 NeuroSync facial values. Safety and the 120ms final-pose release stay locked.
                </span>
              </span>
              <span className={`dev-switch${activeMode === 'tuned' ? ' is-on' : ''}`} aria-hidden="true">
                <span className="dev-switch-knob" />
              </span>
            </button>

            <section className="dev-control-section" aria-labelledby="dev-face-controls">
              <div className="dev-section-head">
                <span id="dev-face-controls">NeuroSync face controls</span>
                <button type="button" onClick={() => selectMode('pure')}>Pure values</button>
              </div>
              {LIPSYNC_TUNING_CONTROLS.filter((control) => control.section === 'face')
                .map((control) => <NumericSlider key={control.key} control={control} coachId={coachId} />)}
            </section>

            <section className="dev-control-section" aria-labelledby="dev-blink-controls">
              <div className="dev-section-head">
                <span id="dev-blink-controls">Blink and eyelid controls</span>
              </div>
              {LIPSYNC_TUNING_CONTROLS.filter((control) => control.section === 'blink')
                .map((control) => <NumericSlider key={control.key} control={control} coachId={coachId} />)}
            </section>

            <section className="dev-control-section" aria-labelledby="dev-pose-controls">
              <div className="dev-section-head">
                <span id="dev-pose-controls">Model, head and eye pose</span>
              </div>
              {LIPSYNC_TUNING_CONTROLS.filter((control) => control.section === 'pose')
                .map((control) => <NumericSlider key={control.key} control={control} coachId={coachId} />)}
            </section>

            <section className="dev-control-section" aria-labelledby="dev-render-controls">
              <div className="dev-section-head">
                <span id="dev-render-controls">Portrait render quality</span>
              </div>
              {LIPSYNC_TUNING_CONTROLS.filter((control) => control.section === 'render')
                .map((control) => <NumericSlider key={control.key} control={control} coachId={coachId} />)}
              <div className="dev-effective-quality" aria-live="polite">
                <strong>Effective live state</strong>
                <span>{renderStatus
                  ? `${renderStatus.dpr}x DPR · ${renderStatus.msaa}x MSAA · SMAA ${renderStatus.smaa} · ${renderStatus.ao} AO · ${renderStatus.tone} @ ${renderStatus.exposure} exposure · lights ${renderStatus.lights}x · shadow ${renderStatus.shadow} · env ${renderStatus.environment} · IBL floor ${renderStatus.iblFloor} · SSS ${renderStatus.sss} · backdrop ${renderStatus.backdrop} · ${renderStatus.balanced}`
                  : 'Character renderer is not active.'}</span>
              </div>
            </section>

            <section className="dev-safety-note" aria-label="Locked runtime safety">
              <strong>Safety remains on in every mode</strong>
              <span>251-channel order · finite/clamp checks · additive reset · 95% rig gate · 0.12s final-pose release</span>
            </section>
          </div>

          <footer className="dev-menu-foot">
            <span>Changes apply live and persist in this browser.</span>
            <span className="floating-panel-foot-actions">
              <button type="button" onClick={floating.resetPosition}>
                <LocateFixed aria-hidden="true" />
                Reset position
              </button>
              <button type="button" onClick={() => selectMode('tuned')}>
                <RotateCcw aria-hidden="true" />
                App defaults
              </button>
            </span>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
}

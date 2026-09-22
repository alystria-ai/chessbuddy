import setupJson from '../vendor/convai-web-lipsync/Lipsynic-setup.json';
import orderJson from '../vendor/convai-web-lipsync/metahuman-order-251.json';
import unityMapJson from '../vendor/convai-web-lipsync/unity-metahuman-map-4.4.1.json';
import { symmetrizeMhaMouth } from '@convai/web-sdk/lipsync-helpers';
import { getLipsyncTuningSnapshot, TUNED_LIPSYNC_VALUES } from './lipsyncTuning';

const MHA_CHANNEL_COUNT = 251;
const EXPECTED_WIRE_ORDER_FNV1A = 'a5c2acf8';
/** Mirrors the manager's proven post-turn fresh-frame drought before stale-tail disposal. */
const MISSING_END_SIGNAL_DROUGHT_SECONDS = 1.5;
const LATERAL_MOUTH_CHANNELS = new Set([
  'CTRL_expressions_mouthLeft',
  'CTRL_expressions_mouthRight',
  'CTRL_expressions_jawLeft',
  'CTRL_expressions_jawRight',
]);
const UPPER_LIP_RAISE_CHANNELS = new Set([
  'CTRL_expressions_mouthUpperLipRaiseL',
  'CTRL_expressions_mouthUpperLipRaiseR',
]);
const LOWER_LIP_DEPRESS_CHANNELS = new Set([
  'CTRL_expressions_mouthLowerLipDepressL',
  'CTRL_expressions_mouthLowerLipDepressR',
]);
const ORAL_CHANNELS = new Set(
  orderJson.channels.filter((channel) => /mouth|jaw|teeth|tongue/i.test(channel)),
);
/**
 * All four V2 rigs expose unusually bright dental rows at conversational jaw
 * peaks. These are the rig-authored MetaHuman occlusion shapes: upper teeth
 * move up and lower teeth move down behind the lips. Existing Convai values
 * are never discarded; these values are only minimums on the mapped frame.
 */
export const CONVAI_MHA_DENTAL_OCCLUSION = Object.freeze({
  upperChannel: 'CTRL_expressions_teethUpU',
  upperMinimum: TUNED_LIPSYNC_VALUES.upperTeethTuck,
  lowerChannel: 'CTRL_expressions_teethDownD',
  lowerMinimum: TUNED_LIPSYNC_VALUES.lowerTeethTuck,
});

/**
 * Chessbuddy's presentation release. The supplied webStudioVerified preset
 * remains unchanged at 0.8 seconds; the live portrait opts into this shorter,
 * still-eased release so a final open viseme cannot visibly linger.
 */
export const CONVAI_MHA_APP_RELEASE_SECONDS = 0.12;

type MutableNumberArray = {
  readonly length: number;
  [index: number]: number;
};

export type ConvaiMhaFrame = ArrayLike<number>;

export type ThreeMorphObjectLike = {
  name?: string;
  frustumCulled?: boolean;
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: MutableNumberArray;
};

export type ThreeSceneLike = {
  traverse(callback: (object: ThreeMorphObjectLike) => void): void;
};

export type ConvaiBlendshapeQueueLike = {
  length?: number;
  getLength?: () => number;
  hasFrames?: () => boolean;
  isBotSpeaking?: () => boolean;
  hasReceivedEndSignal?: () => boolean;
  isConversationEnded?: () => boolean;
  consumeNormalizationSignal?: () => boolean;
  getPlaybackFps?: () => number;
  getTurnStats?: () => { total_blendshapes?: number } | null;
  getFramesConsumed?: () => number;
  getFrameWithAlpha?: (index: number) => ConvaiMhaFrame | null | undefined;
  getFrame?: (index: number) => ConvaiMhaFrame | null | undefined;
  consumeFrames?: (count: number) => void;
  reset?: () => void;
};

type MappingRoute = {
  source: string;
  targets: string[];
  multiplier?: number;
  offset?: number;
  curveExponent?: number;
  enabled?: boolean | number;
  useOverrideValue?: boolean | number;
  overrideValue?: number;
  ignoreGlobalModifiers?: boolean | number;
  clampMinValue?: number;
  clampMaxValue?: number;
};

type UnityMapping = {
  globalMultiplier: number;
  globalOffset: number;
  mappings: MappingRoute[];
};

type IdentityMapping = {
  mode: 'identity';
  globalMultiplier: number;
  globalOffset: number;
  lowerFaceAlpha: number;
  upperFaceAlpha: number;
  upperFaceChannels: string[];
  jawOpen: {
    name: string;
    multiplier: number;
    min: number;
    max: number;
  };
};

type FileMapping = {
  mode: 'mappingFile';
  file: string;
};

type LipsyncPreset = {
  interpolation: {
    enabled: boolean;
    method: string;
  };
  timing: {
    timeOffsetSeconds: number;
    maxFramesConsumedPerRender?: number;
    maxBufferedSeconds?: number;
    minResumeHeadroomSeconds?: number;
  };
  smoothing: {
    enabled: boolean;
    method: string;
    speed?: number;
    factor?: number;
    referenceFps: number;
  };
  starvation: {
    fadeInSeconds: number;
    fadeOutSeconds: number;
    resetAtAlpha?: number;
  };
  mapping: IdentityMapping | FileMapping;
  application: {
    mode: 'add' | 'replace';
    removePreviousContributionBeforeApply: boolean;
  };
};

type LipsyncSetup = {
  transport: {
    enableLipsync: boolean;
    format: string;
    channelCount: number;
    channelOrderFile: string;
    outputFps: number;
    framesBufferDurationSeconds: number;
    deliverChunksAhead: boolean;
  };
  defaultPreset: string;
  presets: Record<string, LipsyncPreset>;
  runtimeSafety: {
    rejectNonFiniteValues: boolean;
    clampEveryChannel: boolean;
    disableFrustumCullingOnMorphedMeshes: boolean;
    neverReplaceMorphTargetInfluenceArrays: boolean;
    resetOnNormalizationSignal: boolean;
    resetWhenConversationEnds: boolean;
  };
  minimumValidation: {
    requiredChannelCount: number;
    requiredMorphCoverage: number;
    requiredChannels: string[];
  };
};

type MorphTargetRef = {
  object: ThreeMorphObjectLike;
  influences: MutableNumberArray;
  index: number;
  baseValue: number;
  hasContribution: boolean;
};

export type ConvaiMhaLipsyncDiagnostics = {
  presetName: string;
  fadeOutSeconds: number;
  fadeAlpha: number;
  starvationSeconds: number;
  tuningMode: 'tuned' | 'pure' | 'custom';
  enabled: boolean;
  wireChannelCount: number;
  wireOrderSignature: string;
  matchedChannelCount: number;
  coverage: number;
  missingChannels: string[];
  missingRequiredChannels: string[];
  rejectedFrames: number;
  rejectedValues: number;
  invalidMorphTargets: number;
  queueErrors: number;
  acceptedFrames: number;
  appliedFrames: number;
  resets: number;
  normalizationResets: number;
  conversationResets: number;
  missingEndSignalTailDrains: number;
  endSignalFinalFrameConsumes: number;
  authoritativeTailReleases: number;
  lastRejection: string | null;
};

export type ConvaiMhaLipsyncOptions = {
  scene: ThreeSceneLike;
  /** The art-team recommendation is the default. Unity parity is opt-in. */
  presetName?: 'webStudioVerified' | 'unity441Parity';
  /** Optional app presentation envelope; omitted means the preset stays exact. */
  fadeOutSeconds?: number;
};

export type ConvaiMhaQueueUpdateOptions = {
  /**
   * Authoritative manager proof that the selected coach's turn has ended.
   * Without this signal, an unsignaled queue is treated as a recoverable
   * inter-chunk hold indefinitely and is never discarded.
   */
  allowMissingEndSignalDrain?: boolean;
  /** Manager proof that speaking ended and fresh facial frames have stopped. */
  releaseHeldPose?: boolean;
};

const setup = setupJson as unknown as LipsyncSetup;
const unityMap = unityMapJson as unknown as UnityMapping;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function assertWireContract(channels: readonly string[]): void {
  const unique = new Set(channels);
  const signature = fnv1a(channels.join('\0'));
  if (
    channels.length !== MHA_CHANNEL_COUNT
    || unique.size !== MHA_CHANNEL_COUNT
    || orderJson.channelCount !== MHA_CHANNEL_COUNT
    || setup.transport.channelCount !== MHA_CHANNEL_COUNT
    || setup.minimumValidation.requiredChannelCount !== MHA_CHANNEL_COUNT
    || setup.transport.format !== 'mha'
    || orderJson.format !== 'mha'
    || signature !== EXPECTED_WIRE_ORDER_FNV1A
  ) {
    throw new Error(
      `Invalid Convai MHA wire contract: expected the exact ordered 251-channel package `
      + `(signature ${EXPECTED_WIRE_ORDER_FNV1A}), received ${channels.length} channels `
      + `(${unique.size} unique, signature ${signature}).`,
    );
  }

  for (const required of setup.minimumValidation.requiredChannels) {
    if (!unique.has(required)) {
      throw new Error(`Invalid Convai MHA wire contract: required channel ${required} is absent.`);
    }
  }
}

const orderedChannels = [...orderJson.channels];
assertWireContract(orderedChannels);

/** Mandatory wire order from the supplied package. Never sort this array. */
export const CONVAI_MHA_CHANNEL_ORDER: readonly string[] = Object.freeze(orderedChannels);
export const CONVAI_MHA_WIRE_ORDER_FNV1A = EXPECTED_WIRE_ORDER_FNV1A;
export const CONVAI_MHA_DEFAULT_PRESET = setup.defaultPreset as 'webStudioVerified';
export const CONVAI_MHA_REQUIRED_CHANNELS: readonly string[] = Object.freeze([
  ...setup.minimumValidation.requiredChannels,
]);

/** Exact ConvaiClient transport settings from Lipsynic-setup.json. */
export const CONVAI_MHA_CLIENT_OPTIONS = Object.freeze({
  enableLipsync: setup.transport.enableLipsync,
  blendshapeConfig: Object.freeze({
    format: setup.transport.format,
    frames_buffer_duration: setup.transport.framesBufferDurationSeconds,
    deliver_chunks_ahead: setup.transport.deliverChunksAhead,
    output_fps: setup.transport.outputFps,
  }),
});

export const CONVAI_MHA_MINIMUM_COVERAGE = setup.minimumValidation.requiredMorphCoverage;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function isMutableNumberArray(value: unknown): value is MutableNumberArray {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView) && 'length' in value;
}

/**
 * Three.js write adapter for the supplied Convai Web MHA contract.
 *
 * Render order is deliberately explicit:
 * `beginFrame()` -> evaluate base animation -> `updateFromConvaiQueue()` -> render.
 */
export class ConvaiMhaLipsync {
  public readonly diagnostics: ConvaiMhaLipsyncDiagnostics;

  private readonly preset: LipsyncPreset;
  private readonly fadeOutSeconds: number;
  private readonly targets = new Map<string, MorphTargetRef[]>();
  private readonly target = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly shapeScratch = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly rawScratch = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly current = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly applied = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly interpolated = new Float32Array(MHA_CHANNEL_COUNT);
  private readonly unityRoutes: Map<string, MappingRoute> | null;

  private accumulatorSeconds = 0;
  private fadeAlpha = 0;
  private hasTarget = false;
  private hasLiveContribution = false;
  /** Whether the queue's current head has already been presented once. */
  private queueHeadPresented = false;
  /**
   * A queue can retain frames while omitting both bot-speaking and end signals.
   * Once the manager authorizes post-turn disposal, `active` stays true while
   * this proof matures so turn completion cannot reset the adapter early.
   */
  private missingEndSignalDroughtSeconds = 0;
  private ownsMissingEndSignalTail = false;
  private authoritativeReleaseStarted = false;

  constructor({
    scene,
    presetName = 'webStudioVerified',
    fadeOutSeconds,
  }: ConvaiMhaLipsyncOptions) {
    if (!scene || typeof scene.traverse !== 'function') {
      throw new Error('ConvaiMhaLipsync requires a Three.js-compatible scene.traverse(callback).');
    }

    const preset = setup.presets[presetName];
    if (!preset) throw new Error(`Unknown Convai MHA lip-sync preset: ${presetName}`);
    if (preset.interpolation.enabled && preset.interpolation.method !== 'linear' && presetName === 'webStudioVerified') {
      throw new Error('webStudioVerified requires linear interpolation.');
    }
    this.preset = preset;
    this.fadeOutSeconds = Number.isFinite(fadeOutSeconds)
      ? Math.max(0, fadeOutSeconds ?? preset.starvation.fadeOutSeconds)
      : preset.starvation.fadeOutSeconds;
    this.unityRoutes = preset.mapping.mode === 'mappingFile'
      ? new Map(unityMap.mappings.filter((route) => Boolean(route.enabled)).map((route) => [route.source, route]))
      : null;

    this.diagnostics = {
      presetName,
      fadeOutSeconds: this.fadeOutSeconds,
      fadeAlpha: 0,
      starvationSeconds: 0,
      tuningMode: getLipsyncTuningSnapshot().mode,
      enabled: false,
      wireChannelCount: CONVAI_MHA_CHANNEL_ORDER.length,
      wireOrderSignature: EXPECTED_WIRE_ORDER_FNV1A,
      matchedChannelCount: 0,
      coverage: 0,
      missingChannels: [],
      missingRequiredChannels: [],
      rejectedFrames: 0,
      rejectedValues: 0,
      invalidMorphTargets: 0,
      queueErrors: 0,
      acceptedFrames: 0,
      appliedFrames: 0,
      resets: 0,
      normalizationResets: 0,
      conversationResets: 0,
      missingEndSignalTailDrains: 0,
      endSignalFinalFrameConsumes: 0,
      authoritativeTailReleases: 0,
      lastRejection: null,
    };

    scene.traverse((object) => this.indexMorphObject(object));

    this.diagnostics.missingChannels = CONVAI_MHA_CHANNEL_ORDER.filter((name) => !this.targets.has(name));
    this.diagnostics.missingRequiredChannels = setup.minimumValidation.requiredChannels.filter(
      (name) => !this.targets.has(name),
    );
    this.diagnostics.matchedChannelCount = MHA_CHANNEL_COUNT - this.diagnostics.missingChannels.length;
    this.diagnostics.coverage = this.diagnostics.matchedChannelCount / MHA_CHANNEL_COUNT;
    this.diagnostics.enabled = this.diagnostics.coverage >= setup.minimumValidation.requiredMorphCoverage
      && this.diagnostics.missingRequiredChannels.length === 0;
  }

  public get enabled(): boolean {
    return this.diagnostics.enabled;
  }

  public get active(): boolean {
    return this.enabled && (
      this.ownsMissingEndSignalTail
      || (this.hasTarget && (this.fadeAlpha > 0 || this.hasLiveContribution))
    );
  }

  private indexMorphObject(object: ThreeMorphObjectLike): void {
    const dictionary = object?.morphTargetDictionary;
    const influences = object?.morphTargetInfluences;
    if (!dictionary || !isMutableNumberArray(influences)) return;

    if (setup.runtimeSafety.disableFrustumCullingOnMorphedMeshes) object.frustumCulled = false;

    const claimedIndices = new Set<number>();
    for (const channel of CONVAI_MHA_CHANNEL_ORDER) {
      const index = dictionary[channel];
      if (!Number.isInteger(index) || index < 0 || index >= influences.length || claimedIndices.has(index)) {
        if (index !== undefined) this.diagnostics.invalidMorphTargets += 1;
        continue;
      }
      claimedIndices.add(index);
      const refs = this.targets.get(channel) ?? [];
      refs.push({ object, influences, index, baseValue: 0, hasContribution: false });
      this.targets.set(channel, refs);
    }
  }

  private rejectFrame(reason: string, invalidValueCount = 0): false {
    this.diagnostics.rejectedFrames += 1;
    this.diagnostics.rejectedValues += invalidValueCount;
    this.diagnostics.lastRejection = reason;
    return false;
  }

  private validateFrame(frame: ConvaiMhaFrame | null | undefined, label: string): frame is ConvaiMhaFrame {
    if (!frame || frame.length !== MHA_CHANNEL_COUNT) {
      return this.rejectFrame(`${label}: expected exactly ${MHA_CHANNEL_COUNT} channels`);
    }
    let invalid = 0;
    for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
      if (typeof frame[index] !== 'number' || !Number.isFinite(frame[index])) invalid += 1;
    }
    if (invalid > 0) return this.rejectFrame(`${label}: ${invalid} non-finite channel value(s)`, invalid);
    return true;
  }

  private mappedValue(index: number, rawValue: number): number {
    const channel = CONVAI_MHA_CHANNEL_ORDER[index];
    const source = clamp01(rawValue);
    const mapping = this.preset.mapping;

    if (mapping.mode === 'mappingFile') {
      const route = this.unityRoutes?.get(channel);
      if (!route) return 0;
      let mapped: number;
      if (Boolean(route.useOverrideValue)) {
        mapped = Number(route.overrideValue ?? 0);
      } else {
        const exponent = Number.isFinite(route.curveExponent) ? Math.max(0, route.curveExponent ?? 1) : 1;
        const shaped = Math.pow(source, exponent);
        const ignoreGlobal = Boolean(route.ignoreGlobalModifiers);
        const globalMultiplier = ignoreGlobal ? 1 : unityMap.globalMultiplier;
        const globalOffset = ignoreGlobal ? 0 : unityMap.globalOffset;
        mapped = shaped * (route.multiplier ?? 1) * globalMultiplier
          + (route.offset ?? 0) + globalOffset;
      }
      const min = clamp01(route.clampMinValue ?? 0);
      const max = clamp01(route.clampMaxValue ?? 1);
      return clamp01(Math.max(Math.min(min, max), Math.min(Math.max(min, max), mapped)));
    }

    const tuning = getLipsyncTuningSnapshot();
    this.diagnostics.tuningMode = tuning.mode;
    const isMouth = /mouth|jaw|teeth|tongue/i.test(channel);
    const isEyeLook = /eyeLook/i.test(channel);
    let mapped = source;
    if (channel === mapping.jawOpen.name) {
      mapped = Math.min(tuning.values.jawMax, source * tuning.values.jawGain);
    }
    if (LATERAL_MOUTH_CHANNELS.has(channel)) {
      mapped *= tuning.values.lateralMouthGain;
    }
    if (UPPER_LIP_RAISE_CHANNELS.has(channel)) {
      mapped *= tuning.values.upperLipRaiseGain;
    }
    if (LOWER_LIP_DEPRESS_CHANNELS.has(channel)) {
      mapped *= tuning.values.lowerLipDepressGain;
    }
    return clamp01(
      mapped
      * tuning.values.overallGain
      * (isMouth ? tuning.values.mouthGain : 1)
      * (isEyeLook ? tuning.values.streamedEyeLookGain : 1),
    );
  }

  private acceptValidatedTarget(frame: ConvaiMhaFrame): true {
    const tuning = getLipsyncTuningSnapshot();
    this.diagnostics.tuningMode = tuning.mode;
    let shapedFrame = frame;
    if (!this.unityRoutes && tuning.values.mouthSymmetry > 0) {
      for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
        this.shapeScratch[index] = clamp01(frame[index]);
      }
      if (tuning.values.mouthSymmetry < 1) this.rawScratch.set(this.shapeScratch);
      symmetrizeMhaMouth(this.shapeScratch);
      if (tuning.values.mouthSymmetry < 1) {
        for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
          this.shapeScratch[index] = lerp(
            this.rawScratch[index],
            this.shapeScratch[index],
            tuning.values.mouthSymmetry,
          );
        }
      }
      shapedFrame = this.shapeScratch;
    }
    for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
      this.target[index] = this.mappedValue(index, shapedFrame[index]);
    }
    const upperIndex = CONVAI_MHA_CHANNEL_ORDER.indexOf(CONVAI_MHA_DENTAL_OCCLUSION.upperChannel);
    const lowerIndex = CONVAI_MHA_CHANNEL_ORDER.indexOf(CONVAI_MHA_DENTAL_OCCLUSION.lowerChannel);
    this.target[upperIndex] = Math.max(
      this.target[upperIndex],
      tuning.values.upperTeethTuck,
    );
    this.target[lowerIndex] = Math.max(
      this.target[lowerIndex],
      tuning.values.lowerTeethTuck,
    );
    this.hasTarget = true;
    this.diagnostics.acceptedFrames += 1;
    this.diagnostics.lastRejection = null;
    return true;
  }

  /** Accepts only a complete, finite 251-value MHA frame. */
  public setTargetFrame(frame: ConvaiMhaFrame | null | undefined): boolean {
    if (!this.enabled) {
      this.diagnostics.lastRejection = 'adapter disabled: morph coverage or required-channel gate failed';
      return false;
    }
    if (!this.validateFrame(frame, 'MHA frame')) return false;
    return this.acceptValidatedTarget(frame);
  }

  /**
   * Restore every morph slot to the exact normalized base value captured before
   * the previous Convai layer was added. No subtraction is used, so a value that
   * saturated at 1 restores correctly on the next frame.
   */
  private restorePreviousContribution(): void {
    if (!this.hasLiveContribution) return;
    for (const refs of this.targets.values()) {
      for (const ref of refs) {
        if (!ref.hasContribution) continue;
        ref.influences[ref.index] = ref.baseValue;
        ref.hasContribution = false;
      }
    }
    this.applied.fill(0);
    this.hasLiveContribution = false;
  }

  /** Call first in every render frame, before evaluating base face/body animation. */
  public beginFrame(): void {
    this.restorePreviousContribution();
  }

  /** Apply the current smoothed target after base animation has evaluated. */
  public update(deltaSeconds: number, hasFreshFrame: boolean): boolean {
    if (!this.enabled || !this.hasTarget) return false;

    // Make accidental duplicate update calls non-accumulating as well. The
    // documented beginFrame -> base -> update ordering remains authoritative.
    this.restorePreviousContribution();

    const delta = Math.min(0.25, finiteNonNegative(deltaSeconds));
    const starvation = this.preset.starvation;
    const fadeDuration = hasFreshFrame ? starvation.fadeInSeconds : this.fadeOutSeconds;
    const fadeStep = fadeDuration > 0 ? delta / fadeDuration : 1;
    this.fadeAlpha = clamp01(this.fadeAlpha + (hasFreshFrame ? fadeStep : -fadeStep));
    this.diagnostics.fadeAlpha = this.fadeAlpha;
    this.diagnostics.starvationSeconds = hasFreshFrame
      ? 0
      : this.diagnostics.starvationSeconds + delta;

    const smoothing = this.preset.smoothing;
    const tuning = getLipsyncTuningSnapshot();
    this.diagnostics.tuningMode = tuning.mode;
    let smoothingAlpha = 1;
    if (smoothing.enabled && tuning.values.smoothing > 0) {
      const decay = this.unityRoutes
        ? (Number.isFinite(smoothing.factor)
          ? clamp01(smoothing.factor ?? 0)
          : clamp01(1 - (smoothing.speed ?? 1)))
        : clamp01(1 - tuning.values.smoothing);
      const referenceFrames = delta * Math.max(1, smoothing.referenceFps || 60);
      smoothingAlpha = clamp01(1 - Math.pow(decay, referenceFrames));
    }

    let wroteContribution = false;
    for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
      this.current[index] = clamp01(lerp(this.current[index], this.target[index], smoothingAlpha));
      const contribution = clamp01(this.current[index] * this.fadeAlpha);
      this.applied[index] = contribution;

      const refs = this.targets.get(CONVAI_MHA_CHANNEL_ORDER[index]);
      if (!refs) continue;
      const channel = CONVAI_MHA_CHANNEL_ORDER[index];
      const oralChannel = !this.unityRoutes && ORAL_CHANNELS.has(channel);
      for (const ref of refs) {
        const rawBase = ref.influences[ref.index];
        if (!Number.isFinite(rawBase)) this.diagnostics.rejectedValues += 1;
        const base = clamp01(rawBase);
        // Both supplied presets are additive. At a zero fade envelope there is
        // no layer to restore, so do not pin active state with no-op writes.
        const suppressingOralBase = oralChannel
          && this.fadeAlpha > 0
          && tuning.values.mouthBaseAdditive < 1;
        if (this.preset.application.mode === 'add' && contribution === 0 && !suppressingOralBase) continue;
        ref.baseValue = base;
        ref.hasContribution = true;
        wroteContribution = true;
        if (this.preset.application.mode === 'add') {
          const additive = clamp01(base + contribution);
          if (oralChannel) {
            // Live speech owns the whole oral region, not just whichever
            // channel happened to be non-zero. Fade the authored/procedural
            // mouth out and back with the live envelope; Pure keeps the fully
            // additive reference behavior through mouthBaseAdditive=1.
            const nonStacking = clamp01(base * (1 - this.fadeAlpha) + contribution);
            ref.influences[ref.index] = clamp01(lerp(
              nonStacking,
              additive,
              tuning.values.mouthBaseAdditive,
            ));
          } else {
            ref.influences[ref.index] = additive;
          }
        } else {
          ref.influences[ref.index] = contribution;
        }
      }
    }

    this.hasLiveContribution = wroteContribution;
    this.diagnostics.appliedFrames += 1;
    return this.active;
  }

  private queueCall<T>(operation: (() => T) | undefined, fallback: T): T {
    if (typeof operation !== 'function') return fallback;
    try {
      return operation();
    } catch {
      this.diagnostics.queueErrors += 1;
      return fallback;
    }
  }

  private queueLength(queue: ConvaiBlendshapeQueueLike): number {
    const fromMethod = this.queueCall(queue.getLength?.bind(queue), Number.NaN);
    if (Number.isFinite(fromMethod)) return Math.max(0, Math.floor(fromMethod));
    try {
      return Number.isFinite(queue.length) ? Math.max(0, Math.floor(queue.length ?? 0)) : 0;
    } catch {
      this.diagnostics.queueErrors += 1;
      return 0;
    }
  }

  private queueHasFrames(queue: ConvaiBlendshapeQueueLike): boolean {
    if (typeof queue.hasFrames === 'function') return Boolean(this.queueCall(queue.hasFrames.bind(queue), false));
    return this.queueLength(queue) > 0;
  }

  /**
   * Convai exposes turn stats before its later bot-stopped-speaking event. The
   * final buffered frame is safe to release early only when public expected-
   * frame accounting proves that no late facial chunk is still outstanding.
   */
  private queueHasCompleteExpectedTail(queue: ConvaiBlendshapeQueueLike): boolean {
    if (typeof queue.getTurnStats !== 'function' || typeof queue.getFramesConsumed !== 'function') {
      return false;
    }
    const stats = this.queueCall(queue.getTurnStats.bind(queue), null);
    const expected = Number(stats?.total_blendshapes);
    const consumed = Number(this.queueCall(queue.getFramesConsumed.bind(queue), Number.NaN));
    return Number.isFinite(expected)
      && expected > 0
      && Number.isFinite(consumed)
      && consumed >= 0
      && consumed + this.queueLength(queue) >= expected;
  }

  private queueFrame(queue: ConvaiBlendshapeQueueLike, index: number): ConvaiMhaFrame | null {
    const primary = this.queueCall<ConvaiMhaFrame | null | undefined>(
      queue.getFrameWithAlpha?.bind(queue, index),
      null,
    );
    if (primary) return primary;
    return this.queueCall<ConvaiMhaFrame | null | undefined>(queue.getFrame?.bind(queue, index), null) ?? null;
  }

  private interpolateFrames(
    frameA: ConvaiMhaFrame,
    frameB: ConvaiMhaFrame | null,
    alpha: number,
  ): ConvaiMhaFrame {
    if (!this.preset.interpolation.enabled || !frameB) return frameA;
    const t = clamp01(alpha);
    for (let index = 0; index < MHA_CHANNEL_COUNT; index += 1) {
      this.interpolated[index] = clamp01(lerp(frameA[index], frameB[index], t));
    }
    return this.interpolated;
  }

  /** Consume, interpolate, smooth, fade, and add the current Convai queue frame. */
  public updateFromConvaiQueue(
    queue: ConvaiBlendshapeQueueLike | null | undefined,
    deltaSeconds: number,
    options: ConvaiMhaQueueUpdateOptions = {},
  ): boolean {
    if (!queue || !this.enabled) return false;

    const normalizationReceived = (
      setup.runtimeSafety.resetOnNormalizationSignal
      && Boolean(this.queueCall(queue.consumeNormalizationSignal?.bind(queue), false))
    );
    if (normalizationReceived) {
      this.reset();
      this.diagnostics.normalizationResets += 1;
      const botStillSpeaking = Boolean(this.queueCall(queue.isBotSpeaking?.bind(queue), false));
      const receivedEndSignal = Boolean(this.queueCall(queue.hasReceivedEndSignal?.bind(queue), false));
      if (
        !botStillSpeaking
        && receivedEndSignal
        && this.queueHasFrames(queue)
        && typeof queue.consumeFrames === 'function'
      ) {
        // Normalization is an authoritative neutral boundary. Any frames left
        // behind after the ended signal belong to the completed utterance and
        // must not be accepted again later in this same render update.
        this.queueCall(queue.consumeFrames.bind(queue, Math.max(1, this.queueLength(queue))), undefined);
      }
      return false;
    }

    const delta = Math.min(0.25, finiteNonNegative(deltaSeconds));
    const botSpeaking = Boolean(this.queueCall(queue.isBotSpeaking?.bind(queue), false));
    const receivedEndSignal = Boolean(this.queueCall(queue.hasReceivedEndSignal?.bind(queue), false));
    let freshSample = false;
    let hasPlayableSample = false;
    let playbackAdvanced = false;

    if (options.releaseHeldPose) {
      if (!this.authoritativeReleaseStarted) {
        this.authoritativeReleaseStarted = true;
        if (this.queueHasFrames(queue) && typeof queue.consumeFrames === 'function') {
          this.queueCall(queue.consumeFrames.bind(queue, Math.max(1, this.queueLength(queue))), undefined);
        }
        // The app has stronger completion evidence than a stale SDK
        // bot-speaking flag: speaking ended and fresh facial frames stopped.
        // Clear the transport tail but preserve our current target so update()
        // can ease it to neutral instead of snapping.
        this.queueCall(queue.reset?.bind(queue), undefined);
        this.queueHeadPresented = false;
        this.ownsMissingEndSignalTail = false;
        this.missingEndSignalDroughtSeconds = 0;
        this.diagnostics.authoritativeTailReleases += 1;
      }
      this.update(delta, false);
      return false;
    }
    this.authoritativeReleaseStarted = false;

    const hasQueuedFrames = this.queueHasFrames(queue);
    const missingEndSignalTail = (
      !botSpeaking
      && !receivedEndSignal
      && hasQueuedFrames
    );
    if (missingEndSignalTail) {
      // Observe the drought even before authorization so a turn-end signal
      // arriving after an already-long quiet gap can resolve the stale tail in
      // that same render. Observation alone never mutates the queue.
      this.missingEndSignalDroughtSeconds += delta;
      this.ownsMissingEndSignalTail = Boolean(options.allowMissingEndSignalDrain);
      if (
        options.allowMissingEndSignalDrain
        && this.missingEndSignalDroughtSeconds >= MISSING_END_SIGNAL_DROUGHT_SECONDS
      ) {
        const queuedFrameCount = Math.max(1, this.queueLength(queue));
        if (typeof queue.consumeFrames === 'function') {
          this.queueCall(queue.consumeFrames.bind(queue, queuedFrameCount), undefined);
        }
        if (this.queueHasFrames(queue) && typeof queue.reset === 'function') {
          // Defensive fallback for an SDK queue whose consumer rejected the
          // bulk count. The same 1.5 s proof makes the remaining tail stale.
          this.queueCall(queue.reset.bind(queue), undefined);
        }
        if (!this.queueHasFrames(queue)) {
          this.diagnostics.missingEndSignalTailDrains += 1;
          this.ownsMissingEndSignalTail = false;
          this.missingEndSignalDroughtSeconds = 0;
          this.queueHeadPresented = false;
        }
      }
    } else {
      // Speech resumed, an authoritative end signal arrived, or the queue
      // emptied. Any of these disproves the missing-signal stale-tail case.
      this.ownsMissingEndSignalTail = false;
      this.missingEndSignalDroughtSeconds = 0;
    }

    // The SDK can stop botSpeaking before the buffered facial tail is empty.
    // Once its public end signal is exposed, continuing to consume that tail is
    // safe and required for isConversationEnded() to ever become true.
    if ((botSpeaking || receivedEndSignal) && this.queueHasFrames(queue)) {
      const reportedFps = Number(this.queueCall(queue.getPlaybackFps?.bind(queue), 0));
      const fps = Number.isFinite(reportedFps) && reportedFps > 0
        ? reportedFps
        : setup.transport.outputFps;
      const frameDuration = 1 / Math.max(1, fps);
      const timeOffset = finiteNonNegative(this.preset.timing.timeOffsetSeconds);
      this.accumulatorSeconds += delta;

      let consumed = 0;
      const maxConsume = Math.max(1, Math.floor(this.preset.timing.maxFramesConsumedPerRender ?? 8));
      while (
        this.accumulatorSeconds + timeOffset >= frameDuration
        && this.queueLength(queue) > 1
        && consumed < maxConsume
      ) {
        if (typeof queue.consumeFrames !== 'function') break;
        this.queueCall(queue.consumeFrames.bind(queue, 1), undefined);
        this.accumulatorSeconds -= frameDuration;
        consumed += 1;
        this.queueHeadPresented = false;
      }

      // Present the final tail frame for at least one render tick, then consume
      // it on the next due tick. Turn stats can precede bot-stopped-speaking by
      // trailing audio/event silence. If the SDK's expected-frame accounting
      // proves the full facial stream is already here, do not freeze its final
      // 0.1-alpha MHA frame while waiting for that later speaking flag.
      const completeExpectedTail = this.queueHasCompleteExpectedTail(queue);
      if (
        receivedEndSignal
        && (!botSpeaking || completeExpectedTail)
        && consumed === 0
        && this.queueHeadPresented
        && this.queueLength(queue) === 1
        && this.accumulatorSeconds + timeOffset >= frameDuration
        && typeof queue.consumeFrames === 'function'
      ) {
        this.queueCall(queue.consumeFrames.bind(queue, 1), undefined);
        this.accumulatorSeconds -= frameDuration;
        consumed += 1;
        this.queueHeadPresented = false;
        if (botSpeaking && completeExpectedTail) {
          this.diagnostics.endSignalFinalFrameConsumes += 1;
        }
      }

      const hasFrameAfterConsumption = this.queueHasFrames(queue);
      const frameA = hasFrameAfterConsumption ? this.queueFrame(queue, 0) : null;
      if (hasFrameAfterConsumption && this.validateFrame(frameA, 'Convai queue frame 0')) {
        const candidateB = this.queueFrame(queue, 1);
        const frameB = candidateB
          ? (this.validateFrame(candidateB, 'Convai queue frame 1') ? candidateB : null)
          : null;
        const phase = clamp01((this.accumulatorSeconds + timeOffset) / frameDuration);
        const interpolated = this.interpolateFrames(frameA, frameB, phase);
        hasPlayableSample = this.acceptValidatedTarget(interpolated);
        // `fresh` is a manager/diagnostic signal, not the starvation hold flag:
        // report the initial head once and subsequent heads only when consumed.
        freshSample = consumed > 0 || !this.queueHeadPresented;
        // A second queued frame means interpolation is still advancing even on
        // a render tick that did not consume a head. A lone, already-presented
        // head is different: it is an unchanged starvation sample. Preserve it
        // in the SDK queue in case a late chunk follows, but let the facial
        // envelope release instead of pinning the final mouth shape until the
        // SDK's often-late bot-stopped event.
        playbackAdvanced = freshSample || frameB !== null;
        this.queueHeadPresented = true;
      } else if (
        hasFrameAfterConsumption
        && receivedEndSignal
        && typeof queue.consumeFrames === 'function'
      ) {
        // A malformed/unreadable final frame must remain visually rejected,
        // but it cannot be allowed to pin the SDK's conversation-ended state.
        // Once the SDK exposes its end signal there is no future valid use for
        // this head, so drop exactly one and let the next render validate any
        // remaining tail frame independently.
        this.queueCall(queue.consumeFrames.bind(queue, 1), undefined);
        this.queueHeadPresented = false;
      }
    }

    this.update(delta, hasPlayableSample && playbackAdvanced);

    const conversationEnded = Boolean(this.queueCall(queue.isConversationEnded?.bind(queue), false));
    const resetAtAlpha = this.preset.starvation.resetAtAlpha ?? 0.001;
    if (
      setup.runtimeSafety.resetWhenConversationEnds
      && conversationEnded
      && this.fadeAlpha <= resetAtAlpha
    ) {
      this.reset();
      this.diagnostics.conversationResets += 1;
      this.queueCall(queue.reset?.bind(queue), undefined);
    }

    return freshSample;
  }

  /** Restore the base face exactly, clear timing/smoothing state, and go neutral. */
  public reset(): void {
    this.restorePreviousContribution();
    this.target.fill(0);
    this.current.fill(0);
    this.applied.fill(0);
    this.interpolated.fill(0);
    this.accumulatorSeconds = 0;
    this.fadeAlpha = 0;
    this.diagnostics.fadeAlpha = 0;
    this.diagnostics.starvationSeconds = 0;
    this.hasTarget = false;
    this.hasLiveContribution = false;
    this.queueHeadPresented = false;
    this.missingEndSignalDroughtSeconds = 0;
    this.ownsMissingEndSignalTail = false;
    this.authoritativeReleaseStarted = false;
    this.diagnostics.resets += 1;
  }
}

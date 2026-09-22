import lightingSetupJson from '../docs/character-models/chess-avatars-v2/lighting-setup.json';

type Vec3 = readonly [number, number, number];

type DirectionalLightExport = {
  name: 'key' | 'rim';
  type: 'DirectionalLight';
  position: Vec3;
  color: string;
  intensity: number;
  castShadow?: boolean;
  shadowBias?: number;
};

type PointLightExport = {
  name: 'catchlight';
  type: 'PointLight';
  position: Vec3;
  color: string;
  intensity: number;
  distance: number;
};

type AmbientLightExport = {
  name: 'ambient';
  type: 'AmbientLight';
  color: string;
  intensity: number;
};

export type CharacterLightExport =
  | DirectionalLightExport
  | PointLightExport
  | AmbientLightExport;

export type CharacterLook = {
  renderer: {
    toneMapping: 'ACESFilmic';
    toneMappingExposure: number;
    outputColorSpace: 'sRGB';
    shadows: boolean;
  };
  environment: {
    preset: 'studio';
    intensity: number;
    blur: number;
    showAsBackground: false;
  };
  whiteBalance: { temperatureKelvin: number; appliedColor: string };
  rigRotationDegrees: number;
  lights: CharacterLightExport[];
  camera: { fov: number; position: Vec3; lookAt: Vec3 };
  postProcessing: {
    enabled: boolean;
    ambientOcclusion: {
      effect: 'N8AO'; enabled: boolean; aoRadius: number; intensity: number; halfRes: boolean;
    };
    bloom: { intensity: number; luminanceThreshold: number };
    vignette: { offset: number; darkness: number };
  };
  colorGrade: { brightness: number; contrast: number; saturation: number };
  skinShading: { technique: string; strength: number; WARNING: string };
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Chess Avatars V2 lighting setup: ${message}`);
}

function validateLook(input: unknown): CharacterLook {
  invariant(input && typeof input === 'object', 'root must be an object');
  const value = input as CharacterLook;
  invariant(value.renderer?.toneMapping === 'ACESFilmic', 'renderer must use ACESFilmic');
  invariant(value.renderer?.outputColorSpace === 'sRGB', 'renderer must use sRGB output');
  invariant(value.environment?.showAsBackground === false, 'environment background must stay hidden');
  invariant(value.environment?.intensity === 0.25, 'environment intensity must be the exact exported 0.25');
  invariant(value.lights?.length === 4, 'the four-light rig is required');
  invariant(value.camera?.position?.length === 3 && value.camera?.lookAt?.length === 3, 'camera vectors must have three components');
  invariant(value.postProcessing?.ambientOcclusion?.effect === 'N8AO', 'ambient occlusion must use N8AO');
  invariant(value.skinShading?.strength === 1.3, 'skin strength must be the exact exported 1.3');
  return value;
}

/** Exact 2026-08-14 Web Studio export. Do not duplicate its numbers in components. */
export const CHARACTER_LOOK = validateLook(lightingSetupJson);

const CHARACTER_ASSET_BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** Guide-only details that are intentionally absent from the numeric export. */
export const CHARACTER_LOOK_TECHNIQUE = Object.freeze({
  environmentUrl: `${CHARACTER_ASSET_BASE}character-assets/chess-avatars-v2/potsdamer_platz_1k.hdr`,
  maxDevicePixelRatio: 2,
  // A DPR-1 backing buffer still leaves high-contrast hair cards on single
  // pixel boundaries. Modest desktop-only supersampling provides real spatial
  // samples; the adaptive path can return it to native DPR after effects/MSAA.
  preferredDesktopDevicePixelRatio: 1.5,
  // The supplied guide keeps SMAA as the final post effect. Live moving hair
  // also needs multisample coverage so alpha-tested strands do not shimmer;
  // use a modest 4x target. Automatic adaptation keeps the composer stable
  // (AO/shadows are reduced first) so it cannot introduce a shader-compilation
  // hitch; 2x remains the hardware fallback and explicit developer option.
  preferredMsaaSamples: 4,
  balancedMsaaSamples: 2,
  minimumEffectiveDevicePixelRatio: 1,
  // The exported 127% contrast is retained as source metadata. Applying that
  // number as a late CSS transfer clips dark hair/cloth texels below ~28/255
  // to zero, unlike the artist reference. Keep the cheap GPU-composited grade
  // but use a shadow-safe late contrast so authored PBR detail survives.
  appliedCssContrastPercent: 100,
  colorGradeTransfer: 'shadow-preserving-css' as const,
  adaptiveRenderScaleStep: 0.25,
  shadowMap: 'PCFSoftShadowMap' as const,
  n8aoDistanceFalloff: 1,
  n8aoQuality: 'medium' as const,
  bloomMipmapBlur: true,
  smaa: true,
  skinLutSize: 64,
  skinTransmittanceColor: '#ff4d33',
  skinTransmittanceWeight: 0.25,
});

/** Resolve a real MSAA count (one sample is equivalent to no MSAA). */
export function resolvePortraitMsaaSamples(maxSamples: number, balanced: boolean): number {
  const available = Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 0;
  const requested = balanced
    ? CHARACTER_LOOK_TECHNIQUE.balancedMsaaSamples
    : CHARACTER_LOOK_TECHNIQUE.preferredMsaaSamples;
  if (available >= requested) return requested;
  return available >= CHARACTER_LOOK_TECHNIQUE.balancedMsaaSamples
    ? CHARACTER_LOOK_TECHNIQUE.balancedMsaaSamples
    : 0;
}

export type PortraitComposerCapabilities = {
  generalMaximum: number;
  depth24Maximum: number;
  halfFloatMaximum: number;
  rgba8Maximum: number;
};

export function resolvePortraitComposerCapabilities(
  capabilities: PortraitComposerCapabilities,
  balanced: boolean,
): { label: 'half-float' | 'unsigned-byte'; multisampling: number; supportedSamples: number } {
  const finiteMaximum = (value: number) => (
    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  );
  const general = finiteMaximum(capabilities.generalMaximum);
  const depth24 = finiteMaximum(capabilities.depth24Maximum);
  const halfFloat = Math.min(
    general,
    depth24,
    finiteMaximum(capabilities.halfFloatMaximum),
  );
  const halfFloatSamples = resolvePortraitMsaaSamples(halfFloat, balanced);
  if (halfFloatSamples > 0) {
    return {
      label: 'half-float',
      multisampling: halfFloatSamples,
      supportedSamples: halfFloat,
    };
  }
  const rgba8 = Math.min(general, depth24, finiteMaximum(capabilities.rgba8Maximum));
  return {
    label: 'unsigned-byte',
    multisampling: resolvePortraitMsaaSamples(rgba8, balanced),
    supportedSamples: rgba8,
  };
}

/** Preserve the requested buffer density; mobile retains its tier's full DPR. */
export function minimumPortraitRenderScale(
  baseDevicePixelRatio: number,
  minimumDevicePixelRatio: number = CHARACTER_LOOK_TECHNIQUE.minimumEffectiveDevicePixelRatio,
): number {
  const base = Number.isFinite(baseDevicePixelRatio) && baseDevicePixelRatio > 0
    ? baseDevicePixelRatio
    : 1;
  const minimum = Number.isFinite(minimumDevicePixelRatio) && minimumDevicePixelRatio > 0
    ? minimumDevicePixelRatio
    : CHARACTER_LOOK_TECHNIQUE.minimumEffectiveDevicePixelRatio;
  return minimum / base;
}

export function preferredDesktopPortraitDevicePixelRatio(devicePixelRatio: number): number {
  const safeRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return Math.min(
    CHARACTER_LOOK_TECHNIQUE.maxDevicePixelRatio,
    Math.max(CHARACTER_LOOK_TECHNIQUE.preferredDesktopDevicePixelRatio, safeRatio),
  );
}

export function clampPortraitRenderScale(scale: number, minimumScale: number): number {
  const safeMinimum = Number.isFinite(minimumScale) && minimumScale > 0 ? minimumScale : 1;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(safeMinimum, Math.min(1, safeScale));
}

export function nextPortraitPerformanceState(
  scale: number,
  balanced: boolean,
  minimumScale: number,
): { scale: number; balanced: boolean } {
  const normalizedScale = clampPortraitRenderScale(scale, minimumScale);
  if (!balanced) return { scale: normalizedScale, balanced: true };
  return {
    scale: clampPortraitRenderScale(
      normalizedScale - CHARACTER_LOOK_TECHNIQUE.adaptiveRenderScaleStep,
      minimumScale,
    ),
    balanced: true,
  };
}

export function portraitPerformanceBounds(refreshRate: number): [number, number] {
  const refresh = Number.isFinite(refreshRate) && refreshRate > 0 ? refreshRate : 60;
  // Drei reports the highest observed render rate, not the panel's physical
  // refresh rate. Keep an absolute quality floor so a GPU-bound 30 FPS portrait
  // is treated as a decline instead of being misclassified as healthy for a
  // supposed 30 Hz display.
  const lower = Math.max(40, Math.min(45, refresh * 0.7));
  const upper = Math.max(50, Math.min(60, refresh * 0.9));
  return [lower, upper];
}

export function getCharacterLight(name: CharacterLightExport['name']): CharacterLightExport {
  const light = CHARACTER_LOOK.lights.find((candidate) => candidate.name === name);
  invariant(light, `missing ${name} light`);
  return light;
}

export function characterColorGradeFilter(
  contrastPercent: number = CHARACTER_LOOK_TECHNIQUE.appliedCssContrastPercent,
): string {
  const contrast = Number.isFinite(contrastPercent)
    ? Math.max(50, Math.min(150, contrastPercent))
    : CHARACTER_LOOK_TECHNIQUE.appliedCssContrastPercent;
  return [
  `brightness(${CHARACTER_LOOK.colorGrade.brightness}%)`,
  `contrast(${contrast}%)`,
  `saturate(${CHARACTER_LOOK.colorGrade.saturation}%)`,
  ].join(' ');
}

export const CHARACTER_COLOR_GRADE_FILTER = characterColorGradeFilter();

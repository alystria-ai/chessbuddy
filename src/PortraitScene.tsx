import { Environment } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import { Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactElement, type ReactNode } from 'react';
import type { EffectComposer as PostprocessingEffectComposer } from 'postprocessing';
import * as THREE from 'three';
import {
  CHARACTER_LOOK,
  CHARACTER_LOOK_TECHNIQUE,
  getCharacterLight,
  resolvePortraitComposerCapabilities,
} from './characterLook';
import { logPortraitEnvironment, warnPortraitEnvironmentMissing } from './portraitDebug';
import {
  resolvePortraitAoQualityForRenderer,
  resolveRequestedMsaaSamples,
  resolveSmaaPreset,
} from './portraitQualityTuning';
import { PortraitN8AO, PortraitToneMapping } from './PortraitPostEffects';

type Props = {
  bgColor: string;
  enablePostProcessing?: boolean;
  enableEnvironment?: boolean;
  balancedRendering?: boolean;
  aoQualityLevel?: number;
  aoIntensity?: number;
  aoRadius?: number;
  msaaQualityLevel?: number;
  smaaQualityLevel?: number;
  toneMappingEnabled?: boolean;
  toneMappingExposure?: number;
  lightIntensityScale?: number;
  shadowQualityLevel?: number;
  studioBackdropStrength?: number;
  environmentIntensity?: number;
  /** Skip studio fill, bloom and vignette so the page shows through the canvas. */
  pageCutout?: boolean;
  children: ReactNode;
};

type PortraitComposerTarget = {
  frameBufferType: THREE.TextureDataType;
  label: 'half-float' | 'unsigned-byte';
  multisampling: number;
  supportedSamples: number;
  halfFloatRenderable: boolean;
};

type PortraitPostChainProps = {
  pageCutout?: boolean;
  multisampling: number;
  frameBufferType: THREE.TextureDataType;
  aoQuality: NonNullable<ReturnType<typeof resolvePortraitAoQualityForRenderer>> | null;
  aoRadius: number;
  aoIntensity: number;
  aoDistanceFalloff: number;
  halfRes: boolean;
  aoEnabledRef: MutableRefObject<boolean>;
  smaaPreset: 0 | 1 | 2 | 3;
  toneMappingEnabled: boolean;
};

function DisposableEffectComposer({
  multisampling,
  frameBufferType,
  children,
}: {
  multisampling: number;
  frameBufferType: THREE.TextureDataType;
  children: ReactElement | ReactElement[];
}) {
  const activeComposer = useRef<PostprocessingEffectComposer | null>(null);
  const captureComposer = useCallback((next: PostprocessingEffectComposer | null) => {
    if (activeComposer.current && activeComposer.current !== next) {
      activeComposer.current.dispose();
    }
    activeComposer.current = next;
  }, []);

  useEffect(() => () => {
    activeComposer.current?.dispose();
    activeComposer.current = null;
  }, []);

  return (
    <EffectComposer
      ref={captureComposer}
      multisampling={multisampling}
      frameBufferType={frameBufferType}
      renderPriority={3}
    >
      {children}
    </EffectComposer>
  );
}

/**
 * Isolate the composer from chat/typewriter renders. The React wrapper builds
 * EffectPass objects from child identity; keeping this subtree stable prevents
 * ordinary UI updates from allocating replacement fullscreen passes.
 */
const PortraitPostChain = memo(function PortraitPostChain({
  multisampling,
  frameBufferType,
  aoQuality,
  aoRadius,
  aoIntensity,
  aoDistanceFalloff,
  halfRes,
  aoEnabledRef,
  smaaPreset,
  toneMappingEnabled,
  pageCutout = false,
}: PortraitPostChainProps) {
  const bloom = CHARACTER_LOOK.postProcessing.bloom;
  const vignette = CHARACTER_LOOK.postProcessing.vignette;
  return (
    <DisposableEffectComposer
      key={`${frameBufferType}:${multisampling}`}
      multisampling={multisampling}
      frameBufferType={frameBufferType}
    >
      {aoQuality ? (
        <PortraitN8AO
          quality={aoQuality}
          aoRadius={aoRadius}
          intensity={aoIntensity}
          distanceFalloff={aoDistanceFalloff}
          halfRes={halfRes}
          enabledRef={aoEnabledRef}
        />
      ) : <></>}
      {pageCutout ? <></> : (
        <Bloom
          intensity={bloom.intensity}
          luminanceThreshold={bloom.luminanceThreshold}
          mipmapBlur={CHARACTER_LOOK_TECHNIQUE.bloomMipmapBlur}
        />
      )}
      {pageCutout ? <></> : (
        <Vignette eskil={false} offset={vignette.offset} darkness={vignette.darkness} />
      )}
      <SMAA preset={smaaPreset} />
      {toneMappingEnabled ? <PortraitToneMapping /> : <></>}
    </DisposableEffectComposer>
  );
});

function internalFormatSampleMaximum(
  context: WebGLRenderingContext | WebGL2RenderingContext,
  internalFormat: number,
): number {
  const gl2 = context as WebGL2RenderingContext;
  if (typeof gl2.getInternalformatParameter !== 'function') return 0;
  try {
    const result = gl2.getInternalformatParameter(gl2.RENDERBUFFER, internalFormat, gl2.SAMPLES);
    const values = Array.from(result as ArrayLike<number>);
    return values.length ? Math.max(0, ...values.filter(Number.isFinite)) : 0;
  } catch {
    return 0;
  }
}

function resolvePortraitComposerTarget(
  renderer: THREE.WebGLRenderer,
): PortraitComposerTarget {
  const context = renderer.getContext();
  const generalMaximum = Math.max(0, renderer.capabilities.maxSamples ?? 0);
  const gl2 = context as WebGL2RenderingContext;
  const halfFloatRenderable = Boolean(context.getExtension('EXT_color_buffer_float'));
  if (typeof gl2.getInternalformatParameter !== 'function') {
    return {
      frameBufferType: THREE.UnsignedByteType,
      label: 'unsigned-byte',
      multisampling: 0,
      supportedSamples: 0,
      halfFloatRenderable,
    };
  }

  const halfFloatMaximum = halfFloatRenderable
    ? internalFormatSampleMaximum(context, gl2.RGBA16F)
    : 0;
  // Three r160 allocates DEPTH_COMPONENT24 for this WebGL2 composer target.
  // Intersect with that exact attachment rather than a generic depth maximum.
  const depth24Maximum = internalFormatSampleMaximum(context, gl2.DEPTH_COMPONENT24);
  const resolved = resolvePortraitComposerCapabilities({
    generalMaximum,
    depth24Maximum,
    halfFloatMaximum,
    rgba8Maximum: internalFormatSampleMaximum(context, gl2.RGBA8),
  }, false);
  // Some mobile WebGL2 implementations expose MSAA only for RGBA8. Prefer a
  // complete byte target with real coverage over a black/incomplete RGBA16F
  // target; keep the half-float path wherever its exact attachments support it.
  return {
    frameBufferType: resolved.label === 'half-float'
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType,
    ...resolved,
    halfFloatRenderable,
  };
}

/** Character writes finish at priorities 0-2; rendering is always priority 3. */
function ManualRenderPass() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 3);
  return null;
}

function whiteBalancedColor(color: string): THREE.Color {
  return new THREE.Color(color).multiply(new THREE.Color(CHARACTER_LOOK.whiteBalance.appliedColor));
}

function CharacterLightRig({
  shadowQualityLevel,
  intensityScale,
}: {
  shadowQualityLevel: number;
  intensityScale: number;
}) {
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const key = getCharacterLight('key');
  const rim = getCharacterLight('rim');
  const catchlight = getCharacterLight('catchlight');
  const ambient = getCharacterLight('ambient');
  if (key.type !== 'DirectionalLight'
    || rim.type !== 'DirectionalLight'
    || catchlight.type !== 'PointLight'
    || ambient.type !== 'AmbientLight') {
    throw new Error('Chess Avatars V2 light types do not match the exported rig');
  }
  const shadowMapSize = shadowQualityLevel >= 2 ? 2048 : 1024;
  const castKeyShadow = key.castShadow && shadowQualityLevel >= 1;

  useEffect(() => {
    const shadow = keyLightRef.current?.shadow;
    if (!shadow) return undefined;
    // Three does not resize an existing shadow target when mapSize changes.
    // Dispose the target, not the light, so developer toggles cannot leak a
    // 1024/2048 framebuffer or keep rendering at the previous resolution.
    shadow.map?.dispose();
    shadow.map = null;
    shadow.mapPass?.dispose();
    shadow.mapPass = null;
    shadow.needsUpdate = true;
    return undefined;
  }, [shadowMapSize, castKeyShadow]);

  useEffect(() => () => keyLightRef.current?.shadow.dispose(), []);

  return (
    <>
      <ambientLight color={whiteBalancedColor(ambient.color)} intensity={ambient.intensity * intensityScale} />
      <directionalLight
        ref={keyLightRef}
        position={key.position}
        color={whiteBalancedColor(key.color)}
        intensity={key.intensity * intensityScale}
        castShadow={castKeyShadow}
        shadow-bias={key.shadowBias}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
        shadow-camera-left={-2.5}
        shadow-camera-right={2.5}
        shadow-camera-top={3}
        shadow-camera-bottom={-0.5}
      />
      <directionalLight
        position={rim.position}
        color={whiteBalancedColor(rim.color)}
        intensity={rim.intensity * intensityScale}
      />
      <pointLight
        position={catchlight.position}
        color={whiteBalancedColor(catchlight.color)}
        intensity={catchlight.intensity * intensityScale}
        distance={catchlight.distance}
      />
    </>
  );
}

function CharacterEnvironment({ intensity }: { intensity: number }) {
  return (
    <Environment
      files={CHARACTER_LOOK_TECHNIQUE.environmentUrl}
      background={CHARACTER_LOOK.environment.showAsBackground}
      blur={CHARACTER_LOOK.environment.blur}
      environmentIntensity={intensity}
    />
  );
}

function propagateEnvironment(scene: THREE.Scene, intensity: number): void {
  if (!scene.environment) return;
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const pbr = material as THREE.MeshStandardMaterial;
      if (!pbr.isMeshStandardMaterial && !(pbr as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
      // Three r160 does not yet apply Scene.environmentIntensity to every
      // material, so mirror the active exact/dev value onto the material-level
      // control. This also prevents the late HDR load from restoring 0.25 over
      // a live developer A/B value.
      pbr.envMapIntensity = intensity;
    }
  });
}

export default function PortraitScene({
  bgColor,
  enablePostProcessing = true,
  enableEnvironment = true,
  balancedRendering = false,
  aoQualityLevel = 2,
  aoIntensity,
  aoRadius,
  msaaQualityLevel = 2,
  smaaQualityLevel = 3,
  toneMappingEnabled = true,
  toneMappingExposure = CHARACTER_LOOK.renderer.toneMappingExposure,
  lightIntensityScale = 1,
  shadowQualityLevel = 2,
  studioBackdropStrength = 0.65,
  environmentIntensity = CHARACTER_LOOK.environment.intensity,
  pageCutout = false,
  children,
}: Props) {
  const { gl, scene } = useThree();
  const environmentLogged = useRef(false);
  const background = useMemo(() => {
    const strength = THREE.MathUtils.clamp(studioBackdropStrength, 0, 1);
    if (pageCutout || strength <= 0) return null;
    const color = new THREE.Color(bgColor);
    if (typeof document === 'undefined') return color;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return color;
    const center = color.clone().lerp(new THREE.Color('#ffffff'), strength * 0.08);
    const edge = color.clone().lerp(new THREE.Color('#28302d'), strength * 0.42);
    const gradient = context.createRadialGradient(256, 218, 36, 256, 256, 390);
    gradient.addColorStop(0, `#${center.getHexString()}`);
    gradient.addColorStop(0.58, `#${color.getHexString()}`);
    gradient.addColorStop(1, `#${edge.getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'ChessAvatarsV2_StudioBackdrop';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }, [bgColor, studioBackdropStrength, pageCutout]);

  useEffect(() => {
    gl.toneMapping = enablePostProcessing && CHARACTER_LOOK.postProcessing.enabled
      ? THREE.NoToneMapping
      : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = toneMappingExposure;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.shadowMap.enabled = CHARACTER_LOOK.renderer.shadows && shadowQualityLevel >= 1;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
  }, [gl, enablePostProcessing, shadowQualityLevel, toneMappingExposure]);

  useEffect(() => {
    scene.background = background;
    return () => {
      if (background instanceof THREE.Texture) background.dispose();
    };
  }, [background, scene]);

  useEffect(() => {
    environmentLogged.current = false;
    gl.domElement.dataset.portraitEnvironmentReady = String(!enableEnvironment);
    if (!enableEnvironment) {
      logPortraitEnvironment({
        hasEnvironment: false,
        environmentIntensity,
        enablePostProcessing,
        enableEnvironment,
      });
      return;
    }

    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      if (!scene.environment) {
        if (performance.now() - startedAt > 5000 && !environmentLogged.current) {
          environmentLogged.current = true;
          warnPortraitEnvironmentMissing();
        }
        return;
      }
      propagateEnvironment(scene, environmentIntensity);
      gl.domElement.dataset.portraitEnvironmentReady = 'true';
      if (!environmentLogged.current) {
        environmentLogged.current = true;
        logPortraitEnvironment({
          hasEnvironment: true,
          environmentIntensity,
          enablePostProcessing,
          enableEnvironment,
        });
      }
      window.clearInterval(interval);
    }, 100);
    return () => window.clearInterval(interval);
  }, [gl, scene, enablePostProcessing, enableEnvironment, environmentIntensity]);

  const ao = CHARACTER_LOOK.postProcessing.ambientOcclusion;
  const composerTarget = useMemo(
    () => resolvePortraitComposerTarget(gl),
    [gl],
  );
  const requestedMsaa = resolveRequestedMsaaSamples(msaaQualityLevel);
  const multisampling = Math.min(composerTarget.multisampling, requestedMsaa);
  const resolvedAoQuality = resolvePortraitAoQualityForRenderer(
    aoQualityLevel,
    composerTarget.halfFloatRenderable,
  );
  const desiredAoEnabled = Boolean(resolvedAoQuality) && !balancedRendering;
  const aoEnabledRef = useRef(desiredAoEnabled);
  useLayoutEffect(() => {
    aoEnabledRef.current = desiredAoEnabled;
  }, [desiredAoEnabled]);
  const resolvedShadowQuality = balancedRendering
    ? Math.min(1, shadowQualityLevel)
    : shadowQualityLevel;
  const smaaPreset = resolveSmaaPreset(smaaQualityLevel);

  useEffect(() => {
    // Durable browser-QA evidence for the actual render target. Canvas
    // antialias alone is irrelevant once the scene renders through a composer.
    gl.domElement.dataset.portraitAa = multisampling > 0
      ? `msaa-${multisampling}+smaa`
      : 'smaa';
    gl.domElement.dataset.portraitMsaaSamples = String(multisampling);
    gl.domElement.dataset.portraitMsaaSupportedSamples = String(composerTarget.supportedSamples);
    gl.domElement.dataset.portraitFramebufferType = composerTarget.label;
    gl.domElement.dataset.portraitBalancedRendering = String(balancedRendering);
    gl.domElement.dataset.portraitAoQuality = !composerTarget.halfFloatRenderable
      ? 'off-no-half-float'
      : balancedRendering && resolvedAoQuality
        ? 'off-adaptive'
        : (resolvedAoQuality ?? 'off');
    gl.domElement.dataset.portraitAoHalfFloatSupported = String(composerTarget.halfFloatRenderable);
    gl.domElement.dataset.portraitSmaaQuality = String(smaaPreset);
    gl.domElement.dataset.portraitToneMapping = toneMappingEnabled ? 'aces-filmic' : 'off';
    gl.domElement.dataset.portraitToneMappingExposure = toneMappingExposure.toFixed(2);
    gl.domElement.dataset.portraitLightIntensityScale = lightIntensityScale.toFixed(2);
    gl.domElement.dataset.portraitShadowQuality = String(resolvedShadowQuality);
    gl.domElement.dataset.portraitBackdropStrength = studioBackdropStrength.toFixed(2);
    gl.domElement.dataset.portraitEnvironmentIntensity = environmentIntensity.toFixed(2);
  }, [gl, multisampling, composerTarget, balancedRendering, resolvedAoQuality, resolvedShadowQuality, smaaPreset, toneMappingEnabled, toneMappingExposure, lightIntensityScale, studioBackdropStrength, environmentIntensity]);

  return (
    <>
      {enableEnvironment && (
        <Suspense fallback={null}>
          <CharacterEnvironment intensity={environmentIntensity} />
        </Suspense>
      )}
      <CharacterLightRig shadowQualityLevel={resolvedShadowQuality} intensityScale={lightIntensityScale} />
      {children}
      {enablePostProcessing && CHARACTER_LOOK.postProcessing.enabled ? (
        <PortraitPostChain
          key={[
            composerTarget.frameBufferType,
            multisampling,
            resolvedAoQuality ?? 'off',
            aoRadius ?? ao.aoRadius,
            aoIntensity ?? ao.intensity,
            smaaPreset,
            toneMappingEnabled,
            pageCutout ? 'cutout' : 'studio',
          ].join(':')}
          pageCutout={pageCutout}
          multisampling={multisampling}
          frameBufferType={composerTarget.frameBufferType}
          aoQuality={resolvedAoQuality}
          aoRadius={aoRadius ?? ao.aoRadius}
          aoIntensity={aoIntensity ?? ao.intensity}
          aoDistanceFalloff={CHARACTER_LOOK_TECHNIQUE.n8aoDistanceFalloff}
          halfRes={ao.halfRes}
          aoEnabledRef={aoEnabledRef}
          smaaPreset={smaaPreset}
          toneMappingEnabled={toneMappingEnabled}
        />
      ) : (
        <ManualRenderPass />
      )}
    </>
  );
}

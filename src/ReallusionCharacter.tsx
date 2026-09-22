import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CoachId } from './coachConfig';
import { CHARACTER_LOOK } from './characterLook';
import { clearCoachAssetCache } from './coachAssetPreload';
import { retainCharacterResources } from './characterResourceLifecycle';
import {
  CONVAI_MHA_APP_RELEASE_SECONDS,
  CONVAI_MHA_CHANNEL_ORDER,
  CONVAI_MHA_DENTAL_OCCLUSION,
  ConvaiMhaLipsync,
} from './convaiMhaLipsync';
import { chessConvai } from './convaiManager';
import { debugLog } from './debugLog';
import {
  createHairPhysics,
  hasAuthoredHairMotion,
  shouldEnableRuntimeHairPhysics,
  type HairPhysics,
} from './hairPhysics';
import {
  collectMaterialInventory,
  getPortraitDebugFlag,
  logPortraitDelayedProbe,
  logPortraitFrustum,
  logPortraitMaterialTune,
  logPortraitSceneGraph,
  probePortraitCenterPixel,
  shouldRecoverPortraitFrame,
  shouldUseBakedPortraitAfterProbes,
  type PortraitPixelClass,
} from './portraitDebug';
import {
  applyPortraitBlink,
  createPortraitBlinkState,
  getPortraitLidClosure,
  resetPortraitBlinkMorphs,
} from './portraitBlink';
import { getPortraitGazeBaseline } from './portraitGazeCalibration';
import { getLipsyncTuningValuesForCoach } from './lipsyncTuning';
import {
  applySkinShader,
  stabilizeMobileSkinOpacity,
  type SkinShaderHandle,
} from './portraitSkinMaterial';
import {
  MORPH_TARGETS_OPTIMIZED_FLAG,
  optimizeZeroDeltaMorphTargets,
} from './optimizeMorphTargets';
import { applySparseMorphShader } from './sparseMorphShader';
import { configurePortraitShadowCasting } from './portraitShadowPolicy';
import { getPortraitBodyPoseSource, sanitizePortraitIdleClip } from './sanitizeIdleClip';
import { useEmotion } from './useEmotion';
import { useEyeTracking } from './useEyeTracking';
import { useHeadTracking } from './useHeadTracking';
import { usePortraitGaze } from './usePortraitGaze';
import CoachChessPerformance from './CoachChessPerformance';
import { getCoachPerformanceManifest } from './coachChessAnimations';
import { sanitizeAuthoredPerformanceClip } from './sanitizeIdleClip';

const LIPSYNC_LOG_INTERVAL_MS = 2000;
const DELAYED_PROBE_MS = [500, 1000, 1200, 2000, 3000] as const;
const MOBILE_FALLBACK_PROBE_MS = 1200;
const MOBILE_FALLBACK_CONFIRM_MS = 250;
const ENVIRONMENT_BLUR_PATCH_FLAG = '__chessAvatarV2EnvironmentBlur';
const ENVIRONMENT_BLUR_UNIFORM = '__chessAvatarV2EnvironmentBlurUniform';
const ENVIRONMENT_BLUR_VALUE = '__chessAvatarV2EnvironmentBlurValue';

/**
 * Drei's `Environment blur` only affects a drawn background. The art export
 * keeps the HDR hidden, so apply the same 0-1 blur control to the specular IBL
 * lookup itself while leaving authored material roughness/direct light intact.
 */
function applyEnvironmentBlur(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  roughnessFloor = CHARACTER_LOOK.environment.blur,
): void {
  const value = THREE.MathUtils.clamp(roughnessFloor, 0, 1);
  material.userData[ENVIRONMENT_BLUR_VALUE] = value;
  const existingUniform = material.userData[ENVIRONMENT_BLUR_UNIFORM] as { value: number } | undefined;
  if (existingUniform) existingUniform.value = value;
  if (material.userData[ENVIRONMENT_BLUR_PATCH_FLAG]) return;
  material.userData[ENVIRONMENT_BLUR_PATCH_FLAG] = true;
  const blur = { value };
  material.userData[ENVIRONMENT_BLUR_UNIFORM] = blur;
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.chessEnvironmentBlur = blur;
    const envMapChunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
    const patchedEnvMapChunk = envMapChunk.replace(
      'textureCubeUV( envMap, reflectVec, roughness )',
      'textureCubeUV( envMap, reflectVec, max( roughness, chessEnvironmentBlur ) )',
    );
    if (patchedEnvMapChunk === envMapChunk) {
      throw new Error('Chess Avatars V2 environment-blur shader hook was not found.');
    }
    const includeHook = '#include <envmap_physical_pars_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace(
      includeHook,
      `uniform float chessEnvironmentBlur;\n${patchedEnvMapChunk}`,
    );
    if (!shader.fragmentShader.includes('max( roughness, chessEnvironmentBlur )')) {
      throw new Error('Chess Avatars V2 physical environment-map include was not found.');
    }
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|chess-avatar-v2-ibl-roughness-floor-v3`;
  material.needsUpdate = true;
}

function recoverMorphTargetNames(root: THREE.Object3D, gltfJson: any): void {
  if (!gltfJson?.meshes) return;
  const meshDataByName = new Map<string, { extras?: { targetNames?: string[] } }>();
  gltfJson.meshes.forEach((meshData: { name?: string; extras?: { targetNames?: string[] } }) => {
    if (meshData.name) meshDataByName.set(meshData.name, meshData);
  });

  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.morphTargetInfluences?.length) return;
    if (mesh.userData[MORPH_TARGETS_OPTIMIZED_FLAG]) return;
    const names = meshDataByName.get(mesh.name)?.extras?.targetNames;
    if (!names?.length || Object.keys(mesh.morphTargetDictionary ?? {}).length >= names.length) return;
    const dictionary: Record<string, number> = {};
    names.forEach((name, index) => {
      if (index < mesh.morphTargetInfluences!.length) dictionary[name] = index;
    });
    mesh.morphTargetDictionary = dictionary;
  });
}

/**
 * Preserve every V2 PBR/shader input. Runtime tuning is restricted to sampler
 * quality, color-space metadata, shadows, alpha coverage and animated bounds.
 */
function prepareV2Materials(root: THREE.Object3D, anisotropy: number, environmentRoughnessFloor: number): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    configurePortraitShadowCasting(
      mesh,
      materials.filter((material): material is THREE.Material => Boolean(material)),
    );
    for (const material of materials) {
      if (!material) continue;
      const pbr = material as THREE.MeshStandardMaterial;
      if (pbr.map) {
        pbr.map.colorSpace = THREE.SRGBColorSpace;
        pbr.map.anisotropy = anisotropy;
        pbr.map.needsUpdate = true;
      }
      if (pbr.emissiveMap) {
        pbr.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        pbr.emissiveMap.anisotropy = anisotropy;
        pbr.emissiveMap.needsUpdate = true;
      }
      for (const texture of [pbr.normalMap, pbr.roughnessMap, pbr.metalnessMap, pbr.aoMap]) {
        if (!texture) continue;
        texture.colorSpace = THREE.NoColorSpace;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }
      // Three r160 has no effective scene.environmentIntensity. Apply the
      // authoritative export directly when each late-loaded GLB material is
      // prepared, so HDR completion cannot race character suspension.
      if (pbr.isMeshStandardMaterial || (pbr as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        pbr.envMapIntensity = CHARACTER_LOOK.environment.intensity;
        applyEnvironmentBlur(pbr, environmentRoughnessFloor);
      }
      if (pbr.alphaTest > 0) pbr.alphaToCoverage = true;
      material.needsUpdate = true;
    }
  });
}

/** Last-resort only: activated after two independently empty mobile probes. */
function applyBasicMaterialFallback(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mapped = source.map((material) => {
      const pbr = material as THREE.MeshStandardMaterial;
      if (!pbr?.map) return material;
      const basic = new THREE.MeshBasicMaterial({
        map: pbr.map,
        color: pbr.color,
        alphaMap: pbr.alphaMap,
        alphaTest: pbr.alphaTest,
        transparent: pbr.transparent,
        opacity: pbr.opacity,
        side: pbr.side,
      });
      basic.name = `${material.name}_emergency_mobile_basic`;
      return basic;
    });
    mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
  });
}

function inspectMorphMeshes(root: THREE.Object3D, coachId: CoachId): void {
  const summaries: string[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.morphTargetInfluences?.length) return;
    const dictionary = mesh.morphTargetDictionary ?? {};
    summaries.push(
      `${mesh.name}:morphs=${mesh.morphTargetInfluences.length},dict=${Object.keys(dictionary).length},`
      + `jawOpen=${dictionary.CTRL_expressions_jawOpen ?? 'missing'}`,
    );
  });
  debugLog('Lipsync', `V2 morph inventory coach=${coachId} — ${summaries.join(' | ')}`);
}

type Props = {
  coachId: CoachId;
  assetName: string;
  charUrl: string;
  animUrl: string;
  /** Frozen by CoachCard together with charUrl; never recompute from a live resize. */
  mobileVariant: boolean;
  /** High-end phones may run the desktop Penner skin path; low-end must not. */
  usePennerSkin?: boolean;
  /** Full-quality phones keep the authored performance clips on the live mesh. */
  authoredPerformance?: boolean;
  hairAlphaCoverage: boolean;
  textureAnisotropy: number;
  environmentRoughnessFloor: number;
  skinSssStrength: number;
  environmentIntensity: number;
  bgColor: string;
  responseThinking?: boolean;
  userSpeaking?: boolean;
  userEngaged?: boolean;
  playerWon?: boolean;
  onReady?: () => void;
  onPersistentFrameFailure?: (first: PortraitPixelClass, second: PortraitPixelClass) => void;
  framing: {
    cameraZ: number;
    fov: number;
    lookAtY: number;
    topInsetWorld: number;
    portraitCropBias: number;
    horizontalOffset: number;
    modelScale?: number;
    modelYawDegrees?: number;
    presentationZoom: number;
  };
};

export default function ReallusionCharacter({
  coachId,
  assetName,
  charUrl,
  animUrl,
  mobileVariant,
  usePennerSkin = !mobileVariant,
  authoredPerformance,
  hairAlphaCoverage,
  textureAnisotropy,
  environmentRoughnessFloor,
  skinSssStrength,
  environmentIntensity,
  bgColor,
  responseThinking = false,
  userSpeaking = false,
  userEngaged = false,
  playerWon = false,
  framing,
  onReady,
  onPersistentFrameFailure,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const [isTalking, setIsTalking] = useState(false);
  const [isFramed, setIsFramed] = useState(false);
  const [authoredBodyReady, setAuthoredBodyReady] = useState(false);
  const [authoredFaceReady, setAuthoredFaceReady] = useState(false);
  const [authoredFaceSettled, setAuthoredFaceSettled] = useState(false);
  const presentedRef = useRef(false);
  const warmFramesRef = useRef(0);
  const blinkRef = useRef(createPortraitBlinkState(0, Number.POSITIVE_INFINITY));
  const blinkSceneRef = useRef<THREE.Object3D | null>(null);
  const hairPhysicsRef = useRef<HairPhysics | null>(null);
  const portraitLiveRef = useRef(false);
  const presentationBaseRef = useRef({ x: 0, y: 0, z: 0, scale: framing.modelScale ?? 1 });
  const delayedProbeTimersRef = useRef<number[]>([]);
  const mobileFallbackAppliedRef = useRef(false);
  const resetGenerationRef = useRef(0);
  const lipsyncLogAtRef = useRef(0);
  const v2DiagnosticsRef = useRef<Record<string, unknown> | null>(null);
  const skinShaderRef = useRef<SkinShaderHandle | null>(null);
  const { camera, gl } = useThree();
  const gltf = useGLTF(charUrl) as any;
  const { scene } = gltf;
  const animationGltf = useGLTF(animUrl) as any;
  const { animations } = animationGltf;
  const performanceManifest = getCoachPerformanceManifest(coachId);
  const useAuthoredPerformance = Boolean(performanceManifest)
    && (authoredPerformance ?? !mobileVariant);
  const portraitAnimations = useMemo(
    () => animations.map((clip: THREE.AnimationClip) => useAuthoredPerformance
      ? sanitizeAuthoredPerformanceClip(clip, 'boardIdle', scene)
      : sanitizePortraitIdleClip(clip, assetName)),
    [animations, assetName, scene, useAuthoredPerformance],
  );
  const authoredHairMotion = useMemo(
    () => hasAuthoredHairMotion(portraitAnimations),
    [portraitAnimations],
  );
  const { actions } = useAnimations(portraitAnimations, groupRef);
  const handleAuthoredBodyReady = useCallback((ready: boolean) => setAuthoredBodyReady(ready), []);
  const handleAuthoredFaceReady = useCallback((ready: boolean, settled: boolean) => {
    setAuthoredFaceReady(ready);
    setAuthoredFaceSettled(settled);
  }, []);

  useEffect(() => {
    if (!mobileVariant) return undefined;
    return retainCharacterResources({
      key: `${charUrl}|${animUrl}`,
      roots: [scene, animationGltf.scene],
      cacheUrls: [charUrl, animUrl],
      clearCache: clearCoachAssetCache,
    });
  }, [mobileVariant, charUrl, animUrl, scene, animationGltf.scene]);

  useEffect(() => {
    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (material.alphaTest <= 0 || material.alphaToCoverage === hairAlphaCoverage) continue;
        material.alphaToCoverage = hairAlphaCoverage;
        material.needsUpdate = true;
      }
    });
  }, [scene, hairAlphaCoverage]);

  useEffect(() => {
    const anisotropy = Math.min(
      Math.max(1, Math.round(textureAnisotropy)),
      Math.max(1, gl.capabilities.getMaxAnisotropy()),
    );
    gl.domElement.dataset.portraitTextureAnisotropy = String(anisotropy);
    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const pbr = material as THREE.MeshStandardMaterial;
        for (const texture of [pbr.map, pbr.emissiveMap, pbr.normalMap, pbr.roughnessMap, pbr.metalnessMap, pbr.aoMap]) {
          if (!texture || texture.anisotropy === anisotropy) continue;
          texture.anisotropy = anisotropy;
          texture.needsUpdate = true;
        }
      }
    });
  }, [gl, scene, textureAnisotropy]);

  useEffect(() => {
    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const pbr = material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
        if (!pbr.isMeshStandardMaterial && !(pbr as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
        applyEnvironmentBlur(pbr, environmentRoughnessFloor);
      }
    });
    gl.domElement.dataset.portraitIblRoughnessFloor = environmentRoughnessFloor.toFixed(2);
  }, [environmentRoughnessFloor, gl, scene]);

  useEffect(() => {
    scene.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const pbr = material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
        if (!pbr.isMeshStandardMaterial && !(pbr as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) continue;
        pbr.envMapIntensity = environmentIntensity;
      }
    });
    gl.domElement.dataset.portraitEnvironmentIntensity = environmentIntensity.toFixed(2);
  }, [environmentIntensity, gl, scene]);

  useEffect(() => {
    const skinShader = skinShaderRef.current;
    if (!skinShader) {
      gl.domElement.dataset.portraitSssStrength = '0.0';
      gl.domElement.dataset.portraitSkinShader = 'vendor-pbr-mobile';
      return;
    }
    skinShader.setStrength(skinSssStrength);
    gl.domElement.dataset.portraitSssStrength = skinSssStrength.toFixed(1);
    gl.domElement.dataset.portraitSkinShader = 'penner-sss';
  }, [gl, skinSssStrength]);

  const lipsync = useMemo(() => {
    if (gltf?.parser?.json) recoverMorphTargetNames(scene, gltf.parser.json);
    const morphOptimization = optimizeZeroDeltaMorphTargets(scene, CONVAI_MHA_CHANNEL_ORDER);
    debugLog(
      'Lipsync',
      `Sparse morph inventory coach=${coachId} slots=${morphOptimization.targetSlotsBefore}`
      + `->${morphOptimization.targetSlotsAfter} effective=${morphOptimization.effectiveChannelCount}`
      + `/251 coverage=${morphOptimization.coverageChannelCount}/251 anchor=${morphOptimization.anchorMesh ?? 'none'}`,
    );
    logPortraitMaterialTune('before', collectMaterialInventory(scene), mobileVariant);
    const anisotropy = Math.min(
      textureAnisotropy,
      8,
      Math.max(1, gl.capabilities.getMaxAnisotropy()),
    );
    prepareV2Materials(scene, anisotropy, environmentRoughnessFloor);
    const opaqueMobileSkinMaterialCount = mobileVariant
      ? stabilizeMobileSkinOpacity(scene)
      : 0;
    const skin = usePennerSkin
      ? applySkinShader(scene, { strength: skinSssStrength })
      : null;
    skinShaderRef.current = skin;
    const sparseMorphShader = applySparseMorphShader(scene);
    logPortraitMaterialTune('after', collectMaterialInventory(scene), mobileVariant);
    logPortraitSceneGraph(scene);
    inspectMorphMeshes(scene, coachId);

    const runtimeHairEnabled = shouldEnableRuntimeHairPhysics(assetName, authoredHairMotion);
    hairPhysicsRef.current = runtimeHairEnabled ? createHairPhysics(scene) : null;
    if (authoredHairMotion) {
      debugLog(
        'HairPhysics',
        `Using authored hair-bone animation without a second spring layer for asset=${assetName}`,
      );
    } else if (hairPhysicsRef.current) {
      debugLog(
        'HairPhysics',
        `Simulating ${hairPhysicsRef.current.boneCount} hair bone(s) in `
        + `${hairPhysicsRef.current.chainCount} chain(s) for asset=${assetName}`,
      );
    } else if (!runtimeHairEnabled) {
      debugLog('HairPhysics', `Using stable rig pose for asset=${assetName}`);
    }

    const adapter = new ConvaiMhaLipsync({
      scene,
      presetName: 'webStudioVerified',
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const diagnostics = adapter.diagnostics;
    const pbrMaterials = new Set<THREE.MeshStandardMaterial>();
    const hairPoseBones: THREE.Bone[] = [];
    const hairPoseMeshes: THREE.Mesh[] = [];
    scene.traverse((object: THREE.Object3D) => {
      const bone = object as THREE.Bone;
      if (bone.isBone && /^Hair\d+$/i.test(bone.name)) hairPoseBones.push(bone);
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (/hair|bang|pony|tail/i.test(mesh.name)
        || materials.some((material) => /^(Blend|Clip)$/i.test(material.name))) {
        hairPoseMeshes.push(mesh);
      }
      for (const material of materials) {
        const pbr = material as THREE.MeshStandardMaterial;
        if (pbr.isMeshStandardMaterial) pbrMaterials.add(pbr);
      }
    });
    v2DiagnosticsRef.current = {
      coachId,
      assetName,
      modelUrl: charUrl,
      mobile: mobileVariant,
      morphCoverage: diagnostics.coverage,
      morphTargetSlotsBefore: morphOptimization.targetSlotsBefore,
      morphTargetSlotsAfter: morphOptimization.targetSlotsAfter,
      sparseMorphMaterialCount: sparseMorphShader.materialCount,
      sampleActiveMorphCount: sparseMorphShader.sampleActiveCount,
      sampleLipsyncState: () => ({
        active: adapter.active,
        acceptedFrames: diagnostics.acceptedFrames,
        fadeAlpha: diagnostics.fadeAlpha,
        starvationSeconds: diagnostics.starvationSeconds,
        tuningMode: diagnostics.tuningMode,
        endSignalFinalFrameConsumes: diagnostics.endSignalFinalFrameConsumes,
        authoritativeTailReleases: diagnostics.authoritativeTailReleases,
        fadeOutSeconds: diagnostics.fadeOutSeconds,
      }),
      matchedMorphChannels: diagnostics.matchedChannelCount,
      pbrMaterialCount: pbrMaterials.size,
      environmentIntensities: [...pbrMaterials].map((material) => material.envMapIntensity),
      environmentBlurMaterialCount: [...pbrMaterials]
        .filter((material) => Boolean(material.userData[ENVIRONMENT_BLUR_PATCH_FLAG])).length,
      skinMaterialCount: skin?.count ?? 0,
      skinLightingPath: skin ? 'three-r160-direct-light-v2' : 'vendor-pbr-mobile',
      opaqueMobileSkinMaterialCount,
      gazeBaseline: getPortraitGazeBaseline(assetName),
      bodyPoseSource: getPortraitBodyPoseSource(assetName),
      hairMotionSource: authoredHairMotion ? 'authored-clip' : (hairPhysicsRef.current ? 'runtime-spring' : 'static'),
      sampleHairPose: () => {
        scene.updateMatrixWorld(true);
        const samples = hairPoseBones.map((bone) => ({
          name: bone.name,
          matrixWorld: Array.from(bone.matrixWorld.elements),
        }));
        for (const mesh of hairPoseMeshes) {
          samples.push({
            name: mesh.name,
            matrixWorld: Array.from(mesh.matrixWorld.elements),
          });
          const skinnedMesh = mesh as THREE.SkinnedMesh;
          const headBone = skinnedMesh.isSkinnedMesh
            ? skinnedMesh.skeleton.bones.find((bone) => /^head$/i.test(bone.name))
            : undefined;
          if (headBone) {
            samples.push({
              name: `${mesh.name}:head`,
              matrixWorld: Array.from(headBone.matrixWorld.elements),
            });
          }
        }
        return samples;
      },
      samplePresentationPose: () => ({
        position: groupRef.current ? groupRef.current.position.toArray() : [],
        rotation: groupRef.current ? groupRef.current.rotation.toArray().slice(0, 3) : [],
        scale: groupRef.current ? groupRef.current.scale.toArray() : [],
      }),
      dentalOcclusion: CONVAI_MHA_DENTAL_OCCLUSION,
      lipsyncFadeOutSeconds: diagnostics.fadeOutSeconds,
      presentationZoom: framing.presentationZoom,
      presentationCameraZ: framing.cameraZ,
      presentationModelYawDegrees: framing.modelYawDegrees ?? 0,
      rendererMemory: gl.info.memory,
    };
    debugLog(
      'Lipsync',
      `Convai MHA coach=${coachId} preset=${diagnostics.presetName} enabled=${adapter.enabled} `
      + `coverage=${(diagnostics.coverage * 100).toFixed(1)}% (${diagnostics.matchedChannelCount}/251) `
      + `missingRequired=${diagnostics.missingRequiredChannels.join(',') || 'none'} `
      + `PennerSkinMaterials=${skin?.count ?? 0}`,
    );
    return adapter;
  }, [
    gltf,
    scene,
    coachId,
    assetName,
    charUrl,
    mobileVariant,
    usePennerSkin,
    textureAnisotropy,
    authoredHairMotion,
    gl,
  ]);

  const lipsyncQaFrame = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null;
    if (new URLSearchParams(window.location.search).get('lipsyncQa') !== 'one-sided-mouth') return null;
    const frame = new Float32Array(CONVAI_MHA_CHANNEL_ORDER.length);
    const set = (channel: string, value: number) => {
      const index = CONVAI_MHA_CHANNEL_ORDER.indexOf(channel);
      if (index >= 0) frame[index] = value;
    };
    set('CTRL_expressions_mouthCornerPullL', 1);
    set('CTRL_expressions_mouthStretchL', 1);
    set('CTRL_expressions_mouthLowerLipDepressL', 1);
    set('CTRL_expressions_mouthFunnelUL', 1);
    set('CTRL_expressions_jawOpen', 0.28);
    return frame;
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !v2DiagnosticsRef.current) return undefined;
    const diagnostics = v2DiagnosticsRef.current;
    const debugWindow = window as typeof window & {
      __chessCharacterV2Diagnostics?: Record<string, Record<string, unknown>>;
    };
    debugWindow.__chessCharacterV2Diagnostics ??= {};
    debugWindow.__chessCharacterV2Diagnostics[coachId] = diagnostics;
    return () => {
      if (debugWindow.__chessCharacterV2Diagnostics?.[coachId] === diagnostics) {
        delete debugWindow.__chessCharacterV2Diagnostics[coachId];
      }
    };
  }, [lipsync, coachId]);

  useEffect(() => {
    resetGenerationRef.current = chessConvai.getLipsyncResetGeneration(coachId);
    return () => {
      lipsync.reset();
      if (lipsync.enabled) chessConvai.releaseLipsyncRenderer(coachId);
      hairPhysicsRef.current = null;
    };
  }, [lipsync, coachId]);

  useEffect(() => {
    delayedProbeTimersRef.current.forEach((id) => window.clearTimeout(id));
    delayedProbeTimersRef.current = [];
    mobileFallbackAppliedRef.current = false;
  }, [charUrl]);

  useEffect(() => () => {
    delayedProbeTimersRef.current.forEach((id) => window.clearTimeout(id));
    delayedProbeTimersRef.current = [];
  }, []);

  useLayoutEffect(() => {
    delayedProbeTimersRef.current.forEach((id) => window.clearTimeout(id));
    delayedProbeTimersRef.current = [];
    portraitLiveRef.current = false;
    setIsFramed(false);
    if (!groupRef.current) return;
    groupRef.current.position.set(0, 0, 0);
    groupRef.current.rotation.set(
      0,
      THREE.MathUtils.degToRad(framing.modelYawDegrees ?? 0),
      0,
    );
    groupRef.current.scale.setScalar(framing.modelScale ?? 1);
    groupRef.current.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(groupRef.current);
    const visibleHalfHeight = Math.tan((framing.fov * Math.PI) / 360) * framing.cameraZ;
    const visibleTop = framing.lookAtY + visibleHalfHeight;
    const targetTop = visibleTop - framing.topInsetWorld;
    groupRef.current.position.y = targetTop - box.max.y + framing.portraitCropBias;
    groupRef.current.position.x = framing.horizontalOffset;
    groupRef.current.updateMatrixWorld(true);
    presentationBaseRef.current = {
      x: groupRef.current.position.x,
      y: groupRef.current.position.y,
      z: groupRef.current.position.z,
      scale: framing.modelScale ?? 1,
    };
    resetPortraitBlinkMorphs(groupRef.current);
    if (blinkSceneRef.current !== scene) {
      blinkSceneRef.current = scene;
      // Asset loading and shader compilation must not consume the first blink
      // delay. Start its clock only when the portrait is actually presented.
      blinkRef.current = createPortraitBlinkState(0, Number.POSITIVE_INFINITY);
    }
    portraitLiveRef.current = true;
    if (v2DiagnosticsRef.current) {
      v2DiagnosticsRef.current.presentationZoom = framing.presentationZoom;
      v2DiagnosticsRef.current.presentationCameraZ = framing.cameraZ;
      v2DiagnosticsRef.current.presentationModelYawDegrees = framing.modelYawDegrees ?? 0;
    }
    logPortraitFrustum(groupRef.current, camera);
    debugLog('ReallusionCharacter', `V2 portrait ready coach=${coachId} asset=${assetName}`);
    setIsFramed(true);

    const scheduleProbe = (delayMs: number, onResult?: (classification: PortraitPixelClass) => void) => {
      const timer = window.setTimeout(() => {
        const probe = probePortraitCenterPixel(gl, bgColor);
        if (!probe) return;
        const renderInfo = gl.info?.render;
        logPortraitDelayedProbe(
          delayMs,
          probe,
          renderInfo ? { triangles: renderInfo.triangles, calls: renderInfo.calls } : undefined,
          gl.domElement,
        );
        onResult?.(probe.classify);
      }, delayMs);
      delayedProbeTimersRef.current.push(timer);
    };

    // gl.readPixels is a synchronous GPU stall. Keep it behind the explicit
    // debug query instead of penalizing every local play session; mobile keeps
    // its guarded recovery probe because unsupported material/composer paths
    // can produce either a blank background or an opaque black face.
    const diagnosticProbes = Boolean(getPortraitDebugFlag());
    DELAYED_PROBE_MS.forEach((delayMs) => {
      if (delayMs === MOBILE_FALLBACK_PROBE_MS && mobileVariant) {
        scheduleProbe(delayMs, (firstClassification) => {
          if (!shouldRecoverPortraitFrame(firstClassification) || mobileFallbackAppliedRef.current || !groupRef.current) return;
          scheduleProbe(MOBILE_FALLBACK_CONFIRM_MS, (secondClassification) => {
            if (!shouldUseBakedPortraitAfterProbes(firstClassification, secondClassification) || mobileFallbackAppliedRef.current || !groupRef.current) return;
            mobileFallbackAppliedRef.current = true;
            debugLog('PortraitDebug', `WARN two invalid mobile probes (${firstClassification}, ${secondClassification}) — leaving live WebGL for the baked portrait`);
            if (onPersistentFrameFailure) {
              onPersistentFrameFailure(firstClassification, secondClassification);
              return;
            }
            applyBasicMaterialFallback(groupRef.current);
          });
        });
      } else if (diagnosticProbes) {
        scheduleProbe(delayMs);
      }
    });
    return () => {
      portraitLiveRef.current = false;
    };
  }, [scene, framing, onPersistentFrameFailure, coachId, assetName, camera, gl, bgColor, mobileVariant]);

  useEffect(() => {
    const keys = Object.keys(actions);
    const idleName = keys.find((key) => key.toLowerCase().includes('idle')) ?? keys[0];
    const action = idleName ? actions[idleName] : null;
    debugLog('ReallusionCharacter', `Playing animation "${idleName ?? 'none'}" for coach=${coachId}`);
    // The authored performance component owns the body from first paint. Do
    // not briefly run the legacy portrait idle while its clips load: the two
    // independent mixers exposed different torso/head orientations and caused
    // a visible load-time correction followed by a snap back.
    if (!action || useAuthoredPerformance) return;
    action.reset().fadeIn(0.3).play();
    return () => {
      action.fadeOut(0.3);
    };
  }, [actions, coachId, useAuthoredPerformance]);

  // 1) Remove the previous Convai layer before the animation mixer's priority-0
  // update and every other base facial layer.
  useFrame(() => {
    const generation = chessConvai.getLipsyncResetGeneration(coachId);
    if (generation !== resetGenerationRef.current) {
      resetGenerationRef.current = generation;
      lipsync.reset();
    }
    lipsync.beginFrame();
  }, -2);

  // Live developer pose offsets compose onto the measured framing without
  // remounting the model or resetting the game/animation mixer.
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !portraitLiveRef.current) return;
    const tuning = getLipsyncTuningValuesForCoach(coachId);
    const base = presentationBaseRef.current;
    group.position.set(
      base.x + tuning.modelOffsetX,
      base.y + tuning.modelOffsetY,
      base.z + tuning.modelOffsetZ,
    );
    group.rotation.set(
      THREE.MathUtils.degToRad(tuning.modelPitchDegrees),
      THREE.MathUtils.degToRad((framing.modelYawDegrees ?? 0) + tuning.modelYawDegrees),
      0,
    );
    group.scale.setScalar(base.scale * tuning.modelScale);
    gl.domElement.dataset[`${coachId}ModelYaw`] = tuning.modelYawDegrees.toFixed(0);
  }, -1);

  usePortraitGaze(scene, {
    isSpeaking: isTalking,
    enabled: isFramed && !authoredFaceReady && !useAuthoredPerformance,
    assetName,
    coachId,
  });
  useHeadTracking(
    scene,
    { lerpSpeed: 0.08, maxTrackAngle: Math.PI / 2, maxPitchAngle: Math.PI / 4, enabled: false },
    isTalking,
    false,
  );
  useEyeTracking(
    null,
    scene,
    { lerpSpeed: 0.2, maxHorizontalAngle: Math.PI / 6, maxVerticalAngle: Math.PI / 8, morphRoot: scene, enabled: false },
    isTalking,
    false,
  );
  useEmotion(scene, {
    isSpeaking: isTalking,
    baseline: 0.46,
    momentPeakMin: 0.68,
    momentPeakMax: 0.92,
    enabled: isFramed && (coachId !== 'arjun' || !authoredFaceReady),
  });

  // 3) Apply the current 251-channel Convai frame after every base writer.
  useFrame((_, delta) => {
    // A rig that fails the 95%/required-channel gate must not claim exclusive
    // SDK-queue ownership: the compatibility consumer still needs to drain the
    // stream so conversation completion cannot deadlock.
    if (!lipsync.enabled) {
      const talkingNow = chessConvai.getIsSpeaking(coachId);
      if (talkingNow !== isTalking) setIsTalking(talkingNow);
      return;
    }
    if (lipsyncQaFrame) {
      lipsync.setTargetFrame(lipsyncQaFrame);
      lipsync.update(delta, true);
      if (!isTalking) setIsTalking(true);
      return;
    }
    const queue = chessConvai.getLipsyncQueue(coachId);
    const allowMissingEndSignalDrain = chessConvai.canDrainMissingEndSignalLipsyncTail(coachId);
    const releaseHeldPose = chessConvai.canReleaseLipsyncHeldPose(coachId);
    const fresh = queue
      ? lipsync.updateFromConvaiQueue(queue, delta, { allowMissingEndSignalDrain, releaseHeldPose })
      : (lipsync.update(delta, false), false);
    chessConvai.reportLipsyncRenderState(coachId, { active: lipsync.active, fresh });

    const talkingNow = chessConvai.getIsSpeaking(coachId) || lipsync.active;
    if (talkingNow !== isTalking) setIsTalking(talkingNow);

    const now = performance.now();
    if (now - lipsyncLogAtRef.current >= LIPSYNC_LOG_INTERVAL_MS && (fresh || lipsync.active)) {
      lipsyncLogAtRef.current = now;
      debugLog(
        'Lipsync',
        `coach=${coachId} preset=${lipsync.diagnostics.presetName} active=${lipsync.active} `
        + `fresh=${fresh} accepted=${lipsync.diagnostics.acceptedFrames} `
        + `rejectedFrames=${lipsync.diagnostics.rejectedFrames} rejectedValues=${lipsync.diagnostics.rejectedValues}`,
      );
    }
  }, 1);

  // The authored face writer runs at 0.75 and Convai at 1. Apply the blink
  // last so neither can overwrite full lid closure. Authored performances
  // provide a fresh base every frame, so max-combine preserves any stronger
  // live blink; legacy characters keep the original absolute ownership.
  useFrame(() => {
    if (portraitLiveRef.current && groupRef.current) {
      applyPortraitBlink(
        groupRef.current,
        performance.now(),
        blinkRef.current,
        authoredFaceReady,
      );
    }
  }, 1.5);

  useEffect(() => () => {
    delete gl.domElement.dataset[`${coachId}ModelYaw`];
  }, [coachId, gl]);

  // Hair reads the final head pose. EffectComposer/renderer runs at priority 3.
  useFrame((_, delta) => hairPhysicsRef.current?.update(delta), 2);

  // Both render paths in PortraitScene submit at priority 3. A pair of browser
  // rAF callbacks only proved that framing ran, not that the final lit, animated
  // model was rendered. Keep it covered until its animation writers and lighting
  // have settled, then reveal an open-eye frame after several real renders.
  useFrame(() => {
    if (!groupRef.current) return;
    const closure = getPortraitLidClosure(groupRef.current);
    if (import.meta.env.DEV) {
      gl.domElement.dataset.portraitBlink = closure.toFixed(3);
    }
    if (presentedRef.current) return;
    const animationsReady = !useAuthoredPerformance || (authoredBodyReady && authoredFaceSettled);
    const rendered = gl.info.render.calls > 0 && !gl.getContext().isContextLost();
    if (!isFramed || !animationsReady || !rendered
      || gl.domElement.dataset.portraitEnvironmentReady !== 'true') {
      warmFramesRef.current = 0;
      return;
    }
    warmFramesRef.current += 1;
    gl.domElement.dataset.portraitPresentedFrames = String(warmFramesRef.current);
    if (warmFramesRef.current < 3 || closure > 0.15) return;
    presentedRef.current = true;
    blinkRef.current = createPortraitBlinkState();
    onReady?.();
  }, 4);

  return (
    <group ref={groupRef} dispose={null}>
      <primitive object={scene} />
      {useAuthoredPerformance && performanceManifest && (
        <Suspense fallback={null}>
          <CoachChessPerformance
            key={performanceManifest.coachId}
            coachId={performanceManifest.coachId}
            rootRef={groupRef}
            scene={scene}
            isSpeaking={isTalking}
            responseThinking={responseThinking}
            userSpeaking={userSpeaking}
            userEngaged={userEngaged}
            playerWon={playerWon}
            onBodyReady={handleAuthoredBodyReady}
            onFaceReady={handleAuthoredFaceReady}
          />
        </Suspense>
      )}
    </group>
  );
}

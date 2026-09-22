import * as THREE from 'three';
import { debugLog } from './debugLog';

const SCOPE = 'PortraitDebug';

export type PortraitPixelClass = 'empty_frame' | 'black_frame' | 'visible_frame';

export type MaterialInventory = {
  physical: number;
  standard: number;
  basic: number;
  other: number;
  withMap: number;
  withoutMap: number;
  skinSamples: string[];
};

let canvasMountCount = 0;

export function nextCanvasMountCount(): number {
  canvasMountCount += 1;
  return canvasMountCount;
}

let cachedPortraitDebugFlag: string | null | undefined;

/** Memoized — read from a per-frame hot path, and the URL can't change without a reload. */
export function getPortraitDebugFlag(): string | null {
  if (cachedPortraitDebugFlag !== undefined) return cachedPortraitDebugFlag;
  if (typeof window === 'undefined') return null;
  cachedPortraitDebugFlag = new URLSearchParams(window.location.search).get('portraitDebug');
  return cachedPortraitDebugFlag;
}

export function logPortraitBootstrap(opts: {
  coachId: string;
  modelFile: string;
  mountCount: number;
  isMobile: boolean;
  characterWindowEl: HTMLElement | null;
  canvasEl: HTMLCanvasElement | null;
  characterReady: boolean;
  bgColor: string;
  gl?: THREE.WebGLRenderer;
}): void {
  const { characterWindowEl, canvasEl, gl } = opts;
  const winRect = characterWindowEl?.getBoundingClientRect();
  const canvasRect = canvasEl?.getBoundingClientRect();
  const canvasStyle = canvasEl ? window.getComputedStyle(canvasEl) : null;
  const winClasses = characterWindowEl?.className ?? '';
  const webgl = gl?.getContext();
  const renderer = webgl ? String(webgl.getParameter(webgl.RENDERER)) : 'n/a';
  const maxTex = webgl ? String(webgl.getParameter(webgl.MAX_TEXTURE_SIZE)) : 'n/a';

  const backingW = canvasEl?.width ?? 0;
  const backingH = canvasEl?.height ?? 0;

  debugLog(
    SCOPE,
    `bootstrap coach=${opts.coachId} model=${opts.modelFile} mount=${opts.mountCount} mobile=${opts.isMobile} ` +
    `ready=${opts.characterReady} win=${Math.round(winRect?.width ?? 0)}x${Math.round(winRect?.height ?? 0)} ` +
    `canvas=${Math.round(canvasRect?.width ?? 0)}x${Math.round(canvasRect?.height ?? 0)} ` +
    `backing=${backingW}x${backingH} ` +
    `css opacity=${canvasStyle?.opacity ?? 'n/a'} visibility=${canvasStyle?.visibility ?? 'n/a'} ` +
    `display=${canvasStyle?.display ?? 'n/a'} zIndex=${canvasStyle?.zIndex ?? 'n/a'} ` +
    `classes="${winClasses}" gl="${renderer}" maxTex=${maxTex}`,
  );
}

export function logPortraitWebGLCapabilities(gl: THREE.WebGLRenderer): void {
  const caps = gl.capabilities;
  debugLog(
    SCOPE,
    `webgl isWebGL2=${caps.isWebGL2} maxTextures=${caps.maxTextures} maxVertexTextures=${caps.maxVertexTextures}`,
  );
}

export function attachPortraitWebGLContextListeners(
  gl: THREE.WebGLRenderer,
  onContextLost?: () => void,
): void {
  const canvas = gl.domElement;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    // Browsers fire contextlost on the detached canvas when the portrait
    // unmounts (leaving a game / starting a new one) — that's teardown, not a
    // failure, so don't kick off the reload-retry path for it.
    if (!canvas.isConnected) {
      debugLog(SCOPE, 'webglcontextlost on detached canvas (teardown) — ignored');
      return;
    }
    debugLog(SCOPE, 'WARN webglcontextlost');
    onContextLost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    debugLog(SCOPE, 'webglcontextrestored');
  });
}

/** ?portraitDebug=decay — dump face morphs + jaw/teeth pose each tick (idle baseline vs decay). */
export function logPortraitDecayState(root: THREE.Object3D, label: string): void {
  const parts: string[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    if (!/^CC_Base_Body(_\d+)?$/i.test(mesh.name)) return;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const value = mesh.morphTargetInfluences[index];
      if (value > 0.005) parts.push(`${name}=${value.toFixed(3)}`);
    }
  });
  const bones: string[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Bone)) return;
    if (/CC_Base_(JawRoot|UpperJaw|Teeth02|Head)$/i.test(child.name)) {
      bones.push(`${child.name.replace('CC_Base_', '')}=(${child.rotation.x.toFixed(3)},${child.rotation.y.toFixed(3)},${child.rotation.z.toFixed(3)})`);
    }
  });
  debugLog(SCOPE, `facestate ${label} ${bones.join(' ')} morphs: ${[...new Set(parts)].join(' ') || '(none)'}`);
}

export function logPortraitSceneGraph(root: THREE.Object3D): void {
  let meshCount = 0;
  let visibleMeshes = 0;
  let hiddenMeshes = 0;
  let skinWithoutMap = 0;
  let physical = 0;
  let standard = 0;
  let basic = 0;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    if (mesh.visible) visibleMeshes += 1;
    else hiddenMeshes += 1;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) physical += 1;
      else if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) standard += 1;
      else if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial) basic += 1;

      const meshName = mesh.name || '';
      const materialName = material.name || '';
      const skinLike = /skin|head|face|body/i.test(meshName) || /skin|head|face|body/i.test(materialName);
      const std = material as THREE.MeshStandardMaterial;
      if (skinLike && !('map' in std && std.map)) skinWithoutMap += 1;
    }
  });

  debugLog(
    SCOPE,
    `sceneGraph meshes=${meshCount} visible=${visibleMeshes} hidden=${hiddenMeshes} ` +
    `physical=${physical} standard=${standard} basic=${basic} skinWithoutMap=${skinWithoutMap}`,
  );
}

export function logPortraitReadyState(opts: {
  coachId: string;
  characterWindowEl: HTMLElement | null;
  characterReady: boolean;
}): void {
  const canvasEl = opts.characterWindowEl?.querySelector('canvas');
  const canvasStyle = canvasEl ? window.getComputedStyle(canvasEl) : null;
  const hasLoading = Boolean(opts.characterWindowEl?.querySelector('.character-loading'));
  debugLog(
    SCOPE,
    `ready coach=${opts.coachId} state=${opts.characterReady} isReadyClass=${opts.characterWindowEl?.classList.contains('is-ready') ?? false} ` +
    `loadingOverlay=${hasLoading} canvasOpacity=${canvasStyle?.opacity ?? 'n/a'}`,
  );
}

export function logPortraitEnvironment(opts: {
  hasEnvironment: boolean;
  /** three < r163 has no scene.environmentIntensity — undefined there. */
  environmentIntensity: number | undefined;
  enablePostProcessing: boolean;
  enableEnvironment: boolean;
}): void {
  debugLog(
    SCOPE,
    `env loaded=${opts.hasEnvironment} intensity=${opts.environmentIntensity?.toFixed(3) ?? 'n/a'} ` +
    `postProcessing=${opts.enablePostProcessing} enableEnvironment=${opts.enableEnvironment}`,
  );
}

export function warnPortraitEnvironmentMissing(): void {
  debugLog(SCOPE, 'WARN env_missing — scene.environment still null after 2s');
}

export function collectMaterialInventory(root: THREE.Object3D): MaterialInventory {
  const inventory: MaterialInventory = {
    physical: 0,
    standard: 0,
    basic: 0,
    other: 0,
    withMap: 0,
    withoutMap: 0,
    skinSamples: [],
  };

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      if ((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) inventory.physical += 1;
      else if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) inventory.standard += 1;
      else if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial) inventory.basic += 1;
      else inventory.other += 1;

      const std = material as THREE.MeshStandardMaterial;
      if ('map' in std && std.map) inventory.withMap += 1;
      else inventory.withoutMap += 1;

      const meshName = mesh.name || '';
      const materialName = material.name || '';
      if (/skin|head|face|body/i.test(meshName) || /skin|head|face|body/i.test(materialName)) {
        if (inventory.skinSamples.length < 3) {
          const emissive = 'emissive' in std ? `#${std.emissive.getHexString()}` : 'n/a';
          const envMap = 'envMapIntensity' in std ? String(std.envMapIntensity) : 'n/a';
          inventory.skinSamples.push(
            `${meshName}:${materialName} em=${emissive} env=${envMap} metal=${'metalness' in std ? std.metalness.toFixed(2) : 'n/a'}`,
          );
        }
      }
    }
  });

  return inventory;
}

export function logPortraitMaterialTune(phase: 'before' | 'after', inventory: MaterialInventory, mobileSafe: boolean): void {
  debugLog(
    SCOPE,
    `materials ${phase} mobile=${mobileSafe} physical=${inventory.physical} standard=${inventory.standard} ` +
    `basic=${inventory.basic} other=${inventory.other} withMap=${inventory.withMap} withoutMap=${inventory.withoutMap} ` +
    `skin=[${inventory.skinSamples.join('; ')}]`,
  );
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function parseHexColor(hex: string): [number, number, number] | null {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return [r, g, b];
}

export function classifyPortraitPixel(rgb: [number, number, number], bgColor: string): PortraitPixelClass {
  if (rgb[0] < 12 && rgb[1] < 12 && rgb[2] < 12) return 'black_frame';
  const bg = parseHexColor(bgColor);
  if (bg && colorDistance(rgb, bg) < 28) return 'empty_frame';
  return 'visible_frame';
}

export function shouldRecoverPortraitFrame(classification: PortraitPixelClass): boolean {
  return classification !== 'visible_frame';
}

export function shouldUseBakedPortraitAfterProbes(first: PortraitPixelClass, second: PortraitPixelClass): boolean {
  return shouldRecoverPortraitFrame(first) && shouldRecoverPortraitFrame(second);
}

export function classifyPortraitFaceSamples(
  samples: Array<[number, number, number]>,
  bgColor: string,
): { rgb: [number, number, number]; classify: PortraitPixelClass } {
  const classes = samples.map((rgb) => classifyPortraitPixel(rgb, bgColor));
  const visibleIndices = classes
    .map((classification, index) => classification === 'visible_frame' ? index : -1)
    .filter((index) => index >= 0);
  // Eyes, lips and teeth are separate meshes. A missing head-skin material can
  // therefore leave one apparently valid point among otherwise empty cheeks.
  // Require skin at a majority of the three forehead/cheek samples.
  if (visibleIndices.length >= 2) {
    const rgb = samples[visibleIndices[0]];
    return { rgb, classify: 'visible_frame' };
  }
  const blackIndices = classes
    .map((classification, index) => classification === 'black_frame' ? index : -1)
    .filter((index) => index >= 0);
  const selectedIndex = blackIndices[0] ?? visibleIndices[0] ?? 0;
  return {
    rgb: samples[selectedIndex],
    classify: blackIndices.length >= 2 ? 'black_frame' : 'empty_frame',
  };
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function probePortraitCenterPixel(
  gl: THREE.WebGLRenderer,
  bgColor: string,
): { rgb: [number, number, number]; hex: string; classify: PortraitPixelClass } | null {
  if (import.meta.env.DEV && getPortraitDebugFlag() === 'force-black') {
    return { rgb: [0, 0, 0], hex: '#000000', classify: 'black_frame' };
  }
  const canvas = gl.domElement;
  const width = canvas.width;
  const height = canvas.height;
  if (width < 2 || height < 2) return null;

  // Read the pixels a user actually sees. The portrait renders through an
  // offscreen composer and preserveDrawingBuffer is false, so asynchronous
  // gl.readPixels on the default framebuffer can report black even while the
  // browser compositor shows a correct face. drawImage snapshots the
  // composited canvas. Sample three skin-region points instead of the literal
  // centre, which lands on Sofia's black collar.
  try {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 32;
    sampleCanvas.height = 32;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.drawImage(canvas, 0, 0, 32, 32);
      const data = context.getImageData(0, 0, 32, 32).data;
      const points = [[16, 9], [13, 12], [19, 12]] as const;
      const samples = points.map(([x, y]) => {
        const offset = (y * 32 + x) * 4;
        return [data[offset], data[offset + 1], data[offset + 2]] as [number, number, number];
      });
      const result = classifyPortraitFaceSamples(samples, bgColor);
      return { ...result, hex: rgbToHex(result.rgb) };
    }
  } catch {
    // Fall through to the WebGL diagnostic for browsers that reject canvas
    // snapshots. Confirmation still requires a second matching failure.
  }

  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const pixelBuffer = new Uint8Array(4);
  const webgl = gl.getContext();
  if (!webgl) return null;
  webgl.readPixels(x, y, 1, 1, webgl.RGBA, webgl.UNSIGNED_BYTE, pixelBuffer);
  const rgb: [number, number, number] = [pixelBuffer[0], pixelBuffer[1], pixelBuffer[2]];
  const hex = rgbToHex(rgb);
  const classify = classifyPortraitPixel(rgb, bgColor);
  return { rgb, hex, classify };
}

function canvasOpacityLabel(canvasEl: HTMLCanvasElement | null | undefined): string {
  if (!canvasEl) return 'n/a';
  return window.getComputedStyle(canvasEl).opacity || 'n/a';
}

export function logPortraitDelayedProbe(
  delayMs: number,
  probe: { hex: string; classify: PortraitPixelClass },
  renderInfo?: { triangles: number; calls: number },
  canvasEl?: HTMLCanvasElement | null,
): void {
  const extra = renderInfo
    ? ` triangles=${renderInfo.triangles} calls=${renderInfo.calls}`
    : '';
  const opacity = canvasOpacityLabel(canvasEl);
  const backing = canvasEl ? `${canvasEl.width}x${canvasEl.height}` : 'n/a';
  const prefix = probe.classify === 'visible_frame' ? '' : 'WARN ';
  debugLog(
    SCOPE,
    `${prefix}delayedProbe t=${delayMs}ms classify=${probe.classify} center=${probe.hex} ` +
    `canvasOpacity=${opacity} backing=${backing}${extra}`,
  );
}

export function logPortraitFrustum(
  root: THREE.Object3D,
  camera: THREE.Camera,
): void {
  const box = new THREE.Box3().setFromObject(root);
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(matrix);
  const inFrustum = frustum.intersectsBox(box);
  debugLog(
    SCOPE,
    `frustum inFrustum=${inFrustum} boxMin=(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}) ` +
    `boxMax=(${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)})`,
  );
}

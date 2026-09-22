import * as THREE from 'three';

/**
 * Vendor emissive-only character look.
 *
 * The art team's pipeline bakes lighting and GI into the character textures in
 * Unreal, then exports for self-illumination (emissive) with no real-time
 * lights and no normal / roughness / metallic maps. The character is meant to
 * be shown with the environment it was baked against; this app composites over
 * a flat UI panel, so the baked base-color texture is routed through the
 * emissive term at factor 1.0 on every mapped material (GLB per-material
 * emissiveFactor values are ignored — they were inconsistent across coaches).
 *
 * Transparent eye overlays (cornea, tearline, occlusion) are left alone — they
 * are reflection shells, not baked colour surfaces.
 *
 * Debug overrides via ?portraitDebug=:
 *   uniform-emissive — legacy per-category levels (pre-vendor A/B)
 *   legacy-shaders    — re-enable skin/eye PBR shaders (off-spec)
 */

/** Transparent overlay shells — not baked colour surfaces. */
const EMISSIVE_SKIP = /^Std_Cornea|^Std_Tearline|^Std_Eye_Occlusion/i;

/** Legacy per-category levels (?portraitDebug=uniform-emissive only). */
export const SELF_ILLUMINATION_LEVELS = {
  skin: 0.74,
  base: 0.66,
  eyes: 0.48,
  mouthInterior: 0.26,
} as const;

export type SelfIlluminationSource = 'vendor' | 'uniform';

export interface SelfIlluminationOptions {
  /** @default 'vendor' */
  source?: SelfIlluminationSource;
}

export interface SelfIlluminationHandle {
  count: number;
  setIntensityScale: (scale: number) => void;
}

type TouchedMaterial = {
  material: THREE.MeshStandardMaterial;
  baseIntensity: number;
};

function levelFor(name: string): number {
  if (/teeth|tongue/i.test(name)) return SELF_ILLUMINATION_LEVELS.mouthInterior;
  if (/^Std_Eye_[LR]|^Eyes$/i.test(name)) return SELF_ILLUMINATION_LEVELS.eyes;
  if (/skin|^head\b/i.test(name)) return SELF_ILLUMINATION_LEVELS.skin;
  return SELF_ILLUMINATION_LEVELS.base;
}

/** Strip maps and PBR response the vendor says not to use at runtime. */
export function stripPbrLightingMaps(std: THREE.MeshStandardMaterial): void {
  std.normalMap = null;
  std.roughnessMap = null;
  std.metalnessMap = null;
  std.aoMap = null;
  std.envMap = null;
  std.metalness = 0;
  std.roughness = 1;
  std.envMapIntensity = 0;
  if ('clearcoat' in std) {
    const phys = std as THREE.MeshPhysicalMaterial;
    phys.clearcoat = 0;
    phys.clearcoatRoughness = 1;
    phys.sheen = 0;
    phys.specularIntensity = 0;
  }
}

function applyFullEmissive(std: THREE.MeshStandardMaterial): void {
  stripPbrLightingMaps(std);
  std.emissiveMap = std.map;
  std.emissive.copy(std.color);
  std.emissiveIntensity = 1;
}

function applyUniformEmissive(std: THREE.MeshStandardMaterial, level: number): void {
  stripPbrLightingMaps(std);
  std.emissiveMap = std.map;
  std.emissive.copy(std.color);
  std.emissiveIntensity = level;
}

export function applySelfIllumination(
  root: THREE.Object3D,
  options: SelfIlluminationOptions = {},
): SelfIlluminationHandle {
  const source = options.source ?? 'vendor';
  const touched: TouchedMaterial[] = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const std = material as THREE.MeshStandardMaterial;
      if (!std?.isMeshStandardMaterial && !(std as unknown as THREE.MeshPhysicalMaterial)?.isMeshPhysicalMaterial) continue;
      if (!std.map) continue;
      if (EMISSIVE_SKIP.test(std.name || '')) continue;

      if (source === 'uniform') {
        applyUniformEmissive(std, levelFor(std.name || ''));
      } else {
        applyFullEmissive(std);
      }

      std.needsUpdate = true;
      touched.push({ material: std, baseIntensity: std.emissiveIntensity });
    }
  });

  return {
    count: touched.length,
    setIntensityScale: (scale: number) => {
      for (const { material, baseIntensity } of touched) {
        material.emissiveIntensity = baseIntensity * scale;
      }
    },
  };
}

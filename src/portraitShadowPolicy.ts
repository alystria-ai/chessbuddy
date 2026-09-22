import type * as THREE from 'three';

const SHADOW_FILTER_INSTALLED = '__chessAvatarV2ShadowGroupFilterInstalled';
const SHADOW_UNSAFE_INDICES = '__chessAvatarV2ShadowUnsafeMaterialIndices';
const SHADOW_WRITE_STATE = '__chessAvatarV2ShadowWriteState';

export function isUnsafeTransparentShadowMaterial(material: THREE.Material): boolean {
  const name = material.name ?? '';
  return /hide/i.test(name)
    || (material.transparent && material.alphaTest <= 0 && /hair|blend|blind|lash|occlusion/i.test(name));
}

export function shouldCastPortraitShadow(materials: readonly THREE.Material[]): boolean {
  return materials.some((material) => !isUnsafeTransparentShadowMaterial(material));
}

/**
 * Three renders multi-material shadow groups one at a time. Keep the opaque
 * head/body groups casting while suppressing only invisible Hide and blended
 * card groups, which otherwise write opaque depth into the face shadow.
 */
export function configurePortraitShadowCasting(
  mesh: THREE.Mesh,
  materials: readonly THREE.Material[],
): void {
  const unsafeIndices = new Set<number>();
  materials.forEach((material, index) => {
    if (isUnsafeTransparentShadowMaterial(material)) unsafeIndices.add(index);
  });
  mesh.userData[SHADOW_UNSAFE_INDICES] = unsafeIndices;
  mesh.castShadow = shouldCastPortraitShadow(materials);

  if (!Array.isArray(mesh.material) || unsafeIndices.size === 0 || mesh.userData[SHADOW_FILTER_INSTALLED]) {
    return;
  }
  mesh.userData[SHADOW_FILTER_INSTALLED] = true;
  const previousBeforeShadow = mesh.onBeforeShadow.bind(mesh);
  const previousAfterShadow = mesh.onAfterShadow.bind(mesh);

  mesh.onBeforeShadow = (renderer, scene, camera, shadowCamera, geometry, depthMaterial, group) => {
    previousBeforeShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group);
    const activeUnsafeIndices = mesh.userData[SHADOW_UNSAFE_INDICES] as Set<number> | undefined;
    const materialIndex = (group as unknown as { materialIndex?: number } | null)?.materialIndex ?? -1;
    if (!activeUnsafeIndices?.has(materialIndex)) return;
    depthMaterial.userData[SHADOW_WRITE_STATE] = {
      colorWrite: depthMaterial.colorWrite,
      depthWrite: depthMaterial.depthWrite,
    };
    depthMaterial.colorWrite = false;
    depthMaterial.depthWrite = false;
  };

  mesh.onAfterShadow = (renderer, scene, camera, shadowCamera, geometry, depthMaterial, group) => {
    const state = depthMaterial.userData[SHADOW_WRITE_STATE] as {
      colorWrite: boolean;
      depthWrite: boolean;
    } | undefined;
    if (state) {
      depthMaterial.colorWrite = state.colorWrite;
      depthMaterial.depthWrite = state.depthWrite;
      delete depthMaterial.userData[SHADOW_WRITE_STATE];
    }
    previousAfterShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group);
  };
}

import * as THREE from 'three';

/**
 * Longer than CoachCard's 1.2 s automatic retry. A retry can therefore retain
 * the same parsed GLTF before its previous mount is physically disposed.
 */
export const CHARACTER_RESOURCE_DISPOSE_DELAY_MS = 1_800;

type DisposableResource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

type ResourceEntry = {
  retainCount: number;
  roots: Set<THREE.Object3D>;
  resources: Set<DisposableResource>;
  cacheUrls: Set<string>;
  clearCache: (url: string) => void;
  disposeTimer: ReturnType<typeof setTimeout> | null;
};

type RetainOptions = {
  key: string;
  roots: Array<THREE.Object3D | null | undefined>;
  cacheUrls: string[];
  clearCache: (url: string) => void;
  disposeDelayMs?: number;
};

const entries = new Map<string, ResourceEntry>();
const resourceOwners = new WeakMap<DisposableResource, number>();

function publishLifecycleDiagnostics(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const debugWindow = window as typeof window & {
    __chessCharacterResourceLifecycle?: Array<{
      key: string;
      retainCount: number;
      resourceCount: number;
      disposePending: boolean;
    }>;
  };
  debugWindow.__chessCharacterResourceLifecycle = [...entries].map(([key, entry]) => ({
    key,
    retainCount: entry.retainCount,
    resourceCount: entry.resources.size,
    disposePending: entry.disposeTimer !== null,
  }));
}

function collectMaterialResources(
  material: THREE.Material,
  resources: Set<DisposableResource>,
): void {
  resources.add(material);
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) resources.add(value);
  }
}

/** Collect only resources owned by a parsed GLTF; renderer/global assets stay untouched. */
export function collectCharacterResources(roots: RetainOptions['roots']): Set<DisposableResource> {
  const resources = new Set<DisposableResource>();
  for (const root of roots) {
    if (!root) continue;
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry instanceof THREE.BufferGeometry) resources.add(mesh.geometry);
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) collectMaterialResources(material, resources);
      }

      const skinned = object as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton?.boneTexture) {
        resources.add(skinned.skeleton.boneTexture);
      }
    });
  }
  return resources;
}

function addResources(entry: ResourceEntry, roots: RetainOptions['roots']): void {
  for (const resource of collectCharacterResources(roots)) {
    if (entry.resources.has(resource)) continue;
    entry.resources.add(resource);
    resourceOwners.set(resource, (resourceOwners.get(resource) ?? 0) + 1);
  }
}

function releaseEntry(key: string, entry: ResourceEntry): void {
  if (entry.retainCount !== 0 || entries.get(key) !== entry) return;

  // Capture emergency/replacement materials installed after initial retain.
  addResources(entry, [...entry.roots]);

  // Texture first, then material, then geometry. Shared objects are disposed
  // only when the final parsed-asset entry releases them.
  const order = (resource: DisposableResource): number => (
    resource instanceof THREE.Texture ? 0 : resource instanceof THREE.Material ? 1 : 2
  );
  for (const resource of [...entry.resources].sort((a, b) => order(a) - order(b))) {
    const owners = resourceOwners.get(resource) ?? 1;
    if (owners > 1) {
      resourceOwners.set(resource, owners - 1);
    } else {
      resourceOwners.delete(resource);
      resource.dispose();
    }
  }
  for (const url of entry.cacheUrls) entry.clearCache(url);
  entries.delete(key);
  publishLifecycleDiagnostics();
}

/**
 * Retain mobile GLTF GPU resources and return an idempotent release function.
 * Release is delayed to make React StrictMode and CoachCard's retry remount safe.
 */
export function retainCharacterResources(options: RetainOptions): () => void {
  let entry = entries.get(options.key);
  if (!entry) {
    entry = {
      retainCount: 0,
      roots: new Set(),
      resources: new Set(),
      cacheUrls: new Set(),
      clearCache: options.clearCache,
      disposeTimer: null,
    };
    entries.set(options.key, entry);
  }

  if (entry.disposeTimer !== null) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  entry.retainCount += 1;
  entry.clearCache = options.clearCache;
  options.roots.forEach((root) => {
    if (root) entry!.roots.add(root);
  });
  options.cacheUrls.forEach((url) => entry!.cacheUrls.add(url));
  addResources(entry, options.roots);
  publishLifecycleDiagnostics();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry!.retainCount = Math.max(0, entry!.retainCount - 1);
    if (entry!.retainCount !== 0 || entry!.disposeTimer !== null) return;
    entry!.disposeTimer = setTimeout(() => {
      entry!.disposeTimer = null;
      releaseEntry(options.key, entry!);
    }, options.disposeDelayMs ?? CHARACTER_RESOURCE_DISPOSE_DELAY_MS);
    publishLifecycleDiagnostics();
  };
}

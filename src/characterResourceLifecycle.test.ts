import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CHARACTER_RESOURCE_DISPOSE_DELAY_MS,
  retainCharacterResources,
} from './characterResourceLifecycle';

function fixture(shared?: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }) {
  const texture = shared?.material.map ?? new THREE.Texture();
  const geometry = shared?.geometry ?? new THREE.BufferGeometry();
  const material = shared?.material ?? new THREE.MeshStandardMaterial({ map: texture });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return { root, texture, geometry, material };
}

describe('mobile character GPU resource lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('disposes GLTF textures, materials and geometry and clears caches after the grace period', () => {
    const item = fixture();
    const textureDispose = vi.spyOn(item.texture, 'dispose');
    const materialDispose = vi.spyOn(item.material, 'dispose');
    const geometryDispose = vi.spyOn(item.geometry, 'dispose');
    const clearCache = vi.fn();
    const release = retainCharacterResources({
      key: 'dispose-one',
      roots: [item.root],
      cacheUrls: ['/coach.mobile.glb', '/idle.glb'],
      clearCache,
    });

    release();
    vi.advanceTimersByTime(CHARACTER_RESOURCE_DISPOSE_DELAY_MS - 1);
    expect(textureDispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(clearCache.mock.calls.map(([url]) => url)).toEqual(['/coach.mobile.glb', '/idle.glb']);
  });

  it('cancels disposal when an immediate retry retains the same parsed asset', () => {
    const item = fixture();
    const geometryDispose = vi.spyOn(item.geometry, 'dispose');
    const clearCache = vi.fn();
    const options = {
      key: 'retry-safe',
      roots: [item.root],
      cacheUrls: ['/retry.mobile.glb'],
      clearCache,
    };
    retainCharacterResources(options)();
    vi.advanceTimersByTime(1_200);
    const releaseRetry = retainCharacterResources(options);
    vi.advanceTimersByTime(CHARACTER_RESOURCE_DISPOSE_DELAY_MS);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(clearCache).not.toHaveBeenCalled();

    releaseRetry();
    vi.advanceTimersByTime(CHARACTER_RESOURCE_DISPOSE_DELAY_MS);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it('never disposes resources still owned by another live parsed asset', () => {
    const shared = fixture();
    const second = fixture({ geometry: shared.geometry, material: shared.material });
    const geometryDispose = vi.spyOn(shared.geometry, 'dispose');
    const materialDispose = vi.spyOn(shared.material, 'dispose');
    const releaseFirst = retainCharacterResources({
      key: 'shared-a', roots: [shared.root], cacheUrls: ['/a.glb'], clearCache: vi.fn(), disposeDelayMs: 0,
    });
    const releaseSecond = retainCharacterResources({
      key: 'shared-b', roots: [second.root], cacheUrls: ['/b.glb'], clearCache: vi.fn(), disposeDelayMs: 0,
    });

    releaseFirst();
    vi.runOnlyPendingTimers();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    releaseSecond();
    vi.runOnlyPendingTimers();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });
});

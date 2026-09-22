import { useGLTF } from '@react-three/drei';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCoach } from './coachConfig';
import {
  clearCoachAssetCache,
  clearCoachAssetCaches,
  coachAssetUrls,
  preloadCoachAssets,
} from './coachAssetPreload';

describe('coach asset preloading after mobile disposal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('invalidates the warm marker together with Drei cache so the same coach can preload again', () => {
    const preload = vi.spyOn(useGLTF, 'preload').mockImplementation(() => undefined as never);
    const clear = vi.spyOn(useGLTF, 'clear').mockImplementation(() => undefined as never);
    const coach = getCoach('arjun');
    expect(coach).toBeTruthy();
    const { modelUrl, idleUrl } = coachAssetUrls(coach!);

    // Establish a clean local state even if another test imported this module.
    clearCoachAssetCaches([modelUrl, idleUrl]);
    clear.mockClear();

    preloadCoachAssets('arjun');
    preloadCoachAssets('arjun');
    expect(preload.mock.calls.map(([url]) => url)).toEqual([modelUrl, idleUrl]);

    clearCoachAssetCaches([modelUrl, idleUrl]);
    preloadCoachAssets('arjun');

    expect(clear.mock.calls.map(([url]) => url)).toEqual([modelUrl, idleUrl]);
    expect(preload.mock.calls.map(([url]) => url)).toEqual([
      modelUrl,
      idleUrl,
      modelUrl,
      idleUrl,
    ]);
  });
});

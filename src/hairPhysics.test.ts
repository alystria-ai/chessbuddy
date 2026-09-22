import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hasAuthoredHairMotion, shouldEnableRuntimeHairPhysics } from './hairPhysics';

describe('hasAuthoredHairMotion', () => {
  it('detects changing authored hair-bone animation', () => {
    const clip = new THREE.AnimationClip('Idle', 1, [
      new THREE.QuaternionKeyframeTrack(
        'Hair3.quaternion',
        [0, 0.5, 1],
        [
          0, 0, 0, 1,
          0, 0.08, 0, 0.9968,
          0, 0, 0, 1,
        ],
      ),
    ]);

    expect(hasAuthoredHairMotion([clip])).toBe(true);
  });

  it('ignores exporter-generated constant hair tracks', () => {
    const clip = new THREE.AnimationClip('Idle', 1, [
      new THREE.QuaternionKeyframeTrack(
        'Hair1.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
      new THREE.VectorKeyframeTrack(
        'Hair1.position',
        [0, 1],
        [0, 0, 0, 0, 0, 0],
      ),
    ]);

    expect(hasAuthoredHairMotion([clip])).toBe(false);
  });

  it('does not mistake ordinary body animation for hair motion', () => {
    const clip = new THREE.AnimationClip('Idle', 1, [
      new THREE.QuaternionKeyframeTrack(
        'head.quaternion',
        [0, 1],
        [0, 0, 0, 1, 0, 0.08, 0, 0.9968],
      ),
    ]);

    expect(hasAuthoredHairMotion([clip])).toBe(false);
  });
});

describe('shouldEnableRuntimeHairPhysics', () => {
  it('keeps Leila stable instead of running the jitter-prone generic spring', () => {
    expect(shouldEnableRuntimeHairPhysics('Leila', false)).toBe(false);
    expect(shouldEnableRuntimeHairPhysics('leila', false)).toBe(false);
  });

  it('preserves authored hair as the sole writer and supports other static rigs', () => {
    expect(shouldEnableRuntimeHairPhysics('Sofia', true)).toBe(false);
    expect(shouldEnableRuntimeHairPhysics('FutureCoach', false)).toBe(true);
  });
});

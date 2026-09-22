import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ARJUN_PLAYER_ROLL_DEGREES,
  applyArjunPlayerHeadCorrection,
  createArjunPlayerHeadCorrection,
  restoreArjunPlayerHeadCorrection,
} from './arjunHeadCorrection';

describe('Arjun player-facing head correction', () => {
  it('keeps only Arjun\'s subtle authored shoulder-side roll in the bone composer', () => {
    expect(ARJUN_PLAYER_ROLL_DEGREES).toBe(-1.5);
  });

  it('composes onto each authored frame and restores it before the next mixer update', () => {
    const scene = new THREE.Group();
    const parent = new THREE.Bone();
    parent.name = 'neck_02';
    const head = new THREE.Bone();
    head.name = 'head';
    parent.add(head);
    scene.add(parent);

    const correction = createArjunPlayerHeadCorrection(scene);
    expect(correction).not.toBeNull();

    const firstBase = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02, -0.08, 0.12));
    head.quaternion.copy(firstBase);
    applyArjunPlayerHeadCorrection(correction!, 7, 7, -1.5);
    expect(Math.abs(head.quaternion.dot(firstBase))).toBeLessThan(0.9999);
    restoreArjunPlayerHeadCorrection(correction!);
    expect(Math.abs(head.quaternion.dot(firstBase))).toBeCloseTo(1, 6);

    const nextAuthoredFrame = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.03, -0.05, 0.09));
    head.quaternion.copy(nextAuthoredFrame);
    applyArjunPlayerHeadCorrection(correction!, 7, 7, -1.5);
    restoreArjunPlayerHeadCorrection(correction!);
    expect(Math.abs(head.quaternion.dot(nextAuthoredFrame))).toBeCloseTo(1, 6);
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { optimizeZeroDeltaMorphTargets } from './optimizeMorphTargets';

function morphAttribute(values: number[]): THREE.BufferAttribute {
  return new THREE.Float32BufferAttribute(values, 3);
}

function makeMesh(name: string, vertices: number, channels: string[], effective: Set<string>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(vertices * 3).fill(0), 3));
  geometry.morphAttributes.position = channels.map((channel) => morphAttribute(
    effective.has(channel) ? [0.01, 0, 0] : [0, 0, 0],
  ));
  geometry.morphAttributes.normal = channels.map(() => morphAttribute([0, 0, 0]));
  const mesh = new THREE.Mesh(geometry);
  mesh.name = name;
  mesh.morphTargetDictionary = Object.fromEntries(channels.map((channel, index) => [channel, index]));
  mesh.morphTargetInfluences = channels.map((_, index) => index / 10);
  return mesh;
}

describe('optimizeZeroDeltaMorphTargets', () => {
  it('keeps every effective target and anchors globally zero contract names on the smallest mesh', () => {
    const channels = ['jaw', 'blink', 'tongue', 'unused'];
    const head = makeMesh('head', 100, channels, new Set(['jaw', 'blink']));
    const mouth = makeMesh('mouth', 10, channels, new Set(['tongue']));
    const root = new THREE.Group();
    root.add(head, mouth);

    const result = optimizeZeroDeltaMorphTargets(root, channels);

    expect(result).toEqual({
      meshCount: 2,
      targetSlotsBefore: 8,
      targetSlotsAfter: 4,
      effectiveChannelCount: 3,
      coverageChannelCount: 4,
      anchorMesh: 'mouth',
    });
    expect(head.morphTargetDictionary).toEqual({ jaw: 0, blink: 1 });
    expect(head.morphTargetInfluences).toEqual([0, 0.1]);
    expect(mouth.morphTargetDictionary).toEqual({ tongue: 0, unused: 1 });
    expect(mouth.morphTargetInfluences).toEqual([0.2, 0.3]);
    expect(head.geometry.morphAttributes.position).toHaveLength(2);
    expect(mouth.geometry.morphAttributes.position).toHaveLength(2);
  });

  it('is idempotent and preserves exact contract coverage on repeated preparation', () => {
    const channels = ['jaw', 'unused'];
    const mesh = makeMesh('face', 12, channels, new Set(['jaw']));

    optimizeZeroDeltaMorphTargets(mesh, channels);
    const second = optimizeZeroDeltaMorphTargets(mesh, channels);

    expect(second.coverageChannelCount).toBe(2);
    expect(mesh.morphTargetDictionary).toEqual({ jaw: 0, unused: 1 });
    expect(mesh.morphTargetInfluences).toHaveLength(2);
  });
});

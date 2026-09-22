import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configurePortraitShadowCasting, shouldCastPortraitShadow } from './portraitShadowPolicy';

describe('portrait shadow policy', () => {
  it('keeps opaque and masked geometry while rejecting invisible/blended overlays', () => {
    const body = new THREE.MeshStandardMaterial();
    body.name = 'Shirt';
    const clippedHair = new THREE.MeshStandardMaterial({ alphaTest: 0.18 });
    clippedHair.name = 'hair_clip';
    const blendedHair = new THREE.MeshStandardMaterial({ transparent: true });
    blendedHair.name = 'hair_blend';
    const hide = new THREE.MeshStandardMaterial({ transparent: true });
    hide.name = 'Hide';

    expect(shouldCastPortraitShadow([body])).toBe(true);
    expect(shouldCastPortraitShadow([clippedHair])).toBe(true);
    expect(shouldCastPortraitShadow([blendedHair])).toBe(false);
    expect(shouldCastPortraitShadow([body, hide])).toBe(true);

    const geometry = new THREE.BufferGeometry();
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);
    const mesh = new THREE.Mesh(geometry, [body, hide]);
    configurePortraitShadowCasting(mesh, [body, hide]);
    expect(mesh.castShadow).toBe(true);

    const depth = new THREE.MeshDepthMaterial();
    mesh.onBeforeShadow(
      {} as THREE.WebGLRenderer,
      {} as THREE.Scene,
      {} as THREE.Camera,
      {} as THREE.Camera,
      geometry,
      depth,
      geometry.groups[1],
    );
    expect(depth.colorWrite).toBe(false);
    expect(depth.depthWrite).toBe(false);
    mesh.onAfterShadow(
      {} as THREE.WebGLRenderer,
      {} as THREE.Scene,
      {} as THREE.Camera,
      {} as THREE.Camera,
      geometry,
      depth,
      geometry.groups[1],
    );
    expect(depth.colorWrite).toBe(true);
    expect(depth.depthWrite).toBe(true);
  });
});

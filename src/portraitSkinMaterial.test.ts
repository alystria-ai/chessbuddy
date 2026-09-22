import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applySkinShader,
  createSkinDiffusionLut,
  shouldUsePennerSkinShader,
  stabilizeMobileSkinOpacity,
} from './portraitSkinMaterial';

describe('Chess Avatars V2 Penner skin material', () => {
  it('keeps mobile on the vendor PBR shader to avoid driver-specific missing faces', () => {
    expect(shouldUsePennerSkinShader(true)).toBe(false);
    expect(shouldUsePennerSkinShader(false)).toBe(true);
  });

  it('removes meaningless mobile skin masking without changing hair cutouts', () => {
    const root = new THREE.Group();
    const head = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
    head.name = 'Head_Sofia';
    head.alphaToCoverage = true;
    const hair = new THREE.MeshStandardMaterial({ alphaTest: 0.18 });
    hair.name = 'hair_clip';
    hair.alphaToCoverage = true;
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), head));
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), hair));

    expect(stabilizeMobileSkinOpacity(root)).toBe(1);
    expect(head.alphaTest).toBe(0);
    expect(head.alphaToCoverage).toBe(false);
    expect(head.transparent).toBe(false);
    expect(head.depthWrite).toBe(true);
    expect(hair.alphaTest).toBeCloseTo(0.18);
    expect(hair.alphaToCoverage).toBe(true);
  });

  it('builds the required 64x64 six-Gaussian pre-integrated LUT', () => {
    const lut = createSkinDiffusionLut();
    expect(lut.image.width).toBe(64);
    expect(lut.image.height).toBe(64);
    expect(lut.image.data).toHaveLength(64 * 64 * 4);
    expect(lut.minFilter).toBe(THREE.LinearFilter);
    expect(lut.generateMipmaps).toBe(false);
  });

  it('patches vendor skin in place while preserving PBR maps and excluding eyes', () => {
    const root = new THREE.Group();
    const colorMap = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    const head = new THREE.MeshStandardMaterial({ map: colorMap, normalMap, roughnessMap });
    head.name = 'Head';
    const body = new THREE.MeshStandardMaterial();
    body.name = 'BodySkin';
    const eye = new THREE.MeshStandardMaterial();
    eye.name = 'Head_Eye_Cornea';
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), head));
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), body));
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), eye));

    const handle = applySkinShader(root);
    expect(handle.count).toBe(2);
    expect(handle.materials[0]).toBe(head);
    expect(head.map).toBe(colorMap);
    expect(head.normalMap).toBe(normalMap);
    expect(head.roughnessMap).toBe(roughnessMap);
    expect(handle.sssStrength.value).toBe(1.3);
    expect(handle.materials).not.toContain(eye);

    const shader = {
      uniforms: {},
      vertexShader: 'void main() {}',
      fragmentShader: '#include <lights_physical_pars_fragment>\nvoid main() {}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    head.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const bodyShader = {
      uniforms: {},
      vertexShader: 'void main() {}',
      fragmentShader: '#include <lights_physical_pars_fragment>\nvoid main() {}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    body.onBeforeCompile(bodyShader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('chessSkinLut');
    expect(shader.fragmentShader).toContain('fwidth( geometryNormal )');
    expect(shader.fragmentShader).toContain('chessSkinTransmittance');
    expect(shader.fragmentShader).toContain('directLight.direction');
    expect(shader.fragmentShader).toContain('directLight.color');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse += chessSkinDirectColor');
    expect(shader.fragmentShader).not.toContain('outgoingLight +=');
    expect(shader.uniforms.chessSkinStrength.value).toBe(1.3);

    handle.setStrength(0.4);
    expect(shader.uniforms.chessSkinStrength.value).toBe(0.4);
    expect(bodyShader.uniforms.chessSkinStrength.value).toBe(0.4);

    // Drei can remount a cached GLB with the same material instance. The
    // returned handle must stay wired to the already-compiled uniform.
    const remounted = applySkinShader(root, { strength: 0.9 });
    expect(remounted.sssStrength).toBe(handle.sssStrength);
    remounted.setStrength(0.2);
    expect(shader.uniforms.chessSkinStrength.value).toBe(0.2);
    expect(bodyShader.uniforms.chessSkinStrength.value).toBe(0.2);
  });
});

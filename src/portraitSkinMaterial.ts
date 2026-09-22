import * as THREE from 'three';
import { CHARACTER_LOOK, CHARACTER_LOOK_TECHNIQUE } from './characterLook';

/**
 * Penner-style pre-integrated skin lighting for the Chess Avatars V2 models.
 *
 * The vendor MeshStandard/Physical material is patched in place. That detail is
 * deliberate: replacing it loses embedded maps, glTF extensions and the art
 * team's updated head shader inputs. The LUT adds only the diffuse light that
 * skin scattering contributes around a shadow terminator, plus a restrained
 * back-lit transmittance tint.
 */

export interface SkinShaderOptions {
  strength?: number;
  match?: RegExp;
  exclude?: RegExp;
}

export interface SkinShaderHandle {
  count: number;
  materials: Array<THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>;
  sssStrength: { value: number };
  setStrength: (value: number) => void;
  sssLut: THREE.DataTexture;
}

const PATCH_FLAG = '__chessAvatarV2PennerSss';
const STRENGTH_UNIFORM = '__chessAvatarV2PennerSssStrength';
const DEFAULT_MATCH = /head|skin|body|face/i;
const DEFAULT_EXCLUDE = /eye|cornea|sclera|iris|teeth|tooth|lash|hair|brow|cloth|shirt|jacket|dress|tongue|mouth|gum|nail/i;

// Jimenez/d'Eon normalized six-Gaussian skin profile coefficients. Keeping
// channels separate produces the characteristic red reach at the terminator.
const PROFILE = [
  { variance: 0.0064, weight: [0.233, 0.455, 0.649] },
  { variance: 0.0484, weight: [0.100, 0.336, 0.344] },
  { variance: 0.1870, weight: [0.118, 0.198, 0.000] },
  { variance: 0.5670, weight: [0.113, 0.007, 0.007] },
  { variance: 1.9900, weight: [0.358, 0.004, 0.000] },
  { variance: 7.4100, weight: [0.078, 0.000, 0.000] },
] as const;

let sharedLut: THREE.DataTexture | null = null;

/**
 * The pre-integrated SSS patch is optional in the artist handoff. Keep it on
 * desktop where the shader path is covered by our reference GPUs, but retain
 * the vendor's stock PBR skin shader on phones. Several mobile drivers can
 * fail only the patched head-material program while still drawing the eye,
 * teeth and lip groups, producing the floating-features failure.
 */
export function shouldUsePennerSkinShader(mobileVariant: boolean): boolean {
  return !mobileVariant;
}

/**
 * Sofia, Leila and Magnus ship their otherwise-opaque head as alpha MASK.
 * Their decoded source alpha never approaches the cutoff, so the mask has no
 * intended visible effect. Some mobile WebP paths nevertheless present an
 * empty alpha plane and discard only the skin group, leaving floating eyes and
 * teeth. Remove that meaningless discard path while retaining every RGB/PBR
 * map and the original material instance.
 */
export function stabilizeMobileSkinOpacity(root: THREE.Object3D): number {
  const visited = new Set<THREE.Material>();
  let count = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const candidate of materials) {
      if (!candidate || visited.has(candidate)) continue;
      visited.add(candidate);
      const material = candidate as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      const name = material.name || '';
      if ((!material.isMeshStandardMaterial
          && !(material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial)
        || !DEFAULT_MATCH.test(name)
        || DEFAULT_EXCLUDE.test(name)
        || (material.alphaTest <= 0 && !material.transparent)) continue;
      material.alphaTest = 0;
      material.alphaToCoverage = false;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.needsUpdate = true;
      count += 1;
    }
  });
  return count;
}

function evaluateDiffusion(distance: number): [number, number, number] {
  const rgb: [number, number, number] = [0, 0, 0];
  for (const lobe of PROFILE) {
    const gaussian = Math.exp(-(distance * distance) / (2 * lobe.variance))
      / Math.sqrt(2 * Math.PI * lobe.variance);
    rgb[0] += lobe.weight[0] * gaussian;
    rgb[1] += lobe.weight[1] * gaussian;
    rgb[2] += lobe.weight[2] * gaussian;
  }
  return rgb;
}

/** Build the guide's 64x64 pre-integrated N.L/curvature LUT at runtime. */
export function createSkinDiffusionLut(size = CHARACTER_LOOK_TECHNIQUE.skinLutSize): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  const integrationSamples = 64;

  for (let y = 0; y < size; y++) {
    const curvature = Math.max(0.015, y / (size - 1));
    for (let x = 0; x < size; x++) {
      const ndotl = (x / (size - 1)) * 2 - 1;
      const baseAngle = Math.acos(THREE.MathUtils.clamp(ndotl, -1, 1));
      const integrated = [0, 0, 0];
      let normalization = 0;

      for (let sample = 0; sample < integrationSamples; sample++) {
        const offset = ((sample + 0.5) / integrationSamples * 2 - 1) * Math.PI;
        const distance = Math.abs(offset) / (0.12 + curvature * 2.4);
        const diffusion = evaluateDiffusion(distance);
        const irradiance = Math.max(Math.cos(baseAngle + offset), 0);
        integrated[0] += irradiance * diffusion[0];
        integrated[1] += irradiance * diffusion[1];
        integrated[2] += irradiance * diffusion[2];
        normalization += (diffusion[0] + diffusion[1] + diffusion[2]) / 3;
      }

      const index = (y * size + x) * 4;
      const scale = normalization > 0 ? 1 / normalization : 0;
      pixels[index] = Math.round(THREE.MathUtils.clamp(integrated[0] * scale, 0, 1) * 255);
      pixels[index + 1] = Math.round(THREE.MathUtils.clamp(integrated[1] * scale, 0, 1) * 255);
      pixels[index + 2] = Math.round(THREE.MathUtils.clamp(integrated[2] * scale, 0, 1) * 255);
      pixels[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'ChessAvatarsV2_PennerSkinLUT';
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function getSharedLut(): THREE.DataTexture {
  sharedLut ??= createSkinDiffusionLut();
  return sharedLut;
}

export function applySkinShader(root: THREE.Object3D, options: SkinShaderOptions = {}): SkinShaderHandle {
  const match = options.match ?? DEFAULT_MATCH;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const requestedStrength = options.strength ?? CHARACTER_LOOK.skinShading.strength;
  const newStrengthUniform = { value: requestedStrength };
  const sssLut = getSharedLut();
  const transmittance = { value: new THREE.Color(CHARACTER_LOOK_TECHNIQUE.skinTransmittanceColor) };
  const transmittanceWeight = { value: CHARACTER_LOOK_TECHNIQUE.skinTransmittanceWeight };
  const materials: Array<THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial> = [];
  const strengthUniforms: Array<{ value: number }> = [];
  const visited = new Set<THREE.Material>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const candidates = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const candidate of candidates) {
      if (!candidate || visited.has(candidate)) continue;
      visited.add(candidate);
      const material = candidate as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      const materialName = material.name || '';
      if (!material.isMeshStandardMaterial
        || !match.test(materialName)
        || exclude.test(materialName)) continue;

      materials.push(material);
      const existingStrength = material.userData[STRENGTH_UNIFORM] as { value: number } | undefined;
      const materialStrength = existingStrength ?? newStrengthUniform;
      materialStrength.value = requestedStrength;
      material.userData[STRENGTH_UNIFORM] = materialStrength;
      strengthUniforms.push(materialStrength);
      if (material.userData[PATCH_FLAG]) continue;
      material.userData[PATCH_FLAG] = true;

      const previousCompile = material.onBeforeCompile.bind(material);
      const previousCacheKey = material.customProgramCacheKey.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.uniforms.chessSkinLut = { value: sssLut };
        shader.uniforms.chessSkinStrength = materialStrength;
        shader.uniforms.chessSkinTransmittance = transmittance;
        shader.uniforms.chessSkinTransmittanceWeight = transmittanceWeight;

        const directDiffuseHook = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
        const physicalChunk = THREE.ShaderChunk.lights_physical_pars_fragment;
        const patchedPhysicalChunk = physicalChunk.replace(
          directDiffuseHook,
          [
            directDiffuseHook,
            '// Chess Avatars V2: pre-integrated skin scattering inside direct lighting.',
            '// directLight.color already contains light color/intensity, attenuation and shadow visibility.',
            'float chessSkinNdotL = dot( geometryNormal, directLight.direction );',
            'float chessSkinNormalDerivative = length( fwidth( geometryNormal ) );',
            'float chessSkinPositionDerivative = max( length( fwidth( geometryPosition ) ), 1e-4 );',
            'float chessSkinCurvature = clamp( chessSkinNormalDerivative / chessSkinPositionDerivative * 0.018, 0.0, 1.0 );',
            'vec3 chessSkinIntegrated = texture2D( chessSkinLut, vec2( chessSkinNdotL * 0.5 + 0.5, chessSkinCurvature ) ).rgb;',
            'float chessSkinLambert = max( chessSkinNdotL, 0.0 );',
            'vec3 chessSkinScatter = max( chessSkinIntegrated - vec3( chessSkinLambert ), vec3( 0.0 ) );',
            'float chessSkinBacklight = pow( max( dot( -geometryNormal, directLight.direction ), 0.0 ), 3.0 );',
            'vec3 chessSkinDirectColor = directLight.color * BRDF_Lambert( material.diffuseColor );',
            'reflectedLight.directDiffuse += chessSkinDirectColor * chessSkinScatter * chessSkinStrength;',
            'reflectedLight.directDiffuse += chessSkinDirectColor * chessSkinTransmittance * chessSkinBacklight * chessSkinTransmittanceWeight * chessSkinStrength;',
          ].join('\n\t'),
        );
        if (patchedPhysicalChunk === physicalChunk) {
          throw new Error('Chess Avatars V2 direct-light skin shader hook was not found.');
        }

        const includeHook = '#include <lights_physical_pars_fragment>';
        const declarations = [
          'uniform sampler2D chessSkinLut;',
          'uniform float chessSkinStrength;',
          'uniform vec3 chessSkinTransmittance;',
          'uniform float chessSkinTransmittanceWeight;',
          patchedPhysicalChunk,
        ].join('\n');
        shader.fragmentShader = shader.fragmentShader.replace(includeHook, declarations);
        if (!shader.fragmentShader.includes('chessSkinDirectColor')) {
          throw new Error('Chess Avatars V2 physical-light shader include was not found.');
        }
      };
      material.customProgramCacheKey = () => `${previousCacheKey()}|chess-avatar-v2-penner-sss-v2-direct-light`;
      material.needsUpdate = true;
    }
  });

  const uniqueStrengthUniforms = [...new Set(strengthUniforms)];
  const sssStrength = uniqueStrengthUniforms[0] ?? newStrengthUniform;
  const setStrength = (value: number) => {
    for (const uniform of uniqueStrengthUniforms) uniform.value = value;
    sssStrength.value = value;
  };
  return { count: materials.length, materials, sssStrength, setStrength, sssLut };
}

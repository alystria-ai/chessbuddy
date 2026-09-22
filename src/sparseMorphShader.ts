import * as THREE from 'three';

const PATCH_FLAG = '__chessAvatarSparseMorphShader';
const MAX_MORPH_TARGETS = 251;

type SparseUniformState = {
  count: { value: number };
  indices: { value: Int32Array };
  weights: { value: Float32Array };
};

export type SparseMorphShaderDiagnostics = {
  materialCount: number;
  meshCount: number;
  sampleActiveCount: () => number;
};

const sparsePars = `
#include <morphtarget_pars_vertex>
#ifdef MORPHTARGETS_TEXTURE
  uniform int chessActiveMorphCount;
  uniform int chessActiveMorphIndices[${MAX_MORPH_TARGETS}];
  uniform float chessActiveMorphWeights[${MAX_MORPH_TARGETS}];
#endif
`;

const sparsePosition = `
#ifdef USE_MORPHTARGETS
  transformed *= morphTargetBaseInfluence;
  #ifdef MORPHTARGETS_TEXTURE
    for ( int chessSlot = 0; chessSlot < ${MAX_MORPH_TARGETS}; chessSlot ++ ) {
      if ( chessSlot >= chessActiveMorphCount ) break;
      int chessMorphIndex = chessActiveMorphIndices[ chessSlot ];
      transformed += getMorph( gl_VerID, chessMorphIndex, 0 ).xyz * chessActiveMorphWeights[ chessSlot ];
    }
  #else
    transformed += morphTarget0 * morphTargetInfluences[ 0 ];
    transformed += morphTarget1 * morphTargetInfluences[ 1 ];
    transformed += morphTarget2 * morphTargetInfluences[ 2 ];
    transformed += morphTarget3 * morphTargetInfluences[ 3 ];
    #ifndef USE_MORPHNORMALS
      transformed += morphTarget4 * morphTargetInfluences[ 4 ];
      transformed += morphTarget5 * morphTargetInfluences[ 5 ];
      transformed += morphTarget6 * morphTargetInfluences[ 6 ];
      transformed += morphTarget7 * morphTargetInfluences[ 7 ];
    #endif
  #endif
#endif
`.replace('gl_VerID', 'gl_VertexID');

const sparseNormal = `
#ifdef USE_MORPHNORMALS
  objectNormal *= morphTargetBaseInfluence;
  #ifdef MORPHTARGETS_TEXTURE
    for ( int chessSlot = 0; chessSlot < ${MAX_MORPH_TARGETS}; chessSlot ++ ) {
      if ( chessSlot >= chessActiveMorphCount ) break;
      int chessMorphIndex = chessActiveMorphIndices[ chessSlot ];
      objectNormal += getMorph( gl_VerID, chessMorphIndex, 1 ).xyz * chessActiveMorphWeights[ chessSlot ];
    }
  #else
    objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
    objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
    objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
    objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
  #endif
#endif
`.replace('gl_VerID', 'gl_VertexID');

function updateSparseUniforms(state: SparseUniformState, object: THREE.Object3D): void {
  const influences = (object as THREE.Mesh).morphTargetInfluences;
  if (!influences) {
    state.count.value = 0;
    return;
  }
  let count = 0;
  for (let index = 0; index < influences.length && count < MAX_MORPH_TARGETS; index += 1) {
    const weight = influences[index];
    if (!Number.isFinite(weight) || weight === 0) continue;
    state.indices.value[count] = index;
    state.weights.value[count] = weight;
    count += 1;
  }
  state.count.value = count;
}

/**
 * Three r160's WebGL2 morph shader loops across every target for every vertex,
 * even when nearly all influences are zero. Keep the exact arrays/dictionaries
 * intact, but feed the shader a compact list of the currently active indices.
 * The upper bound remains 251, so no incoming MHA channel is discarded.
 */
export function applySparseMorphShader(root: THREE.Object3D): SparseMorphShaderDiagnostics {
  const materials = new Set<THREE.Material>();
  const states = new Set<SparseUniformState>();
  let meshCount = 0;

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetInfluences?.length || !mesh.material) return;
    meshCount += 1;
    const candidates = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of candidates) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      if (material.userData[PATCH_FLAG]) {
        const existing = material.userData[PATCH_FLAG] as SparseUniformState;
        states.add(existing);
        continue;
      }

      const state: SparseUniformState = {
        count: { value: 0 },
        indices: { value: new Int32Array(MAX_MORPH_TARGETS) },
        weights: { value: new Float32Array(MAX_MORPH_TARGETS) },
      };
      material.userData[PATCH_FLAG] = state;
      states.add(state);

      const previousCompile = material.onBeforeCompile.bind(material);
      const previousBeforeRender = material.onBeforeRender.bind(material);
      const previousCacheKey = material.customProgramCacheKey.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.uniforms.chessActiveMorphCount = state.count;
        shader.uniforms.chessActiveMorphIndices = state.indices;
        shader.uniforms.chessActiveMorphWeights = state.weights;
        shader.vertexShader = shader.vertexShader
          .replace('#include <morphtarget_pars_vertex>', sparsePars)
          .replace('#include <morphtarget_vertex>', sparsePosition)
          .replace('#include <morphnormal_vertex>', sparseNormal);
        if (!shader.vertexShader.includes('chessActiveMorphCount')) {
          throw new Error('Chess Avatars V2 sparse morph shader hooks were not found.');
        }
      };
      material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
        updateSparseUniforms(state, object);
        previousBeforeRender(renderer, scene, camera, geometry, object, group);
      };
      material.customProgramCacheKey = () => `${previousCacheKey()}|chess-avatar-sparse-morph-v1`;
      material.needsUpdate = true;
    }
  });

  return {
    materialCount: materials.size,
    meshCount,
    sampleActiveCount: () => Math.max(0, ...[...states].map((state) => state.count.value)),
  };
}

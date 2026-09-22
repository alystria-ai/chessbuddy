import * as THREE from 'three';

const MORPH_EPSILON = 1e-8;
export const MORPH_TARGETS_OPTIMIZED_FLAG = '__chessAvatarZeroDeltaMorphsOptimized';

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

export type MorphOptimizationDiagnostics = {
  meshCount: number;
  targetSlotsBefore: number;
  targetSlotsAfter: number;
  effectiveChannelCount: number;
  coverageChannelCount: number;
  anchorMesh: string | null;
};

function isMorphMesh(object: THREE.Object3D): object is MorphMesh {
  const mesh = object as MorphMesh;
  return Boolean(
    mesh.isMesh
    && mesh.geometry
    && mesh.morphTargetDictionary
    && mesh.morphTargetInfluences
    && Object.keys(mesh.morphTargetDictionary).length,
  );
}

function attributeHasDelta(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean {
  const array = attribute.array as ArrayLike<number>;
  for (let index = 0; index < array.length; index += 1) {
    if (Math.abs(Number(array[index])) > MORPH_EPSILON) return true;
  }
  return false;
}

function effectiveTargetIndices(mesh: MorphMesh): Set<number> {
  const effective = new Set<number>();
  for (const attributes of Object.values(mesh.geometry.morphAttributes)) {
    for (let index = 0; index < attributes.length; index += 1) {
      if (!effective.has(index) && attributeHasDelta(attributes[index])) effective.add(index);
    }
  }
  return effective;
}

/**
 * Remove per-primitive morph slots whose position/normal/tangent deltas are
 * entirely zero. MetaHuman exports repeat all 251 slots on eyes, teeth,
 * lashes, and oral meshes even though most cannot affect that primitive;
 * Three's WebGL2 shader still loops over every repeated slot for every vertex.
 *
 * All visually effective targets are retained. Globally zero contract names
 * are retained on the smallest primitive as no-op coverage anchors, so the
 * adapter still discovers and processes the exact 251-channel wire contract.
 * This runs before Convai becomes active, which is the only safe time to
 * replace the influence arrays and dictionaries.
 */
export function optimizeZeroDeltaMorphTargets(
  root: THREE.Object3D,
  contractChannels: readonly string[],
): MorphOptimizationDiagnostics {
  const meshes: MorphMesh[] = [];
  root.traverse((object) => {
    if (isMorphMesh(object)) meshes.push(object);
  });

  const effectiveByMesh = new Map<MorphMesh, Set<number>>();
  const globallyEffective = new Set<string>();
  let targetSlotsBefore = 0;

  for (const mesh of meshes) {
    const effective = effectiveTargetIndices(mesh);
    effectiveByMesh.set(mesh, effective);
    targetSlotsBefore += mesh.morphTargetInfluences.length;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      if (effective.has(index)) globallyEffective.add(name);
    }
  }

  const globallyZeroContractNames = contractChannels.filter((name) => !globallyEffective.has(name));
  const anchor = meshes.reduce<MorphMesh | null>((smallest, mesh) => {
    if (!globallyZeroContractNames.every((name) => name in mesh.morphTargetDictionary)) return smallest;
    const vertices = mesh.geometry.getAttribute('position')?.count ?? Number.POSITIVE_INFINITY;
    const smallestVertices = smallest?.geometry.getAttribute('position')?.count ?? Number.POSITIVE_INFINITY;
    return vertices < smallestVertices ? mesh : smallest;
  }, null);

  let targetSlotsAfter = 0;
  for (const mesh of meshes) {
    const keep = new Set(effectiveByMesh.get(mesh));
    if (mesh === anchor) {
      for (const name of globallyZeroContractNames) keep.add(mesh.morphTargetDictionary[name]);
    }
    const keepIndices = [...keep].sort((left, right) => left - right);
    if (keepIndices.length === mesh.morphTargetInfluences.length) {
      targetSlotsAfter += keepIndices.length;
      continue;
    }

    const oldInfluences = mesh.morphTargetInfluences;
    const oldDictionary = mesh.morphTargetDictionary;
    const morphAttributes = mesh.geometry.morphAttributes as Record<
      string,
      Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>
    >;
    for (const [semantic, attributes] of Object.entries(morphAttributes)) {
      morphAttributes[semantic] = keepIndices.map((index) => attributes[index]);
    }

    const newDictionary: Record<string, number> = {};
    const namesByOldIndex = Object.entries(oldDictionary).sort((left, right) => left[1] - right[1]);
    const oldToNew = new Map(keepIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    for (const [name, oldIndex] of namesByOldIndex) {
      const newIndex = oldToNew.get(oldIndex);
      if (newIndex !== undefined) newDictionary[name] = newIndex;
    }

    mesh.morphTargetDictionary = newDictionary;
    mesh.morphTargetInfluences = keepIndices.map((index) => oldInfluences[index] ?? 0);
    mesh.userData[MORPH_TARGETS_OPTIMIZED_FLAG] = true;
    targetSlotsAfter += keepIndices.length;
  }

  const coverage = new Set<string>();
  for (const mesh of meshes) {
    for (const name of Object.keys(mesh.morphTargetDictionary)) coverage.add(name);
  }

  return {
    meshCount: meshes.length,
    targetSlotsBefore,
    targetSlotsAfter,
    effectiveChannelCount: globallyEffective.size,
    coverageChannelCount: contractChannels.filter((name) => coverage.has(name)).length,
    anchorMesh: anchor?.name ?? null,
  };
}

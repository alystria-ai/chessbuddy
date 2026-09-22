import * as THREE from 'three';

/**
 * Arjun-only geometry repair for his CC4 export defect.
 *
 * Arjun's `CC_Base_Eye` ships with ~186 triangles of the character-LEFT
 * cornea's front dome misassigned to the OPAQUE right-sclera primitive
 * (material `Std_Eye_R`): that primitive's vertices span BOTH eyes, while the
 * real `Std_Cornea_L` primitive contains only the back band of the shell.
 * Rendered with the opaque, depth-writing, brightness-boosted sclera
 * material, the stray dome floats slightly proud of the left eyeball at
 * cornea radius — so when the upper lid lowers (blink / look-down), the lid
 * passes UNDER it near the corner and bright "eye white" cuts through the
 * eyelid (the user-visible bug on his screen-right eye). Every earlier
 * material/occlusion band-aid failed because none of them touched this
 * misassigned patch.
 *
 * The repair is two-part, both verified in-browser:
 *  1. DELETE the stray triangles at load (index rewrite, keeping only the
 *     true right-eye triangles). Re-materialing them as a transparent cornea
 *     was tried first and still left a glossy white smudge in front of the
 *     closed lid — the stray shell sits proud of where the lid closes, so
 *     any visible rendering of it is wrong. The real left eyeball
 *     (`Std_Eye_L`) is complete underneath, so eyes-open renders normally
 *     and both eyes stay symmetric.
 *  2. SHRINK the left eyeball (`Std_Eye_L`) 3% toward its own centroid.
 *     With the dome gone, a 2-3px sliver of the real sclera still poked
 *     through the closed lid at the upper-outer corner — on every other
 *     coach that junction is masked by the `Std_Eye_Occlusion` shell, which
 *     Arjun's export also lacks. The inward shrink tucks the ball fully
 *     behind the lid; at portrait distance the size difference is invisible
 *     (verified open-eye capture).
 *
 * Guarded three ways so no other character can ever be affected:
 *  1. caller gates on assetName === 'Tyler' (Arjun);
 *  2. only meshes with the exact `Std_Eye_R`/`Std_Eye_L` single materials
 *     are considered;
 *  3. everything only runs if the `Std_Eye_R` mesh's vertices actually span
 *     both X signs (a healthy export is single-sided), so the pass
 *     self-disables if the asset is ever properly re-exported.
 */
const LEFT_EYE_SHRINK = 0.97;

export function repairArjunEyeGeometry(root: THREE.Object3D): number {
  let removedTriangles = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    if (!/^Std_Eye_R/.test(mesh.material?.name || '')) return;

    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!position || !index) return;

    // Healthy exports keep each eye primitive on one side of X=0.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    const spansBothEyes = minX < 0 && maxX > 0 && Math.min(-minX, maxX) > 0.005;
    if (!spansBothEyes) return;

    // Keep only triangles on the character-right side (negative local X —
    // the sign test survives quantized/meshopt attributes).
    const kept: number[] = [];
    let dropped = 0;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      const centroidX = position.getX(a) + position.getX(b) + position.getX(c);
      if (centroidX > 0) {
        dropped++;
      } else {
        kept.push(a, b, c);
      }
    }
    if (!dropped || !kept.length) return;

    geometry.setIndex(kept);
    removedTriangles += dropped;
  });

  // Part 2 only makes sense when the export defect was actually present.
  if (removedTriangles > 0) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      if (!/^Std_Eye_L/.test(mesh.material?.name || '')) return;
      const position = mesh.geometry.getAttribute('position');
      if (!position) return;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < position.count; i++) {
        cx += position.getX(i);
        cy += position.getY(i);
        cz += position.getZ(i);
      }
      cx /= position.count;
      cy /= position.count;
      cz /= position.count;
      for (let i = 0; i < position.count; i++) {
        position.setXYZ(
          i,
          cx + (position.getX(i) - cx) * LEFT_EYE_SHRINK,
          cy + (position.getY(i) - cy) * LEFT_EYE_SHRINK,
          cz + (position.getZ(i) - cz) * LEFT_EYE_SHRINK,
        );
      }
      position.needsUpdate = true;
    });
  }

  return removedTriangles;
}

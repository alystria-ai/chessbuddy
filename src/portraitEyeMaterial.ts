import * as THREE from "three";

/**
 * Eye material fix-up for CC4 glTF exports.
 *
 * The CC4 exporter ships every eye-related material (sclera/iris, cornea,
 * tearline, occlusion, lashes) with `roughness: 1, metalness: 1` — a fully
 * metallic, fully rough surface reflects almost nothing, so the eyes render
 * matte and dead: no catchlight, grey sclera. Values below were tuned live
 * against the Unreal MetaHuman reference footage:
 *
 * - Sclera/iris (`Std_Eye_L/R`): dielectric, moderately glossy, with the
 *   albedo lifted (the CC4 eye map bakes in too much darkening).
 * - Cornea (`Std_Cornea_L/R`): the wet dome over the iris — near-mirror
 *   gloss + clearcoat and boosted env reflection; this is what gives the
 *   eye its living catchlight from the key light / window.
 * - Tearline: glossy wet seam where lid meets eyeball.
 * - Occlusion: soft contact-shadow overlay; just needs metalness cleared.
 * - Lashes: dark hair, not metal.
 *
 * Mutates the existing materials in place (keeps maps, skinning, morphs).
 *
 * Ported from the convai-web-sdk neurosync-visual-react example
 * (src/shaders/eyeMaterial.ts) — keep the two in sync.
 */
export function applyEyeShader(root: THREE.Object3D): { count: number } {
  let count = 0;

  const tweak = (m: THREE.Material) => {
    const mat = m as THREE.MeshPhysicalMaterial;
    const name = mat.name || "";

    if (/^Std_Eye_[LR]/.test(name)) {
      mat.metalness = 0;
      mat.roughness = 0.3;
      mat.envMapIntensity = 1.4;
      mat.color.setRGB(1.2, 1.2, 1.2);
    } else if (/^Std_Cornea/.test(name)) {
      mat.metalness = 0;
      mat.roughness = 0.02;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.envMapIntensity = 2.5;
      if ("specularIntensity" in mat) mat.specularIntensity = 1.6;
      if ("clearcoat" in mat) {
        mat.clearcoat = 1;
        mat.clearcoatRoughness = 0.02;
      }
    } else if (/^Std_Tearline/.test(name)) {
      mat.metalness = 0;
      mat.roughness = 0.05;
      mat.envMapIntensity = 1.5;
    } else if (/^Std_Eye_Occlusion/.test(name)) {
      mat.metalness = 0;
    } else if (/^Std_Eyelash/.test(name)) {
      mat.metalness = 0;
      mat.roughness = 0.6;
    } else if (/^Eyes$/i.test(name)) {
      // MetaHuman rig (Sofia) ships one combined eye material (sclera + iris +
      // cornea baked together) instead of the CC4 Std_Eye_/Std_Cornea split.
      // Glossy dielectric so the eye keeps a living catchlight.
      mat.metalness = 0;
      mat.roughness = 0.25;
      mat.envMapIntensity = 1.5;
    } else {
      return;
    }
    mat.needsUpdate = true;
    count++;
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(tweak);
  });

  return { count };
}

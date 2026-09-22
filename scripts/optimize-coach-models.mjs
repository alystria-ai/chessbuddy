/**
 * Optimize coach character GLBs for web + mobile delivery.
 *
 * The raw CC4 exports in assets-src/ are 99-182 MB each and carry 349-437 morph
 * targets per mesh. Three.js uploads morphs as one DataArrayTexture layer per
 * target, so the raw files need >2 GB of GPU memory and exceed the 256-layer
 * cap of many mobile GPUs (Mali/Samsung) — the portrait never renders there,
 * and iOS Safari kills the tab while decoding. This script:
 *
 *   1. Prunes morph targets to the set actually driven at runtime
 *      (MHA-251 normalized-name matching in src/mhaToMorphMap.ts, C_*
 *       correctives from CORRECTIVE_DEFS in src/mhaCorrectives.ts, and
 *       src/portraitBlink.ts Eye_Blink_L/R — regenerate the list with
 *       scripts/generate-morph-keep-list.mjs).
 *   2. Drops all morph targets from primitives where every kept morph is
 *      all-zero (arms/legs/torso/clothing carry face morphs as zero deltas).
 *   3. Resizes + re-encodes textures to WebP (per-region budgets; the mobile
 *      variant gets half resolution and loses clearcoat/specular extensions).
 *   4. Re-compresses geometry with quantization + EXT_meshopt_compression
 *      (drei's useGLTF ships a meshopt decoder by default).
 *
 * Usage:
 *   node scripts/optimize-coach-models.mjs               # all models, both variants
 *   node scripts/optimize-coach-models.mjs leila         # one model
 *   node scripts/optimize-coach-models.mjs --variant=mobile
 *
 * Reads from assets-src/, writes <name>.glb (desktop) and <name>.mobile.glb
 * into public/. Keep-list must stay in sync with scripts/portrait-morph-keep.json
 * (checked by src/coachModelKeepList.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, listTextureSlots, meshopt, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'assets-src');
const OUT_DIR = path.join(ROOT, 'public');
const KEEP_LIST_PATH = path.join(ROOT, 'scripts', 'portrait-morph-keep.json');

/**
 * correctives:false mirrors LIPSYNC_PROFILES[asset].skipCorrectives (Leila).
 * repairNoseRegion: the leila (cc-female) export's mouth visemes (V_Open, funnels, ...)
 * drag nostril vertices with them, which forced the runtime to block those
 * shapes and hide the teeth. Zeroing morph deltas around the nose (smooth
 * falloff) fixes the source data so the runtime can use the full viseme set.
 */
const MODELS = {
  leila: {
    correctives: false,
    repairNoseRegion: true,
    // Leila's cc-female export ships ~3x the triangles of the other coaches
    // (656k vs ~200k) and her 67k-vert face primitive carries all 274 visemes,
    // so her per-frame morph vertex-shader work is ~20M vs ~11M. Nothing else in
    // this pipeline decimates geometry, so her portrait pinned the render loop
    // and made lipsync look like slow motion on desktop. Decimate her skin body
    // to bring geometry + morph work in line with the others. Ratios are tuned
    // so the viseme-bearing face stays ~2x denser than the male heads (lipsync
    // detail intact) while the near-morphless body splits go harder. Tune the
    // ratios here if you want more perf (lower) or more fidelity (higher).
    simplify: {
      meshPattern: /^CC_Base_Body/,
      faceRatio: 0.5,
      bodyRatio: 0.33,
      faceMorphThreshold: 50,
      error: 0.01,
    },
  },
  magnus: { correctives: true },
  arjun: { correctives: true },
  // NOTE: Sofia is no longer a CC4 export — she is now a MetaHuman rig prepared
  // by scripts/prep-sofia-metahuman.mjs (npm run models:sofia), not this
  // pipeline. Do not add her back here.
};

/** Morphs whose strong deltas define the nose region (evaluated pre-prune). */
const NOSE_REGION_SOURCE = /^Nose_Nostril_/i;
/** Only meshes that actually contain nostril geometry. */
const NOSE_REPAIR_MESH = /^CC_Base_Body/i;
/**
 * Per-vertex "noseness" = |delta| / maxDelta under the nostril morphs.
 * Deltas of other morphs are attenuated by 1 - smoothstep(LO, HI, noseness):
 * untouched below LO, fully pinned above HI, smooth in between (no seams).
 */
const NOSE_LO = 0.12;
const NOSE_HI = 0.55;

/** Longest side per texture region. Mobile halves most regions. */
const TEXTURE_BUDGETS = {
  web: { head: 2048, hair: 2048, cloth: 2048, body: 1024, eye: 1024, mouth: 1024, occlusion: 512 },
  mobile: { head: 1024, hair: 1024, cloth: 1024, body: 512, eye: 512, mouth: 512, occlusion: 512 },
};

const WEBP_QUALITY = {
  web: { color: 85, normal: 90, other: 82 },
  mobile: { color: 80, normal: 88, other: 78 },
};

const NONZERO_EPSILON = 1e-8;

/**
 * A morph counts as significantly deforming a primitive when at least one of its
 * vertices moves more than this (model units ~= metres). Leila's CC4 export
 * carries all ~270 face morphs on every body primitive with sub-noise deltas;
 * the real face morphs move by >1e-2 while the dead spillover sits below 1e-4,
 * so the threshold is comfortably inside a clean gap (measured per mesh).
 */
const SIGNIFICANT_MORPH_DISP = 1e-3;

function targetMaxDisplacement(target) {
  const accessor = target ? target.getAttribute('POSITION') : null;
  const array = accessor ? accessor.getArray() : null;
  if (!array) return 0;
  let max = 0;
  for (let i = 0; i + 2 < array.length; i += 3) {
    const d = Math.hypot(array[i], array[i + 1], array[i + 2]);
    if (d > max) max = d;
  }
  return max;
}

function classifyTextureRegion(name) {
  if (/occlusion/i.test(name)) return 'occlusion';
  if (/skin_head/i.test(name)) return 'head';
  if (/hair|scalp|beard|brow|blend/i.test(name)) return 'hair';
  if (/skin_(body|arm|leg)|nails/i.test(name)) return 'body';
  if (/eye|cornea|tear|lash/i.test(name)) return 'eye';
  if (/teeth|tongue/i.test(name)) return 'mouth';
  return 'cloth';
}

function loadKeepList() {
  const data = JSON.parse(fs.readFileSync(KEEP_LIST_PATH, 'utf8'));
  return new Set(data.keepMorphs);
}

/** Mirrors norm()/resolveToken() in src/cc4Correctives.ts buildCC4Correctives. */
function isRuntimeUsableCorrective(name, keptBaseNames) {
  if (!/^C_/i.test(name)) return false;
  if (/Jaw(Open|Fwd|Forward)/i.test(name)) return false;
  const tokens = name.split('_').slice(1);
  if (tokens.length < 2) return false;
  const normalizedBases = keptBaseNames.map((n) => n.replace(/_/g, '').toLowerCase());
  return tokens.every((token) => {
    const t = token.replace(/_/g, '').toLowerCase();
    return normalizedBases.some((base) => base.endsWith(t));
  });
}

function targetHasNonzeroDelta(target) {
  for (const semantic of target.listSemantics()) {
    const accessor = target.getAttribute(semantic);
    const array = accessor ? accessor.getArray() : null;
    if (!array) continue;
    for (let i = 0; i < array.length; i++) {
      if (Math.abs(array[i]) > NONZERO_EPSILON) return true;
    }
  }
  return false;
}

/**
 * Zero mouth-morph deltas around the nose (with smooth falloff) so visemes
 * cannot deform the nostrils. The nose region is located data-driven: it is
 * the set of vertices moved by the NOSE_REGION_SOURCE morphs (nostril,
 * wrinkle, nasolabial), evaluated per primitive BEFORE pruning removes those
 * morphs. Runs on every morph that survives pruning — morphs with no deltas
 * near the nose are untouched.
 */
function repairNoseRegionDeltas(document, log) {
  const processed = new Set();
  for (const mesh of document.getRoot().listMeshes()) {
    if (!NOSE_REPAIR_MESH.test(mesh.getName())) continue;
    const extras = mesh.getExtras() ?? {};
    const targetNames = Array.isArray(extras.targetNames) ? extras.targetNames : null;
    if (!targetNames) continue;
    const noseIndices = targetNames
      .map((name, index) => (NOSE_REGION_SOURCE.test(name) ? index : -1))
      .filter((index) => index >= 0);
    if (!noseIndices.length) continue;

    for (const prim of mesh.listPrimitives()) {
      const targets = prim.listTargets();
      if (!targets.length) continue;
      const basePos = prim.getAttribute('POSITION');
      const base = basePos ? basePos.getArray() : null;
      if (!base) continue;
      const vertexCount = basePos.getCount();

      // Per-vertex noseness from the nostril morphs' own delta magnitudes.
      const noseness = new Float32Array(vertexCount);
      for (const index of noseIndices) {
        const acc = targets[index]?.getAttribute('POSITION');
        const arr = acc ? acc.getArray() : null;
        if (!arr) continue;
        let maxSq = 0;
        for (let v = 0; v < vertexCount; v++) {
          const o = v * 3;
          const dSq = arr[o] * arr[o] + arr[o + 1] * arr[o + 1] + arr[o + 2] * arr[o + 2];
          if (dSq > maxSq) maxSq = dSq;
        }
        if (maxSq < 1e-14) continue;
        const max = Math.sqrt(maxSq);
        for (let v = 0; v < vertexCount; v++) {
          const o = v * 3;
          const d = Math.sqrt(arr[o] * arr[o] + arr[o + 1] * arr[o + 1] + arr[o + 2] * arr[o + 2]) / max;
          if (d > noseness[v]) noseness[v] = d;
        }
      }

      // Attenuation per vertex: 1 below LO (untouched), 0 above HI (pinned).
      const weight = new Float32Array(vertexCount);
      let pinned = 0;
      for (let v = 0; v < vertexCount; v++) {
        const n = noseness[v];
        if (n <= NOSE_LO) weight[v] = 1;
        else if (n >= NOSE_HI) { weight[v] = 0; pinned++; }
        else {
          const t = (n - NOSE_LO) / (NOSE_HI - NOSE_LO);
          weight[v] = 1 - t * t * (3 - 2 * t);
        }
      }
      if (!pinned) continue;

      let repaired = 0;
      for (let index = 0; index < targets.length; index++) {
        if (noseIndices.includes(index)) continue; // the nose morphs themselves stay intact
        const acc = targets[index]?.getAttribute('POSITION');
        if (!acc || processed.has(acc)) continue;
        processed.add(acc);
        const arr = acc.getArray();
        if (!arr) continue;
        let touched = false;
        for (let v = 0; v < vertexCount; v++) {
          const w = weight[v];
          if (w >= 1) continue;
          const o = v * 3;
          if (arr[o] === 0 && arr[o + 1] === 0 && arr[o + 2] === 0) continue;
          arr[o] *= w;
          arr[o + 1] *= w;
          arr[o + 2] *= w;
          touched = true;
        }
        if (touched) {
          acc.setArray(arr);
          repaired++;
        }
      }
      if (repaired) {
        log(`  nose repair ${mesh.getName()}: ${pinned} verts pinned (graded falloff) across ${repaired} morphs`);
      }
    }
  }
}

/**
 * Prune morph targets across the document.
 * - Every mesh keeps only morphs in the keep set (plus usable C_* correctives).
 * - A kept morph survives on a mesh only if it deforms at least one primitive.
 * - Primitives where every kept morph is all-zero lose their targets entirely
 *   (GLTFLoader only builds morph state for primitives that have targets, and
 *   mesh naming is unaffected, so runtime name-based lookups keep working).
 */
function pruneMorphTargets(document, { correctives, keepSet, log }) {
  for (const mesh of document.getRoot().listMeshes()) {
    const extras = mesh.getExtras() ?? {};
    const targetNames = Array.isArray(extras.targetNames) ? extras.targetNames : null;
    const prims = mesh.listPrimitives();
    const primTargets = prims.map((prim) => prim.listTargets());
    const targetCount = Math.max(0, ...primTargets.map((t) => t.length));
    if (!targetCount) continue;

    if (!targetNames || targetNames.length !== targetCount) {
      throw new Error(
        `Mesh "${mesh.getName()}" has ${targetCount} morph targets but extras.targetNames has ` +
        `${targetNames ? targetNames.length : 0} entries — cannot prune safely.`,
      );
    }

    const keptBaseNames = targetNames.filter((name) => keepSet.has(name));
    const keptNames = targetNames.filter(
      (name) => keepSet.has(name) || (correctives && isRuntimeUsableCorrective(name, keptBaseNames)),
    );
    const keptIndices = keptNames.map((name) => targetNames.indexOf(name));

    // Which kept morphs actually deform which primitive?
    const primNonzero = primTargets.map((targets) => {
      if (!targets.length) return null;
      return keptIndices.map((index) => targetHasNonzeroDelta(targets[index]));
    });

    // Mesh-wide morph list: kept morphs that deform at least one primitive.
    const meshMask = keptIndices.map((_, j) => primNonzero.some((nz) => nz && nz[j]));
    const finalNames = keptNames.filter((_, j) => meshMask[j]);
    const finalIndices = keptIndices.filter((_, j) => meshMask[j]);

    for (let p = 0; p < prims.length; p++) {
      const targets = primTargets[p];
      if (!targets.length) continue;
      const primKeepsTargets = primNonzero[p].some(Boolean);
      const survivors = primKeepsTargets ? finalIndices.map((index) => targets[index]) : [];
      const survivorSet = new Set(survivors);
      for (const target of targets) prims[p].removeTarget(target);
      for (const target of survivors) prims[p].addTarget(target);
      for (const target of targets) {
        if (!survivorSet.has(target)) target.dispose();
      }
    }

    const nextExtras = { ...extras };
    if (finalNames.length) nextExtras.targetNames = finalNames;
    else delete nextExtras.targetNames;
    mesh.setExtras(nextExtras);
    mesh.setWeights(finalNames.length ? new Array(finalNames.length).fill(0) : []);

    const perPrim = prims
      .map((_, p) => {
        if (!primTargets[p].length) return '0';
        return primNonzero[p].some(Boolean) ? String(finalNames.length) : '0';
      })
      .join('/');
    log(`  morphs ${mesh.getName()}: ${targetCount} -> ${finalNames.length} (per prim: ${perPrim})`);
  }
}

/**
 * Split multi-primitive morph meshes so each primitive carries ONLY the morph
 * targets that significantly deform it. glTF forces every primitive of a mesh to
 * share the same morph set, so a CC4 body mesh whose face primitive needs ~266
 * morphs drags all 266 onto the torso/arm primitives that use a handful — the
 * vertex shader then samples a 250-layer morph texture across ~140k body verts
 * every frame for nothing. On Leila that was 60M morph-samples/frame (vs Arjun's
 * 13M), which pinned her portrait at ~8fps while speaking and made lipsync look
 * like slow motion. Moving each body primitive to its own mesh with its own
 * (much smaller) morph set is geometry- and visually-neutral — a morph that
 * actually moves a primitive is kept; only sub-threshold spillover is dropped.
 */
function splitMorphPrimitives(document, log) {
  const root = document.getRoot();
  for (const mesh of root.listMeshes()) {
    const prims = mesh.listPrimitives();
    if (prims.length < 2) continue;
    const extras = mesh.getExtras() ?? {};
    const targetNames = Array.isArray(extras.targetNames) ? extras.targetNames : null;
    const meshTargetCount = Math.max(0, ...prims.map((p) => p.listTargets().length));
    if (!meshTargetCount || !targetNames || targetNames.length !== meshTargetCount) continue;

    const sigCount = prims.map((p) => {
      const targets = p.listTargets();
      if (!targets.length) return 0;
      return targets.reduce((n, t) => n + (targetMaxDisplacement(t) > SIGNIFICANT_MORPH_DISP ? 1 : 0), 0);
    });
    const maxSig = Math.max(...sigCount);
    if (!maxSig) continue;
    // Only worth splitting when some primitive uses < half the mesh's morphs.
    const beneficial = prims.some((p, i) => p.listTargets().length && sigCount[i] < maxSig * 0.5);
    if (!beneficial) continue;

    const nodes = root.listNodes().filter((n) => n.getMesh() === mesh);
    if (nodes.length !== 1) {
      log(`  split skip ${mesh.getName()} (referenced by ${nodes.length} nodes)`);
      continue;
    }
    const srcNode = nodes[0];
    const skin = srcNode.getSkin();
    const parentNode = srcNode.getParentNode();
    const scene = parentNode ? null : root.listScenes().find((s) => s.listChildren().includes(srcNode));
    // The face primitive stays in the original mesh and keeps its FULL morph
    // set untouched — its sub-millimetre lip morphs still add visible detail, so
    // trimming it would cost lipsync quality for negligible perf. Only the body
    // primitives (which carry the face set as dead weight) are split + trimmed.
    const keepIdx = sigCount.indexOf(maxSig);

    // Trim a primitive to its own significant targets and record their names.
    // Targets share the mesh-wide order, so the snapshot index maps into
    // targetNames; iterate a stable copy while removing the dead ones.
    const trimToSignificant = (prim, targetMesh) => {
      const keptNames = [];
      prim.listTargets().forEach((target, idx) => {
        if (targetMaxDisplacement(target) > SIGNIFICANT_MORPH_DISP) keptNames.push(targetNames[idx]);
        else prim.removeTarget(target);
      });
      const ex = { ...(targetMesh.getExtras() ?? {}) };
      if (keptNames.length) ex.targetNames = keptNames;
      else delete ex.targetNames;
      targetMesh.setExtras(ex);
      targetMesh.setWeights(keptNames.length ? new Array(keptNames.length).fill(0) : []);
      return keptNames.length;
    };

    let split = 0;
    prims.forEach((prim, i) => {
      if (i === keepIdx) return;
      mesh.removePrimitive(prim);
      const newMesh = document.createMesh(`${mesh.getName()}_split${i}`);
      newMesh.addPrimitive(prim);
      const kept = trimToSignificant(prim, newMesh);
      const newNode = document
        .createNode(`${srcNode.getName()}_split${i}`)
        .setMesh(newMesh)
        .setTranslation(srcNode.getTranslation())
        .setRotation(srcNode.getRotation())
        .setScale(srcNode.getScale());
      if (skin) newNode.setSkin(skin);
      if (parentNode) parentNode.addChild(newNode);
      else if (scene) scene.addChild(newNode);
      log(`  split ${mesh.getName()} prim#${i}: ${meshTargetCount} -> ${kept} morphs`);
      split++;
    });
    log(`  split ${mesh.getName()}: face keeps ${meshTargetCount} morphs, ${split} primitive(s) detached`);
  }
}

/**
 * Decimate heavy skin geometry with the meshopt simplifier (via gltf-transform's
 * simplifyPrimitive, which preserves morph targets AND skin weights). Scoped by
 * mesh-name pattern so only the dense body/head skin is reduced — hair cards,
 * lashes, brows, eyes, teeth and tongue are never touched. Runs AFTER
 * splitMorphPrimitives so the face primitive (which keeps the full viseme set)
 * can be decimated more gently than the near-morphless body splits.
 *
 * Weld first: the simplifier collapses edges across WELDED connectivity, and the
 * raw CC4 export duplicates verts at every UV/normal seam. weld never merges
 * verts that differ in any morph delta (or skin weight), so visemes survive.
 * lockBorder keeps each primitive's boundary edges, so the split body seams and
 * the neck/wrist openings cannot crack when adjacent primitives are decimated
 * independently. prune()/dedup() (run next in optimizeModel) compacts the now
 * unreferenced source vertices, which is what shrinks the morph textures.
 */
async function simplifyHeavyGeometry(document, config, log) {
  const { meshPattern, faceRatio, bodyRatio, faceMorphThreshold, error } = config;
  await document.transform(weld());
  let triBefore = 0;
  let triAfter = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    if (!meshPattern.test(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const morphs = prim.listTargets().length;
      const ratio = morphs >= faceMorphThreshold ? faceRatio : bodyRatio;
      const before = (prim.getIndices()?.getCount() ?? 0) / 3;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: true });
      const after = (prim.getIndices()?.getCount() ?? 0) / 3;
      triBefore += before;
      triAfter += after;
      log(
        `  simplify ${mesh.getName()} (${morphs} morphs @ratio ${ratio}): ` +
        `${Math.round(before).toLocaleString()} -> ${Math.round(after).toLocaleString()} tris`,
      );
    }
  }
  log(`  simplify total: ${Math.round(triBefore).toLocaleString()} -> ${Math.round(triAfter).toLocaleString()} tris`);
}

/** Drop clearcoat/specular so mobile gets cheaper MeshStandardMaterial shaders. */
function stripPhysicalExtensions(document, log) {
  let stripped = 0;
  for (const material of document.getRoot().listMaterials()) {
    for (const ext of ['KHR_materials_clearcoat', 'KHR_materials_specular']) {
      if (material.getExtension(ext)) {
        material.setExtension(ext, null);
        stripped++;
      }
    }
  }
  if (stripped) log(`  stripped ${stripped} clearcoat/specular material extension(s)`);
}

async function compressTextures(document, variant, log) {
  const budgets = TEXTURE_BUDGETS[variant];
  const quality = WEBP_QUALITY[variant];
  document.createExtension(EXTTextureWebP).setRequired(true);

  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const slots = listTextureSlots(texture);
    const label = `${texture.getName()} ${texture.getURI()}`;
    const region = classifyTextureRegion(label);
    const isNormal = slots.some((slot) => /normal/i.test(slot));
    const isColor = slots.some((slot) => /baseColor|emissive/i.test(slot));
    const maxSize = budgets[region];
    const q = isNormal ? quality.normal : isColor ? quality.color : quality.other;

    const before = image.byteLength;
    const encoded = await sharp(Buffer.from(image))
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer();
    texture.setImage(new Uint8Array(encoded));
    texture.setMimeType('image/webp');
    log(
      `  texture ${texture.getName() || '(unnamed)'} [${region}${isNormal ? ',normal' : ''}] ` +
      `${(before / 1024).toFixed(0)}KB -> ${(encoded.byteLength / 1024).toFixed(0)}KB @<=${maxSize}px q${q}`,
    );
  }
}

async function optimizeModel(io, name, variant, keepSet) {
  const srcPath = path.join(SRC_DIR, `${name}.glb`);
  const outPath = path.join(OUT_DIR, variant === 'mobile' ? `${name}.mobile.glb` : `${name}.glb`);
  const log = (message) => console.log(message);

  console.log(`\n=== ${name} (${variant}) ===`);
  const document = await io.read(srcPath);

  // Geometry is decoded on read; drop the draco extension so the writer does
  // not look for an encoder (meshopt() adds EXT_meshopt_compression instead).
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }

  if (MODELS[name].repairNoseRegion) {
    repairNoseRegionDeltas(document, log);
  }
  pruneMorphTargets(document, { correctives: MODELS[name].correctives, keepSet, log });
  splitMorphPrimitives(document, log);
  if (MODELS[name].simplify) await simplifyHeavyGeometry(document, MODELS[name].simplify, log);
  if (variant === 'mobile') stripPhysicalExtensions(document, log);

  await document.transform(prune(), dedup());
  await compressTextures(document, variant, log);
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  await io.write(outPath, document);
  const srcSize = fs.statSync(srcPath).size;
  const outSize = fs.statSync(outPath).size;
  console.log(
    `  wrote ${path.relative(ROOT, outPath)}: ${(srcSize / 1e6).toFixed(1)}MB -> ${(outSize / 1e6).toFixed(1)}MB`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const variantArg = args.find((a) => a.startsWith('--variant='))?.split('=')[1] ?? 'both';
  const variants = variantArg === 'both' ? ['web', 'mobile'] : [variantArg];
  const modelNames = args.filter((a) => !a.startsWith('--'));
  const names = modelNames.length ? modelNames : Object.keys(MODELS);

  for (const name of names) {
    if (!MODELS[name]) throw new Error(`Unknown model "${name}". Known: ${Object.keys(MODELS).join(', ')}`);
    if (!fs.existsSync(path.join(SRC_DIR, `${name}.glb`))) {
      throw new Error(`Missing source ${name}.glb in assets-src/`);
    }
  }
  for (const variant of variants) {
    if (variant !== 'web' && variant !== 'mobile') throw new Error(`Unknown variant "${variant}"`);
  }

  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });

  const keepSet = loadKeepList();
  for (const name of names) {
    for (const variant of variants) {
      await optimizeModel(io, name, variant, keepSet);
    }
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

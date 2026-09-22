/**
 * Prep the MetaHuman-rigged Sofia assets for web + mobile delivery.
 *
 * Unlike the CC4 coaches (scripts/optimize-coach-models.mjs), Sofia is a
 * MetaHuman export: her morph targets are the raw MHA-251 `CTRL_expressions_*`
 * controls (which the lipsync runtime maps 1:1 by normalized name), she has no
 * jaw/teeth bones (jawOpen is a morph), and her mesh is already light
 * (~78k tris, 251 morphs on a 6.9k-tri face). So this script does NOT prune
 * morphs, split primitives or decimate geometry — it just makes the three
 * source files web-ready:
 *
 *   assets-src/sofia.glb (Full MH, 251 shapes) ....→ public/sofia.glb        (desktop)
 *   assets-src/sofia-lite.glb (Lite MH, 103 shapes) → public/sofia.mobile.glb (mobile)
 *   assets-src/sofia-animations-src.glb (23 clips) → public/sofia-animations.glb (idle only)
 *
 * Steps: strip KHR_materials_unlit (so clothes/body react to the portrait
 * lighting like the other coaches), WebP-compress textures (mobile smaller +
 * no clearcoat/specular), and meshopt-compress for delivery. The animation
 * file is stripped to its skeleton + the idle clip (the portrait only plays
 * idle; the mesh and other clips are dead weight).
 *
 * Usage: node scripts/prep-sofia-metahuman.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'assets-src');
const OUT_DIR = path.join(ROOT, 'public');

/**
 * Downward head tilt (radians about the head bone's local X) baked into the
 * model. Her idle rest pose sits slightly chin-up and procedural head tracking
 * is disabled for her rig (no eye bones / different axes), so the tilt is baked
 * into the asset rather than applied per-frame at runtime (a per-frame head
 * rotation accumulated and spun the head). ~4.6 degrees.
 */
const HEAD_PITCH_X = 0.08;

/**
 * The male idle set (magnus/arjun) was authored with the torso swiveled ~12°
 * about the up axis — frozen at frame 0 by the portrait sanitizer it reads as
 * "right shoulder forward". The female set nets out straight (-7°, reads
 * fine), so only the male set is straightened. See straightenChestYaw().
 */
const CHEST_YAW_COACHES = new Set(['magnus', 'arjun']);

/** Multiply quaternion a (xyzw) by b (xyzw): a * b. */
function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatConj(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate vector v by quaternion q (xyzw). */
function quatRotateVec(q, v) {
  const [x, y, z, w] = q;
  const dotUV = x * v[0] + y * v[1] + z * v[2];
  const dotUU = x * x + y * y + z * z;
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    2 * dotUV * x + (w * w - dotUU) * v[0] + 2 * w * cx,
    2 * dotUV * y + (w * w - dotUU) * v[1] + 2 * w * cy,
    2 * dotUV * z + (w * w - dotUU) * v[2] + 2 * w * cz,
  ];
}

/**
 * Straighten the animation's chest yaw so the shoulder line faces the camera.
 *
 * Measures the world yaw (about +Y, the glTF up axis) of spine_05 AND the
 * head at frame 0 versus the model's rest pose, then zeroes both
 * independently: the chest counter-yaw is baked into every pelvis keyframe,
 * and the head's remaining yaw (the vendor counter-turns the head the OTHER
 * way — chest +12°, face -8.5° on the male set) is zeroed at neck_01. Both
 * end up facing the camera. Corrections are conjugated into each bone's
 * parent space using the frame-0 chain; spine sway is <1° across the clip so
 * the error is negligible.
 */
function straightenChestYaw(document, modelDoc, log) {
  const restRot = new Map();
  const parentOf = new Map();
  for (const node of modelDoc.getRoot().listNodes()) {
    restRot.set(node.getName(), node.getRotation());
    for (const child of node.listChildren()) parentOf.set(child.getName(), node.getName());
  }

  const clip = document.getRoot().listAnimations()[0];
  const frame0 = new Map();
  for (const channel of clip.listChannels()) {
    if (channel.getTargetPath() !== 'rotation') continue;
    const v = channel.getSampler().getOutput().getArray();
    frame0.set(channel.getTargetNode()?.getName(), [v[0], v[1], v[2], v[3]]);
  }

  const chainTo = (name) => {
    const chain = [];
    for (let n = name; n; n = parentOf.get(n)) chain.unshift(n);
    return chain;
  };
  const composeWorld = (chain, useAnim) => {
    let q = [0, 0, 0, 1];
    for (const name of chain) {
      const local = useAnim && frame0.has(name) ? frame0.get(name) : restRot.get(name);
      if (local) q = quatMul(q, local);
    }
    return q;
  };

  const chestChain = chainTo('spine_05');
  if (chestChain.length < 2 || !frame0.has('pelvis')) {
    log('  WARN chest chain/pelvis track not found — skipping yaw straighten');
    return;
  }
  // World yaw delta: where does the bone's side axis point on the ground
  // plane, rest vs animated.
  const yawOf = (world) => {
    const side = quatRotateVec(world, [0, 0, 1]);
    return Math.atan2(side[0], side[2]);
  };
  const wrapPi = (a) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
  const yawQuat = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const yawDeltaOf = (chain) => wrapPi(yawOf(composeWorld(chain, true)) - yawOf(composeWorld(chain, false)));

  const chestYaw = yawDeltaOf(chestChain);
  const headYaw = yawDeltaOf(chainTo('head'));
  if (Math.abs(chestYaw) < 0.02 && Math.abs(headYaw) < 0.02) {
    log('  chest/head yaw already straight — nothing to bake');
    return;
  }
  const correction = yawQuat(-chestYaw);

  const rewriteChannel = (nodeName, parentWorld, worldRot) => {
    const channel = clip.listChannels().find(
      (ch) => ch.getTargetPath() === 'rotation' && ch.getTargetNode()?.getName() === nodeName,
    );
    if (!channel) return false;
    // conj(P) * R * P maps the world-space rotation R into the bone's parent
    // space so it can premultiply the local keyframes.
    const localFix = quatMul(quatMul(quatConj(parentWorld), worldRot), parentWorld);
    const accessor = channel.getSampler().getOutput();
    const values = Float32Array.from(accessor.getArray());
    for (let i = 0; i < values.length; i += 4) {
      const q = quatMul(localFix, [values[i], values[i + 1], values[i + 2], values[i + 3]]);
      const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      values[i] = q[0] / len; values[i + 1] = q[1] / len; values[i + 2] = q[2] / len; values[i + 3] = q[3] / len;
    }
    accessor.setArray(values);
    return true;
  };

  const pelvisParentWorld = composeWorld(chainTo('pelvis').slice(0, -1), true);
  rewriteChannel('pelvis', pelvisParentWorld, correction);
  // After the pelvis fix the whole chain (face included) carries -chestYaw;
  // the head sits at headYaw - chestYaw and gets zeroed at neck_01. neck_01's
  // parent world after the pelvis fix is correction * spine_05's original.
  const headYawAfter = wrapPi(headYaw - chestYaw);
  const neckParentWorld = quatMul(correction, composeWorld(chestChain, true));
  const neckFixed = Math.abs(headYawAfter) >= 0.02
    ? rewriteChannel('neck_01', neckParentWorld, yawQuat(-headYawAfter))
    : false;
  const deg = (r) => ((r * 180) / Math.PI).toFixed(1);
  log(
    `  straightened yaw — chest by ${deg(-chestYaw)}° at pelvis` +
    (neckFixed ? `, face by ${deg(-headYawAfter)}° at neck_01` : ' (face already straight)'),
  );
}

/** Bake a local-X pitch onto the head bone so the head rests tilted down. */
function bakeHeadPitch(document, log) {
  const head = document.getRoot().listNodes().find((n) => n.getName() === 'head');
  if (!head) { log('  WARN head node not found — skipping head-pitch bake'); return; }
  const s = Math.sin(HEAD_PITCH_X / 2), c = Math.cos(HEAD_PITCH_X / 2);
  head.setRotation(quatMul(head.getRotation(), [s, 0, 0, c]));
  log(`  baked head pitch ${HEAD_PITCH_X} rad about local X`);
}

/**
 * Repair materials whose color texture landed in the emissive slot only.
 * The 2026-07 vendor export wires some materials' BaseColor into emissive and
 * leaves baseColorTexture empty (Arjun: Head + body "Low", Leila: Teeth.001) —
 * those render as their dark baseColorFactor, and the runtime
 * self-illumination skips untextured materials entirely (near-black head).
 * Correctly-exported materials carry the same texture in BOTH slots, so this
 * copies emissive -> baseColor to match and resets the factor to white.
 */
function repairEmissiveOnlyBaseColor(document, log) {
  for (const material of document.getRoot().listMaterials()) {
    if (material.getBaseColorTexture() || !material.getEmissiveTexture()) continue;
    material.setBaseColorTexture(material.getEmissiveTexture());
    material.getBaseColorTextureInfo().setTexCoord(material.getEmissiveTextureInfo().getTexCoord());
    const alpha = material.getBaseColorFactor()[3];
    material.setBaseColorFactor([1, 1, 1, alpha]);
    log(`  repaired emissive-only base color on material "${material.getName()}"`);
  }
}

/**
 * Warm Leila's eyebrows from near-black to brown.
 *
 * Her brows are PAINTED INTO the head texture (verified at runtime: tinting
 * the Lashes, Clip and Blend materials recoloured the lashes and the scalp
 * hair but never the brows), so no material tweak can reach them — the pixels
 * themselves have to change. Her hair renders a warm auburn while the baked
 * brows sit at RGB ~(23,14,10), which reads plain black against it.
 *
 * The recolour is confined to the brow band of the face-projection layout
 * (normalised so it survives a texture resize), applies only to dark pixels,
 * and feathers on both the luminance threshold and the box border so it can
 * never leave a visible seam across skin.
 */
const BROW_RECOLOR_COACHES = new Set(['leila']);
/** Brow band in normalised texture space (face-projection layout). */
const BROW_BOX = { x: 0.32, y: 0.235, w: 0.40, h: 0.13 };
/**
 * Luminance ramp: full effect below LO, none above HI. Kept TIGHT (strand
 * cores only) — a wide window also caught the brow-bone shadow and the whole
 * socket washed orange, and lifting hard flattened the brows into the skin.
 * The brows must stay dark; only their hue moves.
 */
const BROW_LUM_LO = 18;
const BROW_LUM_HI = 55;
/** Per-channel warm-brown shift applied to the darkest strands. */
const BROW_GAIN = { r: 1.9, g: 1.6, b: 1.35 };
const BROW_LIFT = { r: 8, g: 4, b: 2 };
/** Border feather in normalised units, so the box edge never shows. */
const BROW_FEATHER = 0.022;

async function recolorEyebrows(document, log) {
  const head = document.getRoot().listMaterials().find((m) => /^head/i.test(m.getName() || ''));
  const texture = head?.getBaseColorTexture();
  if (!texture) { log('  WARN head texture not found — skipping brow recolour'); return; }

  const input = Buffer.from(texture.getImage());
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const x0 = Math.round(BROW_BOX.x * width);
  const y0 = Math.round(BROW_BOX.y * height);
  const x1 = Math.round((BROW_BOX.x + BROW_BOX.w) * width);
  const y1 = Math.round((BROW_BOX.y + BROW_BOX.h) * height);
  const featherX = Math.max(1, BROW_FEATHER * width);
  const featherY = Math.max(1, BROW_FEATHER * height);

  let touched = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum >= BROW_LUM_HI) continue;
      // Dark-pixel weight (1 at the strand core, 0 at skin brightness).
      const lumW = Math.min(1, Math.max(0, (BROW_LUM_HI - lum) / (BROW_LUM_HI - BROW_LUM_LO)));
      // Border weight so the rectangle edge fades out instead of cutting.
      const edge = Math.min(
        (x - x0) / featherX, (x1 - 1 - x) / featherX,
        (y - y0) / featherY, (y1 - 1 - y) / featherY,
      );
      const w = lumW * Math.min(1, Math.max(0, edge));
      if (w <= 0) continue;
      const nr = Math.min(255, r * BROW_GAIN.r + BROW_LIFT.r);
      const ng = Math.min(255, g * BROW_GAIN.g + BROW_LIFT.g);
      const nb = Math.min(255, b * BROW_GAIN.b + BROW_LIFT.b);
      data[i] = Math.round(r + (nr - r) * w);
      data[i + 1] = Math.round(g + (ng - g) * w);
      data[i + 2] = Math.round(b + (nb - b) * w);
      touched++;
    }
  }

  const png = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  texture.setImage(png).setMimeType('image/png');
  log(`  recoloured ${touched} eyebrow pixel(s) black -> brown in ${texture.getName() || 'head texture'}`);
}

/** Vendor pipeline: emissive-only — drop normal/roughness/metallic maps at export. */
function stripNormalRoughnessMetallic(document, log) {
  let maps = 0;
  for (const material of document.getRoot().listMaterials()) {
    if (material.getNormalTexture()) {
      material.setNormalTexture(null);
      maps++;
    }
    if (material.getMetallicRoughnessTexture()) {
      material.setMetallicRoughnessTexture(null);
      maps++;
    }
    material.setMetallicFactor(0);
    material.setRoughnessFactor(1);
  }
  if (maps) log(`  stripped ${maps} normal/metallic-roughness map(s)`);
}

/** Drop KHR_materials_unlit so every material is lit by the portrait rig. */
function stripUnlit(document, log) {
  let n = 0;
  for (const material of document.getRoot().listMaterials()) {
    if (material.getExtension('KHR_materials_unlit')) {
      material.setExtension('KHR_materials_unlit', null);
      n++;
    }
  }
  if (n) log(`  stripped KHR_materials_unlit from ${n} material(s)`);
}

/** Drop clearcoat/specular so mobile gets cheaper MeshStandardMaterial shaders. */
function stripPhysicalExtensions(document, log) {
  let n = 0;
  for (const material of document.getRoot().listMaterials()) {
    for (const ext of ['KHR_materials_clearcoat', 'KHR_materials_specular', 'KHR_materials_ior']) {
      if (material.getExtension(ext)) {
        material.setExtension(ext, null);
        n++;
      }
    }
  }
  if (n) log(`  stripped ${n} clearcoat/specular/ior extension(s)`);
}

async function prepModel(io, { coach, srcName, outName, variant }) {
  const srcPath = path.join(SRC_DIR, srcName);
  const outPath = path.join(OUT_DIR, outName);
  const log = (m) => console.log(m);
  console.log(`\n=== ${srcName} -> ${outName} (${variant}) ===`);
  const document = await io.read(srcPath);

  // Geometry is decoded on read; drop any draco extension so the writer does
  // not look for an encoder (meshopt adds EXT_meshopt_compression instead).
  for (const ext of document.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }

  repairEmissiveOnlyBaseColor(document, log);
  stripNormalRoughnessMetallic(document, log);
  // Before textureCompress: the recolour edits the original PNG pixels.
  if (BROW_RECOLOR_COACHES.has(coach)) await recolorEyebrows(document, log);
  stripUnlit(document, log);
  bakeHeadPitch(document, log);
  if (variant === 'mobile') stripPhysicalExtensions(document, log);

  const max = variant === 'mobile' ? 1024 : 2048;
  const quality = variant === 'mobile' ? 80 : 86;
  document.createExtension(EXTTextureWebP).setRequired(true);
  // ORDER MATTERS: meshopt (quantize/reorder + EXT_meshopt_compression) must
  // run BEFORE textureCompress. Running it after rewrote buffer views under
  // the freshly-encoded images and corrupted 6 of 9 webp payloads on the V5
  // export's buffer layout (textures decoded as garbage at runtime —
  // "Couldn't load texture blob"). Compressing textures last keeps the image
  // buffer views intact; verified with a write+readback decode of every
  // texture.
  await document.transform(
    prune(),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality, resize: [max, max] }),
  );

  await io.write(outPath, document);
  const srcSize = fs.statSync(srcPath).size;
  const outSize = fs.statSync(outPath).size;
  console.log(`  wrote ${path.relative(ROOT, outPath)}: ${(srcSize / 1e6).toFixed(1)}MB -> ${(outSize / 1e6).toFixed(1)}MB`);
}

async function prepAnimations(io, coach, modelDoc) {
  const modelJoints = new Set(
    modelDoc.getRoot().listSkins().flatMap((s) => s.listJoints().map((j) => j.getName())),
  );
  const srcPath = path.join(SRC_DIR, `${coach}-animations-src.glb`);
  const outPath = path.join(OUT_DIR, `${coach}-animations.glb`);
  console.log(`\n=== ${coach}-animations-src.glb -> ${coach}-animations.glb ===`);
  const document = await io.read(srcPath);
  const root = document.getRoot();

  for (const ext of root.listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }

  // The portrait only plays the idle clip — keep one idle animation, drop the
  // rest (23 full-skeleton clips are dead weight in a portrait bundle).
  const anims = root.listAnimations();
  const idle = anims.find((a) => a.getName().trim().toLowerCase() === 'idle')
    ?? anims.find((a) => /idle/i.test(a.getName()));
  if (!idle) throw new Error('no idle clip found in animation source');
  console.log(`  keeping idle clip "${idle.getName()}" (dropping ${anims.length - 1} other clips)`);
  // Disposing an Animation does NOT cascade to its channels/samplers — dispose
  // them first so their keyframe accessors become orphans that prune reclaims
  // (each dropped clip carries 2364 samplers).
  for (const a of anims) {
    if (a === idle) continue;
    for (const c of a.listChannels()) c.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }

  // The source skeleton has ~787 joints (full facial rig); the model has ~157.
  // Drop channels that target a node the model doesn't have — those tracks
  // never bind at runtime (useAnimations retargets by node name) and are the
  // bulk of the file. Also drop constant/identity scale tracks.
  let dropped = 0;
  for (const channel of idle.listChannels()) {
    const node = channel.getTargetNode();
    const name = node ? node.getName() : '';
    if (!modelJoints.has(name)) { channel.dispose(); dropped++; }
  }
  // Samplers belong to the Animation, not the channel — disposing a channel
  // leaves its sampler (and its keyframe accessors) behind. Dispose every
  // sampler no longer referenced by a surviving channel so prune can reclaim
  // the accessors (otherwise all ~2364 source samplers survive).
  const usedSamplers = new Set(idle.listChannels().map((c) => c.getSampler()));
  let orphanSamplers = 0;
  for (const sampler of idle.listSamplers()) {
    if (!usedSamplers.has(sampler)) { sampler.dispose(); orphanSamplers++; }
  }
  console.log(`  dropped ${dropped} channels + ${orphanSamplers} orphan samplers (kept ${idle.listChannels().length} channels)`);

  // The animation mesh/skin geometry is unused at runtime (clips retarget onto
  // the model's skeleton by node name) — drop the mesh so only the skeleton +
  // idle clip ship.
  for (const mesh of root.listMeshes()) mesh.dispose();

  if (CHEST_YAW_COACHES.has(coach)) straightenChestYaw(document, modelDoc, console.log);

  await document.transform(
    // Baked idle clip carries a keyframe every frame — collapse runs that
    // interpolate linearly (lossless within tolerance). Big win on baked data.
    resample(),
    prune(),
    dedup(),
    // Compresses the idle clip's keyframe accessors (EXT_meshopt_compression);
    // drei's useGLTF ships the meshopt decoder.
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(outPath, document);
  const srcSize = fs.statSync(srcPath).size;
  const outSize = fs.statSync(outPath).size;
  console.log(`  wrote ${path.relative(ROOT, outPath)}: ${(srcSize / 1e6).toFixed(1)}MB -> ${(outSize / 1e6).toFixed(1)}MB`);
}

/** Every coach is a MetaHuman export now (same skeleton family + pipeline). */
const ALL_COACHES = ['sofia', 'leila', 'magnus', 'arjun'];

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

  const requested = process.argv[2]?.trim().toLowerCase();
  const coaches = requested ? ALL_COACHES.filter((c) => c === requested) : ALL_COACHES;
  if (!coaches.length) throw new Error(`unknown coach "${requested}" (expected one of ${ALL_COACHES.join(', ')})`);

  for (const coach of coaches) {
    // The model doc supplies the joint list (animation trimming) and the rest
    // pose (chest-yaw straightening).
    const modelDoc = await io.read(path.join(SRC_DIR, `${coach}.glb`));
    console.log(`\n##### ${coach}`);

    await prepModel(io, { coach, srcName: `${coach}.glb`, outName: `${coach}.glb`, variant: 'web' });
    await prepModel(io, { coach, srcName: `${coach}-lite.glb`, outName: `${coach}.mobile.glb`, variant: 'mobile' });
    await prepAnimations(io, coach, modelDoc);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

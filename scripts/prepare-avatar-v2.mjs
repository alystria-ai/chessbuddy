/**
 * Prepare the Chess Avatars V2 MetaHuman exports for browser delivery without
 * changing the authored character look or the Convai MHA facial contract.
 *
 * Safety invariants (enforced before an output replaces an existing file):
 *   - BOTH desktop and mobile are independently built from the vendor FULL GLB.
 *   - The exact ordered morph-name arrays and all 251 unique MHA names survive.
 *   - Materials, PBR extension values, shader modes, and every texture slot are
 *     byte-for-byte equivalent at the glTF JSON level after canonicalization.
 *   - Node rest transforms are unchanged (no head pitch or other pose bake).
 *   - Model geometry is only meshopt-compressed; morphs are never pruned.
 *   - Textures are only resized inside their budget and encoded as WebP. PBR
 *     data maps are lossless and colour maps are near-lossless.
 *
 * The 103-target *_Lite.glb files are AUDIT-ONLY references. They are useful
 * for confirming why the old mobile path lost facial channels, but they are
 * never source candidates here. A Lite-looking path is rejected even if it is
 * passed indirectly or renamed into a candidate directory.
 *
 * Usage examples:
 *   node scripts/prepare-avatar-v2.mjs
 *   node scripts/prepare-avatar-v2.mjs --coach=arjun --variant=mobile
 *   node scripts/prepare-avatar-v2.mjs --vendor-dir="<extracted package>" \
 *     --contract-dir="<extracted package>" --output-dir="<temporary output>"
 *   node scripts/prepare-avatar-v2.mjs --dry-run --skip-animations
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { compressTexture, listTextureSlots, meshopt, prune } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CONTRACT_VERSION = 1;
const ORDER_COUNT = 251;
const REQUIRED_COVERAGE = 0.95;
const EXPECTED_ORDER_HASH = '232e7c65a5ddbc80e7f9c8c9ec1cac62dbb779729abeb6731ce159297a1d1e48';
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const REQUIRED_CHANNELS = [
  'CTRL_expressions_jawOpen',
  'CTRL_expressions_mouthLipsTogetherDL',
  'CTRL_expressions_mouthLipsTogetherDR',
  'CTRL_expressions_mouthLipsTogetherUL',
  'CTRL_expressions_mouthLipsTogetherUR',
  'CTRL_expressions_mouthFunnelDL',
  'CTRL_expressions_mouthFunnelDR',
  'CTRL_expressions_mouthFunnelUL',
  'CTRL_expressions_mouthFunnelUR',
];

const COACHES = {
  arjun: {
    full: ['arjun.glb', 'Arjun/ArjunMH.glb', 'ArjunMH.glb'],
    animation: ['arjun-animations-src.glb', 'Arjun/Arjun_Animations.glb', 'Arjun_Animations.glb'],
    // Deliberately unused by source resolution. Lite remains audit-only.
    liteAuditOnly: ['arjun-lite.glb', 'Arjun/ArjunMH_Lite.glb', 'ArjunMH_Lite.glb'],
  },
  leila: {
    full: ['leila.glb', 'Lelia/LeliaMH.glb', 'Leila/LeilaMH.glb', 'LeliaMH.glb', 'LeilaMH.glb'],
    animation: [
      'leila-animations-src.glb',
      'Lelia/Lelia_Animations.glb',
      'Leila/Leila_Animations.glb',
      'Lelia_Animations.glb',
      'Leila_Animations.glb',
    ],
    liteAuditOnly: ['leila-lite.glb', 'Lelia/LeliaMH_Lite.glb', 'Leila/LeilaMH_Lite.glb'],
  },
  magnus: {
    full: ['magnus.glb', 'Magnus/MagnusMH.glb', 'MagnusMH.glb'],
    animation: ['magnus-animations-src.glb', 'Magnus/Magnus_Animations.glb', 'Magnus_Animations.glb'],
    liteAuditOnly: ['magnus-lite.glb', 'Magnus/MagnusMH_Lite.glb', 'MagnusMH_Lite.glb'],
  },
  sofia: {
    full: ['sofia.glb', 'SofiaFormal/SofiaFormalMH.glb', 'SofiaFormalMH.glb'],
    animation: ['sofia-animations-src.glb', 'SofiaFormal/Sofia_Animations.glb', 'Sofia_Animations.glb'],
    liteAuditOnly: ['sofia-lite.glb', 'SofiaFormal/SofiaFormalMH_Lite.glb', 'SofiaFormalMH_Lite.glb'],
  },
};

const VARIANTS = {
  desktop: { suffix: '.glb', maxTextureSize: 2048, colourQuality: 92 },
  mobile: { suffix: '.mobile.glb', maxTextureSize: 1024, colourQuality: 88 },
};

class PreparationError extends Error {
  constructor(message, hint = '') {
    super(message);
    this.name = 'PreparationError';
    this.hint = hint;
  }
}

function parseArgs(argv) {
  const options = {
    sourceDir: path.join(ROOT, 'assets-src'),
    vendorDir: null,
    contractDir: null,
    outputDir: path.join(ROOT, 'public'),
    coaches: [],
    variant: 'both',
    animations: true,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) return inline;
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new PreparationError(`Missing value for ${name}.`);
      index += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-animations' || arg === '--no-animations') options.animations = false;
    else if (arg === '--source-dir' || arg.startsWith('--source-dir=')) options.sourceDir = takeValue('--source-dir');
    else if (arg === '--vendor-dir' || arg.startsWith('--vendor-dir=')) options.vendorDir = takeValue('--vendor-dir');
    else if (arg === '--contract-dir' || arg.startsWith('--contract-dir=')) options.contractDir = takeValue('--contract-dir');
    else if (arg === '--output-dir' || arg.startsWith('--output-dir=')) options.outputDir = takeValue('--output-dir');
    else if (arg === '--variant' || arg.startsWith('--variant=')) options.variant = takeValue('--variant').toLowerCase();
    else if (arg === '--coach' || arg.startsWith('--coach=')) {
      options.coaches.push(...takeValue('--coach').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    } else if (!arg.startsWith('--')) options.coaches.push(arg.trim().toLowerCase());
    else throw new PreparationError(`Unknown option: ${arg}`, 'Run with --help to see supported arguments.');
  }

  if (options.vendorDir && argv.some((arg) => arg === '--source-dir' || arg.startsWith('--source-dir='))) {
    throw new PreparationError('Use either --vendor-dir or --source-dir, not both.');
  }
  if (options.vendorDir) options.sourceDir = options.vendorDir;
  options.sourceDir = path.resolve(options.sourceDir);
  options.vendorDir = options.vendorDir ? path.resolve(options.vendorDir) : null;
  options.outputDir = path.resolve(options.outputDir);
  options.contractDir = path.resolve(
    options.contractDir ?? options.vendorDir ?? path.join(ROOT, 'vendor', 'convai-web-lipsync'),
  );

  options.coaches = [...new Set(options.coaches.length ? options.coaches : Object.keys(COACHES))];
  for (const coach of options.coaches) {
    if (!COACHES[coach]) {
      throw new PreparationError(`Unknown coach "${coach}".`, `Expected one of: ${Object.keys(COACHES).join(', ')}.`);
    }
  }
  if (!['desktop', 'mobile', 'both'].includes(options.variant)) {
    throw new PreparationError(`Unknown variant "${options.variant}".`, 'Expected desktop, mobile, or both.');
  }
  options.variants = options.variant === 'both' ? ['desktop', 'mobile'] : [options.variant];
  return options;
}

function printHelp() {
  console.log(`Chess Avatars V2 safe preparation

Usage:
  node scripts/prepare-avatar-v2.mjs [coach ...] [options]

Options:
  --coach=<names>       Comma-separated subset: arjun, leila, magnus, sofia
  --variant=<value>     desktop, mobile, or both (default: both)
  --source-dir=<path>   Staged FULL sources (default: assets-src)
  --vendor-dir=<path>   Extracted vendor package; implies --source-dir
  --contract-dir=<path> Convai LipSync JSON directory
  --output-dir=<path>   Destination (default: public)
  --skip-animations     Do not prepare the idle animation bundles
  --dry-run             Validate all inputs without writing outputs
  --help                Show this help

The *_Lite.glb files are never build inputs.`);
}

function readJSON(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new PreparationError(`Cannot read ${label}: ${filePath}`, error.message);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PreparationError(`Invalid JSON in ${label}: ${filePath}`, error.message);
  }
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertEqualSignature(actual, expected, label, hint) {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new PreparationError(`${label} changed during preparation.`, hint);
  }
}

function poseSignaturesEquivalent(actual, expected, tolerance = 1e-4) {
  if (actual.length !== expected.length) return false;
  const numericArrayEqual = (a, b) =>
    a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  for (let index = 0; index < actual.length; index += 1) {
    const a = actual[index];
    const b = expected[index];
    if (a.nodeIndex !== b.nodeIndex || a.name !== b.name || a.parent !== b.parent) return false;
    if (!deepArrayEqual(a.children, b.children)) return false;
    if (!numericArrayEqual(a.translation, b.translation)) return false;
    if (!numericArrayEqual(a.rotation, b.rotation)) return false;
    if (!numericArrayEqual(a.scale, b.scale)) return false;
  }
  return true;
}

function deepArrayEqual(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function assertPoseEquivalent(actual, expected, label, hint = '') {
  if (!poseSignaturesEquivalent(actual, expected)) {
    throw new PreparationError(`${label} changed during preparation.`, hint);
  }
}

function loadChannelContract(contractDir) {
  const setupPath = path.join(contractDir, 'Lipsynic-setup.json');
  const setup = readJSON(setupPath, 'Lipsynic-setup.json');
  const orderReference = setup?.transport?.channelOrderFile;
  if (typeof orderReference !== 'string' || !orderReference) {
    throw new PreparationError('Lipsynic-setup.json does not declare transport.channelOrderFile.');
  }
  const orderPath = path.resolve(path.dirname(setupPath), orderReference);
  const relative = path.relative(contractDir, orderPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PreparationError(`Channel-order reference escapes the contract directory: ${orderReference}`);
  }
  const order = readJSON(orderPath, 'metahuman-order-251.json');
  const channels = order?.channels;
  const errors = [];
  if (setup?.transport?.format !== 'mha') errors.push('transport.format must be "mha"');
  if (setup?.transport?.channelCount !== ORDER_COUNT) errors.push(`transport.channelCount must be ${ORDER_COUNT}`);
  if (!Array.isArray(channels) || channels.length !== ORDER_COUNT) errors.push(`order.channels must contain ${ORDER_COUNT} entries`);
  if (Array.isArray(channels) && new Set(channels).size !== channels.length) errors.push('order.channels contains duplicates');
  if (Array.isArray(channels)) {
    const orderHash = sha256Bytes(channels.join('\0'));
    if (orderHash !== EXPECTED_ORDER_HASH) {
      errors.push(`ordered channel hash changed (${orderHash}); do not sort or reorder the vendor list`);
    }
    for (const required of REQUIRED_CHANNELS) {
      if (!channels.includes(required)) errors.push(`required channel is missing: ${required}`);
    }
  }
  if (errors.length) {
    throw new PreparationError(
      `Convai MHA channel contract failed:\n  - ${errors.join('\n  - ')}`,
      'Restore the supplied metahuman-order-251.json and Lipsynic-setup.json before building assets.',
    );
  }
  return { setup, channels, orderHash: EXPECTED_ORDER_HASH, setupPath, orderPath };
}

function findFirstExisting(baseDir, candidates, label) {
  for (const candidate of candidates) {
    const resolved = path.resolve(baseDir, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new PreparationError(
    `Missing ${label} under ${baseDir}.`,
    `Checked: ${candidates.join(', ')}`,
  );
}

function rejectLiteSource(filePath, coach) {
  const normalized = filePath.replaceAll('\\', '/');
  if (/(^|[\/_ .-])lite([\/_ .-]|$)/i.test(normalized)) {
    throw new PreparationError(
      `Refusing Lite source for ${coach}: ${filePath}`,
      'Desktop and mobile must both derive from the 251-target FULL vendor GLB. Lite is audit-only.',
    );
  }
}

function extensionNames(root) {
  return root.listExtensionsUsed().map((extension) => extension.extensionName).sort();
}

function morphSignature(document) {
  return document.getRoot().listMeshes().map((mesh, meshIndex) => {
    const names = mesh.getExtras()?.targetNames;
    return {
      meshIndex,
      meshName: mesh.getName(),
      targetNames: Array.isArray(names) ? [...names] : [],
      primitiveTargetCounts: mesh.listPrimitives().map((primitive) => primitive.listTargets().length),
      weights: [...mesh.getWeights()],
    };
  });
}

function nodePoseSignature(document) {
  const nodes = document.getRoot().listNodes();
  const indexByNode = new Map(nodes.map((node, index) => [node, index]));
  return nodes.map((node, nodeIndex) => ({
    nodeIndex,
    name: node.getName(),
    parent: node.getParentNode() ? indexByNode.get(node.getParentNode()) : null,
    translation: [...node.getTranslation()],
    rotation: [...node.getRotation()],
    scale: [...node.getScale()],
    children: node.listChildren().map((child) => indexByNode.get(child)),
  }));
}

function inspectMorphs(document, channels, label) {
  const contractSet = new Set(channels);
  const named = new Set();
  const influenceRelevant = new Set();
  const errors = [];

  for (const [meshIndex, mesh] of document.getRoot().listMeshes().entries()) {
    const primitiveTargets = mesh.listPrimitives().map((primitive) => primitive.listTargets());
    const maxTargets = Math.max(0, ...primitiveTargets.map((targets) => targets.length));
    if (!maxTargets) continue;
    const names = mesh.getExtras()?.targetNames;
    const meshLabel = `mesh #${meshIndex} "${mesh.getName() || '(unnamed)'}"`;
    if (!Array.isArray(names)) {
      errors.push(`${meshLabel} has morph targets but no extras.targetNames`);
      continue;
    }
    if (new Set(names).size !== names.length) errors.push(`${meshLabel} has duplicate target names`);
    for (const name of names) named.add(name);

    for (const [primitiveIndex, targets] of primitiveTargets.entries()) {
      if (!targets.length) continue;
      if (targets.length !== names.length) {
        errors.push(`${meshLabel} primitive #${primitiveIndex} has ${targets.length} targets but ${names.length} names`);
        continue;
      }
      const basePositionCount = mesh.listPrimitives()[primitiveIndex].getAttribute('POSITION')?.getCount();
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const target = targets[targetIndex];
        const name = names[targetIndex];
        if (!name) continue;
        const semantics = target.listSemantics();
        if (semantics.length) influenceRelevant.add(name);
        for (const semantic of semantics) {
          const count = target.getAttribute(semantic)?.getCount();
          if (basePositionCount !== undefined && count !== basePositionCount) {
            errors.push(
              `${meshLabel} primitive #${primitiveIndex} target "${name}" ${semantic} count ${count} ` +
              `does not match vertex count ${basePositionCount}`,
            );
          }
        }
      }
    }
  }

  const missing = channels.filter((channel) => !named.has(channel));
  const extra = [...named].filter((name) => !contractSet.has(name));
  const influenceMissing = channels.filter((channel) => !influenceRelevant.has(channel));
  const coverage = (channels.length - missing.length) / channels.length;
  const influenceCoverage = (channels.length - influenceMissing.length) / channels.length;

  if (named.size !== ORDER_COUNT || missing.length || extra.length) {
    errors.push(
      `expected the exact ${ORDER_COUNT}-name MHA set; found ${named.size} unique ` +
      `(missing ${missing.length}, extra ${extra.length})`,
    );
  }
  if (coverage < REQUIRED_COVERAGE) errors.push(`unique name coverage ${(coverage * 100).toFixed(1)}% is below 95%`);
  if (influenceCoverage < REQUIRED_COVERAGE) {
    errors.push(`influence-aligned name coverage ${(influenceCoverage * 100).toFixed(1)}% is below 95%`);
  }
  for (const required of REQUIRED_CHANNELS) {
    if (!influenceRelevant.has(required)) errors.push(`required channel has no aligned morph influence: ${required}`);
  }
  if (errors.length) {
    const missingPreview = missing.length ? `\n  Missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}` : '';
    const extraPreview = extra.length ? `\n  Extra: ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ', …' : ''}` : '';
    throw new PreparationError(
      `${label} failed the MHA morph contract:\n  - ${errors.join('\n  - ')}${missingPreview}${extraPreview}`,
      'Use the vendor FULL GLB without morph pruning or target-name rewriting.',
    );
  }
  return { named, influenceRelevant, coverage, influenceCoverage };
}

async function canonicalMaterials(io, document) {
  const jsonDocument = await io.writeJSON(document);
  return jsonDocument.json.materials ?? [];
}

function countTextureSlots(materials) {
  let count = 0;
  const visit = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (/Texture$/.test(key) && Number.isInteger(value.index)) count += 1;
    if (Array.isArray(value)) value.forEach((entry) => visit(entry));
    else Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(materials);
  return count;
}

function assertSupportedExtensions(rawJSON, filePath) {
  const supported = new Set(ALL_EXTENSIONS.map((ExtensionClass) => ExtensionClass.EXTENSION_NAME));
  const unsupported = (rawJSON.extensionsUsed ?? []).filter((name) => !supported.has(name));
  if (unsupported.length) {
    throw new PreparationError(
      `${filePath} uses unsupported glTF extension(s): ${unsupported.join(', ')}`,
      'Do not run a round-trip that could strip an unknown material or shader extension; add explicit support first.',
    );
  }
}

async function createIO() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
}

async function inspectFullSource(io, coach, filePath, contract) {
  rejectLiteSource(filePath, coach);
  const raw = await io.readAsJSON(filePath);
  assertSupportedExtensions(raw.json, filePath);
  const document = await io.read(filePath);
  const morphs = inspectMorphs(document, contract.channels, `${coach} FULL source`);
  const materials = await canonicalMaterials(io, document);
  const poses = nodePoseSignature(document);
  const morphsSignature = morphSignature(document);
  const sourceHash = await sha256File(filePath);
  const materialExtensions = new Set(
    materials.flatMap((material) => Object.keys(material.extensions ?? {})),
  );

  for (const texture of document.getRoot().listTextures()) {
    if (!texture.getImage()) {
      throw new PreparationError(`${coach} source texture "${texture.getName()}" has no embedded image.`);
    }
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(texture.getMimeType())) {
      throw new PreparationError(
        `${coach} source texture "${texture.getName()}" uses unsupported ${texture.getMimeType()}.`,
        'Add an explicit safe encoder path before preparing this asset.',
      );
    }
  }

  return {
    coach,
    filePath,
    sourceHash,
    morphsSignature,
    morphSignatureHash: sha256Bytes(stableStringify(morphsSignature)),
    poseSignature: poses,
    poseSignatureHash: sha256Bytes(stableStringify(poses)),
    materials,
    materialSignatureHash: sha256Bytes(stableStringify(materials)),
    materialExtensions: [...materialExtensions].sort(),
    textureCount: document.getRoot().listTextures().length,
    textureSlots: countTextureSlots(materials),
    nodeNames: new Set(document.getRoot().listNodes().map((node) => node.getName()).filter(Boolean)),
    extensions: extensionNames(document.getRoot()),
    coverage: morphs.coverage,
    influenceCoverage: morphs.influenceCoverage,
  };
}

function removeDracoEncoding(document) {
  // Geometry has already been decoded by NodeIO. Replacing Draco with meshopt is
  // safe and does not touch PBR/material extensions or morph target membership.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_draco_mesh_compression') extension.dispose();
  }
}

function setModelProvenance(document, source, variant, contract) {
  const root = document.getRoot();
  root.setExtras({
    ...(root.getExtras() ?? {}),
    classicChessAvatarV2: {
      contractVersion: CONTRACT_VERSION,
      coach: source.coach,
      variant,
      sourceKind: 'full',
      sourceAsset: path.basename(source.filePath),
      sourceSha256: source.sourceHash,
      sourceMorphSignatureSha256: source.morphSignatureHash,
      sourceMaterialSignatureSha256: source.materialSignatureHash,
      sourcePoseSignatureSha256: source.poseSignatureHash,
      channelOrderSha256: contract.orderHash,
      channelCount: ORDER_COUNT,
      textureMax: VARIANTS[variant].maxTextureSize,
      preparation: 'meshopt + slot-preserving WebP only',
    },
  });
}

async function compressTexturesSafely(document, variant) {
  const settings = VARIANTS[variant];
  const records = [];
  for (const [index, texture] of document.getRoot().listTextures().entries()) {
    const slots = listTextureSlots(texture).sort();
    const dataTexture = slots.some((slot) =>
      /normal|metallic|roughness|occlusion|specular(?!Color)|clearcoat|transmission|thickness/i.test(slot));
    const before = texture.getImage()?.byteLength ?? 0;
    await compressTexture(texture, {
      encoder: sharp,
      targetFormat: 'webp',
      resize: [settings.maxTextureSize, settings.maxTextureSize],
      effort: 5,
      ...(dataTexture
        ? { lossless: true }
        : { nearLossless: true, quality: settings.colourQuality }),
    });
    records.push({
      index,
      name: texture.getName() || '(unnamed)',
      slots,
      mode: dataTexture ? 'lossless-data' : `near-lossless-q${settings.colourQuality}`,
      before,
      after: texture.getImage()?.byteLength ?? 0,
    });
  }
  if (document.getRoot().listTextures().length) {
    document.createExtension(EXTTextureWebP).setRequired(true);
  }
  return records;
}

async function verifyTexturePayloads(document, maxTextureSize, label) {
  const failures = [];
  const dimensions = [];
  for (const [index, texture] of document.getRoot().listTextures().entries()) {
    const image = texture.getImage();
    if (!image) {
      failures.push(`texture #${index} "${texture.getName()}" has no image`);
      continue;
    }
    try {
      const decoded = await sharp(Buffer.from(image), { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
      const { width, height, format } = await sharp(Buffer.from(image), { failOn: 'error' }).metadata();
      if (texture.getMimeType() !== 'image/webp' || format !== 'webp') {
        failures.push(`texture #${index} "${texture.getName()}" is not a valid WebP`);
      }
      if (!width || !height || width > maxTextureSize || height > maxTextureSize) {
        failures.push(
          `texture #${index} "${texture.getName()}" is ${width ?? '?'}x${height ?? '?'}; limit is ${maxTextureSize}`,
        );
      }
      if (!decoded.data.byteLength) failures.push(`texture #${index} "${texture.getName()}" decoded to no pixels`);
      dimensions.push(`${width}x${height}`);
    } catch (error) {
      failures.push(`texture #${index} "${texture.getName()}" cannot be decoded: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new PreparationError(
      `${label} texture verification failed:\n  - ${failures.join('\n  - ')}`,
      'The temporary output was not promoted. Inspect the named texture/encoder failure.',
    );
  }
  return dimensions;
}

async function writeAtomically(io, outputPath, document, verify) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp.glb`,
  );
  try {
    await io.write(temporary, document);
    await verify(temporary);
    await fs.promises.rename(temporary, outputPath);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

async function prepareModelVariant(io, source, variant, outputDir, contract) {
  const settings = VARIANTS[variant];
  const outputPath = path.join(outputDir, `${source.coach}${settings.suffix}`);
  const document = await io.read(source.filePath);

  // These input assertions prevent a changed file from slipping between the
  // preflight pass and the build pass.
  assertEqualSignature(morphSignature(document), source.morphsSignature, `${source.coach} input morph signature`);
  assertEqualSignature(nodePoseSignature(document), source.poseSignature, `${source.coach} input rest pose`);
  assertEqualSignature(
    await canonicalMaterials(io, document),
    source.materials,
    `${source.coach} input material graph`,
  );

  removeDracoEncoding(document);
  setModelProvenance(document, source, variant, contract);

  // Intentionally absent: pruneMorphTargets, geometry simplification, head
  // pitch, eyebrow recolouring, material repair, unlit removal, and physical
  // extension stripping. V2 keeps the vendor-authored look and all 251 morphs.
  await document.transform(meshopt({
    encoder: MeshoptEncoder,
    level: 'medium',
    quantizePosition: 16,
    quantizeNormal: 12,
    quantizeTexcoord: 14,
    quantizeWeight: 12,
    quantizeGeneric: 14,
  }));
  const textureRecords = await compressTexturesSafely(document, variant);

  assertEqualSignature(
    morphSignature(document),
    source.morphsSignature,
    `${source.coach} ${variant} morph signature`,
    'Morph pruning/reordering is forbidden. The temporary output was not promoted.',
  );
  assertEqualSignature(
    nodePoseSignature(document),
    source.poseSignature,
    `${source.coach} ${variant} rest pose`,
    'Head pitch and other rest-pose edits are forbidden. The temporary output was not promoted.',
  );
  // Do not serialize the Document between WebP encoding and the final atomic
  // write. EXT_meshopt_compression is deferred until serialization, and a
  // second in-memory serialization can invalidate freshly embedded image
  // buffer views. The readback below compares the written material JSON and
  // decodes every texture, which is the stronger preservation gate.

  await writeAtomically(io, outputPath, document, async (temporary) => {
    const raw = await io.readAsJSON(temporary);
    const written = await io.read(temporary);
    assertEqualSignature(
      morphSignature(written),
      source.morphsSignature,
      `${source.coach} ${variant} written morph signature`,
    );
    assertPoseEquivalent(
      nodePoseSignature(written),
      source.poseSignature,
      `${source.coach} ${variant} written rest pose`,
    );
    assertEqualSignature(
      raw.json.materials ?? [],
      source.materials,
      `${source.coach} ${variant} written PBR material/texture-slot graph`,
    );
    inspectMorphs(written, contract.channels, `${source.coach} ${variant} written asset`);
    await verifyTexturePayloads(written, settings.maxTextureSize, `${source.coach} ${variant}`);
    const requiredExtensions = new Set(raw.json.extensionsRequired ?? []);
    if (written.getRoot().listAccessors().length && !requiredExtensions.has('EXT_meshopt_compression')) {
      throw new PreparationError(`${source.coach} ${variant} output is missing required EXT_meshopt_compression.`);
    }
    if (written.getRoot().listTextures().length && !requiredExtensions.has('EXT_texture_webp')) {
      throw new PreparationError(`${source.coach} ${variant} output is missing required EXT_texture_webp.`);
    }
    const provenance = raw.json.extras?.classicChessAvatarV2;
    if (provenance?.sourceKind !== 'full' || provenance?.sourceSha256 !== source.sourceHash) {
      throw new PreparationError(`${source.coach} ${variant} output provenance does not identify the FULL source.`);
    }
  });

  const size = fs.statSync(outputPath).size;
  const textureBefore = textureRecords.reduce((sum, record) => sum + record.before, 0);
  const textureAfter = textureRecords.reduce((sum, record) => sum + record.after, 0);
  console.log(
    `  PASS ${source.coach} ${variant}: ${(size / 1_000_000).toFixed(2)} MB, ` +
    `${textureRecords.length} WebP textures ${(textureBefore / 1_000_000).toFixed(2)} -> ` +
    `${(textureAfter / 1_000_000).toFixed(2)} MB, ${source.textureSlots} slots preserved`,
  );
  return outputPath;
}

function selectIdleAnimation(document, label) {
  const animations = document.getRoot().listAnimations();
  const exact = animations.filter((animation) => animation.getName().trim().toLowerCase() === 'idle');
  const candidates = exact.length ? exact : animations.filter((animation) => /(^|\W)idle(\W|$)/i.test(animation.getName()));
  if (candidates.length !== 1) {
    throw new PreparationError(
      `${label} must contain exactly one unambiguous idle clip; found ${candidates.length}.`,
      `Available clips: ${animations.map((animation) => animation.getName() || '(unnamed)').join(', ')}`,
    );
  }
  return candidates[0];
}

function animationSnapshot(animation) {
  return animation.listChannels().map((channel) => {
    const sampler = channel.getSampler();
    return {
      targetNode: channel.getTargetNode()?.getName() ?? '',
      targetPath: channel.getTargetPath(),
      interpolation: sampler.getInterpolation(),
      inputType: sampler.getInput()?.getType() ?? null,
      outputType: sampler.getOutput()?.getType() ?? null,
      input: Array.from(sampler.getInput()?.getArray() ?? []),
      output: Array.from(sampler.getOutput()?.getArray() ?? []),
    };
  });
}

function isStaticSampler(sampler, tolerance = 1e-8) {
  const output = sampler.getOutput();
  const values = output?.getArray();
  const elementSize = output?.getElementSize();
  if (!values || !elementSize || values.length < elementSize) return false;
  for (let index = elementSize; index < values.length; index += 1) {
    if (Math.abs(values[index] - values[index % elementSize]) > tolerance) return false;
  }
  return true;
}

function isStaticSceneRootTRS(document, channel) {
  const node = channel.getTargetNode();
  if (!node || !/^root(?:\.\d+)?$/i.test(node.getName())) return false;
  if (!['translation', 'rotation', 'scale'].includes(channel.getTargetPath())) return false;
  const isDirectSceneRoot = document.getRoot().listScenes().some((scene) => scene.listChildren().includes(node));
  if (node.getParentNode() || !isDirectSceneRoot) return false;
  return isStaticSampler(channel.getSampler());
}

function describeNormalizedRootChannel(channel) {
  const output = channel.getSampler().getOutput();
  const elementSize = output.getElementSize();
  return {
    node: channel.getTargetNode().getName(),
    path: channel.getTargetPath(),
    value: Array.from(output.getArray().slice(0, elementSize)),
    keyframes: channel.getSampler().getInput()?.getCount() ?? 0,
  };
}

function numericSnapshotsEqual(actual, expected, tolerance = 1e-7) {
  if (actual.length !== expected.length) return false;
  for (let channelIndex = 0; channelIndex < actual.length; channelIndex += 1) {
    const a = actual[channelIndex];
    const b = expected[channelIndex];
    for (const key of ['targetNode', 'targetPath', 'interpolation', 'inputType', 'outputType']) {
      if (a[key] !== b[key]) return false;
    }
    for (const key of ['input', 'output']) {
      if (a[key].length !== b[key].length) return false;
      for (let valueIndex = 0; valueIndex < a[key].length; valueIndex += 1) {
        if (Math.abs(a[key][valueIndex] - b[key][valueIndex]) > tolerance) return false;
      }
    }
  }
  return true;
}

function disposeAnimation(animation) {
  for (const channel of animation.listChannels()) channel.dispose();
  for (const sampler of animation.listSamplers()) sampler.dispose();
  animation.dispose();
}

function stripDeadAnimationContent(document, idle, liveModelNodeNames) {
  const root = document.getRoot();
  for (const animation of [...root.listAnimations()]) {
    if (animation !== idle) disposeAnimation(animation);
  }

  let droppedChannels = 0;
  const normalizedRootChannels = [];
  for (const channel of [...idle.listChannels()]) {
    const targetName = channel.getTargetNode()?.getName();
    if (isStaticSceneRootTRS(document, channel)) {
      normalizedRootChannels.push(describeNormalizedRootChannel(channel));
      channel.dispose();
    } else if (!targetName || !liveModelNodeNames.has(targetName)) {
      channel.dispose();
      droppedChannels += 1;
    }
  }
  const usedSamplers = new Set(idle.listChannels().map((channel) => channel.getSampler()));
  for (const sampler of [...idle.listSamplers()]) {
    if (!usedSamplers.has(sampler)) sampler.dispose();
  }

  // Animation bundles are retargeted by node name. Geometry, skins, materials,
  // and textures in the animation export are dead delivery weight.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const mesh of [...root.listMeshes()]) mesh.dispose();

  const retained = new Set();
  for (const channel of idle.listChannels()) {
    for (let node = channel.getTargetNode(); node; node = node.getParentNode()) retained.add(node);
  }
  for (const node of [...root.listNodes()].reverse()) {
    if (!retained.has(node)) node.dispose();
  }
  return { droppedChannels, normalizedRootChannels };
}

function setAnimationProvenance(
  document,
  coach,
  sourceHash,
  idleName,
  contract,
  modelSourceHash,
  normalizedRootChannels,
  retainedBodyCurvesHash,
) {
  const root = document.getRoot();
  root.setExtras({
    ...(root.getExtras() ?? {}),
    classicChessAvatarV2Animation: {
      contractVersion: CONTRACT_VERSION,
      coach,
      sourceAsset: 'full-animation-export',
      sourceSha256: sourceHash,
      modelSourceSha256: modelSourceHash,
      channelOrderSha256: contract.orderHash,
      retainedClip: idleName,
      posePolicy: 'static scene-root TRS removed; retained body keyframes and rest transforms unchanged',
      normalizationPolicy: 'strip static root/root.001 translation, rotation, and scale channels only',
      strippedStaticSceneRootTRS: normalizedRootChannels,
      retainedBodyCurvesSha256: retainedBodyCurvesHash,
    },
  });
}

async function prepareAnimation(io, source, animationPath, outputDir, contract) {
  rejectLiteSource(animationPath, `${source.coach} animation`);
  const raw = await io.readAsJSON(animationPath);
  assertSupportedExtensions(raw.json, animationPath);
  const sourceHash = await sha256File(animationPath);
  const document = await io.read(animationPath);
  removeDracoEncoding(document);
  const idle = selectIdleAnimation(document, `${source.coach} animation source`);
  const idleName = idle.getName();
  const originalClipCount = document.getRoot().listAnimations().length;
  const { droppedChannels, normalizedRootChannels } = stripDeadAnimationContent(document, idle, source.nodeNames);
  if (!idle.listChannels().length) {
    throw new PreparationError(`${source.coach} idle clip has no channels that bind to the FULL model skeleton.`);
  }
  const expectedAnimation = animationSnapshot(idle);
  const retainedBodyCurvesHash = sha256Bytes(stableStringify(expectedAnimation));
  const expectedNodePoses = nodePoseSignature(document);
  setAnimationProvenance(
    document,
    source.coach,
    sourceHash,
    idleName,
    contract,
    source.sourceHash,
    normalizedRootChannels,
    retainedBodyCurvesHash,
  );

  // No resampling, chest straightening, head rotation, or other curve rewrite is
  // allowed. Prune only reclaims content disconnected above; meshopt stores the
  // retained accessor bytes compactly and the readback gate checks every value.
  await document.transform(
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  if (!numericSnapshotsEqual(animationSnapshot(idle), expectedAnimation)) {
    throw new PreparationError(`${source.coach} idle values changed before writing.`);
  }
  assertEqualSignature(
    nodePoseSignature(document),
    expectedNodePoses,
    `${source.coach} animation rest pose`,
    'Animation cleanup may remove dead nodes, but must not edit or reparent retained nodes.',
  );

  const outputPath = path.join(outputDir, `${source.coach}-animations.glb`);
  await writeAtomically(io, outputPath, document, async (temporary) => {
    const writtenRaw = await io.readAsJSON(temporary);
    const written = await io.read(temporary);
    const animations = written.getRoot().listAnimations();
    if (animations.length !== 1 || animations[0].getName() !== idleName) {
      throw new PreparationError(`${source.coach} animation output did not retain exactly the selected idle clip.`);
    }
    if (!numericSnapshotsEqual(animationSnapshot(animations[0]), expectedAnimation)) {
      throw new PreparationError(
        `${source.coach} idle curve/keyframe values changed during write/readback.`,
        'The temporary animation output was not promoted.',
      );
    }
    assertPoseEquivalent(nodePoseSignature(written), expectedNodePoses, `${source.coach} written animation rest pose`);
    if (written.getRoot().listMeshes().length || written.getRoot().listMaterials().length || written.getRoot().listTextures().length) {
      throw new PreparationError(`${source.coach} animation output still contains dead render assets.`);
    }
    const provenance = writtenRaw.json.extras?.classicChessAvatarV2Animation;
    if (provenance?.sourceSha256 !== sourceHash || provenance?.modelSourceSha256 !== source.sourceHash) {
      throw new PreparationError(`${source.coach} animation provenance is incomplete.`);
    }
    if (stableStringify(provenance.strippedStaticSceneRootTRS) !== stableStringify(normalizedRootChannels)) {
      throw new PreparationError(`${source.coach} animation root-TRS normalization provenance changed.`);
    }
    if (provenance.retainedBodyCurvesSha256 !== retainedBodyCurvesHash) {
      throw new PreparationError(`${source.coach} animation retained-body-curve hash changed.`);
    }
  });

  console.log(
    `  PASS ${source.coach} animation: kept "${idleName}", dropped ${originalClipCount - 1} clips + ` +
    `${droppedChannels} dead channels + ${normalizedRootChannels.length} static scene-root TRS channels, ` +
    `${expectedAnimation.length} pose-identical body channels remain`,
  );
  return outputPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log('Chess Avatars V2 safe preparation');
  console.log(`  source:   ${options.sourceDir}`);
  console.log(`  contract: ${options.contractDir}`);
  console.log(`  output:   ${options.outputDir}${options.dryRun ? ' (dry run)' : ''}`);
  console.log(`  coaches:  ${options.coaches.join(', ')}`);
  console.log(`  variants: ${options.variants.join(', ')}`);

  const contract = loadChannelContract(options.contractDir);
  const io = await createIO();

  // Preflight every requested FULL model before writing any output. This keeps a
  // missing/103-target source from producing a partially updated coach set.
  const sources = [];
  for (const coach of options.coaches) {
    const fullPath = findFirstExisting(options.sourceDir, COACHES[coach].full, `${coach} FULL model`);
    const source = await inspectFullSource(io, coach, fullPath, contract);
    sources.push(source);
    console.log(
      `  SOURCE ${coach}: 251/251 names, ${(source.influenceCoverage * 100).toFixed(1)}% influence coverage, ` +
      `${source.textureCount} textures / ${source.textureSlots} slots, PBR ext ` +
      `${source.materialExtensions.join(', ') || '(none)'}`,
    );
  }

  if (options.animations) {
    for (const source of sources) {
      findFirstExisting(options.sourceDir, COACHES[source.coach].animation, `${source.coach} animation source`);
    }
  }
  if (options.dryRun) {
    console.log(`\nPASS dry run: ${sources.length} FULL sources satisfy the 251-channel contract; no files written.`);
    return;
  }

  const outputs = [];
  for (const source of sources) {
    for (const variant of options.variants) {
      outputs.push(await prepareModelVariant(io, source, variant, options.outputDir, contract));
    }
    if (options.animations) {
      const animationPath = findFirstExisting(
        options.sourceDir,
        COACHES[source.coach].animation,
        `${source.coach} animation source`,
      );
      outputs.push(await prepareAnimation(io, source, animationPath, options.outputDir, contract));
    }
  }

  console.log(`\nPASS Chess Avatars V2 preparation: ${outputs.length} verified output(s).`);
  for (const output of outputs) console.log(`  ${output}`);
}

main().catch((error) => {
  console.error('\nFAIL Chess Avatars V2 preparation');
  console.error(`  ${error.message}`);
  if (error.hint) console.error(`  Action: ${error.hint}`);
  if (!(error instanceof PreparationError) && error.stack) console.error(error.stack);
  process.exitCode = 1;
});

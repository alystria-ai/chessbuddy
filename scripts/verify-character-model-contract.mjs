/**
 * Audit Chess Avatars V2 sources and browser outputs against the vendor Convai
 * MHA contract. The report is intentionally actionable: every failure names the
 * asset, violated invariant, and the corrective build action.
 *
 * Coverage is measured from names aligned to real primitive morph indices —
 * the indices Three.js exposes through morphTargetDictionary/influences. A
 * vendor channel may legitimately have zero vertex deltas and still owns an
 * influence slot, so a non-zero-delta scan would incorrectly reject the kit.
 *
 * The 103-target *_Lite.glb files are AUDIT-ONLY. They may remain beside the
 * sources for comparison, but neither desktop nor mobile may claim them as
 * provenance. Both variants must match the exact per-mesh morph sequence of the
 * corresponding FULL source.
 *
 * Usage examples:
 *   node scripts/verify-character-model-contract.mjs
 *   node scripts/verify-character-model-contract.mjs --coach=sofia
 *   node scripts/verify-character-model-contract.mjs \
 *     --vendor-dir="<extracted package>" --skip-built
 *   node scripts/verify-character-model-contract.mjs --json
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const ORDER_COUNT = 251;
const EXPECTED_ORDER_HASH = '232e7c65a5ddbc80e7f9c8c9ec1cac62dbb779729abeb6731ce159297a1d1e48';

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
  desktop: { file: (coach) => `${coach}.glb`, maxTextureSize: 2048 },
  mobile: { file: (coach) => `${coach}.mobile.glb`, maxTextureSize: 1024 },
};

class AuditReporter {
  constructor({ json = false } = {}) {
    this.json = json;
    this.entries = [];
  }

  pass(scope, message, data = undefined) {
    this.entries.push({ status: 'PASS', scope, message, ...(data === undefined ? {} : { data }) });
  }

  warn(scope, message, action = '') {
    this.entries.push({ status: 'WARN', scope, message, ...(action ? { action } : {}) });
  }

  fail(scope, message, action) {
    this.entries.push({ status: 'FAIL', scope, message, action });
  }

  finish() {
    const counts = { PASS: 0, WARN: 0, FAIL: 0 };
    for (const entry of this.entries) counts[entry.status] += 1;
    if (this.json) {
      console.log(JSON.stringify({ ok: counts.FAIL === 0, counts, checks: this.entries }, null, 2));
    } else {
      for (const entry of this.entries) {
        console.log(`${entry.status.padEnd(4)} [${entry.scope}] ${entry.message}`);
        if (entry.status === 'FAIL' && entry.action) console.log(`     Action: ${entry.action}`);
        else if (entry.status === 'WARN' && entry.action) console.log(`     Note: ${entry.action}`);
      }
      console.log(
        `\nCharacter model contract: ${counts.FAIL ? 'FAILED' : 'PASSED'} ` +
        `(${counts.PASS} passed, ${counts.WARN} warnings, ${counts.FAIL} failed)`,
      );
    }
    return counts.FAIL === 0;
  }
}

function parseArgs(argv) {
  const options = {
    sourceDir: path.join(ROOT, 'assets-src'),
    vendorDir: null,
    contractDir: null,
    publicDir: path.join(ROOT, 'public'),
    lightingPath: null,
    coaches: [],
    built: true,
    animations: true,
    json: false,
  };
  let sourceDirWasExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) return inline;
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${name}.`);
      index += 1;
      return next;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--skip-built' || arg === '--source-only') options.built = false;
    else if (arg === '--skip-animations' || arg === '--no-animations') options.animations = false;
    else if (arg === '--source-dir' || arg.startsWith('--source-dir=')) {
      sourceDirWasExplicit = true;
      options.sourceDir = takeValue('--source-dir');
    } else if (arg === '--vendor-dir' || arg.startsWith('--vendor-dir=')) options.vendorDir = takeValue('--vendor-dir');
    else if (arg === '--contract-dir' || arg.startsWith('--contract-dir=')) options.contractDir = takeValue('--contract-dir');
    else if (arg === '--public-dir' || arg.startsWith('--public-dir=')) options.publicDir = takeValue('--public-dir');
    else if (arg === '--lighting' || arg.startsWith('--lighting=')) options.lightingPath = takeValue('--lighting');
    else if (arg === '--coach' || arg.startsWith('--coach=')) {
      options.coaches.push(...takeValue('--coach').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
    } else if (!arg.startsWith('--')) options.coaches.push(arg.trim().toLowerCase());
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (options.vendorDir && sourceDirWasExplicit) throw new Error('Use either --vendor-dir or --source-dir, not both.');
  if (options.vendorDir) options.sourceDir = options.vendorDir;
  options.sourceDir = path.resolve(options.sourceDir);
  options.vendorDir = options.vendorDir ? path.resolve(options.vendorDir) : null;
  options.publicDir = path.resolve(options.publicDir);
  options.contractDir = path.resolve(
    options.contractDir ?? options.vendorDir ?? path.join(ROOT, 'vendor', 'convai-web-lipsync'),
  );
  options.lightingPath = options.lightingPath ? path.resolve(options.lightingPath) : null;
  options.coaches = [...new Set(options.coaches.length ? options.coaches : Object.keys(COACHES))];
  for (const coach of options.coaches) {
    if (!COACHES[coach]) throw new Error(`Unknown coach "${coach}" (expected ${Object.keys(COACHES).join(', ')}).`);
  }
  return options;
}

function printHelp() {
  console.log(`Chess Avatars V2 contract validator

Usage:
  node scripts/verify-character-model-contract.mjs [coach ...] [options]

Options:
  --coach=<names>       Comma-separated subset: arjun, leila, magnus, sofia
  --source-dir=<path>   Staged FULL sources (default: assets-src)
  --vendor-dir=<path>   Extracted vendor package; implies --source-dir
  --contract-dir=<path> Convai LipSync JSON directory
  --public-dir=<path>   Built model directory (default: public)
  --lighting=<path>     Optional lighting-setup.json to parse/check
  --skip-built          Validate vendor JSON and FULL sources only
  --skip-animations     Skip source/output idle-animation checks
  --json                Emit a machine-readable report
  --help                Show this help`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function numericArraysEqual(actual, expected, tolerance = 1e-4) {
  return actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

function poseSignaturesEquivalent(actual, expected, tolerance = 1e-4) {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) {
    const a = actual[index];
    const b = expected[index];
    if (a.nodeIndex !== b.nodeIndex || a.name !== b.name || a.parent !== b.parent) return false;
    if (!deepEqual(a.children, b.children)) return false;
    if (!numericArraysEqual(a.translation, b.translation, tolerance)) return false;
    if (!numericArraysEqual(a.rotation, b.rotation, tolerance)) return false;
    if (!numericArraysEqual(a.scale, b.scale, tolerance)) return false;
  }
  return true;
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

function readJSON(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function resolveContractReference(contractDir, ownerPath, reference, label) {
  if (typeof reference !== 'string' || !reference) throw new Error(`${label} reference is missing.`);
  const resolved = path.resolve(path.dirname(ownerPath), reference);
  const relative = path.relative(contractDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} reference escapes the contract directory: ${reference}`);
  }
  return resolved;
}

function schemaErrors(value, schema, location = '$', errors = []) {
  const typeMatches = (expected) => {
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (expected === 'integer') return Number.isInteger(value);
    if (expected === 'null') return value === null;
    return typeof value === expected;
  };
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.type && !typeMatches(schema.type)) {
    errors.push(`${location} must be ${schema.type}`);
    return errors;
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${location} must be >= ${schema.minimum}`);
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${location} must contain at least ${schema.minLength} character(s)`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location} allows at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(stableStringify)).size !== value.length) errors.push(`${location} items must be unique`);
    if (schema.items) value.forEach((entry, index) => schemaErrors(entry, schema.items, `${location}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) errors.push(`${location}.${required} is required`);
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      errors.push(`${location} needs at least ${schema.minProperties} properties`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) schemaErrors(value[key], childSchema, `${location}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${location}.${key} is not allowed`);
    }
  }
  return errors;
}

function validateContractFiles(options, reporter) {
  const scope = 'vendor-json';
  let jsonFiles;
  try {
    jsonFiles = fs.readdirSync(options.contractDir)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .sort();
  } catch (error) {
    reporter.fail(scope, `Cannot enumerate ${options.contractDir}: ${error.message}`, 'Restore/extract the Convai Web LipSync kit.');
    return null;
  }
  if (!jsonFiles.length) {
    reporter.fail(scope, `No JSON files found in ${options.contractDir}.`, 'Point --contract-dir to the extracted Convai Web LipSync kit.');
    return null;
  }
  const parsed = new Map();
  for (const fileName of jsonFiles) {
    const filePath = path.join(options.contractDir, fileName);
    try {
      parsed.set(fileName, readJSON(filePath));
    } catch (error) {
      reporter.fail(scope, error.message, `Replace ${fileName} with the supplied valid JSON.`);
    }
  }
  if (reporter.entries.some((entry) => entry.status === 'FAIL' && entry.scope === scope)) return null;
  reporter.pass(scope, `Parsed ${jsonFiles.length} supplied JSON file(s): ${jsonFiles.join(', ')}`);

  try {
    const setupPath = path.join(options.contractDir, 'Lipsynic-setup.json');
    const setup = parsed.get('Lipsynic-setup.json') ?? readJSON(setupPath);
    const schemaPath = resolveContractReference(options.contractDir, setupPath, setup.$schema, 'setup.$schema');
    const schema = readJSON(schemaPath);
    const errors = schemaErrors(setup, schema);
    if (errors.length) {
      reporter.fail(
        'schema',
        `Lipsynic-setup.json violates lipsync-setup.schema.json: ${errors.join('; ')}`,
        'Restore the supplied setup/schema pair; do not hand-edit transport or safety types.',
      );
    } else reporter.pass('schema', 'Lipsynic-setup.json satisfies the supplied JSON Schema.');

    const orderPath = resolveContractReference(
      options.contractDir,
      setupPath,
      setup?.transport?.channelOrderFile,
      'transport.channelOrderFile',
    );
    const order = readJSON(orderPath);
    const mapReference = setup?.presets?.unity441Parity?.mapping?.file;
    const mapPath = resolveContractReference(options.contractDir, setupPath, mapReference, 'unity441Parity.mapping.file');
    const unityMap = readJSON(mapPath);
    const channels = order?.channels;

    const orderProblems = [];
    if (order?.schemaVersion !== 1) orderProblems.push('schemaVersion must be 1');
    if (order?.format !== 'mha') orderProblems.push('format must be "mha"');
    if (order?.channelCount !== ORDER_COUNT) orderProblems.push(`channelCount must be ${ORDER_COUNT}`);
    if (!Array.isArray(channels)) orderProblems.push('channels must be an array');
    else {
      if (channels.length !== ORDER_COUNT) orderProblems.push(`channels length is ${channels.length}, expected ${ORDER_COUNT}`);
      if (new Set(channels).size !== channels.length) orderProblems.push('channels are not unique');
      const hash = sha256Bytes(channels.join('\0'));
      if (hash !== EXPECTED_ORDER_HASH) orderProblems.push(`ordered channel hash ${hash} is not the supplied order`);
      for (const required of REQUIRED_CHANNELS) if (!channels.includes(required)) orderProblems.push(`missing ${required}`);
    }
    if (orderProblems.length) {
      reporter.fail(
        'channel-order',
        orderProblems.join('; '),
        'Restore metahuman-order-251.json exactly. Never sort the channel list alphabetically.',
      );
    } else {
      reporter.pass('channel-order', `Exact vendor order verified: ${ORDER_COUNT} unique channels, SHA-256 ${EXPECTED_ORDER_HASH}.`);
    }

    const setupProblems = [];
    if (setup?.transport?.enableLipsync !== true) setupProblems.push('transport.enableLipsync must be true');
    if (setup?.transport?.format !== 'mha') setupProblems.push('transport.format must be mha');
    if (setup?.transport?.channelCount !== ORDER_COUNT) setupProblems.push(`transport.channelCount must be ${ORDER_COUNT}`);
    if (setup?.defaultPreset !== 'webStudioVerified') setupProblems.push('defaultPreset must start at webStudioVerified');
    if (!setup?.presets?.webStudioVerified) setupProblems.push('webStudioVerified preset is missing');
    if (setup?.presets?.webStudioVerified?.application?.mode !== 'add') setupProblems.push('webStudioVerified application.mode must be add');
    if (setup?.presets?.webStudioVerified?.application?.removePreviousContributionBeforeApply !== true) {
      setupProblems.push('previous additive contribution must be removed before apply');
    }
    const safetyFlags = [
      'rejectNonFiniteValues',
      'clampEveryChannel',
      'disableFrustumCullingOnMorphedMeshes',
      'neverReplaceMorphTargetInfluenceArrays',
      'resetOnNormalizationSignal',
      'resetWhenConversationEnds',
    ];
    for (const flag of safetyFlags) if (setup?.runtimeSafety?.[flag] !== true) setupProblems.push(`runtimeSafety.${flag} must be true`);
    if (!deepEqual(setup?.compatibility?.inputRange, [0, 1])) setupProblems.push('compatibility.inputRange must be [0,1]');
    if (!deepEqual(setup?.compatibility?.outputRange, [0, 1])) setupProblems.push('compatibility.outputRange must be [0,1]');
    const requiredCoverage = setup?.minimumValidation?.requiredMorphCoverage;
    if (!Number.isFinite(requiredCoverage) || requiredCoverage < 0.95) setupProblems.push('requiredMorphCoverage must be at least 0.95');
    const declaredRequired = setup?.minimumValidation?.requiredChannels;
    for (const required of REQUIRED_CHANNELS) {
      if (!Array.isArray(declaredRequired) || !declaredRequired.includes(required)) {
        setupProblems.push(`minimumValidation.requiredChannels lacks ${required}`);
      }
    }
    if (setupProblems.length) {
      reporter.fail('setup', setupProblems.join('; '), 'Restore the supplied Web Studio verified setup values.');
    } else reporter.pass('setup', 'Web Studio verified preset, normalized ranges, additive order, and runtime safety flags are intact.');

    const mapProblems = [];
    const mappings = unityMap?.mappings;
    if (unityMap?.schemaVersion !== 1) mapProblems.push('schemaVersion must be 1');
    if (unityMap?.transportFormat !== 'mha') mapProblems.push('transportFormat must be mha');
    if (!Array.isArray(mappings) || mappings.length !== ORDER_COUNT) {
      mapProblems.push(`mappings must contain ${ORDER_COUNT} entries`);
    } else if (Array.isArray(channels)) {
      const sources = mappings.map((mapping) => mapping.source);
      if (new Set(sources).size !== ORDER_COUNT) mapProblems.push('mapping sources are not unique');
      const sourceSet = new Set(sources);
      for (const channel of channels) if (!sourceSet.has(channel)) mapProblems.push(`mapping missing source ${channel}`);
      for (const [index, mapping] of mappings.entries()) {
        if (!Array.isArray(mapping.targets) || !mapping.targets.length || mapping.targets.some((target) => typeof target !== 'string')) {
          mapProblems.push(`mapping #${index} has invalid targets`);
        }
        for (const field of ['multiplier', 'offset', 'curveExponent', 'clampMinValue', 'clampMaxValue']) {
          if (!Number.isFinite(mapping[field])) mapProblems.push(`mapping #${index} ${field} is not finite`);
        }
        if (mapping.clampMinValue > mapping.clampMaxValue) mapProblems.push(`mapping #${index} clamp min exceeds max`);
      }
    }
    if (mapProblems.length) {
      reporter.fail(
        'unity-map',
        `${mapProblems.slice(0, 12).join('; ')}${mapProblems.length > 12 ? `; … ${mapProblems.length - 12} more` : ''}`,
        'Restore unity-metahuman-map-4.4.1.json from the supplied Convai kit.',
      );
    } else reporter.pass('unity-map', 'Unity SDK 4.4.1 map has 251 unique, finite, clamped channel mappings.');

    return {
      setup,
      channels: Array.isArray(channels) ? channels : [],
      channelSet: new Set(Array.isArray(channels) ? channels : []),
      requiredCoverage: Number.isFinite(requiredCoverage) ? requiredCoverage : 0.95,
      orderHash: EXPECTED_ORDER_HASH,
    };
  } catch (error) {
    reporter.fail('vendor-json', error.message, 'Restore the complete supplied Convai Web LipSync JSON set.');
    return null;
  }
}

function validateOptionalLighting(options, reporter) {
  const candidates = [
    options.lightingPath,
    path.join(ROOT, 'public', 'character-assets', 'chess-avatars-v2', 'lighting-setup.json'),
  ].filter(Boolean);
  const lightingPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!lightingPath) {
    reporter.warn('lighting-json', 'No lighting-setup.json was available for this audit.', 'Pass --lighting=<path> to include it.');
    return;
  }
  try {
    const lighting = readJSON(lightingPath);
    const problems = [];
    if (!lighting.renderer || typeof lighting.renderer !== 'object') problems.push('renderer object missing');
    if (!lighting.environment || typeof lighting.environment !== 'object') problems.push('environment object missing');
    if (!Array.isArray(lighting.lights) || !lighting.lights.length) problems.push('lights array missing/empty');
    for (const [index, light] of (lighting.lights ?? []).entries()) {
      if (typeof light.name !== 'string' || typeof light.type !== 'string') problems.push(`light #${index} name/type invalid`);
      if (!Number.isFinite(light.intensity)) problems.push(`light #${index} intensity is not finite`);
      if (light.position && (!Array.isArray(light.position) || light.position.length !== 3 || light.position.some((v) => !Number.isFinite(v)))) {
        problems.push(`light #${index} position must be three finite values`);
      }
      if (typeof light.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.color)) problems.push(`light #${index} color is not #RRGGBB`);
    }
    if (!lighting.camera || !Array.isArray(lighting.camera.position) || !Array.isArray(lighting.camera.lookAt)) {
      problems.push('camera position/lookAt missing');
    }
    if (!lighting.postProcessing || typeof lighting.postProcessing !== 'object') problems.push('postProcessing object missing');
    if (problems.length) {
      reporter.fail('lighting-json', problems.join('; '), 'Restore the supplied lighting-setup.json exact values.');
    } else reporter.pass('lighting-json', `Parsed lighting contract with ${lighting.lights.length} lights: ${lightingPath}`);
  } catch (error) {
    reporter.fail('lighting-json', error.message, 'Restore the supplied valid lighting-setup.json.');
  }
}

function findFirstExisting(baseDir, candidates) {
  for (const candidate of candidates) {
    const resolved = path.resolve(baseDir, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

function isLitePath(filePath) {
  return /(^|[\/_ .-])lite([\/_ .-]|$)/i.test(filePath.replaceAll('\\', '/'));
}

async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

function morphSignature(document) {
  return document.getRoot().listMeshes().map((mesh, meshIndex) => ({
    meshIndex,
    meshName: mesh.getName(),
    targetNames: Array.isArray(mesh.getExtras()?.targetNames) ? [...mesh.getExtras().targetNames] : [],
    primitiveTargetCounts: mesh.listPrimitives().map((primitive) => primitive.listTargets().length),
    weights: [...mesh.getWeights()],
  }));
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

function inspectMorphContract(document, contract) {
  const named = new Set();
  const influenceRelevant = new Set();
  const problems = [];
  for (const [meshIndex, mesh] of document.getRoot().listMeshes().entries()) {
    const primitives = mesh.listPrimitives();
    const targetCounts = primitives.map((primitive) => primitive.listTargets().length);
    const maxTargets = Math.max(0, ...targetCounts);
    if (!maxTargets) continue;
    const names = mesh.getExtras()?.targetNames;
    const meshLabel = `mesh #${meshIndex} "${mesh.getName() || '(unnamed)'}"`;
    if (!Array.isArray(names)) {
      problems.push(`${meshLabel} has targets but no extras.targetNames`);
      continue;
    }
    if (new Set(names).size !== names.length) problems.push(`${meshLabel} targetNames are not unique`);
    names.forEach((name) => named.add(name));
    for (const [primitiveIndex, primitive] of primitives.entries()) {
      const targets = primitive.listTargets();
      if (!targets.length) continue;
      if (targets.length !== names.length) {
        problems.push(`${meshLabel} primitive #${primitiveIndex}: ${targets.length} targets vs ${names.length} names`);
        continue;
      }
      const vertexCount = primitive.getAttribute('POSITION')?.getCount();
      for (let index = 0; index < targets.length; index += 1) {
        const name = names[index];
        const target = targets[index];
        if (name && target.listSemantics().length) influenceRelevant.add(name);
        for (const semantic of target.listSemantics()) {
          const count = target.getAttribute(semantic)?.getCount();
          if (vertexCount !== undefined && count !== vertexCount) {
            problems.push(`${meshLabel} primitive #${primitiveIndex} ${name}/${semantic}: ${count} vs ${vertexCount} vertices`);
          }
        }
      }
    }
  }
  const missing = contract.channels.filter((channel) => !named.has(channel));
  const influenceMissing = contract.channels.filter((channel) => !influenceRelevant.has(channel));
  const extra = [...named].filter((name) => !contract.channelSet.has(name));
  const coverage = contract.channels.length ? (contract.channels.length - missing.length) / contract.channels.length : 0;
  const influenceCoverage = contract.channels.length
    ? (contract.channels.length - influenceMissing.length) / contract.channels.length
    : 0;
  for (const required of REQUIRED_CHANNELS) {
    if (!influenceRelevant.has(required)) problems.push(`required channel lacks an aligned influence: ${required}`);
  }
  return { named, influenceRelevant, missing, influenceMissing, extra, coverage, influenceCoverage, problems };
}

async function canonicalMaterials(io, document) {
  return (await io.writeJSON(document)).json.materials ?? [];
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

function materialExtensionNames(materials) {
  return [...new Set(materials.flatMap((material) => Object.keys(material.extensions ?? {})))].sort();
}

function unsupportedExtensions(rawJSON) {
  const supported = new Set(ALL_EXTENSIONS.map((ExtensionClass) => ExtensionClass.EXTENSION_NAME));
  return (rawJSON.extensionsUsed ?? []).filter((extension) => !supported.has(extension));
}

async function analyzeModel(io, filePath, contract, { canonicalizeMaterials = false } = {}) {
  const raw = await io.readAsJSON(filePath);
  const document = await io.read(filePath);
  const morphs = inspectMorphContract(document, contract);
  const rawMaterials = raw.json.materials ?? [];
  const materials = canonicalizeMaterials ? await canonicalMaterials(io, document) : rawMaterials;
  return {
    filePath,
    hash: await sha256File(filePath),
    raw,
    document,
    morphs,
    morphSignature: morphSignature(document),
    poseSignature: nodePoseSignature(document),
    materials,
    rawMaterials,
    textureSlots: countTextureSlots(materials),
    materialExtensions: materialExtensionNames(materials),
    nodeNames: new Set(document.getRoot().listNodes().map((node) => node.getName()).filter(Boolean)),
    unknownExtensions: unsupportedExtensions(raw.json),
  };
}

function reportMorphResult(scope, analysis, contract, reporter, exact = true) {
  const { morphs } = analysis;
  const summary =
    `${morphs.named.size} unique names, ${(morphs.coverage * 100).toFixed(1)}% named coverage, ` +
    `${(morphs.influenceCoverage * 100).toFixed(1)}% influence-aligned coverage`;
  const failures = [...morphs.problems];
  if (morphs.coverage < contract.requiredCoverage) failures.push(`named coverage is below ${(contract.requiredCoverage * 100).toFixed(0)}%`);
  if (morphs.influenceCoverage < contract.requiredCoverage) failures.push(`influence coverage is below ${(contract.requiredCoverage * 100).toFixed(0)}%`);
  if (exact && (morphs.named.size !== ORDER_COUNT || morphs.missing.length || morphs.extra.length)) {
    failures.push(`exact ${ORDER_COUNT}-name set not preserved (missing ${morphs.missing.length}, extra ${morphs.extra.length})`);
  }
  if (analysis.unknownExtensions.length) failures.push(`unsupported extensions: ${analysis.unknownExtensions.join(', ')}`);
  if (failures.length) {
    const details = failures.slice(0, 10).join('; ');
    reporter.fail(
      scope,
      `${summary}; ${details}${failures.length > 10 ? `; … ${failures.length - 10} more` : ''}`,
      'Use the vendor FULL GLB and rebuild without morph pruning, renaming, material stripping, or unknown-extension round-trips.',
    );
  } else reporter.pass(scope, summary);
}

async function verifyBuiltTextures(analysis, limit) {
  const problems = [];
  const root = analysis.document.getRoot();
  for (const [index, texture] of root.listTextures().entries()) {
    const image = texture.getImage();
    if (!image) {
      problems.push(`texture #${index} "${texture.getName()}" has no image`);
      continue;
    }
    try {
      const metadata = await sharp(Buffer.from(image), { failOn: 'error' }).metadata();
      const decoded = await sharp(Buffer.from(image), { failOn: 'error' }).raw().toBuffer();
      if (texture.getMimeType() !== 'image/webp' || metadata.format !== 'webp') {
        problems.push(`texture #${index} "${texture.getName()}" is not WebP`);
      }
      if (!metadata.width || !metadata.height || metadata.width > limit || metadata.height > limit) {
        problems.push(`texture #${index} "${texture.getName()}" is ${metadata.width}x${metadata.height}; max ${limit}`);
      }
      if (!decoded.byteLength) problems.push(`texture #${index} "${texture.getName()}" decodes to no pixels`);
    } catch (error) {
      problems.push(`texture #${index} "${texture.getName()}" decode failed: ${error.message}`);
    }
  }
  const required = new Set(analysis.raw.json.extensionsRequired ?? []);
  if (root.listTextures().length && !required.has('EXT_texture_webp')) problems.push('EXT_texture_webp is not required');
  if (root.listAccessors().length && !required.has('EXT_meshopt_compression')) problems.push('EXT_meshopt_compression is not required');
  return problems;
}

function provenanceProblems(analysis, source, coach, variant, contract) {
  const provenance = analysis.raw.json.extras?.classicChessAvatarV2;
  const problems = [];
  if (!provenance) return ['classicChessAvatarV2 provenance is missing'];
  if (provenance.contractVersion !== 1) problems.push('contractVersion is not 1');
  if (provenance.coach !== coach) problems.push(`coach is ${provenance.coach}, expected ${coach}`);
  if (provenance.variant !== variant) problems.push(`variant is ${provenance.variant}, expected ${variant}`);
  if (provenance.sourceKind !== 'full') problems.push(`sourceKind is ${provenance.sourceKind}, expected full`);
  if (isLitePath(String(provenance.sourceAsset ?? ''))) problems.push('sourceAsset identifies a Lite GLB');
  if (provenance.sourceSha256 !== source.hash) problems.push('source SHA-256 does not match the audited FULL GLB');
  if (provenance.sourceMorphSignatureSha256 !== sha256Bytes(stableStringify(source.morphSignature))) {
    problems.push('source morph-signature hash does not match');
  }
  if (provenance.sourceMaterialSignatureSha256 !== sha256Bytes(stableStringify(source.materials))) {
    problems.push('source material-signature hash does not match');
  }
  if (provenance.sourcePoseSignatureSha256 !== sha256Bytes(stableStringify(source.poseSignature))) {
    problems.push('source rest-pose hash does not match');
  }
  if (provenance.channelOrderSha256 !== contract.orderHash) problems.push('channel-order hash does not match');
  if (provenance.channelCount !== ORDER_COUNT) problems.push(`channelCount is not ${ORDER_COUNT}`);
  if (provenance.textureMax !== VARIANTS[variant].maxTextureSize) problems.push('textureMax does not match variant budget');
  return problems;
}

function selectIdleAnimation(document) {
  const animations = document.getRoot().listAnimations();
  const exact = animations.filter((animation) => animation.getName().trim().toLowerCase() === 'idle');
  const candidates = exact.length ? exact : animations.filter((animation) => /(^|\W)idle(\W|$)/i.test(animation.getName()));
  return candidates.length === 1 ? candidates[0] : null;
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
  return !node.getParentNode() && isDirectSceneRoot && isStaticSampler(channel.getSampler());
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

function animationSnapshot(animation, allowedNodeNames = null, exclude = null) {
  return animation.listChannels()
    .filter((channel) => (!allowedNodeNames || allowedNodeNames.has(channel.getTargetNode()?.getName())) && !exclude?.(channel))
    .map((channel) => {
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

function numericSnapshotsEqual(actual, expected, tolerance = 1e-7) {
  if (actual.length !== expected.length) return false;
  for (let channelIndex = 0; channelIndex < actual.length; channelIndex += 1) {
    const a = actual[channelIndex];
    const b = expected[channelIndex];
    for (const key of ['targetNode', 'targetPath', 'interpolation', 'inputType', 'outputType']) if (a[key] !== b[key]) return false;
    for (const key of ['input', 'output']) {
      if (a[key].length !== b[key].length) return false;
      for (let valueIndex = 0; valueIndex < a[key].length; valueIndex += 1) {
        if (Math.abs(a[key][valueIndex] - b[key][valueIndex]) > tolerance) return false;
      }
    }
  }
  return true;
}

function animationPoseProblems(sourceDocument, outputDocument) {
  const sourceByName = new Map();
  const duplicates = new Set();
  for (const node of sourceDocument.getRoot().listNodes()) {
    if (sourceByName.has(node.getName())) duplicates.add(node.getName());
    else sourceByName.set(node.getName(), node);
  }
  const problems = [];
  for (const node of outputDocument.getRoot().listNodes()) {
    const name = node.getName();
    if (duplicates.has(name)) {
      problems.push(`cannot uniquely compare duplicate source node "${name}"`);
      continue;
    }
    const source = sourceByName.get(name);
    if (!source) {
      problems.push(`output node "${name}" does not exist in source`);
      continue;
    }
    const sourcePose = {
      translation: [...source.getTranslation()],
      rotation: [...source.getRotation()],
      scale: [...source.getScale()],
      parent: source.getParentNode()?.getName() ?? null,
    };
    const outputPose = {
      translation: [...node.getTranslation()],
      rotation: [...node.getRotation()],
      scale: [...node.getScale()],
      parent: node.getParentNode()?.getName() ?? null,
    };
    if (
      outputPose.parent !== sourcePose.parent ||
      !numericArraysEqual(outputPose.translation, sourcePose.translation) ||
      !numericArraysEqual(outputPose.rotation, sourcePose.rotation) ||
      !numericArraysEqual(outputPose.scale, sourcePose.scale)
    ) {
      problems.push(`rest transform/parent changed for node "${name}"`);
    }
  }
  return problems;
}

async function verifyAnimations(io, options, reporter, contract, coach, sourceModel) {
  const scope = `${coach}/animation`;
  const sourcePath = findFirstExisting(options.sourceDir, COACHES[coach].animation);
  if (!sourcePath) {
    reporter.fail(scope, 'Animation source is missing.', `Expected one of: ${COACHES[coach].animation.join(', ')}`);
    return;
  }
  let sourceDocument;
  let sourceHash;
  let sourceIdle;
  try {
    if (isLitePath(sourcePath)) throw new Error(`animation source looks Lite: ${sourcePath}`);
    sourceDocument = await io.read(sourcePath);
    sourceHash = await sha256File(sourcePath);
    sourceIdle = selectIdleAnimation(sourceDocument);
    if (!sourceIdle) throw new Error('source does not contain exactly one unambiguous Idle clip');
  } catch (error) {
    reporter.fail(scope, `Cannot inspect source: ${error.message}`, 'Restore the supplied animation export.');
    return;
  }
  const normalizedRootChannels = sourceIdle.listChannels()
    .filter((channel) => isStaticSceneRootTRS(sourceDocument, channel))
    .map(describeNormalizedRootChannel);
  const expectedBodyAnimation = animationSnapshot(
    sourceIdle,
    sourceModel.nodeNames,
    (channel) => isStaticSceneRootTRS(sourceDocument, channel),
  );
  if (!options.built) {
    reporter.pass(
      scope,
      `Source Idle clip "${sourceIdle.getName()}" has ${expectedBodyAnimation.length} FULL-model-bindable body channels; ` +
      `${normalizedRootChannels.length} static scene-root TRS channel(s) are normalization-only.`,
    );
    return;
  }

  const outputPath = path.join(options.publicDir, `${coach}-animations.glb`);
  if (!fs.existsSync(outputPath)) {
    reporter.fail(scope, `Built idle bundle is missing: ${outputPath}`, 'Run scripts/prepare-avatar-v2.mjs without --skip-animations.');
    return;
  }
  try {
    const raw = await io.readAsJSON(outputPath);
    const outputDocument = await io.read(outputPath);
    const animations = outputDocument.getRoot().listAnimations();
    const outputIdle = animations.length === 1 ? animations[0] : null;
    const problems = [];
    if (!outputIdle || outputIdle.getName() !== sourceIdle.getName()) {
      problems.push(`expected only "${sourceIdle.getName()}"; found ${animations.map((animation) => animation.getName()).join(', ')}`);
    } else {
      const actual = animationSnapshot(outputIdle);
      if (!numericSnapshotsEqual(actual, expectedBodyAnimation)) {
        problems.push('retained body keyframe/sampler values differ from source Idle');
      }
      const forbiddenRootChannels = outputIdle.listChannels().filter((channel) => isStaticSceneRootTRS(outputDocument, channel));
      if (forbiddenRootChannels.length) {
        problems.push(`${forbiddenRootChannels.length} static scene-root TRS normalization channel(s) remain`);
      }
    }
    problems.push(...animationPoseProblems(sourceDocument, outputDocument));
    if (outputDocument.getRoot().listMeshes().length) problems.push('dead meshes remain');
    if (outputDocument.getRoot().listMaterials().length) problems.push('dead materials remain');
    if (outputDocument.getRoot().listTextures().length) problems.push('dead textures remain');
    const required = new Set(raw.json.extensionsRequired ?? []);
    if (outputDocument.getRoot().listAccessors().length && !required.has('EXT_meshopt_compression')) {
      problems.push('EXT_meshopt_compression is not required');
    }
    const provenance = raw.json.extras?.classicChessAvatarV2Animation;
    if (!provenance) problems.push('animation provenance is missing');
    else {
      if (provenance.coach !== coach) problems.push('animation provenance coach mismatch');
      if (provenance.sourceSha256 !== sourceHash) problems.push('animation source SHA-256 mismatch');
      if (provenance.modelSourceSha256 !== sourceModel.hash) problems.push('FULL model source SHA-256 mismatch');
      if (provenance.channelOrderSha256 !== contract.orderHash) problems.push('channel-order hash mismatch');
      if (provenance.posePolicy !== 'static scene-root TRS removed; retained body keyframes and rest transforms unchanged') {
        problems.push('pose policy is missing/changed');
      }
      if (provenance.normalizationPolicy !== 'strip static root/root.001 translation, rotation, and scale channels only') {
        problems.push('root-TRS normalization policy is missing/changed');
      }
      if (!deepEqual(provenance.strippedStaticSceneRootTRS, normalizedRootChannels)) {
        problems.push('recorded stripped scene-root TRS channels do not match source');
      }
      if (provenance.retainedBodyCurvesSha256 !== sha256Bytes(stableStringify(expectedBodyAnimation))) {
        problems.push('retained-body-curve hash does not match the source body channels');
      }
    }
    if (problems.length) {
      reporter.fail(
        scope,
        `${problems.slice(0, 12).join('; ')}${problems.length > 12 ? `; … ${problems.length - 12} more` : ''}`,
        'Rebuild with prepare-avatar-v2.mjs; do not resample, straighten, pitch, or otherwise rewrite the Idle pose.',
      );
    } else {
      reporter.pass(
        scope,
        `One Idle clip, ${animationSnapshot(outputIdle).length} pose-identical body channels, ` +
        `${normalizedRootChannels.length} static scene-root TRS channels normalized, dead render/skeleton content stripped.`,
      );
    }
  } catch (error) {
    reporter.fail(scope, `Cannot inspect ${outputPath}: ${error.message}`, 'Rebuild the animation bundle with prepare-avatar-v2.mjs.');
  }
}

async function verifyCoach(io, options, reporter, contract, coach) {
  const sourcePath = findFirstExisting(options.sourceDir, COACHES[coach].full);
  const sourceScope = `${coach}/source-full`;
  if (!sourcePath) {
    reporter.fail(sourceScope, 'FULL source GLB is missing.', `Expected one of: ${COACHES[coach].full.join(', ')}`);
    return;
  }
  if (isLitePath(sourcePath)) {
    reporter.fail(sourceScope, `Resolved source looks Lite: ${sourcePath}`, 'Point the source directory at the FULL 251-target exports.');
    return;
  }

  const litePath = findFirstExisting(options.sourceDir, COACHES[coach].liteAuditOnly);
  if (litePath) {
    reporter.pass(`${coach}/lite-audit-only`, `Lite reference detected and excluded from every build/provenance path: ${path.basename(litePath)}`);
  }

  let source;
  try {
    source = await analyzeModel(io, sourcePath, contract, { canonicalizeMaterials: true });
    reportMorphResult(sourceScope, source, contract, reporter, true);
    reporter.pass(
      `${coach}/source-look`,
      `${source.textureSlots} texture slots and PBR extensions ${source.materialExtensions.join(', ') || '(none)'} captured as preservation baseline.`,
    );
  } catch (error) {
    reporter.fail(sourceScope, `Cannot inspect ${sourcePath}: ${error.message}`, 'Restore the supplied FULL GLB.');
    return;
  }

  if (options.built) {
    for (const [variant, settings] of Object.entries(VARIANTS)) {
      const scope = `${coach}/${variant}`;
      const builtPath = path.join(options.publicDir, settings.file(coach));
      if (!fs.existsSync(builtPath)) {
        reporter.fail(scope, `Built GLB is missing: ${builtPath}`, 'Run scripts/prepare-avatar-v2.mjs for both variants.');
        continue;
      }
      try {
        const built = await analyzeModel(io, builtPath, contract);
        reportMorphResult(scope, built, contract, reporter, true);
        const preservationProblems = [];
        if (!deepEqual(built.morphSignature, source.morphSignature)) {
          preservationProblems.push('per-mesh morph name order/count differs from FULL source');
        }
        if (!poseSignaturesEquivalent(built.poseSignature, source.poseSignature)) {
          preservationProblems.push('node rest pose/hierarchy differs from FULL source');
        }
        if (!deepEqual(built.rawMaterials, source.materials)) {
          preservationProblems.push('PBR material values, shader extensions, or texture slots differ from FULL source');
        }
        if (built.textureSlots !== source.textureSlots) {
          preservationProblems.push(`texture slots ${built.textureSlots} vs source ${source.textureSlots}`);
        }
        if (!deepEqual(built.materialExtensions, source.materialExtensions)) {
          preservationProblems.push(
            `material extensions [${built.materialExtensions.join(', ')}] vs source [${source.materialExtensions.join(', ')}]`,
          );
        }
        preservationProblems.push(...await verifyBuiltTextures(built, settings.maxTextureSize));
        preservationProblems.push(...provenanceProblems(built, source, coach, variant, contract));
        if (preservationProblems.length) {
          reporter.fail(
            `${scope}/preservation`,
            `${preservationProblems.slice(0, 12).join('; ')}${preservationProblems.length > 12 ? `; … ${preservationProblems.length - 12} more` : ''}`,
            'Rebuild from the FULL GLB with scripts/prepare-avatar-v2.mjs. Do not use Lite, strip materials, prune morphs, recolour brows, or bake head pitch.',
          );
        } else {
          reporter.pass(
            `${scope}/preservation`,
            `FULL provenance, exact 251 morph sequence, unchanged pose/PBR graph, ${built.textureSlots} slots, valid WebP <=${settings.maxTextureSize}.`,
          );
        }
      } catch (error) {
        reporter.fail(scope, `Cannot inspect ${builtPath}: ${error.message}`, 'Rebuild this output with scripts/prepare-avatar-v2.mjs.');
      }
    }
  }

  if (options.animations) await verifyAnimations(io, options, reporter, contract, coach, source);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL argument parsing: ${error.message}`);
    console.error('Action: run with --help for supported options.');
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  const reporter = new AuditReporter({ json: options.json });
  const contract = validateContractFiles(options, reporter);
  validateOptionalLighting(options, reporter);
  if (contract && contract.channels.length === ORDER_COUNT) {
    const io = await createIO();
    for (const coach of options.coaches) await verifyCoach(io, options, reporter, contract, coach);
  } else {
    reporter.fail('models', 'Model checks skipped because the 251-channel vendor contract is unavailable.', 'Fix vendor JSON failures first.');
  }
  const ok = reporter.finish();
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL unexpected validator error: ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
});

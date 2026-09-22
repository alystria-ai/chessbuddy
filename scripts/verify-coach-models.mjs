/**
 * Render every optimized coach GLB (web + mobile variants) through the same
 * Three.js capture page used for portrait baking, and report any browser
 * console warnings/errors. Writes PNGs to --out=<dir> (default: .verify-out/).
 *
 * Usage: node scripts/verify-coach-models.mjs [--out=DIR] [--headed]
 *        [--gaze-calibration] [coachId ...]
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE_VENDOR = path.join(ROOT, 'node_modules/three');
const POSTPROCESSING_VENDOR = path.join(ROOT, 'node_modules/postprocessing');
const N8AO_VENDOR = path.join(ROOT, 'node_modules/n8ao');
const MHA_JAW_OPEN_CHANNEL = 'CTRL_expressions_jawOpen';
const JAW_OPEN_PROBE_VALUE = 0.35;
const MHA_DENTAL_OCCLUSION = Object.freeze({
  CTRL_expressions_teethUpU: 0.12,
  CTRL_expressions_teethDownD: 0.3,
});
const JAW_OPEN_POSE = [
  MHA_JAW_OPEN_CHANNEL + ':' + JAW_OPEN_PROBE_VALUE,
  ...Object.entries(MHA_DENTAL_OCCLUSION).map(([channel, value]) => channel + ':' + value),
].join(',');
const CAPTURE_CASES = [
  {
    label: 'web neutral',
    fileSuffix: 'web',
    variant: 'web',
    pose: '',
  },
  {
    label: 'mobile neutral',
    fileSuffix: 'mobile',
    variant: 'mobile',
    pose: '',
  },
  {
    label: 'web jawOpen 0.35',
    fileSuffix: 'web.jaw-open-0.35',
    variant: 'web',
    pose: JAW_OPEN_POSE,
    probe: 'jaw',
    smile: 0,
  },
];
const GAZE_CALIBRATION_VALUES = [0.08, 0.16, 0.24, 0.32];
const EYE_LOOK_CHANNELS = Object.freeze({
  down: ['CTRL_expressions_eyeLookDownL', 'CTRL_expressions_eyeLookDownR'],
  left: ['CTRL_expressions_eyeLookLeftL', 'CTRL_expressions_eyeLookLeftR'],
  right: ['CTRL_expressions_eyeLookRightL', 'CTRL_expressions_eyeLookRightR'],
});
const CAMERA_GAZE_BY_COACH = Object.freeze(JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs/character-models/chess-avatars-v2/portrait-gaze-calibration.json'),
  'utf8',
)));

function makeGazePose(direction, value) {
  return EYE_LOOK_CHANNELS[direction]
    .map((channel) => channel + ':' + value)
    .join(',');
}

function makeGazePoseValues(values) {
  return Object.entries(values).map(([channel, value]) => {
    const direction = channel.slice(0, -1);
    const eye = channel.slice(-1);
    const title = direction[0].toUpperCase() + direction.slice(1);
    return `CTRL_expressions_eyeLook${title}${eye}:${value}`;
  }).join(',');
}

function gazeCalibrationCases(coach) {
  const directions = coach === 'leila' || coach === 'sofia'
    ? ['down', 'left', 'right']
    : ['left', 'right'];
  return directions.flatMap((direction) => GAZE_CALIBRATION_VALUES.map((value) => ({
    label: 'web gaze ' + direction + ' ' + value.toFixed(2),
    fileSuffix: 'web.gaze-' + direction + '-' + value.toFixed(2),
    variant: 'web',
    pose: makeGazePose(direction, value),
    probe: 'gaze-calibration',
    smile: 0,
  })));
}

function captureCasesForCoach(coach) {
  const gaze = CAMERA_GAZE_BY_COACH[coach];
  if (!gaze) throw new Error('Missing camera-gaze calibration for coach: ' + coach);
  return [
    ...CAPTURE_CASES,
    {
      label: 'web camera-facing gaze',
      fileSuffix: 'web.camera-gaze',
      variant: 'web',
      pose: makeGazePoseValues(gaze.values),
      probe: 'gaze-baseline',
      smile: 0,
    },
  ];
}

const BUFFER_SHIM_SOURCE = [
  'export const Buffer = {',
  '  from(value, encoding) {',
  '    if (encoding !== "base64") throw new Error("Portrait Buffer shim only supports base64");',
  '    const binary = atob(value);',
  '    const bytes = new Uint8Array(binary.length);',
  '    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);',
  '    return bytes;',
  '  },',
  '};',
  'export default { Buffer };',
].join('\n');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

function resolveWithin(baseDir, encodedRelativePath) {
  let relativePath = '';
  try {
    relativePath = decodeURIComponent(encodedRelativePath);
  } catch {
    return null;
  }
  if (relativePath.includes('\0')) return null;
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, relativePath);
  return candidate === root || candidate.startsWith(root + path.sep) ? candidate : null;
}

function resolveRequestFile(urlPathname) {
  if (urlPathname === '/' || urlPathname === '/capture') {
    return path.join(ROOT, 'scripts', 'portrait-capture.html');
  }
  if (urlPathname.startsWith('/vendor/three/')) {
    return resolveWithin(THREE_VENDOR, urlPathname.slice('/vendor/three/'.length));
  }
  if (urlPathname.startsWith('/vendor/postprocessing/')) {
    return resolveWithin(
      POSTPROCESSING_VENDOR,
      urlPathname.slice('/vendor/postprocessing/'.length),
    );
  }
  if (urlPathname.startsWith('/vendor/n8ao/')) {
    return resolveWithin(N8AO_VENDOR, urlPathname.slice('/vendor/n8ao/'.length));
  }
  if (urlPathname.startsWith('/draco/')) {
    return resolveWithin(
      path.join(THREE_VENDOR, 'examples/jsm/libs/draco/gltf'),
      urlPathname.slice('/draco/'.length),
    );
  }
  return resolveWithin(PUBLIC, urlPathname.replace(/^\//, ''));
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname === '/vendor/buffer-shim.js') {
          res.writeHead(200, { 'Content-Type': MIME['.js'] });
          res.end(BUFFER_SHIM_SOURCE);
          return;
        }
        if (url.pathname === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        const filePath = resolveRequestFile(url.pathname);
        if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal error');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function validateCaptureDiagnostics(diagnostics, captureCase) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };
  expect(diagnostics && typeof diagnostics === 'object', 'capture diagnostics are missing');
  if (!diagnostics) return failures;
  expect(diagnostics.variant === captureCase.variant, 'reported model variant is incorrect');
  expect(diagnostics.camera?.fov === 20, 'camera FOV is not 20');
  expect(
    JSON.stringify(diagnostics.camera?.position) === JSON.stringify([0.25, 1.487, 2.431]),
    'camera position does not match the V2 export',
  );
  expect(
    JSON.stringify(diagnostics.camera?.lookAt) === JSON.stringify([-0.032, 1.485, -0.011]),
    'camera lookAt does not match the V2 export',
  );
  expect(diagnostics.renderer?.toneMapping === 'ACESFilmic', 'ACESFilmic is not active');
  expect(diagnostics.renderer?.exposure === 1, 'exposure is not 1');
  expect(diagnostics.renderer?.outputColorSpace === 'srgb', 'sRGB output is not active');
  expect(diagnostics.renderer?.shadows === true, 'shadows are not active');
  expect(diagnostics.lights?.count === 4, 'the four-light rig is incomplete');
  expect(diagnostics.lights?.rigRotationDegrees === 31, 'light rig rotation is not 31 degrees');
  expect(
    diagnostics.lights?.whiteBalance?.appliedColor === '#e0e8ff',
    'the 7800K white-balance color is not applied',
  );
  const lights = new Map(
    (diagnostics.lights?.values || []).map((light) => [light.name, light]),
  );
  expect(
    JSON.stringify(lights.get('key')?.position) === JSON.stringify([3.259, 4, 1.541])
      && lights.get('key')?.intensity === 1.9
      && lights.get('key')?.color === '#fff1e0'
      && lights.get('key')?.shadowBias === -0.0001,
    'key light values do not match the V2 export',
  );
  expect(
    JSON.stringify(lights.get('rim')?.position) === JSON.stringify([-2.744, 3, -0.684])
      && lights.get('rim')?.intensity === 3
      && lights.get('rim')?.color === '#cfe8ff',
    'rim light values do not match the V2 export',
  );
  expect(
    JSON.stringify(lights.get('catchlight')?.position) === JSON.stringify([0.515, 1.6, 0.857])
      && lights.get('catchlight')?.intensity === 3
      && lights.get('catchlight')?.distance === 3,
    'catchlight values do not match the V2 export',
  );
  expect(lights.get('ambient')?.intensity === 1, 'ambient light intensity is not 1');
  expect(diagnostics.environment?.preset === 'studio', 'environment preset is not studio');
  expect(diagnostics.environment?.intensity === 0.25, 'environment intensity is not 0.25');
  expect(diagnostics.environment?.blur === 0.6, 'environment blur is not 0.6');
  expect(diagnostics.environment?.showAsBackground === false, 'HDRI is being shown as background');
  expect(diagnostics.materials?.iblBlur?.value === 0.6, 'IBL blur uniform is not 0.6');
  expect(
    diagnostics.materials?.iblBlur?.target === 'specular IBL roughness only',
    'IBL blur is not isolated to the specular environment sample',
  );
  expect(
    diagnostics.materials?.iblBlur?.expression === 'max(roughness, chessEnvironmentBlur)',
    'IBL blur does not preserve direct/material roughness with an environment-only floor',
  );
  expect(
    diagnostics.materials?.iblBlur?.materialCount > 0,
    'no PBR materials were registered for IBL blur',
  );
  expect(
    diagnostics.materials?.iblBlur?.compiledMaterialCount
      === diagnostics.materials?.iblBlur?.materialCount,
    'the IBL blur shader patch was not compiled for every PBR material',
  );
  expect(
    diagnostics.materials?.iblBlur?.shaderReplacementCount
      >= diagnostics.materials?.iblBlur?.compiledMaterialCount,
    'the IBL environment sample was not replaced during shader compilation',
  );
  expect(diagnostics.postProcessing?.n8ao?.aoRadius === 0.02, 'N8AO radius is not 0.02');
  expect(diagnostics.postProcessing?.n8ao?.intensity === 3, 'N8AO intensity is not 3');
  expect(diagnostics.postProcessing?.n8ao?.distanceFalloff === 1, 'N8AO falloff is not 1');
  expect(diagnostics.postProcessing?.n8ao?.halfRes === false, 'N8AO is not full resolution');
  expect(diagnostics.postProcessing?.n8ao?.quality === 'Medium', 'N8AO is not medium quality');
  expect(diagnostics.postProcessing?.bloom?.intensity === 0.27, 'bloom intensity is not 0.27');
  expect(
    diagnostics.postProcessing?.bloom?.luminanceThreshold === 0.9,
    'bloom threshold is not 0.9',
  );
  expect(diagnostics.postProcessing?.bloom?.mipmapBlur === true, 'mipmap bloom is not active');
  expect(diagnostics.postProcessing?.vignette?.offset === 0.25, 'vignette offset is not 0.25');
  expect(diagnostics.postProcessing?.vignette?.darkness === 0, 'vignette darkness is not 0');
  expect(diagnostics.postProcessing?.smaa === true, 'SMAA is not active');
  expect(diagnostics.colorGrade?.brightness === 98, 'brightness grade is not 98');
  expect(diagnostics.colorGrade?.contrast === 127, 'contrast grade is not 127');
  expect(diagnostics.colorGrade?.saturation === 88, 'saturation grade is not 88');
  expect(
    diagnostics.colorGrade?.appliedCssContrastPercent === 100,
    'late color-grade contrast does not preserve dark material detail',
  );
  expect(
    diagnostics.colorGrade?.transfer === 'shadow-preserving-css',
    'shadow-preserving browser color-grade transfer is not active',
  );
  expect(diagnostics.skin?.strength === 1.3, 'Penner strength is not 1.3');
  expect(diagnostics.skin?.lutSize === 64, 'Penner LUT is not 64x64');
  expect(diagnostics.skin?.materialCount > 0, 'no skin material received the Penner patch');
  expect(
    diagnostics.skin?.compiledMaterialCount === diagnostics.skin?.materialCount,
    'the direct-light Penner patch was not compiled for every skin material',
  );
  expect(
    diagnostics.skin?.directLightDirection === true,
    'Penner SSS is not driven by directLight.direction',
  );
  expect(
    diagnostics.skin?.directLightColor === true,
    'Penner SSS is not multiplied by directLight.color/intensity/shadow',
  );
  expect(
    diagnostics.skin?.directDiffuseInjection === true,
    'Penner SSS was not injected into reflectedLight.directDiffuse',
  );
  expect(
    diagnostics.skin?.postLightOutgoingSss === false,
    'Penner SSS still uses a post-light outgoingLight additive contribution',
  );
  expect(diagnostics.framing?.modelScale === 0.01, 'character model scale is not 0.01');
  const expectedBodyPoseSource = diagnostics.coachId === 'arjun' || diagnostics.coachId === 'magnus'
    ? 'frontal-bind'
    : 'authored-frame-0';
  expect(
    diagnostics.animation?.bodyPoseSource === expectedBodyPoseSource,
    'portrait body pose is not using the runtime-equivalent ' + expectedBodyPoseSource + ' rule',
  );
  expect(
    diagnostics.morphTargets?.uniqueChannelCount >= 239,
    'morph-target coverage is below the required 95% of 251 channels',
  );
  expect(
    diagnostics.render?.characterTriangles > 0,
    'the loaded character contains no renderable triangles',
  );

  if (captureCase.pose) {
    expect(
      diagnostics.pose?.requested === captureCase.pose,
      'reported pose does not match the requested expression probe',
    );
    const requestedChannels = captureCase.pose.split(',').map((part) => {
      const separator = part.lastIndexOf(':');
      return {
        name: part.slice(0, separator),
        value: Number(part.slice(separator + 1)),
      };
    });
    for (const requested of requestedChannels) {
      const applications = (diagnostics.pose?.applied || [])
        .filter((entry) => entry.name === requested.name);
      expect(applications.length > 0, requested.name + ' was not applied to any morph mesh');
      expect(
        applications.every((entry) => Math.abs(entry.value - requested.value) < 1e-8),
        requested.name + ' did not receive the exact requested value on every morph mesh',
      );
      const active = (diagnostics.morphTargets?.nonZero || [])
        .find((entry) => entry.name === requested.name);
      expect(
        active && Math.abs(active.value - requested.value) < 1e-8,
        requested.name + ' is not active at its requested value in the final morph state',
      );
    }

    if (captureCase.probe === 'jaw') {
      const jawApplications = (diagnostics.pose?.applied || [])
        .filter((entry) => entry.name === MHA_JAW_OPEN_CHANNEL);
      const jawMaterialNames = jawApplications.flatMap((entry) => entry.materials || []);
      expect(
        jawMaterialNames.some((name) => /head|face/i.test(name)),
        'jawOpen was not applied to a head/face material',
      );
      expect(
        jawMaterialNames.some((name) => /teeth/i.test(name)),
        'jawOpen was not applied to a teeth material',
      );
      expect(
        jawApplications.length >= 8,
        'jawOpen did not reach all eight head, eye, teeth and oral morph primitives',
      );
      for (const [channel, value] of Object.entries(MHA_DENTAL_OCCLUSION)) {
        const dentalApplications = (diagnostics.pose?.applied || [])
          .filter((entry) => entry.name === channel);
        expect(
          dentalApplications.length > 0
            && dentalApplications.every((entry) => Math.abs(entry.value - value) < 1e-8),
          channel + ' dental-row occlusion was not applied at ' + value,
        );
      }
    } else if (captureCase.probe === 'gaze-baseline') {
      const gazeNames = requestedChannels.map((entry) => entry.name);
      expect(gazeNames.length >= 2, 'camera-facing gaze must use explicit per-eye channels');
      for (const axisPattern of [/eyeLook(?:Left|Right)/, /eyeLook(?:Up|Down)/]) {
        const axisChannels = requestedChannels.filter((entry) => axisPattern.test(entry.name));
        if (!axisChannels.length) continue;
        expect(
          axisChannels.some((entry) => entry.name.endsWith('L'))
            && axisChannels.some((entry) => entry.name.endsWith('R')),
          `camera-facing gaze ${axisPattern} must calibrate both eyes`,
        );
      }
    }
  } else {
    expect(!diagnostics.pose?.requested, 'neutral capture unexpectedly requested a pose');
  }
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? path.join(ROOT, '.verify-out');
  const coachIds = args.filter((a) => !a.startsWith('--'));
  const coaches = coachIds.length ? coachIds : ['leila', 'magnus', 'sofia', 'arjun'];
  const gazeCalibration = args.includes('--gaze-calibration');
  fs.mkdirSync(outDir, { recursive: true });

  const { server, port } = await startStaticServer();
  const headed = args.includes('--headed');
  const browser = await chromium.launch({
    headless: !headed,
    args: headed
      ? []
      : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  let failures = 0;

  try {
    for (const coach of coaches) {
      const captureCases = gazeCalibration
        ? gazeCalibrationCases(coach)
        : captureCasesForCoach(coach);
      for (const captureCase of captureCases) {
        const variant = captureCase.variant;
        const page = await browser.newPage({
          viewport: { width: 1200, height: 1600 },
          deviceScaleFactor: 1,
        });
        const consoleIssues = [];
        page.on('console', (msg) => {
          if (msg.type() === 'warning' || msg.type() === 'error') {
            consoleIssues.push(`${msg.type()}: ${msg.text()}`);
          }
        });
        page.on('pageerror', (err) => consoleIssues.push(`pageerror: ${err.message}`));

        const captureSearch = new URLSearchParams({ coach });
        if (variant === 'mobile') captureSearch.set('variant', 'mobile');
        if (captureCase.pose) captureSearch.set('pose', captureCase.pose);
        if (captureCase.smile !== undefined) captureSearch.set('smile', String(captureCase.smile));
        const qs = captureSearch.toString();
        const started = Date.now();
        await page.goto(`http://127.0.0.1:${port}/capture?${qs}`, {
          waitUntil: 'domcontentloaded',
          timeout: 300000,
        });
        await page.waitForFunction(
          () => window.__PORTRAIT_READY__ === true,
          null,
          { timeout: 300000 },
        );
        const error = await page.evaluate(() => window.__PORTRAIT_ERROR__ || '');
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);

        if (error) {
          failures++;
          console.log('FAIL ' + coach + ' (' + captureCase.label + '): ' + error);
        } else {
          const dataUrl = await page.evaluate(() => window.__PORTRAIT_DATA_URL__);
          if (!dataUrl?.startsWith('data:image/png;base64,')) {
            throw new Error('Capture did not return a PNG data URL');
          }
          const diagnostics = await page.evaluate(() => window.__PORTRAIT_DIAGNOSTICS__);
          const png = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          const outPath = path.join(outDir, coach + '.' + captureCase.fileSuffix + '.png');
          fs.writeFileSync(outPath, png);

          const imageStats = await sharp(png)
            .extract({ left: 300, top: 200, width: 600, height: 1000 })
            .stats();
          const maximumStdDev = Math.max(
            ...imageStats.channels.slice(0, 3).map((channel) => channel.stdev),
          );
          const renderFailures = validateCaptureDiagnostics(diagnostics, captureCase);
          if (!(maximumStdDev > 2)) {
            renderFailures.push('the center crop is effectively a flat/empty frame');
          }
          for (const issue of consoleIssues) {
            if (issue.startsWith('error:') || issue.startsWith('pageerror:')) {
              renderFailures.push('browser ' + issue);
            }
          }

          if (renderFailures.length) {
            failures++;
            console.log('FAIL ' + coach + ' (' + captureCase.label + ') in ' + elapsed + 's -> ' + outPath);
            for (const failure of renderFailures) console.log('     contract: ' + failure);
          } else {
            console.log('OK   ' + coach + ' (' + captureCase.label + ') in ' + elapsed + 's -> ' + outPath);
          }
          console.log(
            '     morphs=' + diagnostics.morphTargets.uniqueChannelCount
            + ' skinMaterials=' + diagnostics.skin.materialCount
            + ' directLightSkin=' + diagnostics.skin.compiledMaterialCount
            + '/' + diagnostics.skin.materialCount
            + ' iblBlur=' + diagnostics.materials.iblBlur.value.toFixed(2)
            + ' iblPatched=' + diagnostics.materials.iblBlur.compiledMaterialCount
            + '/' + diagnostics.materials.iblBlur.materialCount
            + ' triangles=' + Math.round(diagnostics.render.characterTriangles)
            + ' centerStdDev=' + maximumStdDev.toFixed(2),
          );
          const activeEyeMorphs = diagnostics.morphTargets.nonZero
            .filter((entry) => /eye/i.test(entry.name))
            .map((entry) => entry.name + '=' + entry.value.toFixed(3));
          if (activeEyeMorphs.length) {
            console.log('     activeEyeMorphs=' + activeEyeMorphs.join(','));
          }
          if (captureCase.probe === 'jaw') {
            const jawMeshes = Array.from(new Set(
              diagnostics.pose.applied
                .filter((entry) => entry.name === MHA_JAW_OPEN_CHANNEL)
                .map((entry) => entry.mesh),
            ));
            const jawMaterials = Array.from(new Set(
              diagnostics.pose.applied
                .filter((entry) => entry.name === MHA_JAW_OPEN_CHANNEL)
                .flatMap((entry) => entry.materials || []),
            ));
            console.log(
              '     jawOpen=' + JAW_OPEN_PROBE_VALUE.toFixed(2)
              + ' appliedMeshes=' + jawMeshes.join(',')
              + ' materials=' + jawMaterials.join(','),
            );
          } else if (captureCase.pose) {
            console.log('     pose=' + captureCase.pose);
          }
        }
        for (const issue of consoleIssues) {
          console.log('     ' + coach + ' (' + captureCase.label + ') ' + issue);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) {
    console.log(`\n${failures} render(s) failed`);
    process.exit(1);
  }
}

await main();

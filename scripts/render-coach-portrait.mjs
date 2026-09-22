/**
 * Render menu portrait PNGs from coach GLB files (Playwright + Three.js).
 * Usage: node scripts/render-coach-portrait.mjs [coachId] [--headless]
 *   [--pose=CTRL_expressions_eyeLookDownL:0.1,...] [--smile=0.35]
 *   [--no-gaze] [--zoom=1.5] [--head-yaw=7] [--head-pitch=7]
 *   [--horizontal-offset=-0.025] [--model-yaw=0]
 *   [--output=.verify-out/portrait.png]
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORTRAIT_DIR = path.join(PUBLIC, 'coach-portraits');
const THREE_VENDOR = path.join(ROOT, 'node_modules/three');
const POSTPROCESSING_VENDOR = path.join(ROOT, 'node_modules/postprocessing');
const N8AO_VENDOR = path.join(ROOT, 'node_modules/n8ao');
const GAZE_CALIBRATIONS = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs/character-models/chess-avatars-v2/portrait-gaze-calibration.json'),
  'utf8',
));
const PORTRAIT_PRESENTATION = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs/character-models/chess-avatars-v2/portrait-presentation.json'),
  'utf8',
));

function cameraGazePose(coachId) {
  const calibration = GAZE_CALIBRATIONS[coachId];
  if (!calibration) throw new Error('Missing camera-gaze calibration for coach: ' + coachId);
  const values = Object.entries(calibration.values ?? {});
  if (values.length === 0 || values.some(([channel, value]) => (
    !/^(?:left|right|up|down)[LR]$/.test(channel)
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ))) {
    throw new Error('Invalid camera-gaze calibration for coach: ' + coachId);
  }
  return values.map(([channel, value]) => {
    const direction = channel.slice(0, -1);
    const eye = channel.slice(-1);
    const title = direction[0].toUpperCase() + direction.slice(1);
    return 'CTRL_expressions_eyeLook' + title + eye + ':' + value;
  }).join(',');
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

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

const CUTOUT_CHROMA = { r: 107, g: 255, b: 212 };

function sampleCutoutKey(data, width) {
  const samples = [];
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 48))) {
    const i = x * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const mid = samples[Math.floor(samples.length / 2)] ?? [CUTOUT_CHROMA.r, CUTOUT_CHROMA.g, CUTOUT_CHROMA.b];
  return { r: mid[0], g: mid[1], b: mid[2] };
}

function chromaDistance(r, g, b, key) {
  const luma = (channel) => 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
  const y = luma([r, g, b]);
  const ky = luma([key.r, key.g, key.b]);
  return Math.hypot((b - y) - (key.b - ky), (r - y) - (key.r - ky));
}

async function punchChromaToAlpha(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const key = sampleCutoutKey(data, info.width);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dist = chromaDistance(r, g, b, key);
    if (dist < 18) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    } else if (dist < 34) {
      data[i + 3] = Math.round(data[i + 3] * ((dist - 18) / 16));
    }
    const gDom = data[i + 1] - Math.max(data[i], data[i + 2]);
    if (data[i + 3] > 0 && gDom > 10) {
      const nextA = Math.round(data[i + 3] * (1 - Math.min(1, (gDom - 10) / 22)));
      if (nextA < 10) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      } else {
        data[i + 3] = nextA;
      }
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function renderCoachPortrait(coachId) {
  const { server, port } = await startStaticServer();
  const headless = process.argv.includes('--headless');
  const browser = await chromium.launch({
    headless,
    args: headless
      ? ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
      : [],
  });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1600 },
    deviceScaleFactor: 1,
  });
  const browserIssues = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      browserIssues.push(message.type() + ': ' + message.text());
    }
  });
  page.on('pageerror', (error) => browserIssues.push('pageerror: ' + error.message));

  try {
    const presentation = PORTRAIT_PRESENTATION.coaches?.[coachId];
    if (!presentation) throw new Error('Missing shared portrait presentation for coach: ' + coachId);
    const runtimePose = presentation.runtimePose ?? {};
    const query = new URLSearchParams({ coach: coachId });
    const option = (name, fallback) => (
      process.argv.find((argument) => argument.startsWith('--' + name + '='))
        ?.slice(('--' + name + '=').length) ?? fallback
    );
    const zoom = option(
      'zoom',
      String(presentation.framing.liveCameraZoom ?? PORTRAIT_PRESENTATION.cameraZoom),
    );
    const headYaw = option(
      'head-yaw',
      String(runtimePose.headYawDegrees ?? PORTRAIT_PRESENTATION.headYawDegrees),
    );
    const headPitch = option(
      'head-pitch',
      String(runtimePose.headPitchDegrees ?? PORTRAIT_PRESENTATION.headPitchDegrees),
    );
    const horizontalOffset = option(
      'horizontal-offset',
      String(presentation.framing.horizontalOffset + (runtimePose.modelOffsetX ?? 0)),
    );
    const modelYaw = option(
      'model-yaw',
      String((presentation.framing.modelYawDegrees ?? 0) + (runtimePose.modelYawDegrees ?? 0)),
    );
    query.set('zoom', zoom);
    query.set('iblFloor', '0');
    query.set('studioBackdrop', process.argv.includes('--cutout') ? '0' : '0.65');
    if (process.argv.includes('--cutout') || !process.argv.includes('--studio')) {
      query.set('cutout', '1');
      query.set('studioBackdrop', '0');
    }
    query.set('topInsetWorld', String(presentation.framing.topInsetWorld));
    query.set('portraitCropBias', String(presentation.framing.portraitCropBias));
    query.set('modelScale', String(presentation.framing.modelScale));
    query.set('modelYaw', modelYaw);
    const poseArgument = process.argv.find((argument) => argument.startsWith('--pose='));
    const pose = poseArgument !== undefined
      ? poseArgument.slice('--pose='.length)
      : (process.argv.includes('--camera-gaze') ? cameraGazePose(coachId) : '');
    const smile = process.argv.find((argument) => argument.startsWith('--smile='))?.slice('--smile='.length)
      ?? String(PORTRAIT_PRESENTATION.expression.smileIntensity);
    if (pose) query.set('pose', pose);
    if (smile !== undefined) query.set('smile', smile);
    query.set('headYaw', headYaw);
    query.set('headPitch', headPitch);
    query.set('horizontalOffset', horizontalOffset);
    await page.goto(`http://127.0.0.1:${port}/capture?${query}`, {
      waitUntil: 'domcontentloaded',
      timeout: 300000,
    });
    await page.waitForFunction(
      () => window.__PORTRAIT_READY__ === true,
      undefined,
      { timeout: 300000 },
    );

    const error = await page.evaluate(() => window.__PORTRAIT_ERROR__ || '');
    if (error) throw new Error(error);

    const dataUrl = await page.evaluate(() => window.__PORTRAIT_DATA_URL__);
    if (!dataUrl?.startsWith('data:image/png;base64,')) {
      throw new Error('Portrait render did not produce a PNG data URL');
    }

    const diagnostics = await page.evaluate(() => window.__PORTRAIT_DIAGNOSTICS__);
    const expectedBodyPoseSource = coachId === 'magnus' || coachId === 'arjun'
      ? 'frontal-bind'
      : 'authored-frame-0';
    if (diagnostics?.animation?.bodyPoseSource !== expectedBodyPoseSource) {
      throw new Error(
        'Portrait body-pose mismatch: expected '
        + expectedBodyPoseSource
        + ', got '
        + diagnostics?.animation?.bodyPoseSource,
      );
    }
    if (Math.abs(diagnostics?.camera?.presentationZoom - Number(zoom)) > 1e-8) {
      throw new Error('Portrait camera zoom was not applied exactly');
    }
    if (Math.abs(diagnostics?.headPose?.yawDegrees - Number(headYaw)) > 1e-8
      || Math.abs(diagnostics?.headPose?.pitchDegrees - Number(headPitch)) > 1e-8) {
      throw new Error('Portrait head pose was not applied exactly');
    }
    if (horizontalOffset
      && Math.abs(diagnostics?.framing?.horizontalOffset - Number(horizontalOffset)) > 1e-8) {
      throw new Error('Portrait horizontal offset was not applied exactly');
    }
    if (Math.abs(diagnostics?.framing?.modelYawDegrees - Number(modelYaw)) > 1e-8) {
      throw new Error('Portrait model yaw was not applied exactly');
    }
    if (Math.abs(diagnostics?.smile?.intensity - Number(smile)) > 1e-8) {
      throw new Error('Portrait smile intensity was not applied exactly');
    }
    const expectedFraming = {
      ...presentation.framing,
      horizontalOffset: Number(horizontalOffset),
      modelYawDegrees: Number(modelYaw),
    };
    for (const [key, expected] of Object.entries(expectedFraming)) {
      if (Math.abs(diagnostics?.framing?.[key] - expected) > 1e-8) {
        throw new Error('Portrait framing does not match the live value for ' + key);
      }
    }
    if (pose && diagnostics?.pose?.requested !== pose) {
      throw new Error('Portrait did not apply its requested/default camera-gaze pose');
    }
    if (pose) {
      for (const part of pose.split(',')) {
        const separator = part.lastIndexOf(':');
        const name = part.slice(0, separator);
        const value = Number(part.slice(separator + 1));
        const applied = (diagnostics?.pose?.applied || []).filter((entry) => entry.name === name);
        if (!applied.length || applied.some((entry) => Math.abs(entry.value - value) > 1e-8)) {
          throw new Error('Portrait camera-gaze calibration was not applied exactly: ' + part);
        }
      }
    }
    if (!pose && (diagnostics?.pose?.applied?.length || 0) !== 0) {
      throw new Error('Runtime-aligned portrait unexpectedly contains eye-pose morphs');
    }
    const pngBuffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
      ?.slice('--output='.length);
    const outputPath = outputArgument
      ? path.resolve(ROOT, outputArgument)
      : path.join(PORTRAIT_DIR, `${coachId}.png`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const cutout = query.get('cutout') === '1';
    const written = cutout ? await punchChromaToAlpha(pngBuffer) : pngBuffer;
    await sharp(written)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);

    const stat = fs.statSync(outputPath);
    console.log(
      '  V2 look: camera FOV ' + diagnostics?.camera?.fov
      + ', morph inventory ' + diagnostics?.morphTargets?.uniqueChannelCount
      + ', Penner materials ' + diagnostics?.skin?.materialCount
      + ', body pose ' + diagnostics?.animation?.bodyPoseSource
      + ', character triangles ' + Math.round(diagnostics?.render?.characterTriangles || 0),
    );
    for (const issue of browserIssues) console.log('  browser ' + issue);
    console.log(`Rendered ${coachId}.png (1200x1600, ${Math.round(stat.size / 1024)}KB) -> ${outputPath}`);
  } finally {
    await browser.close();
    server.close();
  }
}

const coachId = (
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'leila'
).toLowerCase();
await renderCoachPortrait(coachId);

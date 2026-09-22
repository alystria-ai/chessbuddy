/**
 * Render every coach under every candidate lighting config, into one sheet.
 *
 *   node scripts/lighting-compare.mjs
 *
 * Why this exists: the character vendor states their models bake lighting and
 * global illumination into the textures, and should therefore be used with
 * Self-Illumination (Emissive) only — no real-time dynamic lighting. Our app
 * partly does that already, but it OVERWRITES the emissiveFactor each model was
 * exported with, and those factors disagree badly between coaches (Arjun 1.0,
 * Sofia clothing 1.0, Magnus 0.3, Leila 0.2). Whether honouring them looks
 * better is not answerable by reading code — so render it and look.
 *
 * Output: design/lighting/<coach>-<config>.png plus a coach-per-row contact
 * sheet at design/lighting/compare.png.
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
const OUT_DIR = path.join(ROOT, 'design/lighting');

const COACHES = ['magnus', 'sofia', 'arjun', 'leila'];

const CONFIGS = [
  { id: 'current', label: 'A. Current (uniform emissive + IBL)', q: 'mode=current&env=1' },
  { id: 'current-noibl', label: 'B. Current, IBL off', q: 'mode=current&env=0' },
  { id: 'vendor', label: 'C. Vendor emissiveFactor + IBL', q: 'mode=vendor&env=1' },
  { id: 'vendor-noibl', label: 'D. Vendor emissiveFactor, IBL off', q: 'mode=vendor&env=0' },
  { id: 'unlit', label: 'E. Fully baked (emissive 1.0, no IBL)', q: 'mode=unlit&env=0' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.wasm': 'application/wasm',
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        let filePath;
        if (url.pathname === '/' || url.pathname === '/compare') {
          filePath = path.join(ROOT, 'scripts', 'lighting-compare.html');
        } else if (url.pathname.startsWith('/vendor/three/')) {
          filePath = path.join(THREE_VENDOR, url.pathname.replace('/vendor/three/', ''));
        } else if (url.pathname.startsWith('/draco/')) {
          filePath = path.join(THREE_VENDOR, 'examples/jsm/libs/draco/gltf', url.pathname.replace('/draco/', ''));
        } else {
          filePath = path.join(PUBLIC, decodeURIComponent(url.pathname.replace(/^\//, '')));
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404); res.end('Not found'); return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        console.error(err); res.writeHead(500); res.end('Internal error');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, port } = await startStaticServer();
  // Headless Chromium falls back to SwiftShader, which renders these physical
  // materials as blank frames — the real GPU is required (same as the portrait
  // renderer).
  const browser = await chromium.launch({ headless: false });

  const shots = new Map();
  try {
    for (const coach of COACHES) {
      for (const cfg of CONFIGS) {
        const page = await browser.newPage({ viewport: { width: 760, height: 960 } });
        try {
          await page.goto(`http://127.0.0.1:${port}/compare?coach=${coach}&${cfg.q}`, {
            waitUntil: 'domcontentloaded', timeout: 300000,
          });
          await page.waitForFunction(() => window.__READY__ === true, { timeout: 300000 });
          const err = await page.evaluate(() => window.__ERROR__ || '');
          if (err) throw new Error(err);
          const dataUrl = await page.evaluate(() => window.__SHOT__);
          const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          const out = path.join(OUT_DIR, `${coach}-${cfg.id}.png`);
          await sharp(buf).png().toFile(out);
          shots.set(`${coach}|${cfg.id}`, out);
          console.log(`  ${coach} / ${cfg.id}`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Contact sheet: one row per coach, one column per config.
  const TW = 380, TH = Math.round(TW * 900 / 700);
  const PAD = 18, GAP = 10, HEAD = 92, ROWLBL = 34;
  const W = PAD * 2 + TW * CONFIGS.length + GAP * (CONFIGS.length - 1);
  const H = HEAD + PAD + (TH + ROWLBL + GAP) * COACHES.length;

  const tiles = [];
  const labels = [];
  for (let r = 0; r < COACHES.length; r++) {
    const y = HEAD + r * (TH + ROWLBL + GAP);
    labels.push(`<text x="${PAD}" y="${y + 23}" font-family="Segoe UI,Arial" font-size="21" font-weight="700" fill="#f2f2f5">${esc(COACHES[r].toUpperCase())}</text>`);
    for (let c = 0; c < CONFIGS.length; c++) {
      const p = shots.get(`${COACHES[r]}|${CONFIGS[c].id}`);
      if (!p) continue;
      tiles.push({ input: await sharp(p).resize(TW, TH, { fit: 'fill' }).toBuffer(), left: PAD + c * (TW + GAP), top: y + ROWLBL });
    }
  }
  for (let c = 0; c < CONFIGS.length; c++) {
    const x = PAD + c * (TW + GAP);
    labels.push(`<text x="${x}" y="76" font-family="Segoe UI,Arial" font-size="17" font-weight="600" fill="#c8c8d4">${esc(CONFIGS[c].label)}</text>`);
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#0b0b0e"/>
    <text x="${PAD}" y="40" font-family="Segoe UI,Arial" font-size="27" font-weight="700" fill="#f2f2f5">Coach lighting — emissive source and IBL compared</text>
    ${labels.join('\n')}
  </svg>`;

  const sheet = path.join(OUT_DIR, 'compare.png');
  await sharp(Buffer.from(svg)).png().composite(tiles).toFile(sheet);
  console.log(`\nsheet -> ${sheet}`);
}

await main();

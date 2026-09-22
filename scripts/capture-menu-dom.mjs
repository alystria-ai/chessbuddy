/**
 * Capture the live menu screen's DOM + a reference screenshot.
 *
 * The visual-style explorations are built on the REAL markup rather than a
 * hand-written approximation, so that (a) every variant renders identical
 * content and is therefore comparable, and (b) the CSS a winning variant
 * produces can be lifted straight back into the app — the class names match.
 *
 * Usage: node scripts/capture-menu-dom.mjs [--url http://localhost:5173]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'design/_capture');

const urlArg = process.argv.indexOf('--url');
const URL = urlArg !== -1 ? process.argv[urlArg + 1] : 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.menu-screen', { timeout: 30000 });
// Portraits are <img>; let them decode so the reference shot isn't blank-faced.
await page.waitForTimeout(1500);

mkdirSync(OUT_DIR, { recursive: true });

const html = await page.$eval('.menu-screen', (el) => el.outerHTML);
writeFileSync(resolve(OUT_DIR, 'menu.html'), html, 'utf8');

// Every stylesheet the app applies, concatenated — the baseline to diff against.
const css = await page.evaluate(() =>
  [...document.styleSheets]
    .map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } })
    .join('\n'),
);
writeFileSync(resolve(OUT_DIR, 'menu.css'), css, 'utf8');

await page.screenshot({ path: resolve(OUT_DIR, 'menu-current.png'), fullPage: true });

console.log(JSON.stringify({
  htmlBytes: html.length,
  cssBytes: css.length,
  consoleErrors: errors.slice(0, 5),
}, null, 2));

await browser.close();

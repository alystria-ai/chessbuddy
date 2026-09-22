// Generate scripts/portrait-morph-keep.json for the MHA-251 pipeline:
// union over source models of morph names that normalize-match an MHA control
// (minus jawFwd, plus Mouth_Mouth_Press aliases), plus CORRECTIVE_DEFS C_*
// morphs that exist on any model, plus BLINK_MORPHS.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL("..", import.meta.url).pathname;
const { METAHUMAN_ORDER_251 } = await import(
  path.join(ROOT, 'node_modules/@convai/web-sdk/dist/lipsync-helpers/metahumanOrder251.js')
);

const norm = (s) => s.replace(/^CTRL_expressions_/i, '').replace(/_/g, '').toLowerCase();
const EXCLUDED = new Set(['jawfwd']);
const ALIASES = {
  mouthpressul: 'mouthmouthpressul',
  mouthpressur: 'mouthmouthpressur',
  mouthpressdl: 'mouthmouthpressdl',
  mouthpressdr: 'mouthmouthpressdr',
};
// Set of normalized keys the mapper drives (control key or its alias target key).
const mhaKeys = new Set();
for (const ctrl of METAHUMAN_ORDER_251) {
  const key = norm(ctrl);
  if (EXCLUDED.has(key)) continue;
  mhaKeys.add(key);
  if (key in ALIASES) mhaKeys.add(ALIASES[key]);
}

// C_* names from CORRECTIVE_DEFS in src/mhaCorrectives.ts
const src = fs.readFileSync(path.join(ROOT, 'src/mhaCorrectives.ts'), 'utf8');
const defsBlock = src.match(/CORRECTIVE_DEFS[\s\S]*?\n\] as const;/)[0];
const correctiveNames = [...defsBlock.matchAll(/\["(C_[^"]+)"/g)].map((m) => m[1]);

const BLINK_MORPHS = ['Eye_Blink_L', 'Eye_Blink_R'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

const allNames = new Set();
// Sofia is excluded: she is now a MetaHuman rig (CTRL_expressions_* morphs) not
// processed by the CC4 optimize pipeline — see scripts/prep-sofia-metahuman.mjs.
for (const model of ['leila', 'magnus', 'arjun']) {
  const file = path.join(ROOT, 'assets-src', `${model}.glb`);
  const doc = await io.read(file);
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    const names = (mesh.getExtras() || {}).targetNames || [];
    for (const n of names) { allNames.add(n); count++; }
  }
  console.error(`${model}: ${count} target names (union so far ${allNames.size})`);
}

const keep = new Set();
for (const name of allNames) {
  if (mhaKeys.has(norm(name))) keep.add(name);
}
let correctivesKept = 0;
for (const c of correctiveNames) {
  if (allNames.has(c)) { keep.add(c); correctivesKept++; }
}
for (const b of BLINK_MORPHS) keep.add(b);

const sorted = [...keep].sort((a, b) => a.localeCompare(b));
console.error(`matched base morphs: ${sorted.filter((n) => !n.startsWith('C_')).length}, correctives kept: ${correctivesKept}/${correctiveNames.length}, total keep: ${sorted.length}`);

const json = {
  comment:
    'Morph targets the portrait runtime actually drives. Sources: MHA-251 normalized-name matching in src/mhaToMorphMap.ts (union across assets-src models), C_* combination correctives from CORRECTIVE_DEFS in src/mhaCorrectives.ts, BLINK_MORPHS in src/portraitBlink.ts. Sync is enforced by src/coachModelKeepList.test.ts. Regenerate via the notes in scripts/optimize-coach-models.mjs.',
  keepMorphs: sorted,
};
fs.writeFileSync(path.join(ROOT, 'scripts', 'portrait-morph-keep.json'), JSON.stringify(json, null, 2) + '\n');
console.error('wrote scripts/portrait-morph-keep.json');

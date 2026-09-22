import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const loader = new GLTFLoader();

for (const file of ['sofia-animations.glb', 'leila-animations.glb']) {
  const buf = fs.readFileSync(path.join(root, '..', 'public', file));
  const gltf = await loader.parseAsync(buf.buffer, '');
  console.log(`\n${file}`);
  for (const clip of gltf.animations) {
    const relevant = clip.tracks.filter((t) => /eye|head|neck|look/i.test(t.name));
    if (!relevant.length) continue;
    console.log(` clip: ${clip.name}`);
    for (const t of relevant) console.log(`   ${t.name}`);
  }
}

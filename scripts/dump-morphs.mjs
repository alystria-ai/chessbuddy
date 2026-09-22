import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  console.log(`\n=== ${file} ===`);
  for (const mesh of root.listMeshes()) {
    const prims = mesh.listPrimitives();
    const extras = mesh.getExtras() || {};
    const targetNames = extras.targetNames || [];
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const targets = p.listTargets();
      const pos = p.getAttribute('POSITION');
      const vcount = pos ? pos.getCount() : 0;
      let morphAttrs = '';
      if (targets.length) {
        morphAttrs = targets[0].listSemantics().join(',');
      }
      console.log(`mesh="${mesh.getName()}" prim=${i} verts=${vcount} targets=${targets.length} morphAttrs=[${morphAttrs}]`);
    }
    if (targetNames.length) {
      console.log(`  targetNames (${targetNames.length}): ${targetNames.join('|')}`);
    }
  }
  for (const anim of root.listAnimations()) {
    const channels = anim.listChannels();
    const paths = {};
    for (const ch of channels) {
      const path = ch.getTargetPath();
      paths[path] = (paths[path] || 0) + 1;
    }
    console.log(`animation="${anim.getName()}" channels=${channels.length} paths=${JSON.stringify(paths)}`);
  }
}

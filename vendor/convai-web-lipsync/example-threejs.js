import { ConvaiClient } from "./vendor/convai-web-sdk/index.js";
import { ConvaiMhaLipsync } from "./convai-mha-lipsync.js";
import setup from "./Lipsynic-setup.json" with { type: "json" };
import order from "./metahuman-order-251.json" with { type: "json" };

const client = new ConvaiClient({
  apiKey: "YOUR_API_KEY",
  characterId: "YOUR_CHARACTER_ID",
  enableVideo: false,
  startWithAudioOn: false,
  ttsEnabled: true,
  enableLipsync: true,
  blendshapeConfig: {
    format: setup.transport.format,
    frames_buffer_duration: setup.transport.framesBufferDurationSeconds,
    deliver_chunks_ahead: setup.transport.deliverChunksAhead,
    output_fps: setup.transport.outputFps
  }
});

// characterScene is the loaded GLTF scene. Call this only after morph targets exist.
const lipsync = new ConvaiMhaLipsync({
  scene: characterScene,
  channelOrder: order.channels,
  setup,
  presetName: "webStudioVerified"
});

console.info("Convai MHA coverage", lipsync.diagnostics.coverage);
if (lipsync.diagnostics.coverage < setup.minimumValidation.requiredMorphCoverage) {
  throw new Error(`Insufficient MetaHuman morph coverage: ${Math.round(lipsync.diagnostics.coverage * 100)}%`);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 1 / 20);
  // Remove the previous Convai layer, then evaluate the base animation, then
  // add the new Convai layer before renderer.render().
  lipsync.beginFrame();
  mixer?.update(delta);
  lipsync.updateFromConvaiQueue(client.blendshapeQueue, delta);
  renderer.render(scene, camera);
});

client.on("stateChange", state => {
  if (!state?.isConnected) lipsync.reset();
});

await client.connect();

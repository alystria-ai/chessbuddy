# Convai Web LipSync Kit

This folder is a portable implementation contract for Convai MHA lip sync on WebGL characters. It separates the wire format, channel order, tuning, mapping, and renderer adapter so WebGL teams do not need to reverse-engineer Unity assets.

## Recommended files to share

- `Lipsynic-setup.json` — requested integration contract and two named presets.
- `metahuman-order-251.json` — mandatory source index to MetaHuman control-name order.
- `unity-metahuman-map-4.4.1.json` — lossless JSON export of the official Unity 4.4.1 MetaHuman map, including all per-channel multipliers, curves, and clamps.
- `convai-mha-lipsync.js` — reference queue, interpolation, smoothing, starvation fade, additive composition, and reset implementation.
- `example-threejs.js` — minimal Convai Client + Three.js integration.
- `lipsync-setup.schema.json` — machine-readable validation schema.

`Lipsynic-setup.json` keeps the filename requested by the art team. Teams may rename it to `lipsync-setup.json` without changing its contents.

## Which preset should WebGL use?

Start with `webStudioVerified`. It exactly represents the implementation validated in Convai Web Studio 2:

- MHA format with exactly 251 normalized channels.
- 90 FPS requested output and a 0.5-second transport buffer.
- Linear interpolation between queued frames.
- Frame-rate-independent smoothing.
- 20 ms visual timing offset.
- Slow starvation fade to prevent mouth snapping during short packet gaps.
- Additive application with the previous lip-sync contribution removed before every render.
- `jawOpen` gain `0.9`, clamped to `0.35` for the tested MetaHuman-derived GLBs.

Use `unity441Parity` only when visual parity with the Unity SDK 4.4.1 MetaHuman profile is required. It uses the exported official per-channel map and Unity playback defaults. The Unity map has a global multiplier of `0.9` and contains channel-specific response curves and clamps; these values are preserved in `unity-metahuman-map-4.4.1.json`.

## Integration order

1. Load the GLB and finish creating all morph targets.
2. Construct `ConvaiMhaLipsync` with the loaded character scene.
3. Create `ConvaiClient` with `enableLipsync: true` and the transport values from the JSON.
4. At the start of the render loop, call `beginFrame()` to remove the previous Convai contribution.
5. Run the base body/facial animation.
6. Call `updateFromConvaiQueue(client.blendshapeQueue, deltaSeconds)`.
7. Render the scene.
8. Call `reset()` on disconnect, character replacement, or session normalization.

The order in steps 4–7 is important. Applying lip sync before another animation system can overwrite the mouth. Adding without removing the previous contribution causes values to accumulate to 1.

## Required safety rules

- Never assume `jawOpen` is the only incoming channel. Convai MHA frames contain 251 ordered values.
- Never reorder channels alphabetically. Use `metahuman-order-251.json` exactly.
- Reject `NaN` and infinite values and clamp every final value to `0–1`.
- Set `frustumCulled = false` on skinned/morphed head meshes, or recompute conservative animated bounds.
- Do not replace `morphTargetInfluences` or delete morph attributes while a character is live.
- Reset the contribution when the normalization signal is received and after conversation fade-out.
- Require at least 95% morph-name coverage. Missing jaw/lip controls must be treated as a setup error.

## Renderer adaptation

The reference adapter expects Three.js-style objects:

```js
object.morphTargetDictionary[name] // index
object.morphTargetInfluences[index] // normalized 0..1
scene.traverse(callback)
```

For Babylon.js or a custom renderer, keep the queue/timing logic and replace only target discovery and target writes. Do not change the 251-channel ordering or smoothing math.

## Validation

Run:

```text
npm test
```

The test verifies channel uniqueness, Unity mapping count, full morph coverage, head culling safety, jaw clamp behavior, additive non-accumulation, and reset behavior.

## Provenance

The kit was generated from:

- `ConvaiWebStudio2/app.js` — verified WebGL playback preset and queue behavior.
- `ConvaiWebStudio2/vendor/convai/MetaHumanOrder251.js` — MHA 251 channel order.
- Convai Unity SDK `4.4.1` `ConvaiLipSyncDefaultMap_MetaHuman.asset` — official per-channel map.
- Unity SDK `FrameSampler.cs`, `LipSyncEngineConfig.cs`, and `ConvaiLipSyncComponent.cs` — interpolation, smoothing, fade, and buffering reference behavior.

No API key or Character ID is stored in this package.

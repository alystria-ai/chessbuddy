import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlendshapeQueue } from '@convai/web-sdk/core';
import {
  CONVAI_MHA_APP_RELEASE_SECONDS,
  CONVAI_MHA_CHANNEL_ORDER,
  CONVAI_MHA_CLIENT_OPTIONS,
  CONVAI_MHA_DENTAL_OCCLUSION,
  CONVAI_MHA_DEFAULT_PRESET,
  CONVAI_MHA_MINIMUM_COVERAGE,
  CONVAI_MHA_REQUIRED_CHANNELS,
  CONVAI_MHA_WIRE_ORDER_FNV1A,
  ConvaiMhaLipsync,
} from './convaiMhaLipsync';
import { resetLipsyncTuning, setLipsyncTuningMode, setLipsyncTuningValue } from './lipsyncTuning';

beforeEach(() => resetLipsyncTuning());

function makeFrame(values: Record<string, number> = {}): Float32Array {
  const frame = new Float32Array(CONVAI_MHA_CHANNEL_ORDER.length);
  for (const [channel, value] of Object.entries(values)) {
    const wireIndex = CONVAI_MHA_CHANNEL_ORDER.indexOf(channel);
    if (wireIndex < 0) throw new Error(`Unknown test MHA channel: ${channel}`);
    frame[wireIndex] = value;
  }
  return frame;
}

function makeScene(options: { missing?: ReadonlySet<string>; base?: number } = {}) {
  const channels = CONVAI_MHA_CHANNEL_ORDER.filter((name) => !options.missing?.has(name));
  // Deliberately reverse the morph indices. Correct code must resolve each wire
  // index through channel name -> morphTargetDictionary, never write wire index.
  const dictionary = Object.fromEntries(channels.map((name, index) => [name, channels.length - index - 1]));
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry());
  mesh.name = 'MHA_face';
  mesh.morphTargetDictionary = dictionary;
  mesh.morphTargetInfluences = new Array(channels.length).fill(options.base ?? 0);
  mesh.frustumCulled = true;
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene, mesh, dictionary, influences: mesh.morphTargetInfluences };
}

function influence(
  mesh: THREE.SkinnedMesh,
  dictionary: Record<string, number>,
  channel: string,
): number {
  return mesh.morphTargetInfluences![dictionary[channel]];
}

function settle(
  lipsync: ConvaiMhaLipsync,
  frame: Float32Array,
  ticks = 24,
): void {
  expect(lipsync.setTargetFrame(frame)).toBe(true);
  for (let index = 0; index < ticks; index += 1) {
    lipsync.beginFrame();
    lipsync.update(1 / 60, true);
  }
}

describe('Convai MHA package contract', () => {
  it('pins the exact, unique, non-alphabetized 251-channel wire order', () => {
    expect(CONVAI_MHA_CHANNEL_ORDER).toHaveLength(251);
    expect(new Set(CONVAI_MHA_CHANNEL_ORDER).size).toBe(251);
    expect(CONVAI_MHA_CHANNEL_ORDER[0]).toBe('CTRL_expressions_browDownL');
    expect(CONVAI_MHA_CHANNEL_ORDER[62]).toBe('CTRL_expressions_jawOpen');
    expect(CONVAI_MHA_CHANNEL_ORDER.at(-1)).toBe('CTRL_expressions_tongueWide');
    expect(CONVAI_MHA_WIRE_ORDER_FNV1A).toBe('a5c2acf8');
    expect(CONVAI_MHA_DEFAULT_PRESET).toBe('webStudioVerified');
    expect(new ConvaiMhaLipsync({ scene: makeScene().scene }).diagnostics.fadeOutSeconds).toBe(0.8);
    expect(CONVAI_MHA_CLIENT_OPTIONS).toEqual({
      enableLipsync: true,
      blendshapeConfig: {
        format: 'mha',
        frames_buffer_duration: 0.5,
        deliver_chunks_ahead: false,
        output_fps: 90,
      },
    });
  });
});

describe('ConvaiMhaLipsync target discovery and safety gate', () => {
  it('maps wire channels through each mesh dictionary and disables frustum culling', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[0];

    expect(lipsync.enabled).toBe(true);
    expect(lipsync.diagnostics.coverage).toBe(1);
    expect(mesh.frustumCulled).toBe(false);

    settle(lipsync, makeFrame({ [channel]: 0.6 }));
    expect(influence(mesh, dictionary, channel)).toBeCloseTo(0.6, 5);
    // Reversed dictionary index proves the adapter did not use wire index 0.
    expect(mesh.morphTargetInfluences![0]).toBe(0);
  });

  it('requires at least 95% unique coverage and every required mouth control', () => {
    const removeForLowCoverage = new Set(CONVAI_MHA_CHANNEL_ORDER.slice(-14));
    const low = new ConvaiMhaLipsync({ scene: makeScene({ missing: removeForLowCoverage }).scene });
    expect(low.diagnostics.coverage).toBeLessThan(CONVAI_MHA_MINIMUM_COVERAGE);
    expect(low.enabled).toBe(false);
    expect(low.setTargetFrame(makeFrame())).toBe(false);

    const missingRequired = new Set([CONVAI_MHA_REQUIRED_CHANNELS[0]]);
    const noJaw = new ConvaiMhaLipsync({ scene: makeScene({ missing: missingRequired }).scene });
    expect(noJaw.diagnostics.coverage).toBeGreaterThan(CONVAI_MHA_MINIMUM_COVERAGE);
    expect(noJaw.diagnostics.missingRequiredChannels).toEqual([CONVAI_MHA_REQUIRED_CHANNELS[0]]);
    expect(noJaw.enabled).toBe(false);
  });
});

describe('ConvaiMhaLipsync frame application', () => {
  it('never replaces the live morphTargetInfluences array', () => {
    const { scene, mesh, influences } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    settle(lipsync, makeFrame({ [CONVAI_MHA_CHANNEL_ORDER[10]]: 0.5 }));
    lipsync.beginFrame();
    lipsync.reset();
    expect(mesh.morphTargetInfluences).toBe(influences);
  });

  it('rejects short and non-finite frames without replacing the last valid target', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[4];
    settle(lipsync, makeFrame({ [channel]: 0.4 }));

    expect(lipsync.setTargetFrame(new Float32Array(250))).toBe(false);
    const malformed = makeFrame({ [channel]: Number.NaN });
    expect(lipsync.setTargetFrame(malformed)).toBe(false);
    expect(lipsync.diagnostics.rejectedFrames).toBe(2);
    expect(lipsync.diagnostics.rejectedValues).toBe(1);

    lipsync.beginFrame();
    lipsync.update(1 / 60, true);
    expect(influence(mesh, dictionary, channel)).toBeCloseTo(0.4, 5);
  });

  it('clamps source and mapped values while preventing tuned oral stacking', () => {
    const { scene, mesh, dictionary } = makeScene({ base: 0 });
    const lipsync = new ConvaiMhaLipsync({ scene });
    const jaw = 'CTRL_expressions_jawOpen';
    const other = CONVAI_MHA_CHANNEL_ORDER[0];
    settle(lipsync, makeFrame({ [jaw]: 4, [other]: -2 }));

    expect(influence(mesh, dictionary, jaw)).toBeCloseTo(0.28, 5);
    expect(influence(mesh, dictionary, other)).toBe(0);

    lipsync.beginFrame();
    mesh.morphTargetInfluences![dictionary[jaw]] = 0.9;
    lipsync.update(1 / 60, true);
    expect(influence(mesh, dictionary, jaw)).toBeCloseTo(0.28, 5);
  });

  it('tucks both dental rows behind the lips without discarding stronger incoming values', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const upper = CONVAI_MHA_DENTAL_OCCLUSION.upperChannel;
    const lower = CONVAI_MHA_DENTAL_OCCLUSION.lowerChannel;

    settle(lipsync, makeFrame({ [upper]: 0.01, [lower]: 0.6 }));

    expect(influence(mesh, dictionary, upper)).toBeCloseTo(0.12, 5);
    expect(influence(mesh, dictionary, lower)).toBeCloseTo(0.6, 5);
  });

  it('restrains sided mouth controls without freezing all natural lateral motion', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const left = 'CTRL_expressions_mouthCornerPullL';
    const right = 'CTRL_expressions_mouthCornerPullR';
    const mouthLeft = 'CTRL_expressions_mouthLeft';
    const jawRight = 'CTRL_expressions_jawRight';

    settle(lipsync, makeFrame({
      [left]: 1,
      [right]: 0,
      [mouthLeft]: 1,
      [jawRight]: 1,
    }));

    expect(influence(mesh, dictionary, left)).toBeCloseTo(0.6, 5);
    expect(influence(mesh, dictionary, right)).toBeCloseTo(0.4, 5);
    expect(influence(mesh, dictionary, mouthLeft)).toBeCloseTo(0.15, 5);
    expect(influence(mesh, dictionary, jawRight)).toBeCloseTo(0.15, 5);
  });

  it('uses the Convai naturalness gains for upper and lower lip aperture', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const upperLeft = 'CTRL_expressions_mouthUpperLipRaiseL';
    const upperRight = 'CTRL_expressions_mouthUpperLipRaiseR';
    const lowerLeft = 'CTRL_expressions_mouthLowerLipDepressL';
    const lowerRight = 'CTRL_expressions_mouthLowerLipDepressR';

    settle(lipsync, makeFrame({
      [upperLeft]: 1,
      [upperRight]: 1,
      [lowerLeft]: 1,
      [lowerRight]: 1,
    }));

    expect(influence(mesh, dictionary, upperLeft)).toBeCloseTo(0.6, 5);
    expect(influence(mesh, dictionary, upperRight)).toBeCloseTo(0.6, 5);
    expect(influence(mesh, dictionary, lowerLeft)).toBeCloseTo(0.45, 5);
    expect(influence(mesh, dictionary, lowerRight)).toBeCloseTo(0.45, 5);
  });

  it('keeps pure NeuroSync sided values raw and supports partial symmetry tuning', () => {
    const left = 'CTRL_expressions_mouthCornerPullL';
    const right = 'CTRL_expressions_mouthCornerPullR';
    const mouthLeft = 'CTRL_expressions_mouthLeft';
    const lowerLeft = 'CTRL_expressions_mouthLowerLipDepressL';

    setLipsyncTuningMode('pure');
    const pure = makeScene();
    const pureLipsync = new ConvaiMhaLipsync({ scene: pure.scene });
    settle(pureLipsync, makeFrame({ [left]: 1, [right]: 0, [mouthLeft]: 1, [lowerLeft]: 1 }));
    expect(influence(pure.mesh, pure.dictionary, left)).toBeCloseTo(1, 5);
    expect(influence(pure.mesh, pure.dictionary, right)).toBe(0);
    expect(influence(pure.mesh, pure.dictionary, mouthLeft)).toBeCloseTo(1, 5);
    expect(influence(pure.mesh, pure.dictionary, lowerLeft)).toBeCloseTo(1, 5);

    setLipsyncTuningValue('mouthSymmetry', 0.5);
    const partial = makeScene();
    const partialLipsync = new ConvaiMhaLipsync({ scene: partial.scene });
    settle(partialLipsync, makeFrame({ [left]: 1, [right]: 0 }));
    expect(influence(partial.mesh, partial.dictionary, left)).toBeCloseTo(0.75, 5);
    expect(influence(partial.mesh, partial.dictionary, right)).toBeCloseTo(0.25, 5);
  });

  it('does not add a live mouth pose on top of the procedural expression mouth', () => {
    const { scene, mesh, dictionary } = makeScene({ base: 0 });
    const lipsync = new ConvaiMhaLipsync({ scene });
    const left = 'CTRL_expressions_mouthCornerPullL';
    const right = 'CTRL_expressions_mouthCornerPullR';

    expect(lipsync.setTargetFrame(makeFrame({ [left]: 0.8, [right]: 0.8 }))).toBe(true);
    lipsync.beginFrame();
    mesh.morphTargetInfluences![dictionary[left]] = 0.25;
    mesh.morphTargetInfluences![dictionary[right]] = 0.23;
    lipsync.update(1, true);

    expect(influence(mesh, dictionary, left)).toBeCloseTo(0.8, 5);
    expect(influence(mesh, dictionary, right)).toBeCloseTo(0.8, 5);
  });

  it('suppresses unrelated procedural smile channels while live speech owns the mouth', () => {
    const { scene, mesh, dictionary } = makeScene({ base: 0 });
    const lipsync = new ConvaiMhaLipsync({ scene });
    const left = 'CTRL_expressions_mouthCornerPullL';
    const right = 'CTRL_expressions_mouthCornerPullR';
    const jaw = 'CTRL_expressions_jawOpen';

    expect(lipsync.setTargetFrame(makeFrame({ [jaw]: 0.2 }))).toBe(true);
    lipsync.beginFrame();
    mesh.morphTargetInfluences![dictionary[left]] = 0.25;
    mesh.morphTargetInfluences![dictionary[right]] = 0.23;
    lipsync.update(1, true);

    expect(influence(mesh, dictionary, left)).toBe(0);
    expect(influence(mesh, dictionary, right)).toBe(0);
    expect(influence(mesh, dictionary, jaw)).toBeCloseTo(0.15, 5);
  });

  it('applies pure NeuroSync facial values while retaining the release/safety adapter', () => {
    setLipsyncTuningMode('pure');
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const jaw = 'CTRL_expressions_jawOpen';
    const upper = CONVAI_MHA_DENTAL_OCCLUSION.upperChannel;
    const lower = CONVAI_MHA_DENTAL_OCCLUSION.lowerChannel;

    settle(lipsync, makeFrame({ [jaw]: 0.8, [upper]: 0, [lower]: 0 }));
    expect(influence(mesh, dictionary, jaw)).toBeCloseTo(0.8, 5);
    expect(influence(mesh, dictionary, upper)).toBe(0);
    expect(influence(mesh, dictionary, lower)).toBe(0);
    expect(lipsync.diagnostics.tuningMode).toBe('pure');

    lipsync.beginFrame();
    lipsync.update(CONVAI_MHA_APP_RELEASE_SECONDS, false);
    expect(lipsync.active).toBe(false);
    expect(influence(mesh, dictionary, jaw)).toBe(0);
  });

  it('applies granular developer slider values to the next live MHA target', () => {
    setLipsyncTuningMode('pure');
    setLipsyncTuningValue('jawGain', 1.2);
    setLipsyncTuningValue('jawMax', 0.45);
    setLipsyncTuningValue('upperTeethTuck', 0.2);
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const jaw = 'CTRL_expressions_jawOpen';
    const upper = CONVAI_MHA_DENTAL_OCCLUSION.upperChannel;

    settle(lipsync, makeFrame({ [jaw]: 0.8, [upper]: 0 }));
    expect(influence(mesh, dictionary, jaw)).toBeCloseTo(0.45, 5);
    expect(influence(mesh, dictionary, upper)).toBeCloseTo(0.2, 5);
    expect(lipsync.diagnostics.tuningMode).toBe('custom');
  });

  it('preserves streamed eye-look by default and exposes its custom gain', () => {
    const eyeLook = 'CTRL_expressions_eyeLookRightL';
    const tuned = makeScene();
    const tunedLipsync = new ConvaiMhaLipsync({ scene: tuned.scene });
    settle(tunedLipsync, makeFrame({ [eyeLook]: 1 }));
    expect(influence(tuned.mesh, tuned.dictionary, eyeLook)).toBeCloseTo(1, 5);

    setLipsyncTuningValue('streamedEyeLookGain', 0.15);
    const custom = makeScene();
    const customLipsync = new ConvaiMhaLipsync({ scene: custom.scene });
    settle(customLipsync, makeFrame({ [eyeLook]: 1 }));
    expect(influence(custom.mesh, custom.dictionary, eyeLook)).toBeCloseTo(0.15, 5);

    setLipsyncTuningMode('pure');
    const pure = makeScene();
    const pureLipsync = new ConvaiMhaLipsync({ scene: pure.scene });
    settle(pureLipsync, makeFrame({ [eyeLook]: 1 }));
    expect(influence(pure.mesh, pure.dictionary, eyeLook)).toBeCloseTo(1, 5);
  });

  it('releases the final app viseme promptly without snapping the mouth shut', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const jaw = 'CTRL_expressions_jawOpen';

    settle(lipsync, makeFrame({ [jaw]: 0.7 }));
    const speakingJaw = influence(mesh, dictionary, jaw);
    expect(lipsync.diagnostics.fadeOutSeconds).toBe(0.12);

    lipsync.beginFrame();
    lipsync.update(0.1, false);
    const halfwayJaw = influence(mesh, dictionary, jaw);
    expect(halfwayJaw).toBeGreaterThan(0);
    expect(halfwayJaw).toBeLessThan(speakingJaw);
    expect(lipsync.active).toBe(true);

    lipsync.beginFrame();
    lipsync.update(0.1, false);
    expect(influence(mesh, dictionary, jaw)).toBe(0);
    expect(lipsync.active).toBe(false);
  });

  it('does not accumulate additive values across render frames', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[70];
    settle(lipsync, makeFrame({ [channel]: 0.45 }));
    const settled = influence(mesh, dictionary, channel);

    for (let index = 0; index < 20; index += 1) {
      lipsync.beginFrame();
      lipsync.update(1 / 60, true);
    }
    expect(influence(mesh, dictionary, channel)).toBeCloseTo(settled, 5);
  });

  it('restores the exact base after additive saturation instead of subtracting', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = 'CTRL_expressions_browDownL';
    settle(lipsync, makeFrame({ [channel]: 1 }));

    lipsync.beginFrame();
    mesh.morphTargetInfluences![dictionary[channel]] = 0.9;
    lipsync.update(1 / 60, true);
    expect(influence(mesh, dictionary, channel)).toBe(1);

    lipsync.beginFrame();
    expect(influence(mesh, dictionary, channel)).toBe(0.9);

    // The next frame's base animation is sampled independently too.
    mesh.morphTargetInfluences![dictionary[channel]] = 0.73;
    lipsync.update(1 / 60, true);
    expect(influence(mesh, dictionary, channel)).toBe(1);
    lipsync.beginFrame();
    expect(influence(mesh, dictionary, channel)).toBe(0.73);
  });

  it('reset restores the captured base exactly and clears active state', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[100];
    settle(lipsync, makeFrame({ [channel]: 0.6 }));

    lipsync.beginFrame();
    mesh.morphTargetInfluences![dictionary[channel]] = 0.22;
    lipsync.update(1 / 60, true);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0.22);
    lipsync.reset();

    expect(influence(mesh, dictionary, channel)).toBe(0.22);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.resets).toBe(1);
  });
});

describe('ConvaiMhaLipsync queue behavior', () => {
  it('uses the 20 ms look-ahead, consumes defensively, and fades on starvation', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[88];
    let frames = [
      makeFrame({ [channel]: 0 }),
      makeFrame({ [channel]: 0.25 }),
      makeFrame({ [channel]: 0.5 }),
      makeFrame({ [channel]: 0.75 }),
    ];
    let consumed = 0;
    let speaking = true;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => speaking,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => {
        consumed += count;
        frames = frames.slice(count);
      },
      isConversationEnded: () => !speaking,
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    // 16.7 ms render delta + 20 ms visual offset advances three 90fps slots.
    expect(consumed).toBe(3);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0);

    // The already-presented one-frame head is now starvation, even while the
    // SDK's speaking flag is late. The default 800 ms preset releases it
    // gradually without discarding the buffered head.
    for (let index = 0; index < 6; index += 1) {
      lipsync.beginFrame();
      expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    }
    expect(lipsync.active).toBe(true);
    expect(frames).toHaveLength(1);

    speaking = false;
    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 0.25);
    expect(lipsync.active).toBe(false);
  });

  it('reports a held queue head as fresh once, then releases its unchanged mouth pose', () => {
    // Pure comparison mode must retain the app's mandatory final-pose fix.
    setLipsyncTuningMode('pure');
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const channel = CONVAI_MHA_CHANNEL_ORDER[91];
    const frames = [makeFrame({ [channel]: 0.7 })];
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => true,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => { frames.splice(0, count); },
      isConversationEnded: () => false,
    };

    // Enter the held-tail scenario with the facial envelope already fully
    // open, as it is after a real spoken sentence rather than at cold start.
    expect(lipsync.setTargetFrame(frames[0])).toBe(true);
    lipsync.beginFrame();
    lipsync.update(0.1, true);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0.6);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0);

    // Reproduce the production failure: Convai can retain its final queue head
    // and bot-speaking flag for 1-2 seconds after audible speech. The head must
    // stay buffered for a possible late chunk, but the app's 120 ms envelope
    // must reach neutral long before either delayed lifecycle event arrives.
    for (let index = 0; index < 8; index += 1) {
      lipsync.beginFrame();
      expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    }
    expect(frames).toHaveLength(1);
    expect(lipsync.active).toBe(false);
    expect(influence(mesh, dictionary, channel)).toBe(0);
    expect(lipsync.diagnostics.fadeAlpha).toBe(0);
    expect(lipsync.diagnostics.starvationSeconds).toBeGreaterThanOrEqual(
      CONVAI_MHA_APP_RELEASE_SECONDS,
    );

    // If the one-frame state was a genuine inter-chunk gap, the preserved
    // head and newly arrived frame resume interpolation/fade-in normally.
    frames.push(makeFrame({ [channel]: 0.35 }));
    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    expect(frames).toHaveLength(1);
    expect(lipsync.active).toBe(true);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0);
  });

  it('releases a stale Convai final pose when the manager proves playback is quiet', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const jaw = 'CTRL_expressions_jawOpen';
    let frames = [makeFrame({ [jaw]: 0.8 })];
    let consumed = 0;
    let resets = 0;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      // Reproduce the observed SDK failure: the final frame and speaking flag
      // remain live after the manager/audio layer has completed the turn.
      isBotSpeaking: () => true,
      hasReceivedEndSignal: () => false,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => {
        consumed += Math.min(count, frames.length);
        frames = frames.slice(count);
      },
      reset: () => {
        resets += 1;
        frames = [];
      },
      isConversationEnded: () => false,
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 0.1)).toBe(true);
    const heldJaw = influence(mesh, dictionary, jaw);
    expect(heldJaw).toBeGreaterThan(0);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 0.1, { releaseHeldPose: true })).toBe(false);
    expect(influence(mesh, dictionary, jaw)).toBeGreaterThan(0);
    expect(influence(mesh, dictionary, jaw)).toBeLessThan(heldJaw);
    expect(consumed).toBe(1);
    expect(resets).toBe(1);
    expect(lipsync.diagnostics.authoritativeTailReleases).toBe(1);

    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 0.1, { releaseHeldPose: true });
    expect(influence(mesh, dictionary, jaw)).toBe(0);
    expect(lipsync.active).toBe(false);
    expect(resets).toBe(1);
  });

  it('releases the real SDK final frame from complete turn stats before a late bot-stopped event', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const jaw = 'CTRL_expressions_jawOpen';
    const queue = new BlendshapeQueue();
    const frame = Array.from(makeFrame({ [jaw]: 0.8 }));

    queue.startConversation();
    queue.addChunk([frame, frame]);
    expect(queue.startBotSpeaking()).toBe(true);
    queue.endConversation({
      fps: 60,
      total_audio_bytes: 1_920,
      total_audio_duration_ms: 2 * (1_000 / 60),
      total_blendshapes: 2,
      total_turn_duration_ms: 2 * (1_000 / 60),
    });
    expect(queue.hasReceivedEndSignal()).toBe(true);
    expect(queue.isBotSpeaking()).toBe(true);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    expect(queue.length).toBe(1);
    const finalPresentedJaw = influence(mesh, dictionary, jaw);
    expect(finalPresentedJaw).toBeGreaterThan(0);

    // The bot-stopped lifecycle event is intentionally still late. Public
    // turn stats prove this is the true final expected frame, so its already-
    // presented 0.1-alpha pose is consumed and the neutral envelope starts.
    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    expect(queue.length).toBe(0);
    expect(queue.isBotSpeaking()).toBe(true);
    expect(influence(mesh, dictionary, jaw)).toBeLessThan(finalPresentedJaw);
    expect(lipsync.diagnostics.endSignalFinalFrameConsumes).toBe(1);

    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 1 / 60);
    expect(influence(mesh, dictionary, jaw)).toBe(0);
    expect(lipsync.active).toBe(false);
  });

  it('does not mistake an end-signaled inter-chunk gap for the expected final frame', () => {
    const { scene } = makeScene();
    const lipsync = new ConvaiMhaLipsync({
      scene,
      fadeOutSeconds: CONVAI_MHA_APP_RELEASE_SECONDS,
    });
    const frame = Array.from(makeFrame({ CTRL_expressions_jawOpen: 0.8 }));
    const queue = new BlendshapeQueue();

    queue.startConversation();
    queue.addChunk([frame]);
    expect(queue.startBotSpeaking()).toBe(true);
    queue.endConversation({
      fps: 60,
      total_audio_bytes: 1_920,
      total_audio_duration_ms: 2 * (1_000 / 60),
      total_blendshapes: 2,
      total_turn_duration_ms: 2 * (1_000 / 60),
    });

    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 1 / 60);
    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 1 / 60);

    expect(queue.isBotSpeaking()).toBe(true);
    expect(queue.length).toBe(1);
    expect(queue.getFramesConsumed()).toBe(0);
    expect(lipsync.active).toBe(true);
    expect(lipsync.diagnostics.endSignalFinalFrameConsumes).toBe(0);
  });

  it('becomes inactive after starvation even before a definitive conversation-end signal', () => {
    const { scene } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    let frames = [makeFrame({ [CONVAI_MHA_CHANNEL_ORDER[92]]: 0.8 })];
    let speaking = true;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => speaking,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      isConversationEnded: () => false,
    };

    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 0.1);
    expect(lipsync.active).toBe(true);
    speaking = false;
    frames = [];
    for (let index = 0; index < 4; index += 1) {
      lipsync.beginFrame();
      lipsync.updateFromConvaiQueue(queue, 0.25);
    }
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.conversationResets).toBe(0);
  });

  it('preserves missing-signal holds until turn-end authorization and resets their drought when speech resumes', () => {
    const { scene } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[96];
    let frames = Array.from({ length: 12 }, (_, index) => makeFrame({ [channel]: index / 12 }));
    let speaking = true;
    let consumed = 0;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => speaking,
      hasReceivedEndSignal: () => false,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => {
        consumed += count;
        frames = frames.slice(count);
      },
      isConversationEnded: () => false,
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    expect(consumed).toBeGreaterThan(0);

    speaking = false;
    const firstHeldTailLength = frames.length;
    for (let index = 0; index < 4; index += 1) {
      lipsync.beginFrame();
      expect(lipsync.updateFromConvaiQueue(queue, 0.25)).toBe(false);
    }
    expect(frames).toHaveLength(firstHeldTailLength);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.missingEndSignalTailDrains).toBe(0);

    // A new speaking signal disproves the stale-tail case and resets its
    // drought clock. Even a later gap beyond 1.5 s remains non-destructive
    // until the manager supplies its authoritative turn-end permission.
    speaking = true;
    lipsync.beginFrame();
    lipsync.updateFromConvaiQueue(queue, 0);
    speaking = false;
    const secondHeldTailLength = frames.length;
    for (let index = 0; index < 8; index += 1) {
      lipsync.beginFrame();
      expect(lipsync.updateFromConvaiQueue(queue, 0.25)).toBe(false);
    }
    expect(frames).toHaveLength(secondHeldTailLength);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.missingEndSignalTailDrains).toBe(0);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 0, {
      allowMissingEndSignalDrain: true,
    })).toBe(false);
    expect(frames).toHaveLength(0);
    expect(lipsync.diagnostics.missingEndSignalTailDrains).toBe(1);
  });

  it('handles the first-render race: preserve forever without authorization, drain after an authorized 1500 ms drought', () => {
    const unauthorized = new ConvaiMhaLipsync({ scene: makeScene().scene });
    let unauthorizedFrames = [makeFrame({ [CONVAI_MHA_CHANNEL_ORDER[98]]: 0.4 })];
    const unauthorizedQueue = {
      get length() { return unauthorizedFrames.length; },
      hasFrames: () => unauthorizedFrames.length > 0,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => false,
      getFrameWithAlpha: (index: number) => unauthorizedFrames[index] ?? null,
      consumeFrames: (count: number) => { unauthorizedFrames = unauthorizedFrames.slice(count); },
      isConversationEnded: () => false,
    };

    // The portrait mounted after the SDK flags had already dropped, so this
    // adapter has never accepted a sample. Without explicit turn-end proof the
    // queue remains a potentially valid inter-chunk hold even after 2 seconds.
    for (let index = 0; index < 8; index += 1) {
      unauthorized.beginFrame();
      expect(unauthorized.updateFromConvaiQueue(unauthorizedQueue, 0.25)).toBe(false);
    }
    expect(unauthorizedFrames).toHaveLength(1);
    expect(unauthorized.diagnostics.acceptedFrames).toBe(0);
    expect(unauthorized.diagnostics.missingEndSignalTailDrains).toBe(0);

    const { scene } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[97];
    let frames = Array.from({ length: 3 }, (_, index) => makeFrame({ [channel]: index / 3 }));
    let consumed = 0;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => false,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => {
        consumed += count;
        frames = frames.slice(count);
      },
      // This reproduces the SDK failure: no end signal and no definitive
      // conversation-ended state even though the manager turn has ended.
      isConversationEnded: () => false,
    };

    const staleTailLength = frames.length;
    expect(staleTailLength).toBeGreaterThan(0);

    for (let index = 0; index < 5; index += 1) {
      lipsync.beginFrame();
      expect(lipsync.updateFromConvaiQueue(queue, 0.25, {
        allowMissingEndSignalDrain: true,
      })).toBe(false);
    }
    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 0.24, {
      allowMissingEndSignalDrain: true,
    })).toBe(false);

    // 1490 ms: the queue and authorized ownership are deliberately preserved,
    // even though this first-render adapter has no visual contribution at all.
    expect(frames).toHaveLength(staleTailLength);
    expect(consumed).toBe(0);
    expect(lipsync.active).toBe(true);
    expect(lipsync.diagnostics.acceptedFrames).toBe(0);
    expect(lipsync.diagnostics.missingEndSignalTailDrains).toBe(0);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 0.02, {
      allowMissingEndSignalDrain: true,
    })).toBe(false);

    expect(frames).toHaveLength(0);
    expect(consumed).toBe(staleTailLength);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.missingEndSignalTailDrains).toBe(1);
    expect(lipsync.diagnostics.conversationResets).toBe(0);
  });

  it('drains an ended stale tail on normalization without replaying it in the same update', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[95];
    let frames = [makeFrame({ [channel]: 0.9 }), makeFrame({ [channel]: 0.7 })];
    let normalizationPending = true;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => true,
      consumeNormalizationSignal: () => {
        const pending = normalizationPending;
        normalizationPending = false;
        return pending;
      },
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => { frames = frames.slice(count); },
      isConversationEnded: () => frames.length === 0,
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    expect(frames).toHaveLength(0);
    expect(influence(mesh, dictionary, channel)).toBe(0);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.acceptedFrames).toBe(0);
    expect(lipsync.diagnostics.normalizationResets).toBe(1);
  });

  it('plays and consumes the safe bot-stopped end-signal tail before resetting', () => {
    const { scene, mesh, dictionary } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    const channel = CONVAI_MHA_CHANNEL_ORDER[93];
    let frames = [
      makeFrame({ [channel]: 0.25 }),
      makeFrame({ [channel]: 0.75 }),
    ];
    let resetCalls = 0;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => true,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => { frames = frames.slice(count); },
      isConversationEnded: () => frames.length === 0,
      reset: () => { resetCalls += 1; },
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(true);
    expect(frames).toHaveLength(1);
    expect(influence(mesh, dictionary, channel)).toBeGreaterThan(0);

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    expect(frames).toHaveLength(0);
    expect(lipsync.active).toBe(true);

    for (let index = 0; index < 60 && lipsync.active; index += 1) {
      lipsync.beginFrame();
      lipsync.updateFromConvaiQueue(queue, 1 / 60);
    }
    expect(lipsync.active).toBe(false);
    expect(resetCalls).toBe(1);
    expect(lipsync.diagnostics.conversationResets).toBe(1);
  });

  it('rejects but drops a malformed final end-signal frame so completion cannot deadlock', () => {
    const { scene } = makeScene();
    const lipsync = new ConvaiMhaLipsync({ scene });
    let frames: Array<ArrayLike<number>> = [makeFrame({ [CONVAI_MHA_CHANNEL_ORDER[94]]: Number.NaN })];
    let resetCalls = 0;
    const queue = {
      get length() { return frames.length; },
      hasFrames: () => frames.length > 0,
      isBotSpeaking: () => false,
      hasReceivedEndSignal: () => true,
      getPlaybackFps: () => 90,
      getFrameWithAlpha: (index: number) => frames[index] ?? null,
      consumeFrames: (count: number) => { frames = frames.slice(count); },
      isConversationEnded: () => frames.length === 0,
      reset: () => { resetCalls += 1; },
    };

    lipsync.beginFrame();
    expect(lipsync.updateFromConvaiQueue(queue, 1 / 60)).toBe(false);
    expect(frames).toHaveLength(0);
    expect(lipsync.active).toBe(false);
    expect(lipsync.diagnostics.rejectedFrames).toBe(1);
    expect(lipsync.diagnostics.rejectedValues).toBe(1);
    expect(lipsync.diagnostics.conversationResets).toBe(1);
    expect(resetCalls).toBe(1);
  });
});

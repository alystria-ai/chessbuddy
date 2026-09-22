import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { METAHUMAN_ORDER_251 } from '@convai/web-sdk/lipsync-helpers';
import {
  applyMhaLipsyncFrame,
  applyMhaJawMotion,
  bindMhaLipsyncMeshes,
  createMhaLipsyncState,
  decayMhaLipsyncMorphs,
  getMhaMatchedCount,
  snapMhaLipsyncNeutral,
} from './mhaLipsync';
import { buildMhaMeshMap, normalizeName } from './mhaToMorphMap';
import { JAW_OPEN_MAX_Z } from './mhaJawBones';
import { setRawNeurosyncPassthrough } from './lipsyncRawMode';

// The suite tests the TUNED pipeline; raw-passthrough tests flip this locally.
beforeAll(() => setRawNeurosyncPassthrough(false));

/**
 * Apply the same frame repeatedly with mocked time so the §1.4 bloom envelope
 * and the input smoother both settle (≈1 within 1e-5 after 14 × 100ms ticks) —
 * steady-state assertions then read the pure gain math.
 */
function applySettled(state: ReturnType<typeof createMhaLipsyncState>, values: Record<string, number>) {
  let nowMs = 50_000;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  let stats!: ReturnType<typeof applyMhaLipsyncFrame>;
  for (let i = 0; i < 14; i++) {
    stats = applyMhaLipsyncFrame(state, makeFrame(values));
    nowMs += 100;
  }
  spy.mockRestore();
  return stats;
}

const mhaIndex = (short: string): number => {
  const i = METAHUMAN_ORDER_251.indexOf(`CTRL_expressions_${short}`);
  if (i < 0) throw new Error(`unknown MHA control ${short}`);
  return i;
};

/**
 * Face mesh with CC4 ExpressionPlus-style names covering the mapping paths:
 * 1:1 match, alias match, skip mask, limit driver target, corrective morph.
 */
const FACE_MORPHS = [
  'Brow_Down_L',
  'Mouth_Corner_Pull_L',
  'Mouth_Stretch_L',
  'Mouth_Lips_Together_UL',
  'Mouth_Mouth_Press_UL',
  'Jaw_Open',
  'Tongue_Out',
  'Eye_Blink_L',
  'C_CornerPullL_JawOpen',
];

function makeFaceMesh(): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry());
  mesh.name = 'CC_Base_Body_1';
  mesh.morphTargetDictionary = Object.fromEntries(FACE_MORPHS.map((name, i) => [name, i]));
  mesh.morphTargetInfluences = new Array(FACE_MORPHS.length).fill(0);
  return mesh;
}

function makeRoot(mesh: THREE.SkinnedMesh): {
  root: THREE.Group;
  jaw: THREE.Bone;
  upperTeeth: THREE.Bone;
  lowerTeeth: THREE.Bone;
} {
  const root = new THREE.Group();
  const jaw = new THREE.Bone();
  jaw.name = 'CC_Base_JawRoot';
  const upperTeeth = new THREE.Bone();
  upperTeeth.name = 'CC_Base_Teeth01';
  const lowerTeeth = new THREE.Bone();
  lowerTeeth.name = 'CC_Base_Teeth02';
  root.add(jaw);
  jaw.add(lowerTeeth);
  root.add(upperTeeth);
  root.add(mesh);
  return { root, jaw, upperTeeth, lowerTeeth };
}

function makeFrame(values: Record<string, number>): Float32Array {
  const frame = new Float32Array(METAHUMAN_ORDER_251.length);
  for (const [short, value] of Object.entries(values)) frame[mhaIndex(short)] = value;
  return frame;
}

const influence = (mesh: THREE.SkinnedMesh, name: string): number =>
  mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildMhaMeshMap', () => {
  it('matches CC4 names to MHA controls by normalized key, with aliases', () => {
    const dict = Object.fromEntries(FACE_MORPHS.map((name, i) => [name, i]));
    const map = buildMhaMeshMap(dict);
    expect(map.indexByMha[mhaIndex('browDownL')]).toBe(dict.Brow_Down_L);
    expect(map.indexByMha[mhaIndex('mouthCornerPullL')]).toBe(dict.Mouth_Corner_Pull_L);
    // alias: mouthPressUL → Mouth_Mouth_Press_UL (doubled prefix on CC4 heads)
    expect(map.indexByMha[mhaIndex('mouthPressUL')]).toBe(dict.Mouth_Mouth_Press_UL);
    // jawFwd binds like any channel; the legacy CC4 pipeline suppresses it
    // via the skip mask (MetaHuman rigs and raw passthrough drive it).
    expect(createMhaLipsyncState().skip[mhaIndex('jawFwd')]).toBe(1);
    expect(createMhaLipsyncState('Sofia').skip[mhaIndex('jawFwd')]).toBe(0);
    expect(normalizeName('CTRL_expressions_mouthLipsTogetherUL')).toBe(
      normalizeName('Mouth_Lips_Together_UL'),
    );
  });
});

describe('applyMhaLipsyncFrame', () => {
  it('applies matched channels 1:1 with mouth gain 1 and non-mouth gain 0.8', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);
    expect(getMhaMatchedCount(state)).toBeGreaterThan(0);

    // First apply initialises the smoothed frame to the target (no lerp lag).
    applyMhaLipsyncFrame(state, makeFrame({ browDownL: 0.5, mouthCornerPullL: 0.6 }));
    expect(influence(mesh, 'Brow_Down_L')).toBeCloseTo(0.5 * 0.8, 5);
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.6, 5);
    expect(state.isActive).toBe(true);
  });

  it('skips jawOpen/teeth/tongue morph channels but drives the jaw bone target', () => {
    const mesh = makeFaceMesh();
    const { root, jaw } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    const stats = applyMhaLipsyncFrame(state, makeFrame({ jawOpen: 0.8, tongueOut: 0.9 }));
    expect(influence(mesh, 'Jaw_Open')).toBe(0);
    expect(influence(mesh, 'Tongue_Out')).toBe(0);
    expect(stats.jawOpen).toBeCloseTo(0.8, 5);

    // Jaw bone eases toward jawOpen * JAW_OPEN_MAX_Z (smooth 0.35/frame).
    applyMhaJawMotion(state);
    expect(jaw.rotation.z).toBeCloseTo(0.8 * 0.35 * JAW_OPEN_MAX_Z, 5);
  });

  it('raw passthrough applies streamed values 1:1 with nothing synthesized', () => {
    setRawNeurosyncPassthrough(true);
    try {
      const mesh = makeFaceMesh();
      const { root } = makeRoot(mesh);
      const state = createMhaLipsyncState('Sofia');
      bindMhaLipsyncMeshes(state, root);

      applyMhaLipsyncFrame(state, makeFrame({
        jawOpen: 0.9, mouthCornerPullL: 0.7, tongueOut: 0.5, browDownL: 0.4,
      }));
      // Unity gain, no compressor, no damping, tongue live.
      expect(influence(mesh, 'Jaw_Open')).toBeCloseTo(0.9, 5);
      expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.7, 5);
      expect(influence(mesh, 'Tongue_Out')).toBeCloseTo(0.5, 5);
      expect(influence(mesh, 'Brow_Down_L')).toBeCloseTo(0.4, 5);
      // No synthesized limit driver: lipsTogether stays at its streamed 0.
      expect(influence(mesh, 'Mouth_Lips_Together_UL')).toBe(0);
      // No combination correctives.
      expect(influence(mesh, 'C_CornerPullL_JawOpen')).toBe(0);
    } finally {
      setRawNeurosyncPassthrough(false);
    }
  });

  it('drives tongue channels on MetaHuman rigs (masking them muted L/TH/D/N sounds)', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState('Sofia');
    bindMhaLipsyncMeshes(state, root);

    applySettled(state, { tongueOut: 0.9 });
    // SDK gain table: tongue channels are not in it → gain 1 (the old
    // non-mouth 0.8 damp is CC4-only now).
    expect(influence(mesh, 'Tongue_Out')).toBeCloseTo(0.9, 4);
  });

  it('MetaHuman: SDK production gains, cap, symmetrize, and bilabial floor', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState('Vincent');
    bindMhaLipsyncMeshes(state, root);

    // jawOpen 1.0 → gain 0.72, then the §1.5 hard cap holds the applied
    // value at 0.5 (jawOpenExtreme stacks on top on these heads).
    applySettled(state, { jawOpen: 1 });
    expect(influence(mesh, 'Jaw_Open')).toBeCloseTo(0.5, 4);

    // Symmetrize: a one-sided corner pull averages across the L/R pair
    // before gains (0.8 L + 0 R → 0.4 both, cornerPull gain 1.0).
    snapMhaLipsyncNeutral(state);
    applySettled(state, { mouthCornerPullL: 0.8 });
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.4, 4);

    // §1.6 bilabial floor: jaw fully closed during speech seals the lips at
    // 0.5 even though the jawOpen→lipsTogether coupling contributes ~0.
    snapMhaLipsyncNeutral(state);
    applySettled(state, { jawOpen: 0, mouthCornerPullL: 0.2, mouthCornerPullR: 0.2 });
    expect(influence(mesh, 'Mouth_Lips_Together_UL')).toBeCloseTo(0.5, 4);
  });

  it('MetaHuman: damps the brow-raise cluster (full-strength raises shoved the forehead up)', () => {
    const state = createMhaLipsyncState('Sofia');
    for (const control of ['browRaiseInL', 'browRaiseInR', 'browRaiseOuterL', 'browRaiseOuterR']) {
      expect(state.gain[mhaIndex(control)]).toBeCloseTo(0.55, 5);
    }
    // Downward/lateral brow moves keep the table default.
    expect(state.gain[mhaIndex('browDownL')]).toBeCloseTo(1, 5);
    expect(state.gain[mhaIndex('browLateralL')]).toBeCloseTo(1, 5);
  });

  it('MetaHuman: envelope blooms in — the first frame does not pop the mouth open', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState('Sofia');
    bindMhaLipsyncMeshes(state, root);

    applyMhaLipsyncFrame(state, makeFrame({ jawOpen: 0.6, mouthCornerPullL: 0.6, mouthCornerPullR: 0.6 }));
    // First 60fps tick: envelope ≈ 1 - exp(-(1/60)/0.09) ≈ 0.169.
    const first = influence(mesh, 'Jaw_Open');
    expect(first).toBeGreaterThan(0.02);
    expect(first).toBeLessThan(0.15);
  });

  it('runs the jawOpen → lipsTogether limit driver (max of target and source)', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    applyMhaLipsyncFrame(state, makeFrame({ jawOpen: 0.7, mouthLipsTogetherUL: 0.2 }));
    // target = max(own value, raw jawOpen) * mouth gain 1
    expect(influence(mesh, 'Mouth_Lips_Together_UL')).toBeCloseTo(0.7, 5);
  });

  it('applies the SDK production gain table on every MetaHuman coach', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState('Vincent'); // Magnus
    bindMhaLipsyncMeshes(state, root);

    // Both sides driven so symmetrization is a no-op; jaw high enough that
    // the jawOpen→lipsTogether coupling dominates the lipsTogether channel:
    // applied = jawOpenRaw × lipsTogether gain 0.8.
    applySettled(state, {
      jawOpen: 0.6,
      mouthCornerPullL: 0.5,
      mouthCornerPullR: 0.5,
      mouthLipsTogetherUL: 0.2,
    });
    // cornerPull stays at 1.0 per the SDK table ("do NOT boost/damp").
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.5, 4);
    expect(influence(mesh, 'Mouth_Lips_Together_UL')).toBeCloseTo(0.6 * 0.8, 4);
    expect(influence(mesh, 'Jaw_Open')).toBeCloseTo(0.6 * 0.72, 4);
  });

  it('drives C_* correctives from the displayed input values', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    applyMhaLipsyncFrame(state, makeFrame({ jawOpen: 0.5, mouthCornerPullL: 0.4 }));
    // Bone-jaw rig: jaw input = raw channel (the bone opens from it); corner
    // pull has mouth gain 1 — product 0.5 * 0.4.
    expect(influence(mesh, 'C_CornerPullL_JawOpen')).toBeCloseTo(0.5 * 0.4, 5);
  });

  it('drives corrective inputs from the displayed (gained) values on MetaHuman rigs', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState('Sofia');
    bindMhaLipsyncMeshes(state, root);

    applySettled(state, { jawOpen: 0.5, mouthCornerPullL: 0.4, mouthCornerPullR: 0.4 });
    // Displayed jaw = 0.5 × SDK gain 0.72; corner pull gain 1.0. The
    // corrective must follow those displayed values, not the raw stream.
    expect(influence(mesh, 'C_CornerPullL_JawOpen')).toBeCloseTo(0.5 * 0.72 * 0.4, 4);
  });

  it('smooths successive frames with the 0.9 lerp at 60fps ticks', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    let nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    applyMhaLipsyncFrame(state, makeFrame({ mouthCornerPullL: 1 }));
    nowMs += 1000 / 60;
    applyMhaLipsyncFrame(state, makeFrame({ mouthCornerPullL: 0 }));
    // 1 + (0 - 1) * 0.92 = 0.08 — light smoothing per the SDK guide §1.7
    // (transient preservation): the envelope guards speech start/end, so the
    // per-frame smoother stays barely-on to keep consonant attacks crisp.
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.08, 5);
  });
});

describe('decay and snap', () => {
  it('normalizes morphs toward zero after speech and deactivates at rest', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    let nowMs = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    applyMhaLipsyncFrame(state, makeFrame({ mouthCornerPullL: 1, jawOpen: 0.6 }));

    nowMs += 1000 / 60;
    decayMhaLipsyncMorphs(state);
    // one 60fps decay tick: * (1 - 0.18)
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBeCloseTo(0.82, 5);
    expect(state.isActive).toBe(true);

    for (let i = 0; i < 60; i++) {
      nowMs += 1000 / 60;
      decayMhaLipsyncMorphs(state);
    }
    expect(state.isActive).toBe(false);
    expect(influence(mesh, 'Mouth_Corner_Pull_L')).toBe(0);
    expect(state.jawOpenTarget).toBe(0);
  });

  it('offsets teeth bones per head — example default vs Magnus tuck', () => {
    const defaultState = createMhaLipsyncState();
    const { root: r1, upperTeeth: u1, lowerTeeth: l1 } = makeRoot(makeFaceMesh());
    bindMhaLipsyncMeshes(defaultState, r1);
    applyMhaJawMotion(defaultState);
    expect(u1.position.y).toBeCloseTo(0.35, 5);
    expect(l1.position.y).toBeCloseTo(0.35, 5);

    const magnusState = createMhaLipsyncState('Vincent');
    const { root: r2, upperTeeth: u2, lowerTeeth: l2 } = makeRoot(makeFaceMesh());
    bindMhaLipsyncMeshes(magnusState, r2);
    applyMhaJawMotion(magnusState);
    // Parent-frame +Y is world-down on these rigs: upper negative = up.
    expect(u2.position.y).toBeCloseTo(-0.45, 5);
    expect(l2.position.y).toBeCloseTo(0.25, 5);
  });

  it('gives Leila the cc-female jaw range (0.78 rad) while others keep 0.25', () => {
    const leila = createMhaLipsyncState('Leila');
    const { root, jaw } = makeRoot(makeFaceMesh());
    bindMhaLipsyncMeshes(leila, root);
    applyMhaLipsyncFrame(leila, makeFrame({ jawOpen: 1 }));
    for (let i = 0; i < 120; i++) applyMhaJawMotion(leila);
    expect(jaw.rotation.z).toBeCloseTo(0.78, 2);

    const sofia = createMhaLipsyncState('Cassandra');
    const { root: r2, jaw: j2 } = makeRoot(makeFaceMesh());
    bindMhaLipsyncMeshes(sofia, r2);
    applyMhaLipsyncFrame(sofia, makeFrame({ jawOpen: 1 }));
    for (let i = 0; i < 120; i++) applyMhaJawMotion(sofia);
    expect(j2.rotation.z).toBeCloseTo(0.25, 2);
  });

  it('keeps the upper teeth skull-fixed while the jaw opens', () => {
    const state = createMhaLipsyncState();
    const { root, upperTeeth, lowerTeeth } = makeRoot(makeFaceMesh());
    bindMhaLipsyncMeshes(state, root);
    applyMhaLipsyncFrame(state, makeFrame({ jawOpen: 1 }));
    for (let i = 0; i < 60; i++) applyMhaJawMotion(state);
    // Upper row: no jawOpen-driven rotation. Lower row: extra open deltas.
    expect(upperTeeth.rotation.z).toBeCloseTo(0, 5);
    expect(lowerTeeth.rotation.z).toBeLessThan(-0.03);
  });

  it('snapMhaLipsyncNeutral zeroes every driven morph immediately', () => {
    const mesh = makeFaceMesh();
    const { root } = makeRoot(mesh);
    const state = createMhaLipsyncState();
    bindMhaLipsyncMeshes(state, root);

    applyMhaLipsyncFrame(state, makeFrame({ mouthCornerPullL: 0.9, jawOpen: 0.9, browDownL: 0.7 }));
    snapMhaLipsyncNeutral(state);
    for (const name of FACE_MORPHS) {
      expect(influence(mesh, name), name).toBe(0);
    }
    expect(state.isActive).toBe(false);
    expect(state.smoothedFrame).toBeNull();
  });
});

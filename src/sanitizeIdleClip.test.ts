import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  getPortraitBodyPoseSource,
  sanitizeAuthoredPerformanceClip,
  sanitizePortraitIdleClip,
} from './sanitizeIdleClip';

describe('sanitizePortraitIdleClip', () => {
  it('locks BoneRoot position to the opening pose', () => {
    const clip = new THREE.AnimationClip('idle', 10, [
      new THREE.VectorKeyframeTrack('CC_Base_BoneRoot.position', [0, 5, 10], [
        0, 0, 0,
        -27, 0.02, -4,
        1.5, 0.04, -1,
      ]),
    ]);

    const sanitized = sanitizePortraitIdleClip(clip, 'Leila');
    const root = sanitized.tracks.find((track) => track.name === 'CC_Base_BoneRoot.position') as THREE.VectorKeyframeTrack;
    expect(root).toBeTruthy();
    expect(Array.from(root.values).map((v) => Number(v.toFixed(2)))).toEqual([
      0, 0, 0,
      0, 0, 0,
      0, 0, 0,
    ]);
  });

  it('removes eye translation only when the track moves', () => {
    const clip = new THREE.AnimationClip('idle', 2, [
      new THREE.VectorKeyframeTrack('CC_Base_L_Eye.position', [0, 1], [
        6.75, 7.08, 3.2,
        6.80, 7.08, 3.2,
      ]),
      new THREE.VectorKeyframeTrack('CC_Base_R_Eye.position', [0, 1], [
        6.76, 7.08, -3.2,
        6.76, 7.08, -3.2,
      ]),
    ]);

    const sanitized = sanitizePortraitIdleClip(clip, 'Leila');
    expect(sanitized.tracks.some((track) => track.name === 'CC_Base_L_Eye.position')).toBe(false);
    expect(sanitized.tracks.some((track) => track.name === 'CC_Base_R_Eye.position')).toBe(true);
  });

  it('locks hip translation when the idle sways horizontally', () => {
    const hip = new THREE.VectorKeyframeTrack('CC_Base_Hip.position', [0, 1], [
      -0.2, 0, 0.5,
      0.16, 0, -0.9,
    ]);
    const sanitized = sanitizePortraitIdleClip(
      new THREE.AnimationClip('idle', 1, [hip]),
      'Leila',
    );
    const out = sanitized.tracks[0] as THREE.VectorKeyframeTrack;
    expect(Array.from(out.values).map((v) => Number(v.toFixed(2)))).toEqual([-0.2, 0, 0.5, -0.2, 0, 0.5]);
  });

  it('locks spine rotation when the idle sways the torso', () => {
    const spine = new THREE.VectorKeyframeTrack('CC_Base_Spine01.rotation', [0, 1], [
      0, 0.05, 0,
      0.12, -0.08, 0.04,
    ]);
    const sanitized = sanitizePortraitIdleClip(new THREE.AnimationClip('idle', 1, [spine]), 'Leila');
    const out = sanitized.tracks[0] as THREE.VectorKeyframeTrack;
    expect(Array.from(out.values).map((v) => Number(v.toFixed(2)))).toEqual([0, 0.05, 0, 0, 0.05, 0]);
  });

  it('strips jaw/teeth/tongue tracks so the bones stay at bind pose for the MHA jaw open', () => {
    const clip = new THREE.AnimationClip('idle', 1, [
      new THREE.VectorKeyframeTrack('CC_Base_JawRoot.position', [0, 1], [0, 0, 0, 1.5, 0, 0]),
      new THREE.VectorKeyframeTrack('CC_Base_Teeth02.scale', [0, 1], [1, 1, 1, 2, 2, 2]),
      new THREE.VectorKeyframeTrack('CC_Base_Tongue03.rotation', [0, 1], [0, 0, 0, 0.3, 0, 0]),
      new THREE.VectorKeyframeTrack('CC_Base_UpperJaw.rotation', [0, 1], [0, 0.2, 0, 0.5, 0, 0]),
    ]);
    const sanitized = sanitizePortraitIdleClip(clip, 'Leila');
    const names = sanitized.tracks.map((t) => t.name);
    expect(names).not.toContain('CC_Base_JawRoot.position');
    expect(names).not.toContain('CC_Base_Teeth02.scale');
    expect(names).not.toContain('CC_Base_Tongue03.rotation');
    // UpperJaw is still locked (not stripped) — the example leaves it to the clip.
    expect(names).toContain('CC_Base_UpperJaw.rotation');
  });

  it('preserves the artist-authored eye rotation animation', () => {
    const clip = new THREE.AnimationClip('idle', 1, [
      new THREE.VectorKeyframeTrack('CC_Base_L_Eye.rotation', [0, 1], [0.1, 0, 0, 0.2, 0, 0]),
      new THREE.QuaternionKeyframeTrack('CC_Base_R_Eye.quaternion', [0, 1], [0, 0, 0, 1, 0.1, 0, 0, 1]),
    ]);
    const sanitized = sanitizePortraitIdleClip(clip, 'Sofia');
    expect(sanitized.tracks).toHaveLength(2);

    const left = sanitized.tracks[0] as THREE.VectorKeyframeTrack;
    expect(Array.from(left.values).map((v) => Number(v.toFixed(2)))).toEqual([0.1, 0, 0, 0.2, 0, 0]);

    const right = sanitized.tracks[1] as THREE.QuaternionKeyframeTrack;
    expect(Array.from(right.values).map((v) => Number(v.toFixed(2)))).toEqual([0, 0, 0, 1, 0.1, 0, 0, 1]);
  });

  it('locks head rotation to the opening pose', () => {
    const clip = new THREE.AnimationClip('idle', 2, [
      new THREE.VectorKeyframeTrack('CC_Base_Head.rotation', [0, 1], [0, 0.1, 0, 0.5, 0.3, 0]),
    ]);
    const sanitized = sanitizePortraitIdleClip(clip, 'Sofia');
    const head = sanitized.tracks[0] as THREE.VectorKeyframeTrack;
    expect(Array.from(head.values).map((v) => Number(v.toFixed(2)))).toEqual([0, 0.1, 0, 0, 0.1, 0]);
  });

  it('strips MetaHuman scene-root TRS so the outer 0.01 wrapper is the only scale owner', () => {
    const clip = new THREE.AnimationClip('idle', 2, [
      new THREE.VectorKeyframeTrack('root.scale', [0, 2], [0.01, 0.01, 0.01, 0.01, 0.01, 0.01]),
      new THREE.VectorKeyframeTrack('root.position', [0, 2], [0, 0, 0, 0, 0, 0]),
      new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.VectorKeyframeTrack('spine_01.position', [0, 2], [0, 1, 0, 0, 1.02, 0]),
    ]);

    const sanitized = sanitizePortraitIdleClip(clip, 'Sofia');
    expect(sanitized.tracks.map((track) => track.name)).toEqual(['spine_01.position']);
  });

  it.each(['Tyler', 'Vincent'])('keeps %s front-facing by removing the turned central-body pose', (assetName) => {
    const clip = new THREE.AnimationClip('idle', 2, [
      new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, 2], [
        0, 0.18, 0, 0.9837,
        0, 0.12, 0, 0.9928,
      ]),
      new THREE.QuaternionKeyframeTrack('spine_01.quaternion', [0, 2], [
        0, 0, -0.16, 0.9871,
        0, 0, -0.12, 0.9928,
      ]),
      new THREE.QuaternionKeyframeTrack('neck_02.quaternion', [0, 2], [
        0, -0.08, 0, 0.9968,
        0, -0.04, 0, 0.9992,
      ]),
      new THREE.QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 2], [
        0.1, 0, 0, 0.995,
        0.12, 0, 0, 0.9928,
      ]),
    ]);

    const sanitized = sanitizePortraitIdleClip(clip, assetName);

    expect(getPortraitBodyPoseSource(assetName)).toBe('frontal-bind');
    expect(sanitized.tracks.map((track) => track.name)).toEqual(['upperarm_l.quaternion']);
  });

  it('keeps the authored opening pose for the female portrait rigs', () => {
    expect(getPortraitBodyPoseSource('Sofia')).toBe('authored-frame-0');
    expect(getPortraitBodyPoseSource('Leila')).toBe('authored-frame-0');
  });

  it('keeps Leila hair stable by freezing even low-amplitude central-chain drift', () => {
    const clip = new THREE.AnimationClip('idle', 1, [
      new THREE.QuaternionKeyframeTrack('spine_02.quaternion', [0, 1], [
        0, 0, 0, 1,
        0, 0.004, 0, 0.999992,
      ]),
      new THREE.VectorKeyframeTrack('head.position', [0, 1], [
        0, 12, 0,
        0.006, 12.004, -0.003,
      ]),
      new THREE.QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [
        0, 0, 0, 1,
        0.08, 0, 0, 0.9968,
      ]),
    ]);

    const sanitized = sanitizePortraitIdleClip(clip, 'Leila');
    const spine = sanitized.tracks[0] as THREE.QuaternionKeyframeTrack;
    const head = sanitized.tracks[1] as THREE.VectorKeyframeTrack;
    const arm = sanitized.tracks[2] as THREE.QuaternionKeyframeTrack;

    expect(Array.from(spine.values)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(head.values)).toEqual([0, 12, 0, 0, 12, 0]);
    expect(Array.from(arm.values)).not.toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('sanitizeAuthoredPerformanceClip', () => {
  it('preserves authored pelvis/head motion while stripping root TRS and unsupported corrective bones', () => {
    const target = new THREE.Group();
    for (const name of ['pelvis', 'head']) {
      const bone = new THREE.Bone();
      bone.name = name;
      target.add(bone);
    }
    const clip = new THREE.AnimationClip('source', 1, [
      new THREE.QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.2, 0, 0.98]),
      new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.2, 0, 0.98]),
      new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0.1, 0, 0, 0.99]),
      new THREE.QuaternionKeyframeTrack('FACIAL_C_LowerLipRotation.quaternion', [0, 1], [0, 0, 0, 1, 0.1, 0, 0, 0.99]),
    ]);
    const result = sanitizeAuthoredPerformanceClip(clip, 'boardIdle', target);
    expect(result.name).toBe('boardIdle');
    expect(result.tracks.map((track) => track.name)).toEqual([
      'pelvis.quaternion',
      'head.quaternion',
    ]);
    expect(result.tracks[0].values[5]).toBeCloseTo(0.2);
  });

  it('can keep a user-facing performance frontal without flattening arm motion', () => {
    const target = new THREE.Group();
    for (const name of ['pelvis', 'head', 'upperarm_l']) {
      const bone = new THREE.Bone();
      bone.name = name;
      target.add(bone);
    }
    const clip = new THREE.AnimationClip('source', 1, [
      new THREE.QuaternionKeyframeTrack('pelvis.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.2, 0, 0.98]),
      new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 1], [0, 0, 0, 1, 0.1, 0, 0, 0.99]),
      new THREE.QuaternionKeyframeTrack('upperarm_l.quaternion', [0, 1], [0, 0, 0, 1, 0.2, 0, 0, 0.98]),
    ]);
    const result = sanitizeAuthoredPerformanceClip(clip, 'userIdle', target, {
      lockPlayerFacingBody: true,
    });

    expect(result.tracks.map((track) => track.name)).toEqual(['upperarm_l.quaternion']);
  });
});

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { parseArjunFaceClip } from './arjunChessAnimations';
import {
  BUILTIN_COACH_PERFORMANCE_MANIFESTS,
  getPlayerFacingPerformanceAnimations,
  getAuthoredEyeLookGain,
  validateCoachPerformanceManifest,
} from './coachChessAnimations';

describe('authored coach chess performances', () => {
  it('exposes only player-facing non-transition clips to the live runtime', () => {
    for (const manifest of Object.values(BUILTIN_COACH_PERFORMANCE_MANIFESTS)) {
      const runtime = getPlayerFacingPerformanceAnimations(manifest);
      expect(runtime.some(({ id }) => id === manifest.userIdleId)).toBe(true);
      expect(runtime.every(({ state, kind }) => state === 'user' && kind !== 'transition')).toBe(true);
      expect(runtime.map(({ id }) => id)).not.toContain(manifest.toBoardId);
      expect(runtime.map(({ id }) => id)).not.toContain(manifest.toUserId);
      expect(runtime.map(({ id }) => id)).not.toContain(manifest.boardIdleId);
    }
    const sofiaRuntime = getPlayerFacingPerformanceAnimations(
      BUILTIN_COACH_PERFORMANCE_MANIFESTS.sofia,
    ).map(({ id }) => id);
    const leilaRuntime = getPlayerFacingPerformanceAnimations(
      BUILTIN_COACH_PERFORMANCE_MANIFESTS.leila,
    ).map(({ id }) => id);
    expect(sofiaRuntime).toContain('userArm');
    expect(sofiaRuntime).toContain('userNails');
    expect(sofiaRuntime).not.toContain('postureShift');
    expect(leilaRuntime).not.toContain('postureShift');
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.sofia.authoredEyeLookGain).toBe(0);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.sofia.authoredBlinkGain).toBe(0);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.magnus.authoredEyeLookGain).toBe(0);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.magnus.authoredBlinkGain).toBe(0);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.magnus.lockPlayerFacingBody).toBe(true);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.sofia.lockPlayerFacingBody).not.toBe(true);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.leila.lockPlayerFacingBody).not.toBe(true);
    expect(BUILTIN_COACH_PERFORMANCE_MANIFESTS.arjun.lockPlayerFacingBody).not.toBe(true);
    for (const animationId of leilaRuntime) {
      expect(getAuthoredEyeLookGain(BUILTIN_COACH_PERFORMANCE_MANIFESTS.leila, animationId)).toBe(0);
    }
    expect(getAuthoredEyeLookGain(BUILTIN_COACH_PERFORMANCE_MANIFESTS.arjun, 'userShoulder')).toBeUndefined();
  });

  it('defines a complete isolated manifest for every built-in coach', () => {
    expect(Object.keys(BUILTIN_COACH_PERFORMANCE_MANIFESTS).sort()).toEqual([
      'arjun', 'leila', 'magnus', 'sofia',
    ]);
    for (const [coachId, manifest] of Object.entries(BUILTIN_COACH_PERFORMANCE_MANIFESTS)) {
      expect(manifest.coachId).toBe(coachId);
      expect(validateCoachPerformanceManifest(manifest)).toEqual([]);
      expect(manifest.basePath).toContain(`/${coachId}-chess-animations`);
      expect(manifest.animations.some(({ id }) => id === manifest.userIdleId)).toBe(true);
      expect(manifest.animations.some(({ id }) => id === manifest.boardIdleId)).toBe(true);
      expect(manifest.animations.some(({ id }) => id === manifest.toBoardId)).toBe(true);
      expect(manifest.animations.some(({ id }) => id === manifest.toUserId)).toBe(true);
    }
  });

  it('maps every manifest entry to a valid body animation and exact MHA-251 face clip', async () => {
    const io = new NodeIO();
    for (const manifest of Object.values(BUILTIN_COACH_PERFORMANCE_MANIFESTS)) {
      for (const definition of manifest.animations) {
        const bodyPath = path.join(process.cwd(), 'public', manifest.basePath, 'body', definition.bodyFile);
        const facePath = path.join(process.cwd(), 'public', manifest.basePath, 'face', definition.faceFile);
        expect(existsSync(bodyPath), `${manifest.coachId}:${definition.id} body`).toBe(true);
        expect(existsSync(facePath), `${manifest.coachId}:${definition.id} face`).toBe(true);
        const document = await io.read(bodyPath);
        const animations = document.getRoot().listAnimations();
        expect(animations.length, `${manifest.coachId}:${definition.id} body animations`).toBeGreaterThan(0);
        expect(animations[0].listChannels().length, `${manifest.coachId}:${definition.id} body channels`).toBeGreaterThan(0);
        const face = parseArjunFaceClip(JSON.parse(readFileSync(facePath, 'utf8')));
        expect(face.data.length).toBe(face.frameCount * 251);
        expect(face.duration).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});

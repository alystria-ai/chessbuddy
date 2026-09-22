import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  advancePortraitBlink,
  applyPortraitBlink,
  createPortraitBlinkState,
  getPortraitBlinkAmount,
  resetPortraitBlinkMorphs,
  RESTING_LID_DROOP,
} from './portraitBlink';
import { resetLipsyncTuning, setLipsyncTuningMode, setLipsyncTuningValue } from './lipsyncTuning';

beforeEach(() => resetLipsyncTuning());

describe('portraitBlink', () => {
  it('finishes an elapsed blink after a shader or loading stall', () => {
    const state = createPortraitBlinkState(0, 100);
    advancePortraitBlink(100, state);
    advancePortraitBlink(650, state);
    expect(getPortraitBlinkAmount(650, state)).toBe(0);
    expect(state.phase).toBe('idle');
  });

  it('stays open between scheduled blinks', () => {
    const state = createPortraitBlinkState(0, 5000);
    state.nextBlinkMs = 5000;
    advancePortraitBlink(1000, state);
    expect(state.phase).toBe('idle');
    expect(getPortraitBlinkAmount(1000, state)).toBe(0);
  });

  it('runs a close-open blink cycle', () => {
    const state = createPortraitBlinkState(0, 100);
    state.nextBlinkMs = 100;
    advancePortraitBlink(100, state);
    expect(state.phase).toBe('closing');
    expect(getPortraitBlinkAmount(140, state)).toBeGreaterThan(0.3);

    advancePortraitBlink(200, state);
    expect(state.phase).toBe('opening');
    expect(getPortraitBlinkAmount(250, state)).toBeLessThan(0.75);

    advancePortraitBlink(320, state);
    expect(state.phase).toBe('idle');
    expect(getPortraitBlinkAmount(320, state)).toBe(0);
    expect(state.nextBlinkMs).toBeGreaterThan(320);
  });

  it('keeps body blink in sync with eye meshes so lipsync cannot drag a blink shut', () => {
    const geometry = new THREE.BufferGeometry();
    const body = new THREE.SkinnedMesh(geometry);
    body.name = 'CC_Base_Body';
    body.morphTargetDictionary = { Eye_Blink_L: 0, Eye_Blink_R: 1 };
    body.morphTargetInfluences = [0.85, 0.85];

    const root = new THREE.Group();
    root.add(body);

    const state = createPortraitBlinkState(0, 0);
    state.phase = 'opening';
    state.phaseStartMs = 0;

    applyPortraitBlink(root, 200, state);
    // Blink morphs return fully to 0 — the resting droop lives on eyeRelax,
    // not on a held partial blink (a held blink pushed the lower lid up and
    // read as under-eye bags).
    expect(body.morphTargetInfluences[0]).toBe(0);
    expect(body.morphTargetInfluences[1]).toBe(0);
  });

  it('opens eye meshes after a blink instead of leaving them stuck shut', () => {
    const geometry = new THREE.BufferGeometry();
    const lashes = new THREE.SkinnedMesh(geometry);
    lashes.name = 'Lash_Up_Wavy';
    lashes.morphTargetDictionary = { Eye_Blink_L: 0, Eye_Blink_R: 1 };
    lashes.morphTargetInfluences = [1, 1];

    const root = new THREE.Group();
    root.add(lashes);

    const state = createPortraitBlinkState(0, 0);
    state.phase = 'opening';
    state.phaseStartMs = 0;

    applyPortraitBlink(root, 80, state);
    expect(lashes.morphTargetInfluences[0]).toBeLessThan(0.4);
    expect(lashes.morphTargetInfluences[1]).toBeLessThan(0.4);

    applyPortraitBlink(root, 200, state);
    expect(lashes.morphTargetInfluences[0]).toBe(0);
    expect(lashes.morphTargetInfluences[1]).toBe(0);
  });

  it('carries the resting droop on eyeRelax (upper lid only) and fades it during blinks', () => {
    const geometry = new THREE.BufferGeometry();
    const head = new THREE.SkinnedMesh(geometry);
    head.name = 'Mesh009';
    head.morphTargetDictionary = {
      CTRL_expressions_eyeBlinkL: 0,
      CTRL_expressions_eyeBlinkR: 1,
      CTRL_expressions_eyeRelaxL: 2,
      CTRL_expressions_eyeRelaxR: 3,
    };
    head.morphTargetInfluences = [0, 0, 0, 0];
    const root = new THREE.Group();
    root.add(head);

    // At rest: no blink, full droop on eyeRelax.
    const state = createPortraitBlinkState(0, 5000);
    applyPortraitBlink(root, 100, state);
    expect(head.morphTargetInfluences[0]).toBe(0);
    expect(head.morphTargetInfluences[2]).toBe(RESTING_LID_DROOP);
    expect(head.morphTargetInfluences[3]).toBe(RESTING_LID_DROOP);

    // Mid-blink: droop fades so the shapes never over-close additively.
    state.phase = 'closing';
    state.phaseStartMs = 100;
    applyPortraitBlink(root, 185, state); // full close (CLOSE_MS = 85)
    expect(head.morphTargetInfluences[0]).toBe(1);
    expect(head.morphTargetInfluences[2]).toBe(0);
  });

  it('applies blink morphs on every mesh that exposes them', () => {
    const geometry = new THREE.BufferGeometry();
    const body = new THREE.SkinnedMesh(geometry);
    body.name = 'CC_Base_Body';
    body.morphTargetDictionary = { Eye_Blink_L: 0, Eye_Blink_R: 1 };
    body.morphTargetInfluences = [0, 0];

    const lashes = new THREE.SkinnedMesh(geometry);
    lashes.name = 'Lash_Up_Wavy';
    lashes.morphTargetDictionary = { Eye_Blink_L: 0 };
    lashes.morphTargetInfluences = [0];

    const root = new THREE.Group();
    root.add(body, lashes);

    const state = createPortraitBlinkState(0, 0);
    state.phase = 'closing';
    state.phaseStartMs = 0;

    applyPortraitBlink(root, 50, state);

    expect(body.morphTargetInfluences[0]).toBeGreaterThan(0.2);
    expect(body.morphTargetInfluences[1]).toBeGreaterThan(0.2);
    expect(lashes.morphTargetInfluences[0]).toBeGreaterThan(0.2);
  });

  it('lets pure NeuroSync own blinking and exposes granular custom strength', () => {
    const geometry = new THREE.BufferGeometry();
    const head = new THREE.SkinnedMesh(geometry);
    head.morphTargetDictionary = {
      CTRL_expressions_eyeBlinkL: 0,
      CTRL_expressions_eyeBlinkR: 1,
      CTRL_expressions_eyeRelaxL: 2,
    };
    head.morphTargetInfluences = [0, 0, 0];
    const root = new THREE.Group();
    root.add(head);
    const state = createPortraitBlinkState(0, 0);
    state.phase = 'closing';
    state.phaseStartMs = 0;

    setLipsyncTuningMode('pure');
    applyPortraitBlink(root, 85, state);
    expect(head.morphTargetInfluences).toEqual([0, 0, 0]);

    setLipsyncTuningValue('blinkStrength', 0.5);
    state.phase = 'closing';
    state.phaseStartMs = 0;
    applyPortraitBlink(root, 85, state);
    expect(head.morphTargetInfluences[0]).toBeCloseTo(0.5, 5);
  });

  it('clears eye blink morphs on reset without touching the body mesh', () => {
    const geometry = new THREE.BufferGeometry();
    const body = new THREE.SkinnedMesh(geometry);
    body.name = 'CC_Base_Body';
    body.morphTargetDictionary = { Eye_Blink_L: 0 };
    body.morphTargetInfluences = [0.6];

    const lashes = new THREE.SkinnedMesh(geometry);
    lashes.name = 'Lash_Up_Wavy';
    lashes.morphTargetDictionary = { Eye_Blink_L: 0 };
    lashes.morphTargetInfluences = [0.9];

    const root = new THREE.Group();
    root.add(body, lashes);
    resetPortraitBlinkMorphs(root);

    expect(body.morphTargetInfluences[0]).toBe(0.6);
    expect(lashes.morphTargetInfluences[0]).toBe(0);
  });
});

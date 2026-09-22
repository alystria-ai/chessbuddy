import { describe, expect, it } from 'vitest';
import { CONVAI_MHA_CHANNEL_ORDER } from './convaiMhaLipsync';
import {
  createArjunLightSmile,
  dampenArjunPlayerFacingEyeLook,
  isArjunSpeechChannel,
  parseArjunFaceClip,
  sampleArjunFaceClip,
  scaleAuthoredBlink,
  scaleAuthoredDirectionalEyeLook,
  selectWeightedArjunAmbientGesture,
  shouldPlayArjunWinReaction,
  stepArjunAuthoredFaceStrength,
} from './arjunChessAnimations';

function faceFixture() {
  return {
    fps: 2,
    frameCount: 2,
    targetCount: 251,
    curves: Object.fromEntries(CONVAI_MHA_CHANNEL_ORDER.map((name, index) => [name, [index ? 0 : -0.2, index ? 1 : 1.2]])),
  };
}

describe('Arjun chess animations', () => {
  it('parses the exact named MHA-251 curve set and clamps exported overshoot', () => {
    const clip = parseArjunFaceClip(faceFixture());
    expect(clip.frameCount).toBe(2);
    expect(clip.duration).toBe(0.5);
    expect(clip.data[0]).toBe(0);
    expect(clip.data[251]).toBe(1);
  });

  it('rejects an incomplete face contract', () => {
    const fixture = faceFixture();
    delete fixture.curves[CONVAI_MHA_CHANNEL_ORDER[0]];
    expect(() => parseArjunFaceClip(fixture)).toThrow(/channel mismatch/);
  });

  it('samples between authored frames without allocating a replacement array', () => {
    const clip = parseArjunFaceClip(faceFixture());
    const output = new Float32Array(251);
    expect(sampleArjunFaceClip(clip, 0.25, output)).toBe(output);
    expect(output[1]).toBeCloseTo(0.5);
  });

  it('keeps the long user idle looking at the player without flattening blinks or expressions', () => {
    const fixture = faceFixture();
    fixture.curves.CTRL_expressions_eyeLookLeftL = [0.6, 0.4];
    fixture.curves.CTRL_expressions_eyeLookRightR = [0.5, 0.3];
    fixture.curves.CTRL_expressions_eyeLookDownL = [0.4, 0.2];
    fixture.curves.CTRL_expressions_eyeBlinkL = [0.2, 0.8];
    const source = parseArjunFaceClip(fixture);
    const centered = dampenArjunPlayerFacingEyeLook(source);
    const lookLeft = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeLookLeftL');
    const lookRight = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeLookRightR');
    const lookDown = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeLookDownL');
    const blink = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkL');
    expect(centered.data[lookLeft]).toBeCloseTo(0.28);
    expect(centered.data[lookRight]).toBeCloseTo(0.025);
    expect(centered.data[lookDown]).toBeCloseTo(0.02);
    expect(centered.data[blink]).toBe(source.data[blink]);
    expect(centered.data).not.toBe(source.data);
  });

  it('can return authored gaze to neutral without changing lids or expressions', () => {
    const fixture = faceFixture();
    fixture.curves.CTRL_expressions_eyeLookLeftL = [0.6, 0.4];
    fixture.curves.CTRL_expressions_eyeLookRightR = [0.5, 0.3];
    fixture.curves.CTRL_expressions_eyeLookUpL = [0.4, 0.2];
    fixture.curves.CTRL_expressions_eyeBlinkL = [0.2, 0.8];
    fixture.curves.CTRL_expressions_mouthCornerPullL = [0.1, 0.4];
    const source = parseArjunFaceClip(fixture);
    const neutral = scaleAuthoredDirectionalEyeLook(source, 0);
    const blink = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkL');
    const smile = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_mouthCornerPullL');
    for (const name of CONVAI_MHA_CHANNEL_ORDER.filter((channel) => /eyeLook(?:Left|Right|Up|Down)[LR]$/i.test(channel))) {
      const channel = CONVAI_MHA_CHANNEL_ORDER.indexOf(name);
      expect(neutral.data[channel]).toBe(0);
      expect(neutral.data[251 + channel]).toBe(0);
    }
    expect(neutral.data[blink]).toBe(source.data[blink]);
    expect(neutral.data[smile]).toBe(source.data[smile]);
    expect(neutral.data).not.toBe(source.data);
  });

  it('can hand authored blink drivers to the full-close layer without flattening the face', () => {
    const fixture = faceFixture();
    fixture.curves.CTRL_expressions_eyeBlinkL = [0.64, 0.4];
    fixture.curves.CTRL_expressions_eyeBlinkR = [0.79, 0.5];
    fixture.curves.CTRL_expressions_eyeSquintInnerL = [0.2, 0.3];
    fixture.curves.CTRL_expressions_mouthCornerPullL = [0.1, 0.4];
    const source = parseArjunFaceClip(fixture);
    const neutral = scaleAuthoredBlink(source, 0);
    const blinkL = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkL');
    const blinkR = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeBlinkR');
    const squint = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeSquintInnerL');
    const smile = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_mouthCornerPullL');
    expect(neutral.data[blinkL]).toBe(0);
    expect(neutral.data[blinkR]).toBe(0);
    expect(neutral.data[251 + blinkL]).toBe(0);
    expect(neutral.data[251 + blinkR]).toBe(0);
    expect(neutral.data[squint]).toBe(source.data[squint]);
    expect(neutral.data[smile]).toBe(source.data[smile]);
  });

  it('keeps ambient gestures player-facing and reserves thumbs-up for victory', () => {
    expect(selectWeightedArjunAmbientGesture(0).id).toBe('userHead');
    expect(selectWeightedArjunAmbientGesture(0.99).id).toBe('userShoulder');
    for (const random of [0, 0.2, 0.5, 0.8, 0.999]) {
      const gesture = selectWeightedArjunAmbientGesture(random);
      expect(gesture.state).toBe('user');
      expect(gesture.id).not.toBe('userLike');
    }
  });

  it('allows thumbs-up only for a quiet, player-facing victory', () => {
    const ready = {
      playerWon: true,
      alreadyPlayed: false,
      stableState: 'user' as const,
      currentKind: 'idle' as const,
      isSpeaking: false,
      responseThinking: false,
      userSpeaking: false,
      userEngaged: false,
    };
    expect(shouldPlayArjunWinReaction(ready)).toBe(true);
    expect(shouldPlayArjunWinReaction({ ...ready, playerWon: false })).toBe(false);
    expect(shouldPlayArjunWinReaction({ ...ready, alreadyPlayed: true })).toBe(false);
    expect(shouldPlayArjunWinReaction({ ...ready, stableState: 'board' })).toBe(false);
    expect(shouldPlayArjunWinReaction({ ...ready, isSpeaking: true })).toBe(false);
  });

  it('hands the face to live lip sync quickly without a frame-rate-dependent jump', () => {
    let strength = 1;
    for (let frame = 0; frame < 30; frame += 1) {
      strength = stepArjunAuthoredFaceStrength(strength, true, 1 / 60);
    }
    expect(strength).toBeLessThan(0.02);
    for (let frame = 0; frame < 60; frame += 1) {
      strength = stepArjunAuthoredFaceStrength(strength, false, 1 / 60);
    }
    expect(strength).toBeGreaterThan(0.99);
  });

  it('identifies facial speech channels that must remain owned by live lip sync', () => {
    expect(isArjunSpeechChannel('CTRL_expressions_jawOpen')).toBe(true);
    expect(isArjunSpeechChannel('CTRL_expressions_mouthLipsPressL')).toBe(true);
    expect(isArjunSpeechChannel('CTRL_expressions_eyeBlinkL')).toBe(false);
  });

  it('rebases the authored nonzero jaw neutral instead of exposing idle teeth', () => {
    const fixture = faceFixture();
    const jaw = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_jawOpen');
    fixture.curves.CTRL_expressions_jawOpen = [0.14, 0.17];
    const clip = parseArjunFaceClip(fixture);
    expect(clip.data[jaw]).toBe(0);
    expect(clip.data[251 + jaw]).toBeCloseTo(0.03);
  });

  it('derives a symmetric light smile without opening the jaw', () => {
    const fixture = faceFixture();
    fixture.curves.CTRL_expressions_mouthCornerPullL = [0, 0.6];
    fixture.curves.CTRL_expressions_mouthCornerPullR = [0, 0.2];
    fixture.curves.CTRL_expressions_mouthDimpleL = [0, 0.8];
    fixture.curves.CTRL_expressions_mouthDimpleR = [0, 0.4];
    fixture.curves.CTRL_expressions_eyeCheekRaiseL = [0, 0.7];
    fixture.curves.CTRL_expressions_eyeCheekRaiseR = [0, 0.2];
    fixture.curves.CTRL_expressions_eyeSquintInnerL = [0, 0.4];
    fixture.curves.CTRL_expressions_eyeSquintInnerR = [0, 0.1];
    fixture.curves.CTRL_expressions_jawOpen = [0.14, 0.3];
    const smile = createArjunLightSmile(parseArjunFaceClip(fixture));
    const pullL = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_mouthCornerPullL');
    const pullR = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_mouthCornerPullR');
    const cheekL = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeCheekRaiseL');
    const cheekR = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeCheekRaiseR');
    const squintL = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeSquintInnerL');
    const squintR = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_eyeSquintInnerR');
    const jaw = CONVAI_MHA_CHANNEL_ORDER.indexOf('CTRL_expressions_jawOpen');
    expect(smile[pullL]).toBeGreaterThan(0);
    expect(smile[pullL]).toBeCloseTo(smile[pullR], 6);
    expect(smile[cheekL]).toBeGreaterThanOrEqual(0.1);
    expect(smile[cheekL]).toBeCloseTo(smile[cheekR], 6);
    expect(smile[squintL]).toBeGreaterThan(0);
    expect(smile[squintL]).toBeCloseTo(smile[squintR], 6);
    expect(smile[jaw]).toBe(0);
  });
});

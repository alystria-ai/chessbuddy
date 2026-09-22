import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ARJUN_GESTURE_GAP_MAX_SECONDS,
  ARJUN_GESTURE_GAP_MIN_SECONDS,
  createArjunLightSmile,
  dampenArjunPlayerFacingEyeLook,
  parseArjunFaceClip,
  sampleArjunFaceClip,
  scaleAuthoredBlink,
  scaleAuthoredDirectionalEyeLook,
  shouldPlayArjunWinReaction,
  stepArjunAuthoredFaceStrength,
  type ArjunFaceClip,
} from './arjunChessAnimations';
import {
  coachPerformanceBodyUrl,
  coachPerformanceFaceUrl,
  getAuthoredEyeLookGain,
  getCoachPerformanceManifest,
  getPlayerFacingPerformanceAnimations,
  selectWeightedCoachGesture,
  type CoachPerformanceAnimationDefinition,
} from './coachChessAnimations';
import type { BuiltinCoachId } from './coachConfig';
import { CONVAI_MHA_CHANNEL_ORDER } from './convaiMhaLipsync';
import { debugLog } from './debugLog';
import { normalizeName } from './mhaToMorphMap';
import { sanitizeAuthoredPerformanceClip } from './sanitizeIdleClip';
import {
  applyArjunPlayerHeadCorrection,
  createArjunPlayerHeadCorrection,
  restoreArjunPlayerHeadCorrection,
} from './arjunHeadCorrection';
import { getLipsyncTuningValuesForCoach } from './lipsyncTuning';

type FaceBinding = {
  influences: number[] | Float32Array;
  slots: Int16Array;
};

/**
 * Commit one complete authored-face frame. An ownership gap must write zeroes
 * instead of leaving the previous gesture's eye pose resident in the mesh.
 */
export function commitAuthoredFaceOutput(
  bindings: readonly FaceBinding[],
  output: Float32Array,
  hasActiveFrame: boolean,
): void {
  if (!hasActiveFrame) output.fill(0);
  for (const binding of bindings) {
    for (let channel = 0; channel < output.length; channel += 1) {
      const slot = binding.slots[channel];
      if (slot >= 0) binding.influences[slot] = output[channel];
    }
  }
}

type Props = {
  coachId: BuiltinCoachId;
  rootRef: RefObject<THREE.Group>;
  scene: THREE.Object3D;
  isSpeaking: boolean;
  responseThinking: boolean;
  userSpeaking: boolean;
  userEngaged: boolean;
  playerWon: boolean;
  onBodyReady: (ready: boolean) => void;
  onFaceReady: (ready: boolean, settled: boolean) => void;
};

const CHANNEL_COUNT = CONVAI_MHA_CHANNEL_ORDER.length;
const CROSSFADE_SECONDS = 0.24;

function coachAnimationRandom(coachId: BuiltinCoachId): number {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('coachRandom')
      ?? (coachId === 'arjun' ? params.get('arjunRandom') : null);
    const fixed = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(fixed)) return THREE.MathUtils.clamp(fixed, 0, 0.999999);
  }
  return Math.random();
}

export default function CoachChessPerformance({
  coachId,
  rootRef,
  scene,
  isSpeaking,
  responseThinking,
  userSpeaking,
  userEngaged,
  playerWon,
  onBodyReady,
  onFaceReady,
}: Props) {
  const { gl } = useThree();
  const manifest = useMemo(() => {
    const resolved = getCoachPerformanceManifest(coachId);
    if (!resolved) throw new Error(`No authored chess performance for ${coachId}`);
    return resolved;
  }, [coachId]);
  const runtimeDefinitions = useMemo(
    () => getPlayerFacingPerformanceAnimations(manifest),
    [manifest],
  );
  const byId = useMemo(
    () => new Map(runtimeDefinitions.map((definition) => [definition.id, definition])),
    [runtimeDefinitions],
  );
  const essentialDefinitions = useMemo(
    () => runtimeDefinitions.filter(
      ({ id, kind }) => kind !== 'gesture'
        || id === manifest.victoryGestureId
        || id === manifest.smileSourceId,
    ),
    [manifest.smileSourceId, manifest.victoryGestureId, runtimeDefinitions],
  );
  const essentialFaceDefinitions = essentialDefinitions;
  const gestureDefinitions = useMemo(
    () => runtimeDefinitions
      .filter(({ id, kind }) => kind === 'gesture'
        && id !== manifest.victoryGestureId
        && id !== manifest.smileSourceId)
      .sort((left, right) => left.id.localeCompare(right.id)),
    [manifest.smileSourceId, manifest.victoryGestureId, runtimeDefinitions],
  );
  const essentialBodyUrls = useMemo(
    () => essentialDefinitions.map((definition) => coachPerformanceBodyUrl(manifest, definition)),
    [essentialDefinitions, manifest],
  );
  const gltfs = useGLTF(essentialBodyUrls) as unknown as Array<{ animations: THREE.AnimationClip[] }>;
  const clips = useMemo(() => {
    return essentialDefinitions.map((definition, index) => {
      const source = gltfs[index]?.animations?.[0];
      if (!source) throw new Error(`${coachId} body clip ${definition.id} has no animation`);
      return sanitizeAuthoredPerformanceClip(source, definition.id, scene, {
        lockPlayerFacingBody: manifest.lockPlayerFacingBody,
      });
    });
  }, [coachId, essentialDefinitions, gltfs, manifest.lockPlayerFacingBody, scene]);
  const { actions, mixer } = useAnimations(clips, rootRef);
  const [faceClips, setFaceClips] = useState<Map<string, ArjunFaceClip> | null>(null);
  const actionMap = useRef(new Map<string, THREE.AnimationAction>());
  const gestureClips = useRef<THREE.AnimationClip[]>([]);
  const faceBindings = useMemo(() => {
    const bindings: FaceBinding[] = [];
    scene.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      const byNormalizedName = new Map<string, number>();
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        byNormalizedName.set(normalizeName(name), index);
      }
      const slots = new Int16Array(CHANNEL_COUNT).fill(-1);
      let matched = 0;
      CONVAI_MHA_CHANNEL_ORDER.forEach((name, channel) => {
        const slot = byNormalizedName.get(normalizeName(name));
        if (slot === undefined) return;
        slots[channel] = slot;
        matched += 1;
      });
      if (matched) bindings.push({ influences: mesh.morphTargetInfluences, slots });
    });
    return bindings;
  }, [scene]);
  const headCorrection = useMemo(() => createArjunPlayerHeadCorrection(scene), [scene]);

  const runtime = useRef({
    elapsed: 0,
    currentId: manifest.userIdleId,
    nextGestureAt: ARJUN_GESTURE_GAP_MIN_SECONDS,
    gesturePlayCount: 0,
    winReactionPlayed: false,
  });
  const signals = useRef({
    isSpeaking,
    responseThinking,
    userSpeaking,
    userEngaged,
    playerWon,
  });
  signals.current = {
    isSpeaking,
    responseThinking,
    userSpeaking,
    userEngaged,
    playerWon,
  };
  const faceOutput = useRef(new Float32Array(CHANNEL_COUNT));
  const faceScratch = useRef(new Float32Array(CHANNEL_COUNT));
  const lightSmile = useMemo(() => {
    const source = manifest.smileSourceId ? faceClips?.get(manifest.smileSourceId) : null;
    return source ? createArjunLightSmile(source) : null;
  }, [faceClips, manifest.smileSourceId]);
  const faceStrength = useRef(1);
  const debugLocked = useRef(false);
  const datasetKeys = useMemo(() => ({
    attention: `${coachId}Attention`,
    animation: `${coachId}Animation`,
    bodyReady: `${coachId}BodyReady`,
    faceReady: `${coachId}FaceReady`,
    gestureCount: `${coachId}GestureCount`,
    gesturePlays: `${coachId}GesturePlays`,
    headYaw: `${coachId}HeadYaw`,
    headPitch: `${coachId}HeadPitch`,
    headRoll: `${coachId}HeadRoll`,
  }), [coachId]);

  useEffect(() => () => {
    if (headCorrection) restoreArjunPlayerHeadCorrection(headCorrection);
    delete gl.domElement.dataset[datasetKeys.headYaw];
    delete gl.domElement.dataset[datasetKeys.headPitch];
    delete gl.domElement.dataset[datasetKeys.headRoll];
  }, [datasetKeys, gl, headCorrection]);

  // Remove our previous additive pose before Drei's animation mixer evaluates
  // the next authored body frame. This prevents accumulation and also avoids
  // the load-time ownership handoff that briefly exposed the left-biased raw
  // clip pose before the common Chessbuddy head correction took over.
  useFrame(() => {
    if (headCorrection) restoreArjunPlayerHeadCorrection(headCorrection);
  }, -1.5);

  // Apply only a head correction after the mixer. Do not write eye bones or
  // eye-look morphs: the supplied face animation and live MHA-251 frame retain
  // exclusive ownership of the coach's eyes.
  useFrame(() => {
    if (!headCorrection) return;
    const tuning = getLipsyncTuningValuesForCoach(coachId);
    const rollDegrees = manifest.headRollDegrees ?? 0;
    applyArjunPlayerHeadCorrection(
      headCorrection,
      tuning.headYawDegrees,
      tuning.headPitchDegrees,
      rollDegrees,
    );
    gl.domElement.dataset[datasetKeys.headYaw] = tuning.headYawDegrees.toFixed(0);
    gl.domElement.dataset[datasetKeys.headPitch] = tuning.headPitchDegrees.toFixed(0);
    gl.domElement.dataset[datasetKeys.headRoll] = rollDegrees.toFixed(1);
  }, 0.5);

  useEffect(() => {
    for (const definition of essentialFaceDefinitions) {
      const action = actions[definition.id];
      if (action) actionMap.current.set(definition.id, action);
    }
  }, [actions]);

  const play = useCallback((definition: CoachPerformanceAnimationDefinition, fade = CROSSFADE_SECONDS) => {
    const next = actionMap.current.get(definition.id);
    if (!next) return false;
    const effectiveFade = definition.id === manifest.victoryGestureId
      ? 0.4
      : definition.kind === 'gesture' ? 0.3 : fade;
    for (const action of actionMap.current.values()) {
      // LoopOnce + clampWhenFinished leaves a completed gesture paused at its
      // last frame. isRunning() is false in that state, but its full weight is
      // still contributing to the mixer. Fade paused actions too, otherwise
      // the new idle and the frozen gesture fight at weight 1 and visibly snap.
      if (action === next || (!action.isRunning() && !action.paused)) continue;
      action.fadeOut(effectiveFade);
    }
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.clampWhenFinished = !definition.loop;
    next.setLoop(definition.loop ? THREE.LoopRepeat : THREE.LoopOnce, definition.loop ? Infinity : 1);
    next.fadeIn(effectiveFade).play();
    runtime.current.currentId = definition.id;
    if (definition.kind === 'gesture') {
      runtime.current.gesturePlayCount += 1;
      gl.domElement.dataset[datasetKeys.gesturePlays] = String(runtime.current.gesturePlayCount);
    }
    debugLog('CoachAnimation', `coach=${coachId} playing ${definition.id} (${definition.kind}, ${definition.state})`);
    return true;
  }, [coachId, datasetKeys.gesturePlays, gl, manifest.victoryGestureId]);

  const playIdle = useCallback(() => {
    const definition = byId.get(manifest.userIdleId);
    if (!definition || !play(definition)) return;
    runtime.current.nextGestureAt = runtime.current.elapsed
      + THREE.MathUtils.lerp(
        ARJUN_GESTURE_GAP_MIN_SECONDS,
        ARJUN_GESTURE_GAP_MAX_SECONDS,
        coachAnimationRandom(coachId),
      );
  }, [byId, coachId, manifest.userIdleId, play]);

  useEffect(() => {
    playIdle();
    onBodyReady(true);
    gl.domElement.dataset[datasetKeys.bodyReady] = 'true';
    gl.domElement.dataset[datasetKeys.gesturePlays] = '0';
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      const finished = manifest.animations.find(({ id }) => actionMap.current.get(id) === event.action);
      if (!finished || runtime.current.currentId !== finished.id) return;
      playIdle();
    };
    mixer.addEventListener('finished', onFinished);
    return () => {
      onBodyReady(false);
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      delete gl.domElement.dataset[datasetKeys.bodyReady];
      delete gl.domElement.dataset[datasetKeys.gesturePlays];
    };
  }, [byId, coachId, datasetKeys, gl, manifest, mixer, onBodyReady, play, playIdle]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(essentialFaceDefinitions.map(async (definition) => {
      const url = coachPerformanceFaceUrl(manifest, definition);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const parsed = parseArjunFaceClip(await response.json());
      const authoredEyeLookGain = getAuthoredEyeLookGain(manifest, definition.id);
      const gazeSafe = authoredEyeLookGain === undefined
        ? parsed
        : scaleAuthoredDirectionalEyeLook(parsed, authoredEyeLookGain);
      const blinkSafe = manifest.authoredBlinkGain === undefined
        ? gazeSafe
        : scaleAuthoredBlink(gazeSafe, manifest.authoredBlinkGain);
      const face = definition.id === manifest.userIdleId
        && manifest.playerFacingEyeGain !== undefined
        ? dampenArjunPlayerFacingEyeLook(blinkSafe, manifest.playerFacingEyeGain)
        : blinkSafe;
      return [definition.id, face] as const;
    })).then((entries) => {
      if (controller.signal.aborted) return;
      // Gesture streaming may already have begun on a slow connection. Merge
      // instead of replacing so an early background-loaded face clip cannot be
      // discarded when the essential set finishes.
      setFaceClips((current) => new Map([...(current ?? []), ...entries]));
      onFaceReady(true, true);
      gl.domElement.dataset[datasetKeys.faceReady] = 'true';
      debugLog('CoachAnimation', `coach=${coachId} loaded ${entries.length} essential synchronized MHA-251 face clips`);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      onFaceReady(false, true);
      gl.domElement.dataset[datasetKeys.faceReady] = 'fallback';
      debugLog('CoachAnimation', `coach=${coachId} face clips unavailable; keeping safe procedural face: ${String(error)}`);
    });
    return () => {
      controller.abort();
      onFaceReady(false, false);
      delete gl.domElement.dataset[datasetKeys.faceReady];
    };
  }, [coachId, datasetKeys.faceReady, essentialFaceDefinitions, gl, manifest, onFaceReady]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const loadGestures = async () => {
      const loader = new GLTFLoader();
      for (const definition of gestureDefinitions) {
        if (cancelled || !rootRef.current) return;
        try {
          const [gltf, faceResponse] = await Promise.all([
            loader.loadAsync(coachPerformanceBodyUrl(manifest, definition)),
            fetch(coachPerformanceFaceUrl(manifest, definition), { signal: controller.signal }),
          ]);
          if (!faceResponse.ok) throw new Error(`HTTP ${faceResponse.status} for ${definition.faceFile}`);
          const source = gltf.animations[0];
          if (!source) throw new Error(`${definition.bodyFile} has no animation`);
          const clip = sanitizeAuthoredPerformanceClip(source, definition.id, scene, {
            lockPlayerFacingBody: manifest.lockPlayerFacingBody,
          });
          const action = mixer.clipAction(clip, rootRef.current);
          gestureClips.current.push(clip);
          actionMap.current.set(definition.id, action);
          const parsed = parseArjunFaceClip(await faceResponse.json());
          const authoredEyeLookGain = getAuthoredEyeLookGain(manifest, definition.id);
          const gazeSafe = authoredEyeLookGain === undefined
            ? parsed
            : scaleAuthoredDirectionalEyeLook(parsed, authoredEyeLookGain);
          const face = manifest.authoredBlinkGain === undefined
            ? gazeSafe
            : scaleAuthoredBlink(gazeSafe, manifest.authoredBlinkGain);
          setFaceClips((current) => new Map(current ?? []).set(definition.id, face));
          debugLog('CoachAnimation', `coach=${coachId} background-loaded gesture ${definition.id}`);
        } catch (error) {
          if (!cancelled && !controller.signal.aborted) {
            debugLog('CoachAnimation', `coach=${coachId} skipped gesture ${definition.id}: ${String(error)}`);
          }
        }
      }
      if (!cancelled) gl.domElement.dataset[datasetKeys.gestureCount] = String(gestureClips.current.length);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const handle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(() => void loadGestures(), { timeout: 3_000 })
      : window.setTimeout(() => void loadGestures(), 1_500);
    return () => {
      cancelled = true;
      controller.abort();
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      for (const clip of gestureClips.current) mixer.uncacheClip(clip);
      gestureClips.current = [];
      delete gl.domElement.dataset[datasetKeys.gestureCount];
    };
  }, [coachId, datasetKeys.gestureCount, gestureDefinitions, gl, manifest, mixer, rootRef, scene]);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    type AnimationDebugApi = {
      playClip: (id: string, progress?: number) => boolean;
      release: () => void;
      available: () => string[];
      snapshot: () => Array<{
        id: string;
        clip: string;
        uuid: string;
        time: number;
        duration: number;
        weight: number;
        enabled: boolean;
        paused: boolean;
        running: boolean;
      }>;
    };
    const debugWindow = window as typeof window & {
      __chessCoachAnimationDebug?: AnimationDebugApi;
      __chessArjunAnimationDebug?: AnimationDebugApi;
    };
    const api = {
      playClip: (id: string, progress = 0.5) => {
        const action = actionMap.current.get(id);
        const definition = byId.get(id);
        if (!action || !definition) return false;
        debugLocked.current = true;
        for (const candidate of actionMap.current.values()) candidate.stop();
        action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
        action.time = THREE.MathUtils.clamp(progress, 0, 0.999) * action.getClip().duration;
        action.paused = true;
        mixer.update(0);
        runtime.current.currentId = id;
        gl.domElement.dataset[datasetKeys.attention] = 'user';
        gl.domElement.dataset[datasetKeys.animation] = id;
        return true;
      },
      release: () => {
        debugLocked.current = false;
        for (const candidate of actionMap.current.values()) candidate.paused = false;
        playIdle();
      },
      available: () => [...actionMap.current.keys()],
      snapshot: () => runtimeDefinitions.flatMap(({ id }) => {
        const action = actionMap.current.get(id);
        return action ? [{
          id,
          clip: action.getClip().name,
          uuid: action.getClip().uuid,
          time: action.time,
          duration: action.getClip().duration,
          weight: action.getEffectiveWeight(),
          enabled: action.enabled,
          paused: action.paused,
          running: action.isRunning(),
        }] : [];
      }),
    };
    debugWindow.__chessCoachAnimationDebug = api;
    if (coachId === 'arjun') debugWindow.__chessArjunAnimationDebug = api;
    return () => {
      if (debugWindow.__chessCoachAnimationDebug === api) delete debugWindow.__chessCoachAnimationDebug;
      if (debugWindow.__chessArjunAnimationDebug === api) delete debugWindow.__chessArjunAnimationDebug;
    };
  }, [byId, coachId, datasetKeys, gl, mixer, playIdle, runtimeDefinitions]);

  useFrame((_, delta) => {
    const state = runtime.current;
    const signal = signals.current;
    state.elapsed += Math.min(delta, 0.1);
    gl.domElement.dataset[datasetKeys.attention] = 'user';
    gl.domElement.dataset[datasetKeys.animation] = state.currentId;
    if (debugLocked.current) return;
    if (!signal.playerWon) state.winReactionPlayed = false;
    const currentDefinition = byId.get(state.currentId);
    if (shouldPlayArjunWinReaction({
      playerWon: signal.playerWon,
      alreadyPlayed: state.winReactionPlayed,
      stableState: 'user',
      currentKind: currentDefinition?.kind,
      isSpeaking: signal.isSpeaking,
      responseThinking: signal.responseThinking,
      userSpeaking: signal.userSpeaking,
      userEngaged: signal.userEngaged,
    })) {
      const victoryGesture = manifest.victoryGestureId
        ? byId.get(manifest.victoryGestureId)
        : undefined;
      if (victoryGesture && play(victoryGesture)) {
        state.winReactionPlayed = true;
        return;
      }
    }
    if (
      currentDefinition?.kind === 'idle'
      && state.elapsed >= state.nextGestureAt
      && !signal.isSpeaking
      && !signal.userSpeaking
      && !signal.userEngaged
    ) {
      const gesture = selectWeightedCoachGesture(manifest, 'user', coachAnimationRandom(coachId));
      if (gesture) play(gesture);
    }
  }, 0.25);

  useFrame((_, delta) => {
    if (import.meta.env.DEV) {
      const action = actionMap.current.get(runtime.current.currentId);
      gl.domElement.dataset.portraitAnimationTime = action?.time.toFixed(3) ?? '';
    }
    if (!faceClips || !faceBindings.length) return;
    const output = faceOutput.current;
    const scratch = faceScratch.current;
    output.fill(0);
    let totalWeight = 0;
    for (const definition of runtimeDefinitions) {
      const action = actionMap.current.get(definition.id);
      const face = faceClips.get(definition.id);
      if (!action || !face || !action.enabled) continue;
      const weight = action.getEffectiveWeight();
      if (weight <= 0.0001) continue;
      const bodyDuration = Math.max(action.getClip().duration, 0.001);
      const normalizedFaceTime = (action.time / bodyDuration) * face.duration;
      sampleArjunFaceClip(face, normalizedFaceTime, scratch);
      for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) output[channel] += scratch[channel] * weight;
      totalWeight += weight;
    }
    const hasActiveFrame = totalWeight > 0.0001;
    if (hasActiveFrame) {
      faceStrength.current = stepArjunAuthoredFaceStrength(faceStrength.current, isSpeaking, delta);
      const inverseWeight = totalWeight > 1 ? 1 / totalWeight : 1;
      for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
        output[channel] = THREE.MathUtils.clamp(
          output[channel] * inverseWeight * faceStrength.current,
          0,
          1,
        );
      }
      if (lightSmile) {
        for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
          output[channel] = Math.max(output[channel], lightSmile[channel] * faceStrength.current);
        }
      }
    }
    commitAuthoredFaceOutput(faceBindings, output, hasActiveFrame);
  }, 0.75);

  return null;
}

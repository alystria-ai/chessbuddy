const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const lerp = (a, b, alpha) => a + (b - a) * alpha;

export async function loadConvaiLipsyncKit(baseUrl = ".") {
  const setup = await fetch(`${baseUrl}/Lipsynic-setup.json`).then(response => {
    if (!response.ok) throw new Error(`LipSync setup failed: ${response.status}`);
    return response.json();
  });
  const order = await fetch(new URL(setup.transport.channelOrderFile, `${location.origin}${location.pathname}`)).then(response => response.json());
  let unityMap = null;
  const unityFile = setup.presets.unity441Parity?.mapping?.file;
  if (unityFile) unityMap = await fetch(`${baseUrl}/${unityFile.replace(/^\.\//, "")}`).then(response => response.json());
  return { setup, channelOrder: order.channels, unityMap };
}

export class ConvaiMhaLipsync {
  constructor({ scene, channelOrder, setup, unityMap = null, presetName = setup.defaultPreset }) {
    if (!scene?.traverse) throw new Error("A Three.js-compatible scene.traverse function is required.");
    if (!Array.isArray(channelOrder) || channelOrder.length !== 251) throw new Error("MHA requires exactly 251 ordered channels.");
    this.order = channelOrder;
    this.setup = setup;
    this.preset = setup.presets[presetName];
    if (!this.preset) throw new Error(`Unknown lip-sync preset: ${presetName}`);
    this.targets = new Map();
    this.target = new Float32Array(251);
    this.current = new Float32Array(251);
    this.applied = new Float32Array(251);
    this.interpolated = new Float32Array(251);
    this.accumulator = 0;
    this.fadeAlpha = 0;
    this.hasTarget = false;
    this.diagnostics = { rejectedValues: 0, missingChannels: [], coverage: 0 };
    this.routes = this.#compileRoutes(unityMap);
    this.unityMap = unityMap;
    scene.traverse(object => this.#indexMesh(object));
    this.diagnostics.missingChannels = this.order.filter(name => !this.targets.has(name));
    this.diagnostics.coverage = (251 - this.diagnostics.missingChannels.length) / 251;
  }

  #indexMesh(object) {
    const dictionary = object?.morphTargetDictionary;
    const influences = object?.morphTargetInfluences;
    if (!dictionary || !Array.isArray(influences)) return;
    if (this.setup.runtimeSafety.disableFrustumCullingOnMorphedMeshes) object.frustumCulled = false;
    for (const [name, index] of Object.entries(dictionary)) {
      if (!this.targets.has(name)) this.targets.set(name, []);
      this.targets.get(name).push({ object, index });
    }
  }

  #compileRoutes(unityMap) {
    if (this.preset.mapping.mode !== "mappingFile" || !unityMap) return null;
    return new Map(unityMap.mappings.filter(route => route.enabled).map(route => [route.source, route]));
  }

  #mappedValue(index, raw) {
    const name = this.order[index];
    let value = clamp01(raw);
    if (!Number.isFinite(Number(raw))) this.diagnostics.rejectedValues += 1;
    const map = this.preset.mapping;
    if (map.mode === "mappingFile" && this.routes) {
      const route = this.routes.get(name);
      if (!route) return 0;
      if (route.useOverrideValue) value = route.overrideValue;
      else {
        const shaped = Math.pow(value, route.curveExponent ?? 1);
        const globalMultiplier = route.ignoreGlobalModifiers ? 1 : (this.unityMap?.globalMultiplier ?? 1);
        const globalOffset = route.ignoreGlobalModifiers ? 0 : (this.unityMap?.globalOffset ?? 0);
        value = shaped * (route.multiplier ?? 1) * globalMultiplier + (route.offset ?? 0) + globalOffset;
      }
      return Math.max(route.clampMinValue ?? 0, Math.min(route.clampMaxValue ?? 1, value));
    }
    value = value * map.globalMultiplier + map.globalOffset;
    if (name === map.jawOpen?.name) {
      value = clamp01(raw) * map.jawOpen.multiplier * map.globalMultiplier + map.globalOffset;
      value = Math.max(map.jawOpen.min, Math.min(map.jawOpen.max, value));
    }
    const alpha = map.upperFaceChannels?.includes(name) ? map.upperFaceAlpha : map.lowerFaceAlpha;
    return clamp01(value * alpha);
  }

  setTargetFrame(frame) {
    if (!frame?.length) return false;
    for (let index = 0; index < 251; index += 1) this.target[index] = this.#mappedValue(index, frame[index] ?? 0);
    this.hasTarget = true;
    return true;
  }

  interpolate(frameA, frameB, alpha) {
    if (!frameA) return null;
    if (!this.preset.interpolation.enabled || !frameB) return frameA;
    for (let index = 0; index < 251; index += 1) {
      this.interpolated[index] = lerp(Number(frameA[index]) || 0, Number(frameB[index]) || 0, clamp01(alpha));
    }
    return this.interpolated;
  }

  removePreviousContribution() {
    if (this.preset.application.mode !== "add") return;
    for (let index = 0; index < 251; index += 1) {
      const contribution = this.applied[index];
      if (!contribution) continue;
      for (const ref of this.targets.get(this.order[index]) || []) {
        ref.object.morphTargetInfluences[ref.index] = Math.max(0, ref.object.morphTargetInfluences[ref.index] - contribution);
      }
      this.applied[index] = 0;
    }
  }

  beginFrame() {
    this.removePreviousContribution();
  }

  update(deltaSeconds, hasFreshFrame) {
    if (!this.hasTarget) return;
    const fade = this.preset.starvation;
    const duration = hasFreshFrame ? fade.fadeInSeconds : fade.fadeOutSeconds;
    this.fadeAlpha = clamp01(this.fadeAlpha + (hasFreshFrame ? 1 : -1) * (duration > 0 ? deltaSeconds / duration : 1));
    const smoothing = this.preset.smoothing;
    let blend = 1;
    if (smoothing.enabled) {
      const decay = smoothing.factor ?? (1 - smoothing.speed);
      blend = clamp01(1 - Math.pow(decay, Math.max(0, deltaSeconds) * (smoothing.referenceFps || 60)));
    }
    for (let index = 0; index < 251; index += 1) {
      this.current[index] = lerp(this.current[index], this.target[index], blend);
      const contribution = this.current[index] * this.fadeAlpha;
      this.applied[index] = contribution;
      for (const ref of this.targets.get(this.order[index]) || []) {
        const influences = ref.object.morphTargetInfluences;
        influences[ref.index] = this.preset.application.mode === "add"
          ? clamp01(influences[ref.index] + contribution)
          : contribution;
      }
    }
  }

  updateFromConvaiQueue(queue, deltaSeconds) {
    if (!queue) return false;
    if (queue.consumeNormalizationSignal?.()) this.reset();
    let fresh = false;
    if (queue.isBotSpeaking?.() && queue.hasFrames?.()) {
      const fps = Math.max(1, Number(queue.getPlaybackFps?.()) || this.setup.transport.outputFps);
      const frameDuration = 1 / fps;
      this.accumulator += deltaSeconds;
      let consumed = 0;
      const maxConsume = this.preset.timing.maxFramesConsumedPerRender ?? 8;
      while (this.accumulator >= frameDuration && queue.length > 1 && consumed < maxConsume) {
        queue.consumeFrames?.(1);
        this.accumulator -= frameDuration;
        consumed += 1;
      }
      const a = queue.getFrameWithAlpha?.(0) || queue.getFrame?.(0);
      const b = queue.getFrameWithAlpha?.(1) || queue.getFrame?.(1);
      fresh = this.setTargetFrame(this.interpolate(a, b, this.accumulator / frameDuration));
    }
    this.update(deltaSeconds, fresh);
    if (queue.isConversationEnded?.() && this.fadeAlpha <= (this.preset.starvation.resetAtAlpha ?? 0.001)) {
      this.reset();
      queue.reset?.();
    }
    return fresh;
  }

  reset() {
    this.removePreviousContribution();
    this.target.fill(0);
    this.current.fill(0);
    this.applied.fill(0);
    this.interpolated.fill(0);
    this.accumulator = 0;
    this.fadeAlpha = 0;
    this.hasTarget = false;
  }
}

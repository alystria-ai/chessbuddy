import { useEffect, useLayoutEffect, useMemo, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { N8AOPostPass } from 'n8ao';
import { ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import type { PortraitAoQuality } from './portraitQualityTuning';

export function createPortraitToneMappingEffect(): ToneMappingEffect {
  return new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  });
}

export function PortraitToneMapping() {
  const effect = useMemo(createPortraitToneMappingEffect, []);
  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} />;
}

type AoProps = {
  quality: PortraitAoQuality;
  aoRadius: number;
  distanceFalloff: number;
  intensity: number;
  halfRes: boolean;
};

const N8AO_MODE: Record<PortraitAoQuality, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

const N8AO_DISPOSED = '__chessAvatarV2Disposed';
const N8AO_RENDER_TARGET_KEYS = [
  'beautyRenderTarget',
  'depthDownsampleTarget',
  'transparencyRenderTargetDWFalse',
  'transparencyRenderTargetDWTrue',
  'writeTargetInternal',
  'readTargetInternal',
  'outputTargetInternal',
  'accumulationRenderTarget',
] as const;
const N8AO_QUAD_KEYS = [
  'effectCompositerQuad',
  'effectShaderQuad',
  'poissonBlurQuad',
  'depthDownsampleQuad',
  'depthCopyPass',
  'copyQuad',
  'accumulationQuad',
] as const;

type DisposableResource = { dispose: () => void };
type N8AOInternals = N8AOPostPass & Record<string, unknown>;

/**
 * n8ao 1.10.2 inherits Pass.dispose(), which is intentionally empty. Dispose
 * only resources created and owned by N8AOPostPass; its `depthTexture` is
 * supplied by the surrounding composer and must remain composer-owned.
 */
export function disposePortraitN8AO(pass: N8AOPostPass): void {
  const internals = pass as N8AOInternals;
  if (internals[N8AO_DISPOSED]) return;
  internals[N8AO_DISPOSED] = true;
  const disposed = new Set<DisposableResource>();
  const disposeOnce = (candidate: unknown) => {
    if (!candidate || typeof (candidate as DisposableResource).dispose !== 'function') return;
    const resource = candidate as DisposableResource;
    if (disposed.has(resource)) return;
    disposed.add(resource);
    resource.dispose();
  };

  for (const key of N8AO_RENDER_TARGET_KEYS) {
    disposeOnce(internals[key]);
    internals[key] = null;
  }
  for (const key of N8AO_QUAD_KEYS) {
    disposeOnce(internals[key]);
    internals[key] = null;
  }
  disposeOnce(internals.bluenoise);
  internals.bluenoise = null;
}

export function configurePortraitN8AO(
  pass: Pick<N8AOPostPass, 'configuration' | 'setQualityMode'>,
  { quality, aoRadius, distanceFalloff, intensity, halfRes }: AoProps,
): void {
  pass.setQualityMode(N8AO_MODE[quality]);
  pass.configuration.aoRadius = aoRadius;
  pass.configuration.distanceFalloff = distanceFalloff;
  pass.configuration.intensity = intensity;
  pass.configuration.halfRes = halfRes;
  pass.configuration.depthAwareUpsampling = true;
  // ACES + final output encoding are owned by the later post effects.
  pass.configuration.gammaCorrection = false;
}

export function PortraitN8AO({
  quality,
  aoRadius,
  distanceFalloff,
  intensity,
  halfRes,
  enabledRef,
}: AoProps & { enabledRef?: MutableRefObject<boolean> }) {
  const { scene, camera } = useThree();
  const pass = useMemo(() => {
    const nextPass = new N8AOPostPass(scene, camera);
    nextPass.dispose = () => disposePortraitN8AO(nextPass);
    return nextPass;
  }, [scene, camera]);

  useLayoutEffect(() => {
    configurePortraitN8AO(pass, { quality, aoRadius, distanceFalloff, intensity, halfRes });
    pass.enabled = enabledRef?.current ?? true;
  }, [pass, quality, aoRadius, distanceFalloff, intensity, halfRes]);

  // Adaptive quality disables AO before touching spatial resolution. Read a
  // stable ref so this inexpensive flag change does not rebuild the composer
  // or recompile the N8AO shader during play.
  useFrame(() => {
    pass.enabled = enabledRef?.current ?? true;
  }, -3);

  useEffect(() => () => disposePortraitN8AO(pass), [pass]);
  return <primitive object={pass} />;
}

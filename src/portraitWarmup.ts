/** Shared mobile compact reference used to align warmup PNG crop with live 3D. */
export const MOBILE_WARMUP_REFERENCE = {
  /** Sofia framing.horizontalOffset + mobileCompact.horizontalOffset */
  horizontalOffset: -0.047,
  objectXPercent: 46,
  objectYPercent: 6,
  cameraZoom: 0.94,
} as const;

/** World-offset delta to object-position X shift on the compact mobile crop. */
export const MOBILE_WARMUP_OFFSET_TO_OBJECT_X = 625;

export function mobileWarmupObjectPosition(
  horizontalOffset: number,
  cameraZoom: number = MOBILE_WARMUP_REFERENCE.cameraZoom,
): string {
  const offsetDelta = horizontalOffset - MOBILE_WARMUP_REFERENCE.horizontalOffset;
  const objectX = MOBILE_WARMUP_REFERENCE.objectXPercent + offsetDelta * MOBILE_WARMUP_OFFSET_TO_OBJECT_X;
  const zoomDelta = cameraZoom - MOBILE_WARMUP_REFERENCE.cameraZoom;
  const objectY = MOBILE_WARMUP_REFERENCE.objectYPercent + zoomDelta * 4;
  return `${objectX.toFixed(1)}% ${objectY.toFixed(1)}%`;
}

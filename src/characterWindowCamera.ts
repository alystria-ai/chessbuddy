import portraitPresentation from '../docs/character-models/chess-avatars-v2/portrait-presentation.json';

export type CharacterCameraVector = readonly [number, number, number];

/**
 * Presentation-only portrait zoom. The authored FOV, model scale, lights, and
 * look-at point stay untouched; the camera simply dollies toward its target.
 */
export const CHARACTER_WINDOW_PRESENTATION_ZOOM = portraitPresentation.cameraZoom;

export function dollyCharacterCamera(
  position: CharacterCameraVector,
  lookAt: CharacterCameraVector,
  zoom = CHARACTER_WINDOW_PRESENTATION_ZOOM,
): CharacterCameraVector {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error('Character-window zoom must be a finite positive number');
  }
  return [
    lookAt[0] + ((position[0] - lookAt[0]) / zoom),
    lookAt[1] + ((position[1] - lookAt[1]) / zoom),
    lookAt[2] + ((position[2] - lookAt[2]) / zoom),
  ];
}

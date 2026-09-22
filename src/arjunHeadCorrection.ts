import * as THREE from 'three';

/** Subtle authored shoulder-side tilt; yaw and pitch come from Arjun's isolated coach pose. */
export const ARJUN_PLAYER_ROLL_DEGREES = -1.5;

export type ArjunPlayerHeadCorrection = {
  head: THREE.Object3D;
  baseQuaternion: THREE.Quaternion;
  yawAxis: THREE.Vector3;
  pitchAxis: THREE.Vector3;
  rollAxis: THREE.Vector3;
  yawQuaternion: THREE.Quaternion;
  pitchQuaternion: THREE.Quaternion;
  rollQuaternion: THREE.Quaternion;
  correctedQuaternion: THREE.Quaternion;
  applied: boolean;
};

/**
 * Bind a head-only correction in world-aligned parent-space axes. The eyes are
 * deliberately excluded: Arjun's authored/Convai eye controls remain intact.
 */
export function createArjunPlayerHeadCorrection(
  root: THREE.Object3D,
): ArjunPlayerHeadCorrection | null {
  let head: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!head && /^(?:head|CC_Base_Head)$/i.test(object.name)) head = object;
  });
  if (!head) return null;

  const bone = head as THREE.Object3D;
  bone.updateWorldMatrix(true, false);
  const parentWorld = new THREE.Quaternion();
  (bone.parent ?? bone).getWorldQuaternion(parentWorld);
  const toParent = parentWorld.invert();
  return {
    head: bone,
    baseQuaternion: new THREE.Quaternion(),
    yawAxis: new THREE.Vector3(0, 1, 0).applyQuaternion(toParent).normalize(),
    pitchAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(toParent).normalize(),
    rollAxis: new THREE.Vector3(0, 0, 1).applyQuaternion(toParent).normalize(),
    yawQuaternion: new THREE.Quaternion(),
    pitchQuaternion: new THREE.Quaternion(),
    rollQuaternion: new THREE.Quaternion(),
    correctedQuaternion: new THREE.Quaternion(),
    applied: false,
  };
}

/** Remove last frame's additive correction before the animation mixer runs. */
export function restoreArjunPlayerHeadCorrection(
  correction: ArjunPlayerHeadCorrection,
): void {
  if (!correction.applied) return;
  correction.head.quaternion.copy(correction.baseQuaternion);
  correction.applied = false;
}

/** Compose the player-facing offset onto the current authored mixer pose. */
export function applyArjunPlayerHeadCorrection(
  correction: ArjunPlayerHeadCorrection,
  yawDegrees: number,
  pitchDegrees: number,
  rollDegrees = 0,
): void {
  // Defensive non-accumulation for paused/debug frames. Normal runtime calls
  // restore at priority -1.5, before the mixer writes its next authored pose.
  restoreArjunPlayerHeadCorrection(correction);
  correction.baseQuaternion.copy(correction.head.quaternion);
  correction.yawQuaternion.setFromAxisAngle(
    correction.yawAxis,
    THREE.MathUtils.degToRad(Number.isFinite(yawDegrees) ? yawDegrees : 0),
  );
  correction.pitchQuaternion.setFromAxisAngle(
    correction.pitchAxis,
    THREE.MathUtils.degToRad(Number.isFinite(pitchDegrees) ? pitchDegrees : 0),
  );
  correction.rollQuaternion.setFromAxisAngle(
    correction.rollAxis,
    THREE.MathUtils.degToRad(Number.isFinite(rollDegrees) ? rollDegrees : 0),
  );
  correction.correctedQuaternion
    .copy(correction.yawQuaternion)
    .multiply(correction.pitchQuaternion)
    .multiply(correction.rollQuaternion)
    .multiply(correction.baseQuaternion);
  correction.head.quaternion.copy(correction.correctedQuaternion);
  correction.applied = true;
}

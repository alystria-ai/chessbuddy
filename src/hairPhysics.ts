import * as THREE from 'three';

/**
 * Runtime hair physics — verlet spring chains over the vendor's hair bones.
 *
 * Sofia V5 ships a hair simulation rig (head → Hair1..Hair6); the vendor has
 * been BAKING a hair simulation into every animation clip by hand, which is
 * slow for them. This module simulates those bones at runtime instead:
 *
 *  - Chains are discovered by name (`Hair<N>` bones whose parent is not a
 *    hair bone start a chain), so future coaches with the same convention
 *    get physics for free, including multiple chains per head.
 *  - The spring target each frame is the pose the animation mixer wrote to
 *    the bones (baked hair tracks act as an art-directed guide). When a clip
 *    does NOT animate a hair bone, the captured rest pose is the target —
 *    detected by comparing against what we wrote last frame, so the sim
 *    never chases its own output.
 *  - The simulation runs at a FIXED 120Hz timestep behind an accumulator,
 *    and the rendered pose interpolates between the last two sim states.
 *    Integrating with the raw frame delta made the energy of the verlet
 *    step vary with frame-time wobble, which read as low-framerate jitter;
 *    fixed substeps + interpolation give the same motion at any display
 *    rate, butter-smooth.
 *
 * Runs AFTER the animation mixer and head tracking (register the update at
 * a late useFrame priority) so it sees the final head pose each frame.
 */

const HAIR_BONE = /^Hair\d+$/i;
const HAIR_TRACK = /(?:^|[./])Hair\d+\.(?:position|quaternion|scale)$/i;
const AUTHORED_MOTION_EPSILON = 1e-6;
/** Fixed simulation timestep. */
const SIM_HZ = 120;
const H = 1 / SIM_HZ;
/** Cap on accumulated time — a background tab resuming must not explode. */
const MAX_FRAME_DT = 0.1;
/** If the chain root teleports farther than this in one frame, hard-reset. */
const TELEPORT_DISTANCE = 0.5;

/** Tuning (world units are meters after the portrait's model scaling). */
const STIFFNESS = 24;      // pull toward the target pose, per second
const DAMPING = 0.985;     // velocity kept per 120Hz substep (~0.16/s half-life)
const GRAVITY = 0.18;      // m/s^2 of downward drift (subtle — styled hair)

type ChainBone = {
  bone: THREE.Bone;
  /** Local offset of the next joint (or virtual tip) in this bone's space. */
  childOffset: THREE.Vector3;
  boneLength: number;
  /** Verlet state (world space). */
  prevTip: THREE.Vector3;
  currTip: THREE.Vector3;
  /** currTip before the most recent substep — interpolation endpoint. */
  interpFrom: THREE.Vector3;
  /** Rest-pose local rotation (target when no animation drives the bone). */
  restLocalQuat: THREE.Quaternion;
  /** What we wrote last frame — detects whether the mixer re-posed the bone. */
  lastWrittenQuat: THREE.Quaternion;
  /** Per-render-frame cached kinematics. */
  frameBonePos: THREE.Vector3;
  frameTargetTip: THREE.Vector3;
  frameTargetQuat: THREE.Quaternion;
  frameParentQuat: THREE.Quaternion;
  /** Target-pose world matrix — the next link's parent frame. */
  frameTargetMatrix: THREE.Matrix4;
};

export type HairPhysics = {
  update(deltaSeconds: number): void;
  reset(): void;
  readonly chainCount: number;
  readonly boneCount: number;
};

/**
 * Leila's V2 hair rig has no authored hair tracks. The generic spring reads
 * several very short chains in her loose hairstyle as simulation chains and
 * produces visible high-frequency motion in the portrait crop. Keep that rig
 * stable; Sofia's authored ponytail and future genuinely animated rigs remain
 * untouched.
 */
export function shouldEnableRuntimeHairPhysics(
  assetName: string | undefined,
  hasAuthoredMotion: boolean,
): boolean {
  if (hasAuthoredMotion) return false;
  return !/^Leila$/i.test(assetName ?? '');
}

/**
 * Returns true only when a clip contains genuinely changing hair-bone keys.
 *
 * Exporters commonly write constant TRS tracks for every bone, so track
 * presence alone is not enough. When authored motion exists it is already an
 * art-directed hair simulation and must remain the sole writer; layering the
 * runtime spring over it makes the spring chase a second moving simulation,
 * which amplifies Sofia's ponytail motion into visible jitter.
 */
export function hasAuthoredHairMotion(clips: readonly THREE.AnimationClip[]): boolean {
  return clips.some((clip) => clip.tracks.some((track) => {
    if (!HAIR_TRACK.test(track.name)) return false;
    const values = track.values;
    const valueSize = track.getValueSize();
    if (valueSize <= 0 || values.length <= valueSize) return false;

    for (let offset = valueSize; offset < values.length; offset += valueSize) {
      for (let component = 0; component < valueSize; component += 1) {
        if (Math.abs(values[offset + component] - values[component]) > AUTHORED_MOTION_EPSILON) {
          return true;
        }
      }
    }
    return false;
  }));
}

const tmpParentQuat = new THREE.Quaternion();
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpNext = new THREE.Vector3();
const tmpTip = new THREE.Vector3();
const tmpDelta = new THREE.Quaternion();
const tmpParentScale = new THREE.Vector3();
const tmpParentPos = new THREE.Vector3();

export function createHairPhysics(root: THREE.Object3D): HairPhysics | null {
  // Discover chains: a chain root is a Hair bone whose parent is not one.
  const chains: ChainBone[][] = [];
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone || !HAIR_BONE.test(bone.name)) return;
    const parentIsHair = bone.parent && HAIR_BONE.test(bone.parent.name);
    if (parentIsHair) return;

    const chain: ChainBone[] = [];
    let current: THREE.Bone | null = bone;
    while (current) {
      const next: THREE.Bone | undefined = current.children.find(
        (c) => (c as THREE.Bone).isBone && HAIR_BONE.test(c.name),
      ) as THREE.Bone | undefined;
      // The last bone gets a virtual tip continuing its parent link's offset
      // (same direction and a comparable length).
      const childOffset = next
        ? next.position.clone()
        : (chain.length
          ? chain[chain.length - 1].childOffset.clone()
          : new THREE.Vector3(1, 0, 0));
      chain.push({
        bone: current,
        childOffset,
        boneLength: 0,
        prevTip: new THREE.Vector3(),
        currTip: new THREE.Vector3(),
        interpFrom: new THREE.Vector3(),
        restLocalQuat: current.quaternion.clone(),
        lastWrittenQuat: current.quaternion.clone(),
        frameBonePos: new THREE.Vector3(),
        frameTargetTip: new THREE.Vector3(),
        frameTargetQuat: new THREE.Quaternion(),
        frameParentQuat: new THREE.Quaternion(),
        frameTargetMatrix: new THREE.Matrix4(),
      });
      current = next ?? null;
    }
    if (chain.length) chains.push(chain);
  });

  if (!chains.length) return null;

  let needsSeed = true;
  let accumulator = 0;

  const seedFromCurrentPose = () => {
    for (const chain of chains) {
      for (const link of chain) {
        link.bone.updateWorldMatrix(true, false);
        link.bone.getWorldPosition(tmpVec);
        link.currTip.copy(link.childOffset).applyMatrix4(link.bone.matrixWorld);
        link.prevTip.copy(link.currTip);
        link.interpFrom.copy(link.currTip);
        link.boneLength = link.currTip.distanceTo(tmpVec);
        link.lastWrittenQuat.copy(link.bone.quaternion);
      }
    }
    accumulator = 0;
    needsSeed = false;
  };

  /**
   * Cache this frame's kinematic inputs per link: bone pivot, target tip
   * (from the mixer pose or rest pose), and parent orientation. The target
   * uses the parent's ANIMATED chain — computed by composing target
   * rotations down the chain so a baked parent pose carries to children.
   */
  const captureFrameTargets = () => {
    for (const chain of chains) {
      const rootBone = chain[0].bone;
      rootBone.parent!.updateWorldMatrix(true, false);
      // Compose target world transforms down the chain using each link's
      // TARGET rotation (mixer pose, or rest when the mixer didn't write).
      let parentMatrix = rootBone.parent!.matrixWorld;
      for (const link of chain) {
        const bone = link.bone;
        parentMatrix.decompose(tmpParentPos, tmpParentQuat, tmpParentScale);
        link.frameParentQuat.copy(tmpParentQuat);
        link.frameBonePos.copy(bone.position).applyMatrix4(parentMatrix);

        // Did the mixer (or anything else) re-pose this bone since our last
        // write? If not, target the captured rest pose instead of our own
        // previous output.
        const animated = !quatsApproxEqual(bone.quaternion, link.lastWrittenQuat);
        const targetLocal = animated ? bone.quaternion : link.restLocalQuat;
        link.frameTargetQuat.copy(tmpParentQuat).multiply(targetLocal);

        link.frameTargetTip
          .copy(link.childOffset)
          .multiplyScalar(tmpParentScale.x)
          .applyQuaternion(link.frameTargetQuat)
          .add(link.frameBonePos);

        if (link.boneLength <= 1e-8) {
          link.boneLength = link.childOffset.length() * tmpParentScale.x;
        }

        // Teleport guard (framing reset, coach switch on a cached scene).
        if (link.frameBonePos.distanceTo(link.currTip) > TELEPORT_DISTANCE) {
          link.currTip.copy(link.frameTargetTip);
          link.prevTip.copy(link.frameTargetTip);
          link.interpFrom.copy(link.frameTargetTip);
        }

        // Next link's parent frame = this bone's TARGET world transform
        // (scale assumed uniform along bone chains).
        link.frameTargetMatrix.compose(
          link.frameBonePos,
          link.frameTargetQuat,
          tmpVec.set(tmpParentScale.x, tmpParentScale.x, tmpParentScale.x),
        );
        parentMatrix = link.frameTargetMatrix;
      }
    }
  };

  const substep = () => {
    const stiffnessStep = Math.min(1, STIFFNESS * H);
    const gravityStep = GRAVITY * H * H;
    for (const chain of chains) {
      for (const link of chain) {
        link.interpFrom.copy(link.currTip);
        // Verlet: inertia + spring toward the frame target + gravity.
        tmpNext
          .copy(link.currTip)
          .addScaledVector(tmpDir.copy(link.currTip).sub(link.prevTip), DAMPING)
          .addScaledVector(tmpDir.copy(link.frameTargetTip).sub(link.currTip), stiffnessStep)
          .add(tmpDir.set(0, -gravityStep, 0));

        // Constrain to bone length around the pivot.
        tmpDir.copy(tmpNext).sub(link.frameBonePos);
        const len = tmpDir.length();
        if (len < 1e-8) {
          tmpNext.copy(link.frameTargetTip);
        } else {
          tmpNext.copy(link.frameBonePos).addScaledVector(tmpDir.multiplyScalar(1 / len), link.boneLength);
        }

        link.prevTip.copy(link.currTip);
        link.currTip.copy(tmpNext);
      }
    }
  };

  const writePose = (alpha: number) => {
    for (const chain of chains) {
      for (const link of chain) {
        const bone = link.bone;
        // Interpolated tip between the last two sim states.
        tmpTip.copy(link.interpFrom).lerp(link.currTip, alpha);

        tmpDir.copy(tmpTip).sub(link.frameBonePos).normalize();
        tmpVec.copy(link.frameTargetTip).sub(link.frameBonePos).normalize();
        tmpDelta.setFromUnitVectors(tmpVec, tmpDir);
        tmpQuat.copy(link.frameTargetQuat).premultiply(tmpDelta);
        // World → local against the SIMULATED parent chain: use the real
        // parent's current world quat (parents were written before children).
        bone.parent!.matrixWorld.decompose(tmpParentPos, tmpParentQuat, tmpParentScale);
        bone.quaternion.copy(tmpParentQuat.invert()).multiply(tmpQuat);
        link.lastWrittenQuat.copy(bone.quaternion);

        // Refresh this bone's world matrix so the child converts against it.
        bone.updateMatrix();
        bone.matrixWorld.multiplyMatrices(bone.parent!.matrixWorld, bone.matrix);
      }
    }
  };

  const update = (deltaSeconds: number) => {
    const dt = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DT);
    if (dt <= 0) return;
    if (needsSeed) seedFromCurrentPose();

    captureFrameTargets();

    accumulator += dt;
    while (accumulator >= H) {
      substep();
      accumulator -= H;
    }

    writePose(accumulator / H);
  };

  return {
    update,
    reset: () => { needsSeed = true; },
    chainCount: chains.length,
    boneCount: chains.reduce((sum, c) => sum + c.length, 0),
  };
}

function quatsApproxEqual(a: THREE.Quaternion, b: THREE.Quaternion): boolean {
  return Math.abs(a.x - b.x) < 1e-7
    && Math.abs(a.y - b.y) < 1e-7
    && Math.abs(a.z - b.z) < 1e-7
    && Math.abs(a.w - b.w) < 1e-7;
}

/**
 * Character movement simulation WITHOUT bone manipulation.
 *
 * WHY NO BONE ROTATIONS:
 * Each GLB model has bones in different local-space orientations (rest poses).
 * Applying Euler rotations (e.g. leg.rotation.x = 0.4) in world-Euler space
 * on an arbitrary bone will rotate it in the WRONG direction for most models.
 * This causes the twisted/folded/upside-down characters seen in the screenshot.
 *
 * SOLUTION:
 * - If the GLB has embedded animation clips → useAnimations plays them correctly.
 * - If no clips exist → characters stand in their natural GLB rest pose.
 * - Movement "feel" is simulated at the GROUP level (position Y bob).
 * - No bones are ever touched by this system.
 */

import * as THREE from 'three';

// Kept for API compatibility with RemotePlayer
export interface BoneSet {
  hips:         THREE.Object3D | null;
  spine:        THREE.Object3D | null;
  chest:        THREE.Object3D | null;
  neck:         THREE.Object3D | null;
  head:         THREE.Object3D | null;
  leftUpLeg:    THREE.Object3D | null;
  leftLeg:      THREE.Object3D | null;
  leftFoot:     THREE.Object3D | null;
  rightUpLeg:   THREE.Object3D | null;
  rightLeg:     THREE.Object3D | null;
  rightFoot:    THREE.Object3D | null;
  leftArm:      THREE.Object3D | null;
  leftForeArm:  THREE.Object3D | null;
  rightArm:     THREE.Object3D | null;
  rightForeArm: THREE.Object3D | null;
}

/** Returns empty bone set — we no longer manipulate bones */
export function findBones(_model: THREE.Object3D): BoneSet {
  return {
    hips: null, spine: null, chest: null, neck: null, head: null,
    leftUpLeg: null, leftLeg: null, leftFoot: null,
    rightUpLeg: null, rightLeg: null, rightFoot: null,
    leftArm: null, leftForeArm: null,
    rightArm: null, rightForeArm: null,
  };
}

/**
 * No-op — bone manipulation removed.
 * Group-level Y-bob is handled directly in RemotePlayer's useFrame.
 */
export function applyProceduralAnimation(
  _bones: BoneSet,
  _action: string,
  _elapsed: number,
  _delta: number,
): void {
  // Intentionally empty — do NOT manipulate bones here.
}

/**
 * Compute a Y-offset for group-level body bob based on movement state.
 * This gives the impression of movement without touching any bones.
 */
export function getMovementBob(action: string, elapsed: number): number {
  switch (action) {
    case 'walking':
      // Two bobs per step cycle, small amplitude
      return Math.abs(Math.sin(elapsed * 9.5)) * 0.011;
    case 'running':
      // Faster, more pronounced bob
      return Math.abs(Math.sin(elapsed * 14.5)) * 0.022;
    case 'crouching':
      return 0;
    default:
      // Idle: near-zero breathing sway
      return Math.sin(elapsed * 0.9) * 0.003;
  }
}

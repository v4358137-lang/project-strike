/**
 * Procedural Animation System — REST-POSE ADDITIVE approach.
 *
 * Previous attempt failed because we REPLACED bone quaternions with absolute
 * Euler angles, wiping out each model's natural rest orientation → twisted/upside-down.
 *
 * THIS version:
 * 1. Captures the bone's rest quaternion (from the GLB bind pose).
 * 2. Applies a DELTA rotation ON TOP of that rest pose:
 *      target = restQuat * deltaQuat
 * 3. When angle = 0, bone returns to rest → character is always natural-looking.
 * 4. Works for ANY humanoid GLB regardless of internal bone orientation.
 */
import * as THREE from 'three';

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

// Keyed by bone UUID — survives renames
export type RestPoses = Map<string, THREE.Quaternion>;

const BONE_KEYWORDS: Record<keyof BoneSet, string[]> = {
  hips:         ['hips','hip','pelvis','root'],
  spine:        ['spine1','spine_01','spine01','spine'],
  chest:        ['spine2','spine_02','chest','upperchest','spine3'],
  neck:         ['neck'],
  head:         ['head'],
  leftUpLeg:    ['leftupleg','l_upleg','leftthigh','thigh_l','upleftleg'],
  leftLeg:      ['leftleg','l_leg','leftshin','leftcalf','shin_l','lowerleg_l'],
  leftFoot:     ['leftfoot','l_foot','foot_l'],
  rightUpLeg:   ['rightupleg','r_upleg','rightthigh','thigh_r','uprightleg'],
  rightLeg:     ['rightleg','r_leg','rightshin','rightcalf','shin_r','lowerleg_r'],
  rightFoot:    ['rightfoot','r_foot','foot_r'],
  leftArm:      ['leftarm','l_arm','leftshoulder2','upperarm_l'],
  leftForeArm:  ['leftforearm','l_forearm','leftlowerarm','lowerarm_l'],
  rightArm:     ['rightarm','r_arm','rightshoulder2','upperarm_r'],
  rightForeArm: ['rightforearm','r_forearm','rightlowerarm','lowerarm_r'],
};

export function findBones(model: THREE.Object3D): BoneSet {
  const bones = Object.fromEntries(
    Object.keys(BONE_KEYWORDS).map(k => [k, null])
  ) as unknown as BoneSet;

  model.traverse(obj => {
    const n = obj.name.toLowerCase().replace(/[\s\-_.]/g, '');
    for (const [key, kws] of Object.entries(BONE_KEYWORDS) as [keyof BoneSet, string[]][]) {
      if (bones[key]) continue;
      if (kws.some(k => n.includes(k))) bones[key] = obj;
    }
  });
  return bones;
}

/** Snapshot every bone's initial quaternion so we can animate additively */
export function captureRestPoses(model: THREE.Object3D): RestPoses {
  const poses: RestPoses = new Map();
  model.traverse(obj => {
    if (obj.name) poses.set(obj.uuid, obj.quaternion.clone());
  });
  return poses;
}

// ── Pre-allocated temporaries ─────────────────────────────────────────────────
const _q    = new THREE.Quaternion();
const _e    = new THREE.Euler();
const _zero = new THREE.Quaternion(); // identity

/**
 * Rotate a bone ADDITIVELY from its rest pose.
 * target = restQuat * Quaternion(rx,ry,rz)
 * When rx=ry=rz=0 the bone returns to rest — character is always stable.
 */
function sb(
  bone: THREE.Object3D | null,
  rx: number, ry: number, rz: number,
  alpha: number,
  rests: RestPoses,
) {
  if (!bone) return;
  const rest = rests.get(bone.uuid);
  if (!rest) return;

  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);

  // Additive: apply delta rotation in bone-local space on top of rest quaternion
  const target = rest.clone().multiply(_q);
  bone.quaternion.slerp(target, Math.min(alpha, 1));
}

/** Reset a bone smoothly back to its rest pose */
function resetBone(bone: THREE.Object3D | null, alpha: number, rests: RestPoses) {
  if (!bone) return;
  const rest = rests.get(bone.uuid);
  if (!rest) return;
  bone.quaternion.slerp(rest, Math.min(alpha, 1));
}

/** Smooth-step easing for more natural motion curves */
function smoothStep(x: number): number { return x * x * (3 - 2 * x); }

export function applyProceduralAnimation(
  b: BoneSet,
  action: string,
  elapsed: number,
  delta: number,
  rests: RestPoses,
) {
  const a = Math.min(delta * 11, 1); // transition alpha

  switch (action) {

    case 'idle': {
      const t = elapsed;
      // Subtle chest breathing at ~14 breaths/minute
      sb(b.chest, Math.sin(t * 0.85) * 0.015, 0, 0, a * 0.5, rests);
      sb(b.spine, 0.008, 0, 0, a * 0.3, rests);
      // Gentle head float
      sb(b.head, 0, Math.sin(t * 0.25) * 0.022, 0, a * 0.4, rests);
      // Reset all limbs to rest
      resetBone(b.leftUpLeg,  a, rests); resetBone(b.rightUpLeg,  a, rests);
      resetBone(b.leftLeg,    a, rests); resetBone(b.rightLeg,    a, rests);
      resetBone(b.leftFoot,   a, rests); resetBone(b.rightFoot,   a, rests);
      resetBone(b.leftArm,    a, rests); resetBone(b.rightArm,    a, rests);
      resetBone(b.leftForeArm,a, rests); resetBone(b.rightForeArm,a, rests);
      break;
    }

    case 'walking': {
      const spd = elapsed * 4.8;
      const sL  = Math.sin(spd);
      const sR  = Math.sin(spd + Math.PI);
      const lF  = smoothStep((sL + 1) / 2); // eased [0..1]
      const rF  = smoothStep((sR + 1) / 2);

      // Leg swing — delta around bone's local X (forward/back for most rigs)
      sb(b.leftUpLeg,  sL * 0.36, 0, 0, a * 1.6, rests);
      sb(b.rightUpLeg, sR * 0.36, 0, 0, a * 1.6, rests);
      // Knee bend on forward phase
      sb(b.leftLeg,   lF * 0.28, 0, 0, a * 1.4, rests);
      sb(b.rightLeg,  rF * 0.28, 0, 0, a * 1.4, rests);
      // Ankle roll
      sb(b.leftFoot,  -sL * 0.07, 0, 0, a, rests);
      sb(b.rightFoot, -sR * 0.07, 0, 0, a, rests);
      // Arm counter-swing (opposite to legs)
      sb(b.leftArm,  sR * 0.16, 0, 0, a, rests);
      sb(b.rightArm, sL * 0.16, 0, 0, a, rests);
      // Spine lean
      sb(b.spine, 0.04, 0, 0, a * 0.4, rests);
      sb(b.chest, Math.sin(spd * 2) * 0.01, 0, 0, a * 0.4, rests);
      sb(b.head, 0, 0, 0, a * 0.3, rests);
      break;
    }

    case 'running': {
      const spd = elapsed * 8.5;
      const sL  = Math.sin(spd);
      const sR  = Math.sin(spd + Math.PI);
      const lF  = smoothStep((sL + 1) / 2);
      const rF  = smoothStep((sR + 1) / 2);

      sb(b.leftUpLeg,  sL * 0.60, 0, 0, a * 2.0, rests);
      sb(b.rightUpLeg, sR * 0.60, 0, 0, a * 2.0, rests);
      sb(b.leftLeg,    lF * 0.50, 0, 0, a * 1.8, rests);
      sb(b.rightLeg,   rF * 0.50, 0, 0, a * 1.8, rests);
      sb(b.leftFoot,   -sL * 0.15, 0, 0, a, rests);
      sb(b.rightFoot,  -sR * 0.15, 0, 0, a, rests);
      // Arms pump harder
      sb(b.leftArm,  sR * 0.32, 0, 0, a, rests);
      sb(b.rightArm, sL * 0.32, 0, 0, a, rests);
      sb(b.leftForeArm,  sR * 0.12, 0, 0, a, rests);
      sb(b.rightForeArm, sL * 0.12, 0, 0, a, rests);
      // Strong forward lean
      sb(b.spine, 0.16, 0, 0, a * 0.5, rests);
      sb(b.chest, 0.04 + Math.sin(spd * 2) * 0.02, 0, 0, a * 0.4, rests);
      sb(b.head, -0.06, 0, 0, a * 0.3, rests);
      break;
    }

    case 'crouching': {
      sb(b.leftUpLeg,  0.50, 0, 0, a, rests);
      sb(b.rightUpLeg, 0.50, 0, 0, a, rests);
      sb(b.leftLeg,    0.65, 0, 0, a, rests);
      sb(b.rightLeg,   0.65, 0, 0, a, rests);
      sb(b.spine, 0.14, 0, 0, a * 0.5, rests);
      break;
    }

    case 'jumping': {
      sb(b.leftUpLeg,  -0.28, 0, 0, a * 1.5, rests);
      sb(b.rightUpLeg, -0.28, 0, 0, a * 1.5, rests);
      sb(b.leftLeg,     0.45, 0, 0, a * 1.5, rests);
      sb(b.rightLeg,    0.45, 0, 0, a * 1.5, rests);
      sb(b.spine, -0.04, 0, 0, a, rests);
      break;
    }

    case 'shooting': {
      const breath = Math.sin(elapsed * 0.9) * 0.005;
      sb(b.spine, 0.05 + breath, 0, 0, a * 0.4, rests);
      sb(b.head, -0.04, 0, 0, a * 0.4, rests);
      // Limbs stay at rest for cleaner look
      resetBone(b.leftUpLeg,  a, rests); resetBone(b.rightUpLeg,  a, rests);
      resetBone(b.leftLeg,    a, rests); resetBone(b.rightLeg,    a, rests);
      break;
    }
  }

  // Suppress unused import warning
  void _zero;
}

/** Group-level Y-bob for movement feel (used when no GLB clips available) */
export function getMovementBob(action: string, elapsed: number): number {
  if (action === 'walking') return Math.abs(Math.sin(elapsed * 9.5)) * 0.01;
  if (action === 'running')  return Math.abs(Math.sin(elapsed * 14))  * 0.02;
  return 0;
}

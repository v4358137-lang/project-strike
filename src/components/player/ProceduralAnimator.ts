/**
 * Procedural bone animation system for third-person characters.
 * Drives idle/walk/run/crouch/shoot/jump animations via sine-wave kinematics
 * when the GLB has no embedded animation clips.
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

// Fuzzy bone lookup — matches common naming conventions
const BONE_MAP: Record<keyof BoneSet, string[]> = {
  hips:         ['hips','hip','pelvis','root'],
  spine:        ['spine1','spine_01','spine01','spine'],
  chest:        ['spine2','spine_02','chest','upperchest','spine3'],
  neck:         ['neck'],
  head:         ['head'],
  leftUpLeg:    ['leftupleg','l_upleg','leftthigh','left_thigh','thigh_l','leftupperleg','upleftleg'],
  leftLeg:      ['leftleg','l_leg','leftshin','leftcalf','shin_l','knee_l','lowerleg_l'],
  leftFoot:     ['leftfoot','l_foot','foot_l'],
  rightUpLeg:   ['rightupleg','r_upleg','rightthigh','right_thigh','thigh_r','rightupperleg','uprightleg'],
  rightLeg:     ['rightleg','r_leg','rightshin','rightcalf','shin_r','knee_r','lowerleg_r'],
  rightFoot:    ['rightfoot','r_foot','foot_r'],
  leftArm:      ['leftarm','l_arm','leftshoulder2','left_upper_arm','upperarm_l'],
  leftForeArm:  ['leftforearm','l_forearm','leftlowerarm','lowerarm_l'],
  rightArm:     ['rightarm','r_arm','rightshoulder2','right_upper_arm','upperarm_r'],
  rightForeArm: ['rightforearm','r_forearm','rightlowerarm','lowerarm_r'],
};

export function findBones(model: THREE.Object3D): BoneSet {
  const bones: BoneSet = {
    hips: null, spine: null, chest: null, neck: null, head: null,
    leftUpLeg: null, leftLeg: null, leftFoot: null,
    rightUpLeg: null, rightLeg: null, rightFoot: null,
    leftArm: null, leftForeArm: null,
    rightArm: null, rightForeArm: null,
  };

  model.traverse(obj => {
    const n = obj.name.toLowerCase().replace(/[\s\-_.]/g, '');
    for (const [key, aliases] of Object.entries(BONE_MAP) as [keyof BoneSet, string[]][]) {
      if (bones[key]) continue; // already found
      if (aliases.some(a => n.includes(a))) {
        bones[key] = obj;
      }
    }
  });
  return bones;
}

// Pre-allocated quaternion/euler to avoid GC pressure every frame
const _q  = new THREE.Quaternion();
const _e  = new THREE.Euler();
const _v0 = new THREE.Vector3();

function lerpBone(bone: THREE.Object3D | null, rx: number, ry: number, rz: number, alpha: number) {
  if (!bone) return;
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  bone.quaternion.slerp(_q, alpha);
}

export function applyProceduralAnimation(
  bones: BoneSet,
  action: string,
  elapsed: number,
  delta: number,
) {
  const a = Math.min(delta * 10, 1); // smooth transition alpha

  if (action === 'idle') {
    const breathT = elapsed * 0.9;
    // Subtle breathing — chest rises/falls
    lerpBone(bones.chest, Math.sin(breathT) * 0.018, 0, 0, a);
    // Gentle head sway
    lerpBone(bones.head, 0, Math.sin(elapsed * 0.4) * 0.025, 0, a);
    // Spine neutral
    lerpBone(bones.spine, 0.02, 0, 0, a);
    // Hips slight weight shift
    if (bones.hips) {
      bones.hips.rotation.z = THREE.MathUtils.lerp(bones.hips.rotation.z, Math.sin(elapsed * 0.35) * 0.015, a);
    }
    // Limbs to natural rest
    lerpBone(bones.leftUpLeg,    0,    0, 0, a);
    lerpBone(bones.rightUpLeg,   0,    0, 0, a);
    lerpBone(bones.leftLeg,      0,    0, 0, a);
    lerpBone(bones.rightLeg,     0,    0, 0, a);
    lerpBone(bones.leftArm,     -0.1,  0, 0, a);
    lerpBone(bones.rightArm,    -0.1,  0, 0, a);
    lerpBone(bones.leftForeArm,  0.3,  0, 0, a);
    lerpBone(bones.rightForeArm, 0.3,  0, 0, a);

  } else if (action === 'walking') {
    const spd = elapsed * 4.5; // walk cadence
    const leg  = 0.38;          // upper leg swing amplitude
    const knee = 0.30;          // lower leg bend amplitude
    const arm  = 0.22;          // arm swing amplitude
    const hip  = 0.035;         // hip lateral rotation

    // Upper legs alternate (180° out of phase)
    lerpBone(bones.leftUpLeg,  Math.sin(spd) * leg,            0, 0, a * 1.5);
    lerpBone(bones.rightUpLeg, Math.sin(spd + Math.PI) * leg,  0, 0, a * 1.5);
    // Lower leg bends on back-swing phase
    lerpBone(bones.leftLeg,  Math.max(0, Math.sin(spd + 0.5)) * knee,           0, 0, a * 1.5);
    lerpBone(bones.rightLeg, Math.max(0, Math.sin(spd + Math.PI + 0.5)) * knee, 0, 0, a * 1.5);
    // Ankle dorsiflexion
    lerpBone(bones.leftFoot,  -Math.sin(spd) * 0.12,           0, 0, a);
    lerpBone(bones.rightFoot, -Math.sin(spd + Math.PI) * 0.12, 0, 0, a);
    // Arms counter-swing (opposite to legs)
    lerpBone(bones.leftArm,  Math.sin(spd + Math.PI) * arm, 0, 0, a);
    lerpBone(bones.rightArm, Math.sin(spd) * arm,            0, 0, a);
    lerpBone(bones.leftForeArm,  0.4 + Math.sin(spd + Math.PI) * 0.1, 0, 0, a);
    lerpBone(bones.rightForeArm, 0.4 + Math.sin(spd)           * 0.1, 0, 0, a);
    // Hip sway and bob
    if (bones.hips) {
      bones.hips.rotation.y = THREE.MathUtils.lerp(bones.hips.rotation.y, Math.sin(spd) * hip, a);
      bones.hips.rotation.z = THREE.MathUtils.lerp(bones.hips.rotation.z, Math.sin(spd * 2) * 0.02, a);
    }
    // Spine / chest — slight forward lean + sway
    lerpBone(bones.spine, 0.06, 0, 0, a);
    lerpBone(bones.chest, Math.sin(spd * 2) * 0.015, 0, 0, a);
    // Head stays level
    lerpBone(bones.head, -0.02, 0, 0, a);

  } else if (action === 'running') {
    const spd  = elapsed * 8.0;
    const leg  = 0.68;
    const knee = 0.55;
    const arm  = 0.45;
    const hip  = 0.07;

    lerpBone(bones.leftUpLeg,  Math.sin(spd) * leg,            0, 0, a * 2);
    lerpBone(bones.rightUpLeg, Math.sin(spd + Math.PI) * leg,  0, 0, a * 2);
    lerpBone(bones.leftLeg,  Math.max(0, Math.sin(spd + 0.6)) * knee,           0, 0, a * 2);
    lerpBone(bones.rightLeg, Math.max(0, Math.sin(spd + Math.PI + 0.6)) * knee, 0, 0, a * 2);
    lerpBone(bones.leftFoot,  -Math.sin(spd) * 0.2,           0, 0, a);
    lerpBone(bones.rightFoot, -Math.sin(spd + Math.PI) * 0.2, 0, 0, a);
    // Arms drive hard (running arm pump)
    lerpBone(bones.leftArm,  Math.sin(spd + Math.PI) * arm, 0, 0, a);
    lerpBone(bones.rightArm, Math.sin(spd)            * arm, 0, 0, a);
    lerpBone(bones.leftForeArm,  0.55 + Math.sin(spd + Math.PI) * 0.15, 0, 0, a);
    lerpBone(bones.rightForeArm, 0.55 + Math.sin(spd)           * 0.15, 0, 0, a);
    // Hip — more aggressive
    if (bones.hips) {
      bones.hips.rotation.y = THREE.MathUtils.lerp(bones.hips.rotation.y, Math.sin(spd) * hip, a);
      bones.hips.rotation.z = THREE.MathUtils.lerp(bones.hips.rotation.z, Math.sin(spd * 2) * 0.04, a);
    }
    // Strong forward lean
    lerpBone(bones.spine, 0.18, 0, 0, a);
    lerpBone(bones.chest, 0.06 + Math.sin(spd * 2) * 0.02, 0, 0, a);
    lerpBone(bones.head, -0.1, 0, 0, a); // head stays forward

  } else if (action === 'crouching') {
    const spd = elapsed * 3.5;
    // Hips lowered, strong knee bend
    if (bones.hips) {
      bones.hips.position.y = THREE.MathUtils.lerp(
        bones.hips.position.y ?? 0, -0.25, a,
      );
    }
    lerpBone(bones.leftUpLeg,  0.55, 0, 0, a);
    lerpBone(bones.rightUpLeg, 0.55, 0, 0, a);
    lerpBone(bones.leftLeg,    0.70, 0, 0, a);
    lerpBone(bones.rightLeg,   0.70, 0, 0, a);
    lerpBone(bones.spine, 0.15, 0, 0, a);
    lerpBone(bones.head, -0.05 + Math.sin(spd * 0.5) * 0.01, 0, 0, a);

  } else if (action === 'shooting') {
    // Right arm raised to shoulder level holding gun
    lerpBone(bones.rightArm,     -0.4,  0, -0.15, a);
    lerpBone(bones.rightForeArm,  0.5,  0,  0,    a);
    lerpBone(bones.leftArm,      -0.35, 0,  0.2,  a);
    lerpBone(bones.leftForeArm,   0.45, 0,  0,    a);
    // Slight breathing sway on spine
    lerpBone(bones.spine, 0.04 + Math.sin(elapsed * 0.8) * 0.008, 0, 0, a);
    lerpBone(bones.head, -0.05, 0, 0, a);

  } else if (action === 'jumping') {
    lerpBone(bones.leftUpLeg,  -0.3, 0, 0, a);
    lerpBone(bones.rightUpLeg, -0.3, 0, 0, a);
    lerpBone(bones.leftLeg,     0.5, 0, 0, a);
    lerpBone(bones.rightLeg,    0.5, 0, 0, a);
    lerpBone(bones.spine, -0.05, 0, 0, a);
    lerpBone(bones.leftArm,  -0.5, 0,  0.3, a);
    lerpBone(bones.rightArm, -0.5, 0, -0.3, a);
  }

  // Hips position Y spring-back to 0 when not crouching
  if (action !== 'crouching' && bones.hips) {
    bones.hips.position.y = THREE.MathUtils.lerp(bones.hips.position.y ?? 0, 0, a * 0.5);
  }

  // Suppress TS unused import
  void _v0;
}

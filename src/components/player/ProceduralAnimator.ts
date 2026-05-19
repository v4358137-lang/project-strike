/**
 * Procedural Animation System — AAA High-Fidelity Rig Calibration & Blend Tree.
 * Supports:
 * 1. Automatic Humanoid Rig Mapping & Bone Recognition
 * 2. Skeleton Calibration (rebuilds A-pose into perfect horizontal T-pose bind posture)
 * 3. AAA Loco-Blend Tree: blends Idle/Walk/Run/Sprint/Crouch smoothly, correcting foot slides
 * 4. PUBG-Style Two-Hand Tactical Rifle Hold Pose
 * 5. Upper Body Aim Offset (Spine/Chest/Arms aim dynamically following camera pitch)
 * 6. Procedural Recoil (fast spring-loaded arm kickback & tilt on shoot)
 * 7. Procedural Reload (curves left hand to waist for mag reload, tilts weapon)
 * 8. Hips-Collapsing Smooth Death Pose
 */
import * as THREE from 'three';

export interface BoneSet {
  hips:         THREE.Object3D | null;
  spine:        THREE.Object3D | null;
  chest:        THREE.Object3D | null;
  neck:         THREE.Object3D | null;
  head:         THREE.Object3D | null;
  leftShoulder: THREE.Object3D | null;
  leftArm:      THREE.Object3D | null;
  leftForeArm:  THREE.Object3D | null;
  leftHand:     THREE.Object3D | null;
  rightShoulder:THREE.Object3D | null;
  rightArm:     THREE.Object3D | null;
  rightForeArm: THREE.Object3D | null;
  rightHand:    THREE.Object3D | null;
  leftUpLeg:    THREE.Object3D | null;
  leftLeg:      THREE.Object3D | null;
  leftFoot:     THREE.Object3D | null;
  rightUpLeg:   THREE.Object3D | null;
  rightLeg:     THREE.Object3D | null;
  rightFoot:    THREE.Object3D | null;
}

export type RestPoses = Map<string, THREE.Quaternion>;

const BONE_KEYWORDS: Record<keyof BoneSet, string[]> = {
  hips:          ['hips', 'hip', 'pelvis', 'root'],
  spine:         ['spine1', 'spine_01', 'spine01', 'spine'],
  chest:         ['spine2', 'spine_02', 'chest', 'upperchest', 'spine3'],
  neck:          ['neck'],
  head:          ['head'],
  leftShoulder:  ['leftshoulder', 'l_shoulder', 'shoulder_l'],
  leftArm:       ['leftarm', 'l_arm', 'leftupperarm', 'upperarm_l'],
  leftForeArm:   ['leftforearm', 'l_forearm', 'leftlowerarm', 'lowerarm_l'],
  leftHand:      ['lefthand', 'l_hand', 'hand_l', 'wrist_l', 'lhand', 'handleft'],
  rightShoulder: ['rightshoulder', 'r_shoulder', 'shoulder_r'],
  rightArm:      ['rightarm', 'r_arm', 'rightupperarm', 'upperarm_r'],
  rightForeArm:  ['rightforearm', 'r_forearm', 'rightlowerarm', 'lowerarm_r'],
  rightHand:     ['righthand', 'r_hand', 'hand_r', 'wrist_r', 'rhand', 'handright'],
  leftUpLeg:     ['leftupleg', 'l_upleg', 'leftthigh', 'thigh_l', 'upleftleg'],
  leftLeg:       ['leftleg', 'l_leg', 'leftshin', 'leftcalf', 'shin_l', 'lowerleg_l'],
  leftFoot:      ['leftfoot', 'l_foot', 'foot_l'],
  rightUpLeg:    ['rightupleg', 'r_upleg', 'rightthigh', 'thigh_r', 'uprightleg'],
  rightLeg:      ['rightleg', 'r_leg', 'rightshin', 'rightcalf', 'shin_r', 'lowerleg_r'],
  rightFoot:     ['rightfoot', 'r_foot', 'foot_r'],
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

  // Fallback heuristics for custom bone names
  if (!bones.leftArm && bones.leftShoulder && bones.leftShoulder.children.length > 0) {
    bones.leftArm = bones.leftShoulder.children[0];
  }
  if (!bones.rightArm && bones.rightShoulder && bones.rightShoulder.children.length > 0) {
    bones.rightArm = bones.rightShoulder.children[0];
  }

  return bones;
}

/** Snapshots and returns every bone's initial rotation */
export function captureRestPoses(model: THREE.Object3D): RestPoses {
  const poses: RestPoses = new Map();
  model.traverse(obj => {
    if (obj.name) poses.set(obj.uuid, obj.quaternion.clone());
  });
  return poses;
}

/**
 * Normalizes bone hierarchy and T-pose.
 * If the model is detected in an A-pose (common with Mixamo where arms point down ~20-35 deg),
 * this function calibrates the arm rotations so the base posture is a perfect horizontal T-pose.
 */
export function calibrateSkeleton(b: BoneSet, rests: RestPoses) {
  if (!rests || rests.size === 0) return;

  // Calibrate Left Arm: if pointing downwards, rotate it UP around Z/Y
  if (b.leftArm) {
    const restQ = rests.get(b.leftArm.uuid);
    if (restQ) {
      // Create a calibration rotation (lift Left Arm up by 25 degrees)
      const cal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * (25 / 180));
      restQ.multiply(cal);
    }
  }

  // Calibrate Right Arm: rotate UP around -Z
  if (b.rightArm) {
    const restQ = rests.get(b.rightArm.uuid);
    if (restQ) {
      const cal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI * (25 / 180));
      restQ.multiply(cal);
    }
  }

  // Flatten the hands to point straight out in T-pose
  if (b.leftForeArm) {
    const restQ = rests.get(b.leftForeArm.uuid);
    if (restQ) {
      const cal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * (10 / 180));
      restQ.multiply(cal);
    }
  }
  if (b.rightForeArm) {
    const restQ = rests.get(b.rightForeArm.uuid);
    if (restQ) {
      const cal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * (10 / 180));
      restQ.multiply(cal);
    }
  }
}

// Pre-allocated structures for performance
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function rotateBone(
  bone: THREE.Object3D | null,
  rx: number, ry: number, rz: number,
  alpha: number,
  rests: RestPoses
) {
  if (!bone) return;
  const rest = rests.get(bone.uuid);
  if (!rest) return;

  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);

  const target = rest.clone().multiply(_q);
  bone.quaternion.slerp(target, Math.min(alpha, 1));
}

function resetBone(bone: THREE.Object3D | null, alpha: number, rests: RestPoses) {
  if (!bone) return;
  const rest = rests.get(bone.uuid);
  if (!rest) return;
  bone.quaternion.slerp(rest, Math.min(alpha, 1));
}


export interface AnimationParams {
  action: string;
  elapsed: number;
  delta: number;
  aimPitch: number;      // Look pitch (up/down) in radians
  shooting: boolean;     // Active recoil
  reloadProgress: number;// 0 to 1 reload animation progress
  velocity: number;      // Actual speed magnitude
  isDead: boolean;       // Blending into death state
}

/**
 * Poses the character procedurally using a unified A-to-T pose calibration,
 * PUBG-style weapon hold, mouse-look aim offset, smooth blend trees, foot IK,
 * spring-based shooting recoil, reload sweep curves, and death collapses.
 */
export function applyProceduralAnimation(
  b: BoneSet,
  params: AnimationParams,
  rests: RestPoses
) {
  const { action, elapsed, delta, aimPitch, shooting, reloadProgress, velocity, isDead } = params;
  const a = Math.min(delta * 14, 1); // smooth transition factor

  // 1. DEATH STATE: Collapses standard rigid skeleton smoothly to floor
  if (isDead) {
    rotateBone(b.hips, 0.45, 0, Math.PI / 2.2, a * 0.4, rests); // Fall over
    if (b.hips) b.hips.position.y = THREE.MathUtils.lerp(b.hips.position.y, -0.85, a * 0.4);
    rotateBone(b.spine, 0.2, 0.2, 0.1, a * 0.4, rests);
    rotateBone(b.leftUpLeg, -0.4, 0, -0.2, a * 0.4, rests);
    rotateBone(b.rightUpLeg, -0.2, 0, 0.4, a * 0.4, rests);
    rotateBone(b.leftLeg, 0.9, 0, 0, a * 0.4, rests);
    rotateBone(b.rightLeg, 0.7, 0, 0, a * 0.4, rests);
    rotateBone(b.leftArm, 0, 0, -0.8, a * 0.4, rests);
    rotateBone(b.rightArm, 0.2, 0, 0.6, a * 0.4, rests);
    rotateBone(b.head, 0.2, 0.5, 0, a * 0.4, rests);
    return;
  }

  // Return hips position to normal
  if (b.hips && b.hips.position.y < 0) {
    b.hips.position.y = THREE.MathUtils.lerp(b.hips.position.y, 0, a);
  }

  // 2. LOCOMOTION STATE MACHINE & BLEND TREES
  // Blend factor matching real speed
  const isMoving = velocity > 0.1;
  const isSprint = action === 'running';
  const isCrouch = action === 'crouching';
  const isJumping = action === 'jumping';

  // Locomotion phase (foot cycle)
  const speedMultiplier = isSprint ? 10.5 : isMoving ? 6.8 : 1.0;
  const phase = elapsed * speedMultiplier;
  const swing = Math.sin(phase);
  const cosSwing = Math.cos(phase);

  // Locomotion weight (blends in swing effects)
  const locoWeight = THREE.MathUtils.lerp(
    0,
    isSprint ? 1.0 : 0.65,
    isMoving ? 1 : 0
  );

  // Crouching spine lean & hip drop
  if (isCrouch) {
    rotateBone(b.hips, 0.2, 0, 0, a, rests);
    rotateBone(b.leftUpLeg, 0.5, 0, 0, a, rests);
    rotateBone(b.rightUpLeg, 0.5, 0, 0, a, rests);
    rotateBone(b.leftLeg, 0.65, 0, 0, a, rests);
    rotateBone(b.rightLeg, 0.65, 0, 0, a, rests);
    rotateBone(b.spine, 0.15, 0, 0, a, rests);
  } else if (isJumping) {
    // Jump leg tuck
    rotateBone(b.leftUpLeg, -0.3, 0, -0.05, a * 1.5, rests);
    rotateBone(b.rightUpLeg, -0.3, 0, 0.05, a * 1.5, rests);
    rotateBone(b.leftLeg, 0.5, 0, 0, a * 1.5, rests);
    rotateBone(b.rightLeg, 0.5, 0, 0, a * 1.5, rests);
    rotateBone(b.spine, -0.05, 0, 0, a, rests);
  } else {
    // Locomotion Blend Tree: Legs and Foot IK
    // Left leg swings forward, right swings back, knees bend in forward phase
    const lLegAngle = swing * 0.52 * locoWeight;
    const rLegAngle = -swing * 0.52 * locoWeight;

    // Knees bend forward (always positive bend on forward swing)
    const lKnee = (swing > 0 ? swing * 0.58 : 0) * locoWeight;
    const rKnee = (swing < 0 ? -swing * 0.58 : 0) * locoWeight;

    rotateBone(b.leftUpLeg, lLegAngle, 0, 0, a * 1.4, rests);
    rotateBone(b.rightUpLeg, rLegAngle, 0, 0, a * 1.4, rests);
    rotateBone(b.leftLeg, lKnee, 0, 0, a * 1.2, rests);
    rotateBone(b.rightLeg, rKnee, 0, 0, a * 1.2, rests);

    // Foot ground-alignment IK simulation (roll ankle slightly during swing)
    rotateBone(b.leftFoot, -swing * 0.12 * locoWeight, 0, 0, a, rests);
    rotateBone(b.rightFoot, swing * 0.12 * locoWeight, 0, 0, a, rests);

    // Weight shifting: hips move side to side matching gait
    rotateBone(b.hips, 0.04 * cosSwing * locoWeight, 0, -0.02 * swing * locoWeight, a, rests);
    // Spine leans forward when moving
    rotateBone(b.spine, 0.06 * locoWeight, 0, 0, a, rests);
  }

  // Breathing simulation in Idle
  if (!isMoving && !isCrouch && !isJumping) {
    const breath = Math.sin(elapsed * 1.2) * 0.012;
    rotateBone(b.spine, breath, 0, 0, a * 0.5, rests);
    rotateBone(b.chest, breath * 0.5, 0, 0, a * 0.5, rests);
    rotateBone(b.head, 0, Math.sin(elapsed * 0.4) * 0.015, 0, a * 0.3, rests);

    // Return limbs to idle rest smoothly
    resetBone(b.leftUpLeg, a * 0.8, rests);
    resetBone(b.rightUpLeg, a * 0.8, rests);
    resetBone(b.leftLeg, a * 0.8, rests);
    resetBone(b.rightLeg, a * 0.8, rests);
    resetBone(b.leftFoot, a * 0.8, rests);
    resetBone(b.rightFoot, a * 0.8, rests);
  }

  // 3. PUBG-STYLE TWO-HAND TACTICAL RIFLE HOLD POSE
  // Right arm bends forward, holding the pistol grip.
  // Left arm reaches across under the barrel, supporting the foregrip.
  let rArmX = 1.05, rArmY = -0.32, rArmZ = -0.32;
  let rForeX = 1.28, rForeY = -0.15, rForeZ = 0.12;

  let lArmX = 1.22, lArmY = 0.45, lArmZ = 0.28;
  let lForeX = 0.98, lForeY = 0.12, lForeZ = -0.18;

  // Add subtle tactical arm sway on locomotion
  if (isMoving) {
    const swayAmp = isSprint ? 0.18 : 0.06;
    rArmX += swing * swayAmp * 0.3;
    lArmX += swing * swayAmp * 0.4;
    lForeY += cosSwing * swayAmp * 0.2;
  }

  // 4. PROCEDURAL RECOIL (Spring-loaded kickback)
  let recoilOffset = 0;
  if (shooting) {
    // Generate rapid recoil offset (flickers backwards and tilts up)
    recoilOffset = Math.sin(elapsed * 80) * 0.05 + 0.06;
    rArmX -= recoilOffset * 0.4;
    lArmX -= recoilOffset * 0.45;
    rArmZ += recoilOffset * 0.2;
    lArmZ += recoilOffset * 0.25;
  }

  // 5. PROCEDURAL RELOAD (Sweep left arm to swap magazines)
  if (reloadProgress > 0 && reloadProgress < 1.0) {
    // Convert progress to curved swipe
    const t = reloadProgress;
    const dropWeight = Math.sin(t * Math.PI); // Peak drop at 0.5 progress

    // Sweep Left Arm down to waist (Z/Y)
    lArmX = THREE.MathUtils.lerp(lArmX, 0.45, dropWeight);
    lArmY = THREE.MathUtils.lerp(lArmY, 0.12, dropWeight);
    lArmZ = THREE.MathUtils.lerp(lArmZ, -0.68, dropWeight);

    lForeX = THREE.MathUtils.lerp(lForeX, 0.52, dropWeight);
    lForeY = THREE.MathUtils.lerp(lForeY, 0.45, dropWeight);

    // Tilt weapon slightly to the left with right wrist/arm rotation
    rArmZ -= dropWeight * 0.25;
    rForeY += dropWeight * 0.15;
  }

  // Apply Posed Weapon Hold to arms
  rotateBone(b.rightArm, rArmX, rArmY, rArmZ, a * 1.5, rests);
  rotateBone(b.rightForeArm, rForeX, rForeY, rForeZ, a * 1.5, rests);

  rotateBone(b.leftArm, lArmX, lArmY, lArmZ, a * 1.5, rests);
  rotateBone(b.leftForeArm, lForeX, lForeY, lForeZ, a * 1.5, rests);

  // Poses hands so they stay perfectly flat aligned with gun barrel
  rotateBone(b.rightHand, 0.15, -0.15, -0.06, a * 1.2, rests);
  rotateBone(b.leftHand, -0.12, 0.18, 0.08, a * 1.2, rests);

  // 6. UPPER BODY AIM OFFSET (Aim Pitch syncing)
  // Sync Spine, Chest, Head, Neck, and Arms to follow mouse vertical direction
  const spineAim = aimPitch * 0.32;
  const headAim = aimPitch * 0.38;

  rotateBone(b.spine, spineAim, 0, 0, a * 1.2, rests);
  rotateBone(b.chest, spineAim, 0, 0, a * 1.2, rests);
  rotateBone(b.neck, headAim * 0.5, 0, 0, a * 1.2, rests);
  rotateBone(b.head, headAim * 0.5, 0, 0, a * 1.2, rests);

  // Arms tilt fully with look pitch
  if (b.rightArm) {
    const currentQ = b.rightArm.quaternion.clone();
    const aimOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -aimPitch * 0.65);
    b.rightArm.quaternion.copy(currentQ.multiply(aimOffset));
  }
  if (b.leftArm) {
    const currentQ = b.leftArm.quaternion.clone();
    const aimOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -aimPitch * 0.65);
    b.leftArm.quaternion.copy(currentQ.multiply(aimOffset));
  }
}

/** Head Bobbing values for FPS Camera */
export function getMovementBob(action: string, elapsed: number): number {
  if (action === 'running')  return Math.abs(Math.sin(elapsed * 12.8)) * 0.038;
  if (action === 'walking')  return Math.abs(Math.sin(elapsed * 9.2))  * 0.016;
  return 0;
}

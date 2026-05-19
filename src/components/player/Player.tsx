import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Vector3, Euler } from 'three';
import * as THREE from 'three';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useInputStore } from '../../store/useInputStore';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useGameStore } from '../../store/useGameStore';
import { WEAPONS } from '../weapons/WeaponManager';
import { MuzzleFlash } from '../effects/MuzzleFlash';
import {
  findBones, captureRestPoses, applyProceduralAnimation, getMovementBob,
  type BoneSet, type RestPoses,
} from './ProceduralAnimator';

/* ─── Constants ─────────────────────────────────────────────────────────────── */
const SPEED        = 5;
const SPRINT_MUL   = 1.9;
const JUMP_FORCE   = 8.5;
const NETWORK_TICK = 1 / 30;
const TARGET_H     = 1.75;
const FOOT_OFFSET  = 1.0;
// PUBG-style shoulder cam
const CAM_DIST  = 3.0;
const CAM_H     = 1.3;
const CAM_RIGHT = 0.4;   // right shoulder offset

const PLAYER_MODEL = '/models/characters/hero__character.glb';

/* ─── Pre-allocated (no allocations inside useFrame) ────────────────────────── */
const _front  = new Vector3();
const _side   = new Vector3();
const _dir    = new Vector3();
const _yawEul = new Euler(0, 0, 0, 'YXZ');
const _camPos = new Vector3();
const _camTgt = new Vector3();
const _charPos = new Vector3();
const _wPos   = new THREE.Vector3();
const _wQ     = new THREE.Quaternion();
const _piQ    = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
const _rhKW   = ['righthand','handr','r_hand','wristr','rhand','hand_r','handright','mixamorigrighthand'];

function findRH(model: THREE.Object3D): THREE.Object3D | null {
  let f: THREE.Object3D | null = null;
  model.traverse(o => {
    if (f) return;
    const n = o.name.toLowerCase().replace(/[\s\-_.]/g,'');
    if (_rhKW.some(k => n.includes(k))) f = o;
  });
  return f;
}

/* ─── Local weapon (attached to player's hand bone) ─────────────────────────── */
const LocalWeapon = ({
  weaponIdx, handBoneRef, charRef, shooting,
}: {
  weaponIdx: number;
  handBoneRef: React.MutableRefObject<THREE.Object3D | null>;
  charRef: React.MutableRefObject<THREE.Group | null>;
  shooting: boolean;
}) => {
  const w = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(w.modelPath) as { scene: THREE.Group };
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const max = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (max > 0) c.scale.setScalar(0.58 / max);
    return c;
  }, [scene]);

  const wRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!wRef.current) return;
    const hand = handBoneRef.current;
    const body = charRef.current;
    if (hand) {
      hand.getWorldPosition(_wPos);
      hand.getWorldQuaternion(_wQ);
      wRef.current.position.copy(_wPos);
      wRef.current.quaternion.copy(_wQ).multiply(_piQ);
    } else if (body) {
      body.getWorldPosition(_wPos);
      body.getWorldQuaternion(_wQ);
      _wPos.y += 1.22; _wPos.x += 0.14;
      wRef.current.position.copy(_wPos);
      wRef.current.quaternion.copy(_wQ).multiply(_piQ);
    }
  });

  return (
    <group ref={wRef}>
      <primitive object={clone} />
      <MuzzleFlash active={shooting} />
    </group>
  );
};

/* ─── Player ─────────────────────────────────────────────────────────────────── */
export const Player = () => {
  const rbRef     = useRef<RapierRigidBody>(null);
  const { rapier, world } = useRapier();
  const vel       = useRef(new Vector3());
  const netTimer  = useRef(0);

  // Camera angles
  const yaw   = useRef(0);
  const pitch = useRef(-0.25);

  // Character refs
  const charRef    = useRef<THREE.Group>(null);
  const animRef    = useRef<THREE.Group>(null);
  const handRef    = useRef<THREE.Object3D | null>(null);

  // Animation state
  const bonesRef      = useRef<BoneSet | null>(null);
  const restRef       = useRef<RestPoses>(new Map());
  const hasClipsRef   = useRef(false);
  const lastActionRef = useRef('idle');
  const shootingRef   = useRef(false);
  const weaponIdxRef  = useRef(0);

  const sendUpdate = useNetworkStore(s => s.sendUpdate);

  // Load character
  const { scene, animations } = useGLTF(PLAYER_MODEL) as {
    scene: THREE.Group; animations: THREE.AnimationClip[];
  };
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;
    clone.updateMatrixWorld(true);
    const h = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_H / h);
    clone.updateMatrixWorld(true);
    clone.position.y = -new THREE.Box3().setFromObject(clone).min.y;
    clone.traverse(ch => {
      const m = ch as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    });
    return clone;
  }, [scene]);

  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    restRef.current   = captureRestPoses(clonedScene);
    bonesRef.current  = findBones(clonedScene);
    handRef.current   = findRH(clonedScene);
    hasClipsRef.current = Object.keys(actions).length > 0;
  }, [clonedScene, actions]);

  // Mouse look
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      yaw.current   -= e.movementX * 0.0022;
      pitch.current  = Math.max(-0.55, Math.min(0.45, pitch.current - e.movementY * 0.0022));
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  useFrame((state, delta) => {
    if (!rbRef.current) return;
    const rb = rbRef.current;
    const inp = useInputStore.getState();

    // Movement
    _front.set(0, 0, Number(inp.backward) - Number(inp.forward));
    _side.set(Number(inp.left) - Number(inp.right), 0, 0);
    _dir.subVectors(_front, _side);
    if (_dir.lengthSq() > 0) _dir.normalize();
    _dir.multiplyScalar(SPEED * (inp.sprint ? SPRINT_MUL : inp.crouch ? 0.5 : 1));
    _yawEul.set(0, yaw.current, 0);
    _dir.applyEuler(_yawEul);

    const cv = rb.linvel();
    const t  = Math.min(10 * delta, 1);
    vel.current.x = MathUtils.lerp(vel.current.x, _dir.x, t);
    vel.current.z = MathUtils.lerp(vel.current.z, _dir.z, t);
    vel.current.y = cv.y;

    // Ground check
    const pos = rb.translation();
    const ray = new rapier.Ray({ x: pos.x, y: pos.y - 1.05, z: pos.z }, { x: 0, y: -1, z: 0 });
    const grounded = world.castRay(ray, 0.25, true) !== null;
    if (inp.jump && grounded) vel.current.y = JUMP_FORCE;
    rb.setLinvel(vel.current, true);

    const feetY = pos.y - FOOT_OFFSET;

    // ── TPS Camera ──────────────────────────────────────────────────────────
    const cy = yaw.current, cp = pitch.current;
    const cosCp = Math.cos(cp), sinCp = Math.sin(cp);
    const sinCy = Math.sin(cy), cosCy = Math.cos(cy);

    // Shoulder-cam target (chest level)
    _camTgt.set(pos.x, feetY + 1.15, pos.z);

    // Camera orbits behind and right of character
    _camPos.set(
      pos.x + sinCy * CAM_DIST * cosCp + cosCy * CAM_RIGHT,
      feetY + 1.15 + (-sinCp) * CAM_DIST + CAM_H,
      pos.z + cosCy * CAM_DIST * cosCp - sinCy * CAM_RIGHT,
    );
    state.camera.position.lerp(_camPos, Math.min(delta * 22, 1));
    state.camera.lookAt(_camTgt);

    // ── Character position + smooth yaw ─────────────────────────────────────
    if (charRef.current) {
      _charPos.set(pos.x, feetY, pos.z);
      charRef.current.position.copy(_charPos);
      // Character always faces same direction as camera (PUBG-style)
      charRef.current.rotation.y = MathUtils.lerp(
        charRef.current.rotation.y,
        cy + Math.PI,
        Math.min(delta * 12, 1),
      );
    }

    // ── Determine action ─────────────────────────────────────────────────────
    const isMoving = inp.forward || inp.backward || inp.left || inp.right;
    const hSpeed   = Math.sqrt(vel.current.x ** 2 + vel.current.z ** 2);
    const action   =
      inp.crouch         ? 'crouching' :
      !grounded && vel.current.y > 0.5 ? 'jumping' :
      inp.sprint && isMoving ? 'running'  :
      isMoving           ? 'walking'  :
      inp.shoot          ? 'shooting' :
                           'idle';

    shootingRef.current  = inp.shoot;
    weaponIdxRef.current = inp.weapon1 ? 0 : inp.weapon2 ? 1 : weaponIdxRef.current;

    // Switch GLB clip when action changes
    if (action !== lastActionRef.current) {
      lastActionRef.current = action;
      if (hasClipsRef.current) {
        const names = Object.keys(actions);
        const find  = (...kws: string[]) =>
          kws.reduce<string | undefined>((f, kw) => f ?? names.find(n => n.toLowerCase().includes(kw)), undefined)
          ?? names[0];
        const clip  =
          action === 'running'   ? find('run','sprint','jog')    :
          action === 'walking'   ? find('walk','move')            :
          action === 'shooting'  ? find('shoot','fire','attack')  :
          action === 'crouching' ? find('crouch','duck')          :
          action === 'jumping'   ? find('jump','leap')            :
                                   find('idle','stand','breath');
        const next = actions[clip];
        if (next) {
          Object.values(actions).forEach(a => a?.fadeOut(0.25));
          next.reset().fadeIn(0.25).play();
          next.setLoop(THREE.LoopRepeat, Infinity);
        }
      }
    }

    // Procedural animation (when no GLB clips)
    if (!hasClipsRef.current && bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(bonesRef.current, action, state.clock.getElapsedTime(), delta, restRef.current);
    }

    // Group Y-bob
    if (charRef.current) {
      charRef.current.position.y = feetY + getMovementBob(action, state.clock.getElapsedTime());
    }

    // Network broadcast
    netTimer.current += delta;
    if (netTimer.current >= NETWORK_TICK) {
      netTimer.current = 0;
      sendUpdate({
        name: useGameStore.getState().playerName ?? 'Player',
        position: [pos.x, pos.y, pos.z],
        rotation: [0, yaw.current, 0],
        action, velocity: hSpeed,
        weaponIdx: weaponIdxRef.current,
      } as Parameters<typeof sendUpdate>[0]);
    }
  });

  return (
    <>
      {/* Physics capsule — invisible, drives position */}
      <RigidBody
        ref={rbRef}
        colliders={false}
        mass={1}
        type="dynamic"
        position={[0, 20, 0]}
        enabledRotations={[false, false, false]}
        canSleep={false}
        linearDamping={0}
        angularDamping={100}
        restitution={0}
      >
        <CapsuleCollider args={[0.5, 0.5]} friction={0} restitution={0} />
      </RigidBody>

      {/* Visible character (third-person) */}
      <group ref={charRef}>
        <group ref={animRef}>
          <primitive object={clonedScene} />
        </group>
        <LocalWeapon
          weaponIdx={weaponIdxRef.current}
          handBoneRef={handRef}
          charRef={charRef}
          shooting={shootingRef.current}
        />
      </group>
    </>
  );
};

useGLTF.preload(PLAYER_MODEL);
WEAPONS.forEach(w => useGLTF.preload(w.modelPath));

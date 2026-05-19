import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Vector3, Euler } from 'three';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useInputStore } from '../../store/useInputStore';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useGameStore } from '../../store/useGameStore';
import { WEAPONS } from '../weapons/WeaponManager';
import { MuzzleFlash } from '../effects/MuzzleFlash';
import {
  findBones, captureRestPoses, calibrateSkeleton, applyProceduralAnimation, getMovementBob,
  type BoneSet, type RestPoses,
} from './ProceduralAnimator';

/* ─── Constants ─────────────────────────────────────────────────────────────── */
const SPEED        = 5.2;
const SPRINT_MUL   = 1.95;
const JUMP_FORCE   = 9.0;
const NETWORK_TICK = 1 / 30;
const TARGET_H     = 1.75;
const FOOT_OFFSET  = 1.0;

// TPS Camera offset values
const CAM_DIST  = 2.8;
const CAM_H     = 1.25;
const CAM_RIGHT = 0.45;

const PLAYER_MODEL = '/models/characters/hero__character.glb';

/* ─── Pre-allocated (avoid allocations inside useFrame) ─────────────────────── */
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

/* ─── Local weapon model ────────────────────────────────────────────────────── */
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
    if (max > 0) c.scale.setScalar(0.60 / max);
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
      _wPos.y += 1.25; _wPos.x += 0.15;
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

  // Mouse look view angles
  const yaw   = useRef(0);
  const pitch = useRef(-0.15);

  // Character hierarchy refs
  const charRef    = useRef<THREE.Group>(null);
  const animRef    = useRef<THREE.Group>(null);
  const handRef    = useRef<THREE.Object3D | null>(null);

  // Dynamic Spawning Control
  const spawned    = useRef(false);

  // Animation states
  const bonesRef      = useRef<BoneSet | null>(null);
  const restRef       = useRef<RestPoses>(new Map());

  // Procedural reload variables
  const reloadTimer    = useRef(0);
  const reloadDuration = useRef(2.5);
  const isReloading    = useRef(false);

  const sendUpdate = useNetworkStore(s => s.sendUpdate);
  const isDead     = useGameStore(s => s.isDead);
  const weapon2Input = useInputStore(s => s.weapon2);
  const shootInput   = useInputStore(s => s.shoot);
  const ammoState    = useGameStore(s => s.ammo);

  // Load hero character model
  const { scene } = useGLTF(PLAYER_MODEL) as { scene: THREE.Group };
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

  // Map bones & apply T-pose calibration once on mount
  useEffect(() => {
    restRef.current   = captureRestPoses(clonedScene);
    bonesRef.current  = findBones(clonedScene);
    if (bonesRef.current) {
      calibrateSkeleton(bonesRef.current, restRef.current);
    }
    handRef.current   = bonesRef.current ? bonesRef.current.rightHand : null;
  }, [clonedScene]);

  // Respawn listener to re-align with ground heights
  const lastDead = useRef(isDead);
  useEffect(() => {
    if (lastDead.current && !isDead) {
      spawned.current = false;
    }
    lastDead.current = isDead;
  }, [isDead]);

  // Mouse look capture
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
    if (!rbRef.current || isDead) return;
    const rb = rbRef.current;
    const inp = useInputStore.getState();

    // ── Spawning terrain height correction (Step 9) ──
    if (!spawned.current) {
      const pos = rb.translation();
      const spawnRay = new rapier.Ray({ x: pos.x, y: 60, z: pos.z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(spawnRay, 120, true);
      if (hit !== null) {
        const hitPoint = spawnRay.pointAt((hit as any).toi);
        rb.setTranslation({ x: pos.x, y: hitPoint.y + 1.25, z: pos.z }, true);
        spawned.current = true;
      }
    }

    const currentWeapon = WEAPONS[inp.weapon2 ? 1 : 0];

    // ── Locomotion movement logic ──
    _front.set(0, 0, Number(inp.backward) - Number(inp.forward));
    _side.set(Number(inp.left) - Number(inp.right), 0, 0);
    _dir.subVectors(_front, _side);
    if (_dir.lengthSq() > 0) _dir.normalize();
    _dir.multiplyScalar(SPEED * (inp.sprint ? SPRINT_MUL : inp.crouch ? 0.45 : 1));
    _yawEul.set(0, yaw.current, 0);
    _dir.applyEuler(_yawEul);

    const cv = rb.linvel();
    const t  = Math.min(11 * delta, 1);
    vel.current.x = MathUtils.lerp(vel.current.x, _dir.x, t);
    vel.current.z = MathUtils.lerp(vel.current.z, _dir.z, t);
    vel.current.y = cv.y;

    // Ground raycast check
    const pos = rb.translation();
    const ray = new rapier.Ray({ x: pos.x, y: pos.y - 1.05, z: pos.z }, { x: 0, y: -1, z: 0 });
    const grounded = world.castRay(ray, 0.28, true) !== null;
    if (inp.jump && grounded) vel.current.y = JUMP_FORCE;
    rb.setLinvel(vel.current, true);

    const feetY = pos.y - FOOT_OFFSET;

    // Determine current locomotion action
    const isMoving = inp.forward || inp.backward || inp.left || inp.right;
    const hSpeed   = Math.sqrt(vel.current.x ** 2 + vel.current.z ** 2);
    const action   =
      inp.crouch         ? 'crouching' :
      !grounded && vel.current.y > 0.5 ? 'jumping' :
      inp.sprint && isMoving ? 'running'  :
      isMoving           ? 'walking'  :
                           'idle';

    // ── ADS Camera FOV Zoom ──
    const targetFov = inp.ads ? 48 : 90;
    const persCam = state.camera as THREE.PerspectiveCamera;
    if (persCam.isPerspectiveCamera) {
      persCam.fov = MathUtils.lerp(persCam.fov, targetFov, delta * 12);
      persCam.updateProjectionMatrix();
    }

    // ── Camera Modes (FPS / TPS with KeyV Toggle) ──
    const viewMode = inp.viewMode;
    const cy = yaw.current, cp = pitch.current;
    const cosCp = Math.cos(cp), sinCp = Math.sin(cp);
    const sinCy = Math.sin(cy), cosCy = Math.cos(cy);

    if (viewMode === 'fps') {
      // Anchor FPS camera inside head (with walk/run bobbing values)
      const bob = getMovementBob(action, state.clock.getElapsedTime());
      _camPos.set(pos.x, feetY + 1.62 + bob, pos.z);
      state.camera.position.copy(_camPos);

      // Rotate camera using mouse rotation parameters directly
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ'));
      state.camera.quaternion.copy(q);
    } else {
      // Shoulder-cam target (chest level)
      _camTgt.set(pos.x, feetY + 1.15, pos.z);

      // Orbit behind and right of character
      _camPos.set(
        pos.x + sinCy * CAM_DIST * cosCp + cosCy * CAM_RIGHT,
        feetY + 1.15 + (-sinCp) * CAM_DIST + CAM_H,
        pos.z + cosCy * CAM_DIST * cosCp - sinCy * CAM_RIGHT,
      );
      state.camera.position.lerp(_camPos, Math.min(delta * 22, 1));
      state.camera.lookAt(_camTgt);
    }

    // ── Local Character Mesh Hiding in FPS ──
    clonedScene.traverse(ch => {
      const m = ch as THREE.Mesh;
      if (!m.isMesh) return;
      const name = m.name.toLowerCase();
      const isHeadPart = name.includes('head') || name.includes('neck') || name.includes('hair') ||
                         name.includes('face') || name.includes('eye') || name.includes('glass') ||
                         name.includes('helmet') || name.includes('mouth');
      if (isHeadPart) {
        m.visible = viewMode === 'tps'; // completely hides head to prevent hollow model clipping!
      }
    });

    // Character position and facing rotation sync
    if (charRef.current) {
      _charPos.set(pos.x, feetY, pos.z);
      charRef.current.position.copy(_charPos);
      if (viewMode === 'fps') {
        charRef.current.rotation.y = yaw.current + Math.PI;
      } else {
        charRef.current.rotation.y = MathUtils.lerp(
          charRef.current.rotation.y,
          yaw.current + Math.PI,
          Math.min(delta * 12, 1),
        );
      }
    }

    // ── Procedural Reload Action Trigger ──
    const ammo = useGameStore.getState().ammo;
    const magazines = useGameStore.getState().magazines;
    if (inp.reload && !isReloading.current && ammo < currentWeapon.magazineSize && magazines > 0) {
      isReloading.current = true;
      reloadTimer.current = 0;
      reloadDuration.current = currentWeapon.reloadTime;
    }

    if (isReloading.current) {
      reloadTimer.current += delta;
      if (reloadTimer.current >= reloadDuration.current) {
        isReloading.current = false;
        reloadTimer.current = 0;
      }
    }

    // ── Procedural animation pipeline ──
    if (bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(
        bonesRef.current,
        {
          action,
          elapsed: state.clock.getElapsedTime(),
          delta,
          aimPitch: pitch.current,
          shooting: inp.shoot && ammo > 0 && !isReloading.current,
          reloadProgress: isReloading.current ? (reloadTimer.current / reloadDuration.current) : 0,
          velocity: hSpeed,
          isDead: false,
        },
        restRef.current
      );
    }

    // Network Sync broadcast at 30Hz
    netTimer.current += delta;
    if (netTimer.current >= NETWORK_TICK) {
      netTimer.current = 0;
      sendUpdate({
        name: useGameStore.getState().playerName ?? 'Player',
        position: [pos.x, pos.y, pos.z],
        rotation: [0, yaw.current, 0],
        action: isReloading.current ? 'reloading' : action,
        velocity: hSpeed,
        weaponIdx: inp.weapon2 ? 1 : 0,
        aimPitch: pitch.current,
        shooting: inp.shoot && ammo > 0 && !isReloading.current,
        reloadProgress: isReloading.current ? (reloadTimer.current / reloadDuration.current) : 0,
      } as Parameters<typeof sendUpdate>[0]);
    }
  });

  return (
    <>
      <RigidBody
        ref={rbRef}
        colliders={false}
        mass={1}
        type="dynamic"
        position={[0, 15, 0]}
        enabledRotations={[false, false, false]}
        canSleep={false}
        linearDamping={0}
        angularDamping={100}
        restitution={0}
      >
        <CapsuleCollider args={[0.55, 0.45]} friction={0} restitution={0} />
      </RigidBody>

      <group ref={charRef}>
        <group ref={animRef}>
          <primitive object={clonedScene} />
        </group>
        <LocalWeapon
          weaponIdx={weapon2Input ? 1 : 0}
          handBoneRef={handRef}
          charRef={charRef}
          shooting={shootInput && ammoState > 0 && !isReloading.current}
        />
      </group>
    </>
  );
};

useGLTF.preload(PLAYER_MODEL);
WEAPONS.forEach(w => useGLTF.preload(w.modelPath));

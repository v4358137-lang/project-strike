/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';
import { findBones, captureRestPoses, applyProceduralAnimation, getMovementBob, type BoneSet, type RestPoses } from './ProceduralAnimator';
import { MuzzleFlash } from '../effects/MuzzleFlash';

/* ─── Constants ─────────────────────────────────────────────────────────────── */
const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];
const TARGET_HEIGHT = 1.75;
const FOOT_OFFSET   = 1.0; // capsule halfHeight(0.5) + radius(0.5)

function stableIdx(id: string, n: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

/* ─── Right-hand bone keyword list ──────────────────────────────────────────── */
const RIGHT_HAND_KW = [
  'righthand','handr','r_hand','wristr','rightwrist',
  'rhand','hand_r','handright','palmr','mixamorigrighthand',
];

function findRightHandBone(model: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  model.traverse(obj => {
    if (found) return;
    const n = obj.name.toLowerCase().replace(/[\s\-_.]/g, '');
    if (RIGHT_HAND_KW.some(k => n.includes(k))) found = obj;
  });
  return found;
}

/* ─── Weapon component: tracked to right-hand bone ──────────────────────────── */
const _wp  = new THREE.Vector3();
const _wq  = new THREE.Quaternion();
const _wu  = new THREE.Vector3(1, 0, 0);  // up for slerp
const _adj = new THREE.Quaternion();       // weapon-local adjustment

interface WeaponProps {
  weaponIdx: number;
  handBone: THREE.Object3D | null;
  fallbackGroup: THREE.Group | null;
  shooting: boolean;
}

const WeaponAttachment = ({ weaponIdx, handBone, fallbackGroup, shooting }: WeaponProps) => {
  const w = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(w.modelPath) as { scene: THREE.Group };

  const { clone: weaponClone, scale: weaponScale } = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.updateMatrixWorld(true);
    const box    = new THREE.Box3().setFromObject(c);
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    const s      = maxDim > 0 ? 0.60 / maxDim : 1;
    return { clone: c, scale: s };
  }, [scene]);

  const groupRef = useRef<THREE.Group>(null);

  // Per-frame: track hand bone in world space
  useFrame(() => {
    if (!groupRef.current) return;

    if (handBone) {
      // Track the actual right hand bone → weapon follows animation perfectly
      handBone.getWorldPosition(_wp);
      handBone.getWorldQuaternion(_wq);
      groupRef.current.position.copy(_wp);
      groupRef.current.quaternion.copy(_wq);
      // Small visual offset so gun grip aligns with palm
      groupRef.current.quaternion.multiply(
        _adj.setFromAxisAngle(_wu, Math.PI * 0.5)
      );
    } else if (fallbackGroup) {
      // Fallback: fixed position at shoulder height
      fallbackGroup.getWorldPosition(_wp);
      groupRef.current.position.copy(_wp);
      groupRef.current.position.y += 1.25;
      groupRef.current.position.z -= 0.08;
      groupRef.current.position.x += 0.15;
      groupRef.current.rotation.set(-0.05, Math.PI, -0.05);
    }
  });

  return (
    <group ref={groupRef}>
      <group scale={[weaponScale, weaponScale, weaponScale]}>
        <primitive object={weaponClone} />
      </group>
      <MuzzleFlash active={shooting} />
    </group>
  );
};

/* ─── Individual remote player ────────────────────────────────────────────────── */
const RemotePlayerMesh = ({ player, charIdx }: { player: RemotePlayerState; charIdx: number }) => {
  const groupRef    = useRef<THREE.Group>(null);
  const animRef     = useRef<THREE.Group>(null);

  const bonesRef    = useRef<BoneSet | null>(null);
  const restRef     = useRef<RestPoses>(new Map());
  const handBoneRef = useRef<THREE.Object3D | null>(null);
  const hasClipsRef = useRef(false);

  const footWorldY = useCallback((cy: number) => cy - FOOT_OFFSET, []);

  const targetPos  = useRef(new THREE.Vector3(
    player.position[0], footWorldY(player.position[1]), player.position[2],
  ));
  const targetRotY = useRef(player.rotation[1]);

  const { scene, animations } = useGLTF(CHARACTER_MODELS[charIdx]) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  /* ── Clone: shares material refs → original colours/textures preserved ────── */
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // 1. Scale to human height
    clone.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(clone);
    const h    = box1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    // 2. Shift so feet → local Y 0 (moves ALL children together → no split body)
    clone.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(clone);
    clone.position.y = -box2.min.y;

    // 3. Tag meshes — do NOT touch materials (keeps original colours)
    clone.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData['playerId'] = player.id;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });

    return clone;
  }, [scene, player.id]);

  /* ── Setup: capture rest poses, find bones, find hand bone ───────────────── */
  useEffect(() => {
    restRef.current     = captureRestPoses(clonedScene);
    bonesRef.current    = findBones(clonedScene);
    handBoneRef.current = findRightHandBone(clonedScene);
  }, [clonedScene]);

  /* ── GLB clip playback (used when model has embedded animations) ─────────── */
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    const clipNames = Object.keys(actions);
    hasClipsRef.current = clipNames.length > 0;
    if (!hasClipsRef.current) return;

    const find = (...kws: string[]) =>
      kws.reduce<string | undefined>(
        (f, kw) => f ?? clipNames.find(n => n.toLowerCase().includes(kw)),
        undefined,
      ) ?? clipNames[0];

    const clip =
      player.action === 'running'   ? find('run', 'sprint', 'jog')   :
      player.action === 'walking'   ? find('walk', 'move')            :
      player.action === 'shooting'  ? find('shoot', 'fire', 'attack') :
      player.action === 'crouching' ? find('crouch', 'duck')          :
      player.action === 'jumping'   ? find('jump', 'leap')            :
                                      find('idle', 'stand', 'breath');

    const next = actions[clip];
    if (!next) return;
    Object.values(actions).forEach(ac => ac?.fadeOut(0.25));
    next.reset().fadeIn(0.25).play();
    next.setLoop(THREE.LoopRepeat, Infinity);
    return () => { next.fadeOut(0.2); };
  }, [player.action, actions]);

  /* ── Per-frame: procedural animation + smooth interpolation ──────────────── */
  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const elapsed = clock.getElapsedTime();

    // Rest-pose-additive procedural animation (safe for any GLB rig)
    if (!hasClipsRef.current && bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(
        bonesRef.current, player.action, elapsed, delta, restRef.current,
      );
    }

    // Group-level bob (adds movement feel without touching bones)
    const bob = getMovementBob(player.action, elapsed);

    const al = Math.min(delta * 18, 1);
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, targetPos.current.x, al);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, targetPos.current.z, al);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, targetPos.current.y + bob, al);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotY.current, al);
  });

  useEffect(() => {
    targetPos.current.set(
      player.position[0], footWorldY(player.position[1]), player.position[2],
    );
    targetRotY.current = player.rotation[1];
  }, [player.position, player.rotation, footWorldY]);

  if (player.isDead) return null;

  const hp   = player.health / 100;
  const hCol = hp > 0.5 ? '#2dc653' : hp > 0.25 ? '#f4a261' : '#e63946';

  return (
    <>
      {/* Main character group */}
      <group
        ref={groupRef}
        position={[player.position[0], footWorldY(player.position[1]), player.position[2]]}
      >
        <group ref={animRef}>
          <primitive object={clonedScene} />
        </group>

        {/* Name tag + health bar (billboarded) */}
        <Billboard follow position={[0, TARGET_HEIGHT + 0.42, 0]}>
          <Text fontSize={0.15} color="#fff" anchorX="center" anchorY="bottom"
            outlineWidth={0.012} outlineColor="#000" position={[0, 0.12, 0]}>
            {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
          </Text>
          <mesh>
            <planeGeometry args={[0.65, 0.065]} />
            <meshBasicMaterial color="#111" transparent opacity={0.82} />
          </mesh>
          <mesh position={[-(0.325 - 0.65 * hp / 2), 0, 0.001]}>
            <planeGeometry args={[0.65 * hp, 0.065]} />
            <meshBasicMaterial color={hCol} />
          </mesh>
        </Billboard>
      </group>

      {/* Weapon tracked to hand bone (scene-level so it can use world coords) */}
      <WeaponAttachment
        weaponIdx={player.weaponIdx ?? 0}
        handBone={handBoneRef.current}
        fallbackGroup={groupRef.current}
        shooting={player.action === 'shooting'}
      />
    </>
  );
};

/* ─── Container ───────────────────────────────────────────────────────────────── */
export const RemotePlayers = () => {
  const remote = useNetworkStore(s => s.remotePlayers);
  return (
    <>
      {Array.from(remote.values()).map(p => (
        <RemotePlayerMesh
          key={p.id}
          player={p}
          charIdx={stableIdx(p.id, CHARACTER_MODELS.length)}
        />
      ))}
    </>
  );
};

CHARACTER_MODELS.forEach(m => useGLTF.preload(m));
WEAPONS.forEach(w => useGLTF.preload(w.modelPath));

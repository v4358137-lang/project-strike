/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';
import {
  findBones, captureRestPoses, applyProceduralAnimation, getMovementBob,
  type BoneSet, type RestPoses,
} from './ProceduralAnimator';
import { MuzzleFlash } from '../effects/MuzzleFlash';

/* ─── Character models (preloaded) ──────────────────────────────────────────── */
const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];
const TARGET_HEIGHT = 1.75;
const FOOT_OFFSET   = 1.0;

function stableIdx(id: string, n: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

/* ─── Right-hand bone search ─────────────────────────────────────────────────── */
const RH_KEYWORDS = [
  'righthand','handr','r_hand','wristr','rightwrist',
  'rhand','hand_r','handright','palmr','mixamorigrighthand',
];

function findRightHandBone(model: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  model.traverse(obj => {
    if (found) return;
    const n = obj.name.toLowerCase().replace(/[\s\-_.]/g, '');
    if (RH_KEYWORDS.some(k => n.includes(k))) found = obj;
  });
  return found;
}

/* ─── Pre-allocated THREE objects (never allocate inside useFrame) ───────────── */
const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _pi = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/* ─── Weapon attached to hand bone (or shoulder fallback) ────────────────────── */
const HandWeapon = ({
  weaponIdx,
  handBoneRef,
  groupRef,
  shooting,
}: {
  weaponIdx: number;
  handBoneRef: React.MutableRefObject<THREE.Object3D | null>;
  groupRef: React.MutableRefObject<THREE.Group | null>;
  shooting: boolean;
}) => {
  const w = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(w.modelPath) as { scene: THREE.Group };

  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.updateMatrixWorld(true);
    const box    = new THREE.Box3().setFromObject(c);
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (maxDim > 0) c.scale.setScalar(0.58 / maxDim);
    return c;
  }, [scene]);

  const wRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!wRef.current) return;
    const hand = handBoneRef.current;
    const body = groupRef.current;

    if (hand) {
      // Track the actual hand bone in world space
      hand.getWorldPosition(_wp);
      hand.getWorldQuaternion(_wq);
      wRef.current.position.copy(_wp);
      wRef.current.quaternion.copy(_wq);
      wRef.current.quaternion.multiply(_pi); // flip barrel to face forward
    } else if (body) {
      // Fallback: fixed position at shoulder height in group-local space
      body.getWorldPosition(_wp);
      _wp.y += 1.22;
      _wp.x += 0.14;
      // Forward offset using body's facing direction
      body.getWorldQuaternion(_wq);
      const fwd = new THREE.Vector3(0, 0, -0.06).applyQuaternion(_wq);
      _wp.add(fwd);
      wRef.current.position.copy(_wp);
      wRef.current.quaternion.copy(_wq).multiply(_pi);
    }
  });

  return (
    <group ref={wRef}>
      <primitive object={clone} />
      <MuzzleFlash active={shooting} />
    </group>
  );
};

/* ─── Single remote player ──────────────────────────────────────────────────── */
const RemotePlayerMesh = ({
  player, charIdx,
}: { player: RemotePlayerState; charIdx: number }) => {

  const groupRef    = useRef<THREE.Group>(null);
  const animRef     = useRef<THREE.Group>(null);
  const bonesRef    = useRef<BoneSet | null>(null);
  const restRef     = useRef<RestPoses>(new Map());
  const handBoneRef = useRef<THREE.Object3D | null>(null);
  const hasClipsRef = useRef(false);

  const footY = useCallback((cy: number) => cy - FOOT_OFFSET, []);

  const tPos  = useRef(new THREE.Vector3(player.position[0], footY(player.position[1]), player.position[2]));
  const tRotY = useRef(player.rotation[1]);

  const { scene, animations } = useGLTF(CHARACTER_MODELS[charIdx]) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  /* ── Clone: shares original material refs → textures/colours preserved ────── */
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    clone.updateMatrixWorld(true);
    const b1 = new THREE.Box3().setFromObject(clone);
    const h  = b1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    clone.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(clone);
    clone.position.y = -b2.min.y; // all meshes lifted together → no split body

    clone.traverse(ch => {
      const m = ch as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData['playerId'] = player.id;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    });

    return clone;
  }, [scene, player.id]);

  /* ── Setup bones + rest poses after clone is ready ───────────────────────── */
  useEffect(() => {
    restRef.current     = captureRestPoses(clonedScene);
    bonesRef.current    = findBones(clonedScene);
    handBoneRef.current = findRightHandBone(clonedScene);
  }, [clonedScene]);

  /* ── GLB animation clips (play if the model has them) ────────────────────── */
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    const names = Object.keys(actions);
    hasClipsRef.current = names.length > 0;
    if (!hasClipsRef.current) return;

    const find = (...kws: string[]) =>
      kws.reduce<string | undefined>(
        (f, kw) => f ?? names.find(n => n.toLowerCase().includes(kw)),
        undefined,
      ) ?? names[0];

    const clip =
      player.action === 'running'   ? find('run','sprint','jog')   :
      player.action === 'walking'   ? find('walk','move')           :
      player.action === 'shooting'  ? find('shoot','fire','attack') :
      player.action === 'crouching' ? find('crouch','duck')         :
      player.action === 'jumping'   ? find('jump','leap')           :
                                      find('idle','stand','breath');

    const next = actions[clip];
    if (!next) return;
    Object.values(actions).forEach(a => a?.fadeOut(0.25));
    next.reset().fadeIn(0.25).play();
    next.setLoop(THREE.LoopRepeat, Infinity);
    return () => { next.fadeOut(0.2); };
  }, [player.action, actions]);

  /* ── Per-frame: animation + interpolation ────────────────────────────────── */
  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const elapsed = clock.getElapsedTime();

    if (!hasClipsRef.current && bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(
        bonesRef.current, player.action, elapsed, delta, restRef.current,
      );
    }

    const bob = getMovementBob(player.action, elapsed);
    const al  = Math.min(delta * 18, 1);

    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, tPos.current.x, al);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, tPos.current.z, al);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, tPos.current.y + bob, al);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, tRotY.current, al);
  });

  useEffect(() => {
    tPos.current.set(player.position[0], footY(player.position[1]), player.position[2]);
    tRotY.current = player.rotation[1];
  }, [player.position, player.rotation, footY]);

  if (player.isDead) return null;

  const hp   = player.health / 100;
  const hCol = hp > 0.5 ? '#2dc653' : hp > 0.25 ? '#f4a261' : '#e63946';

  return (
    <>
      {/* ── Character group ────────────────────────────────────────────────── */}
      <group
        ref={groupRef}
        position={[player.position[0], footY(player.position[1]), player.position[2]]}
      >
        <group ref={animRef}>
          <primitive object={clonedScene} />
        </group>

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

      {/* ── Weapon (rendered at scene root, tracked to hand bone each frame) ── */}
      <HandWeapon
        weaponIdx={player.weaponIdx ?? 0}
        handBoneRef={handBoneRef}
        groupRef={groupRef}
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

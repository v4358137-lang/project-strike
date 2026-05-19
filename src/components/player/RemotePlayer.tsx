/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';
import {
  findBones, captureRestPoses, calibrateSkeleton, applyProceduralAnimation, getMovementBob,
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

/* ─── Weapon attached to remote player hand bone ────────────────────────────── */
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
    if (maxDim > 0) c.scale.setScalar(0.60 / maxDim);
    return c;
  }, [scene]);

  const wRef = useRef<THREE.Group>(null);
  const _wp = new THREE.Vector3();
  const _wq = new THREE.Quaternion();
  const _pi = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  useFrame(() => {
    if (!wRef.current) return;
    const hand = handBoneRef.current;
    const body = groupRef.current;

    if (hand) {
      hand.getWorldPosition(_wp);
      hand.getWorldQuaternion(_wq);
      wRef.current.position.copy(_wp);
      wRef.current.quaternion.copy(_wq);
      wRef.current.quaternion.multiply(_pi); // face gun barrel forward
    } else if (body) {
      body.getWorldPosition(_wp);
      _wp.y += 1.25;
      _wp.x += 0.15;
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

/* ─── Single remote player mesh ────────────────────────────────────────────── */
const RemotePlayerMesh = ({
  player, charIdx,
}: { player: RemotePlayerState; charIdx: number }) => {

  const groupRef    = useRef<THREE.Group>(null);
  const animRef     = useRef<THREE.Group>(null);
  const bonesRef    = useRef<BoneSet | null>(null);
  const restRef     = useRef<RestPoses>(new Map());
  const handBoneRef = useRef<THREE.Object3D | null>(null);

  const footY = useCallback((cy: number) => cy - FOOT_OFFSET, []);

  const tPos  = useRef(new THREE.Vector3(player.position[0], footY(player.position[1]), player.position[2]));
  const tRotY = useRef(player.rotation[1]);

  const { scene } = useGLTF(CHARACTER_MODELS[charIdx]) as { scene: THREE.Group };

  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    clone.updateMatrixWorld(true);
    const b1 = new THREE.Box3().setFromObject(clone);
    const h  = b1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    clone.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(clone);
    clone.position.y = -b2.min.y;

    clone.traverse(ch => {
      const m = ch as THREE.Mesh;
      if (!m.isMesh) return;
      m.userData['playerId'] = player.id;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
    });

    return clone;
  }, [scene, player.id]);

  /* ── Setup bones, poses and T-pose calibration once on mount ─────────────── */
  useEffect(() => {
    restRef.current     = captureRestPoses(clonedScene);
    bonesRef.current    = findBones(clonedScene);
    if (bonesRef.current) {
      calibrateSkeleton(bonesRef.current, restRef.current);
    }
    handBoneRef.current = bonesRef.current ? bonesRef.current.rightHand : null;
  }, [clonedScene]);

  /* ── Interpolate position + run identical procedural blend tree ──────────── */
  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const elapsed = clock.getElapsedTime();

    if (bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(
        bonesRef.current,
        {
          action: player.action,
          elapsed,
          delta,
          aimPitch: player.aimPitch ?? 0,
          shooting: !!player.shooting,
          reloadProgress: player.reloadProgress ?? 0,
          velocity: player.velocity ?? 0,
          isDead: !!player.isDead,
        },
        restRef.current
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
      <group
        ref={groupRef}
        position={[player.position[0], footY(player.position[1]), player.position[2]]}
      >
        <group ref={animRef}>
          <primitive object={clonedScene} />
        </group>

        <Html position={[0, TARGET_HEIGHT + 0.35, 0]} center distanceFactor={8}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            fontFamily: "'Rajdhani', sans-serif", fontSize: '12px', color: '#fff',
            textShadow: '0 0 4px #000, 1px 1px 2px #000', pointerEvents: 'none', userSelect: 'none',
            whiteSpace: 'nowrap',
          }}>
            <div style={{ fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '3px' }}>
              {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
            </div>
            <div style={{
              width: '60px', height: '4px', backgroundColor: 'rgba(0, 0, 0, 0.6)',
              borderRadius: '2px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.8)',
            }}>
              <div style={{
                width: `${hp * 100}%`, height: '100%',
                backgroundColor: hCol, transition: 'width 0.1s ease',
              }} />
            </div>
          </div>
        </Html>
      </group>

      <HandWeapon
        weaponIdx={player.weaponIdx ?? 0}
        handBoneRef={handBoneRef}
        groupRef={groupRef}
        shooting={!!player.shooting}
      />
    </>
  );
};

/* ─── Remote players list container ─────────────────────────────────────────── */
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

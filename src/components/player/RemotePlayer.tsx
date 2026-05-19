/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
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

const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

// All characters scaled to this height via bounding-box normalisation
const TARGET_HEIGHT = 1.75;
// Capsule: halfHeight=0.5 + radius=0.5 → feet are 1.0 below capsule centre
const FOOT_OFFSET   = 1.0;

function stableIdx(id: string, n: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

// ── Weapon held at shoulder ────────────────────────────────────────────────────
const HandWeapon = ({ weaponIdx }: { weaponIdx: number }) => {
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

  return (
    <group position={[0.14, 1.20, -0.02]} rotation={[-0.05, Math.PI, -0.05]}>
      <primitive object={clone} />
    </group>
  );
};

// ── Individual remote player ───────────────────────────────────────────────────
const RemotePlayerMesh = ({
  player, charIdx,
}: { player: RemotePlayerState; charIdx: number }) => {

  const groupRef    = useRef<THREE.Group>(null);
  const animRef     = useRef<THREE.Group>(null);
  const bonesRef    = useRef<BoneSet | null>(null);
  const restRef     = useRef<RestPoses>(new Map());
  const hasClipsRef = useRef(false);

  const footWorldY  = (cy: number) => cy - FOOT_OFFSET;

  const targetPos   = useRef(new THREE.Vector3(
    player.position[0], footWorldY(player.position[1]), player.position[2],
  ));
  const targetRotY  = useRef(player.rotation[1]);

  const { scene, animations } = useGLTF(CHARACTER_MODELS[charIdx]) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  // ── Clone: shares material refs → original colours preserved ─────────────
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // 1. Scale to human height (1.75 m)
    clone.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(clone);
    const h    = box1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    // 2. Shift so feet are at local Y = 0 (applied to whole clone → no split body)
    clone.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(clone);
    clone.position.y = -box2.min.y;

    // 3. Tag meshes for raycast — do NOT clone/replace materials (keeps colours)
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

  // ── After clone ready: capture rest poses + find bones ───────────────────
  useEffect(() => {
    // Store rest quaternion for every bone BEFORE any animation starts
    restRef.current = captureRestPoses(clonedScene);
    bonesRef.current = findBones(clonedScene);
  }, [clonedScene]);

  // ── Try GLB embedded animation clips ─────────────────────────────────────
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    const clipNames = Object.keys(actions);
    hasClipsRef.current = clipNames.length > 0;
    if (!hasClipsRef.current) return; // will use procedural below

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

  // ── Per-frame update ──────────────────────────────────────────────────────
  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const elapsed = clock.getElapsedTime();

    // Procedural animation when no GLB clips (rest-pose-additive, never breaks rig)
    if (!hasClipsRef.current && bonesRef.current && restRef.current.size > 0) {
      applyProceduralAnimation(
        bonesRef.current, player.action, elapsed, delta, restRef.current,
      );
    }

    // Group-level Y-bob for movement feel
    const bob = getMovementBob(player.action, elapsed);

    // Smooth entity interpolation (XZ fast, Y includes bob)
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
  }, [player.position, player.rotation]);

  if (player.isDead) return null;

  const hp   = player.health / 100;
  const hCol = hp > 0.5 ? '#2dc653' : hp > 0.25 ? '#f4a261' : '#e63946';

  return (
    <group
      ref={groupRef}
      position={[player.position[0], footWorldY(player.position[1]), player.position[2]]}
    >
      {/* animRef wraps clonedScene — mixer finds all bones here */}
      <group ref={animRef}>
        <primitive object={clonedScene} />
      </group>

      <HandWeapon weaponIdx={player.weaponIdx} />

      <Billboard follow position={[0, TARGET_HEIGHT + 0.42, 0]}>
        <Text
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#000000"
          position={[0, 0.12, 0]}
        >
          {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
        </Text>
        <mesh>
          <planeGeometry args={[0.65, 0.065]} />
          <meshBasicMaterial color="#111111" transparent opacity={0.82} />
        </mesh>
        <mesh position={[-(0.325 - 0.65 * hp / 2), 0, 0.001]}>
          <planeGeometry args={[0.65 * hp, 0.065]} />
          <meshBasicMaterial color={hCol} />
        </mesh>
      </Billboard>
    </group>
  );
};

// ── Container ─────────────────────────────────────────────────────────────────
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

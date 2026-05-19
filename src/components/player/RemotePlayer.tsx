/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';

const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

// Human height in world units (capsule = 2 units tall, center broadcast)
const TARGET_HEIGHT = 1.75;
// Physics capsule: halfHeight=0.5, radius=0.5 → bottom = center - 1.0
const FOOT_OFFSET = 1.0;

function stableIdx(id: string, n: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

// Auto-scaled weapon placed at shoulder in a proper gun-hold position
const HandWeapon = ({ weaponIdx }: { weaponIdx: number }) => {
  const w = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(w.modelPath) as { scene: THREE.Group };

  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    // Measure actual size and scale weapon to ~65cm (realistic gun length)
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (maxDim > 0) c.scale.setScalar(0.65 / maxDim);
    return c;
  }, [scene]);

  // Right shoulder, chest height, barrel pointing forward along character -Z
  // rotationOffset [0, PI, 0] in weapon config means barrel faces -Z (forward)
  const rot = w.rotationOffset ?? [0, Math.PI, 0];
  return (
    <group position={[0.2, 1.3, 0.05]} rotation={rot as [number, number, number]}>
      <primitive object={clone} />
    </group>
  );
};

const RemotePlayerMesh = ({ player, charIdx }: { player: RemotePlayerState; charIdx: number }) => {
  const groupRef = useRef<THREE.Group>(null);
  const animRef  = useRef<THREE.Group>(null);

  // Target positions — foot level (capsule centre − 1)
  const footY    = (cy: number) => cy - FOOT_OFFSET;
  const targetPos = useRef(new THREE.Vector3(player.position[0], footY(player.position[1]), player.position[2]));
  const targetRotY = useRef(player.rotation[1]);

  const { scene, animations } = useGLTF(CHARACTER_MODELS[charIdx]) as { scene: THREE.Group; animations: THREE.AnimationClip[] };

  // Clone with SkeletonUtils (preserves skinned-mesh textures)
  const { clonedScene, yLift } = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // Scale to human height
    clone.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(clone);
    const h = box1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    // Compute how much to lift so feet land at local Y=0
    clone.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(clone);
    const lift = -box2.min.y; // lift = positive number

    // Tag all meshes for raycast hit detection + fix material visibility
    clone.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData['playerId'] = player.id;
      mesh.castShadow = mesh.receiveShadow = true;
      const fix = (m: THREE.Material) => { const c = m.clone(); c.needsUpdate = true; return c; };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
    });

    return { clonedScene: clone, yLift: lift };
  }, [scene, player.id]);

  // Animations — animRef wraps the primitive so mixer finds all bones
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    if (!actions || !animations.length) return;
    const names = Object.keys(actions);
    if (!names.length) return;

    const find = (...kws: string[]) =>
      kws.reduce<string | undefined>((found, kw) =>
        found ?? names.find(n => n.toLowerCase().includes(kw)), undefined) ?? names[0];

    const clip =
      player.action === 'running'   ? find('run', 'sprint', 'jog') :
      player.action === 'walking'   ? find('walk', 'move') :
      player.action === 'shooting'  ? find('shoot', 'fire', 'attack') :
      player.action === 'crouching' ? find('crouch', 'duck') :
      player.action === 'jumping'   ? find('jump', 'leap') :
                                      find('idle', 'stand', 'breath');

    const next = actions[clip];
    if (!next) return;
    Object.values(actions).forEach(a => a?.fadeOut(0.2));
    next.reset().fadeIn(0.2).play();
    next.setLoop(THREE.LoopRepeat, Infinity);
    return () => { next.fadeOut(0.15); };
  }, [player.action, actions, animations]);

  // Interpolate to server position
  useEffect(() => {
    targetPos.current.set(player.position[0], footY(player.position[1]), player.position[2]);
    targetRotY.current = player.rotation[1];
  }, [player.position, player.rotation]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const a = Math.min(delta * 18, 1);
    groupRef.current.position.lerp(targetPos.current, a);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetRotY.current, a);
  });

  if (player.isDead) return null;

  const hp   = player.health / 100;
  const hCol = hp > 0.5 ? '#2dc653' : hp > 0.25 ? '#f4a261' : '#e63946';

  return (
    <group ref={groupRef} position={[player.position[0], footY(player.position[1]), player.position[2]]}>

      {/* animRef wraps clonedScene; yLift corrects feet to local Y=0 */}
      <group ref={animRef} position={[0, yLift, 0]}>
        <primitive object={clonedScene} />
      </group>

      {/* Weapon held at right shoulder */}
      <HandWeapon weaponIdx={player.weaponIdx} />

      {/* Name tag always faces camera */}
      <Billboard follow position={[0, TARGET_HEIGHT + yLift + 0.35, 0]}>
        <Text fontSize={0.16} color="#fff" anchorX="center" anchorY="bottom"
          outlineWidth={0.012} outlineColor="#000" position={[0, 0.12, 0]}>
          {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
        </Text>
        <mesh>
          <planeGeometry args={[0.65, 0.065]} />
          <meshBasicMaterial color="#111" transparent opacity={0.8} />
        </mesh>
        <mesh position={[-(0.325 - 0.65 * hp / 2), 0, 0.001]}>
          <planeGeometry args={[0.65 * hp, 0.065]} />
          <meshBasicMaterial color={hCol} />
        </mesh>
      </Billboard>
    </group>
  );
};

export const RemotePlayers = () => {
  const remote = useNetworkStore(s => s.remotePlayers);
  return (
    <>
      {Array.from(remote.values()).map(p => (
        <RemotePlayerMesh key={p.id} player={p} charIdx={stableIdx(p.id, CHARACTER_MODELS.length)} />
      ))}
    </>
  );
};

CHARACTER_MODELS.forEach(m => useGLTF.preload(m));
WEAPONS.forEach(w => useGLTF.preload(w.modelPath));

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';

// ── Config ───────────────────────────────────────────────────────────────────
const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

// Human height in world units. The player capsule is 2 units tall
// (halfHeight=0.5 + radius=0.5 on each side).
// We scale all characters to this so they fit the capsule correctly.
const TARGET_HEIGHT = 1.8;

// The physics capsule centre is broadcast as position.y.
// Bottom of the capsule = position.y - halfHeight - radius = position.y - 1.
// We shift the character group DOWN by this so feet land on the floor.
const CAPSULE_FOOT_OFFSET = 1.0;

function stableIndex(id: string, len: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % len;
}

// ── Weapon held in hand ───────────────────────────────────────────────────────
const HandWeapon = ({ weaponIdx }: { weaponIdx: number }) => {
  const weapon = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(weapon.modelPath) as { scene: THREE.Group };
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  // Weapon is positioned at the right-hand-side of the character body.
  // We use a fixed offset that works for all models:
  //   X = 0.22 (right side), Y = 0.75 (waist/chest height), Z = 0.15 (slightly forward)
  // Scale is per-weapon from the weapon config.
  const wScale = weapon.scale ?? [0.05, 0.05, 0.05];
  const wRot   = weapon.rotationOffset ?? [0, Math.PI, 0];

  return (
    <group position={[0.22, 0.75, 0.15]} rotation={[wRot[0], wRot[1], wRot[2]]}>
      <primitive object={clone} scale={wScale} />
    </group>
  );
};

// ── Individual remote player ──────────────────────────────────────────────────
const RemotePlayerMesh = ({
  player,
  charIdx,
}: {
  player: RemotePlayerState;
  charIdx: number;
}) => {
  // Target position = capsule centre minus foot offset → feet on floor
  const footPos = (y: number) => y - CAPSULE_FOOT_OFFSET;

  const groupRef   = useRef<THREE.Group>(null);
  const targetPos  = useRef(new THREE.Vector3(
    player.position[0], footPos(player.position[1]), player.position[2],
  ));
  const targetRotY = useRef(player.rotation[1]);

  // Inner group ref for useAnimations (needs to wrap the primitive)
  const animRef = useRef<THREE.Group>(null);

  const charPath = CHARACTER_MODELS[charIdx];
  const { scene, animations } = useGLTF(charPath) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  // ── Proper clone (preserves skinned mesh textures) ────────────────────────
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // Scale to exact human height via bounding box
    const box = new THREE.Box3().setFromObject(clone);
    const h   = box.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    // Shift model so its feet are at local Y = 0
    const box2 = new THREE.Box3().setFromObject(clone);
    clone.position.y -= box2.min.y;

    // Fix materials + tag for raycasting
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData['playerId'] = player.id;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      const fix = (m: THREE.Material) => {
        const c = m.clone();
        c.needsUpdate  = true;
        c.transparent  = false;
        c.depthWrite   = true;
        return c;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(fix)
        : fix(mesh.material);
    });

    return clone;
  }, [scene, player.id]);

  // ── Animations ───────────────────────────────────────────────────────────
  // useAnimations must receive the ref that contains the skeleton hierarchy.
  // We attach clonedScene as child of animRef so the mixer can find all bones.
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    if (!actions || animations.length === 0) return;

    const names = Object.keys(actions);
    if (names.length === 0) return;

    const find = (...kws: string[]): string => {
      for (const kw of kws) {
        const hit = names.find(n => n.toLowerCase().includes(kw));
        if (hit) return hit;
      }
      return names[0]; // safe fallback
    };

    // Map server action → best clip name
    let clipName: string;
    switch (player.action) {
      case 'running':  clipName = find('run', 'sprint', 'jog');   break;
      case 'walking':  clipName = find('walk', 'move');            break;
      case 'shooting': clipName = find('shoot', 'fire', 'attack'); break;
      case 'crouching':clipName = find('crouch', 'duck', 'squat'); break;
      case 'jumping':  clipName = find('jump', 'leap', 'fall');    break;
      default:         clipName = find('idle', 'stand', 'breath'); break;
    }

    const next = actions[clipName];
    if (!next) return;

    // Fade all out, fade new one in
    Object.values(actions).forEach(a => a?.fadeOut(0.25));
    next.reset().fadeIn(0.25).play();
    next.setLoop(THREE.LoopRepeat, Infinity);

    return () => { next.fadeOut(0.2); };
  }, [player.action, actions, animations]);

  // ── Interpolate position + rotation ──────────────────────────────────────
  useEffect(() => {
    targetPos.current.set(
      player.position[0],
      footPos(player.position[1]),
      player.position[2],
    );
    targetRotY.current = player.rotation[1];
  }, [player.position, player.rotation]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const a = Math.min(delta * 20, 1);
    groupRef.current.position.lerp(targetPos.current, a);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotY.current,
      a,
    );
  });

  if (player.isDead) return null;

  const hp    = player.health / 100;
  const hCol  = hp > 0.5 ? '#2dc653' : hp > 0.25 ? '#f4a261' : '#e63946';

  return (
    // Group sits at foot level (capsule centre - 1)
    <group
      ref={groupRef}
      position={[player.position[0], footPos(player.position[1]), player.position[2]]}
    >
      {/* Animation root — clonedScene is child so mixer finds all bones */}
      <group ref={animRef}>
        <primitive object={clonedScene} />
      </group>

      {/* Weapon held in right hand at fixed body offset */}
      <HandWeapon weaponIdx={player.weaponIdx} />

      {/* Billboard name tag + health bar (always faces camera) */}
      <Billboard
        follow
        lockX={false}
        lockY={false}
        lockZ={false}
        position={[0, TARGET_HEIGHT + 0.4, 0]}
      >
        {/* Name */}
        <Text
          fontSize={0.16}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#000000"
          position={[0, 0.13, 0]}
        >
          {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
        </Text>

        {/* Health bar bg */}
        <mesh>
          <planeGeometry args={[0.65, 0.065]} />
          <meshBasicMaterial color="#1a1a1a" transparent opacity={0.85} />
        </mesh>

        {/* Health bar fill */}
        <mesh position={[-(0.325 - 0.65 * hp / 2), 0, 0.001]}>
          <planeGeometry args={[0.65 * hp, 0.065]} />
          <meshBasicMaterial color={hCol} />
        </mesh>
      </Billboard>
    </group>
  );
};

// ── Container ────────────────────────────────────────────────────────────────
export const RemotePlayers = () => {
  const remotePlayers = useNetworkStore(s => s.remotePlayers);
  return (
    <>
      {Array.from(remotePlayers.values()).map(player => (
        <RemotePlayerMesh
          key={player.id}
          player={player}
          charIdx={stableIndex(player.id, CHARACTER_MODELS.length)}
        />
      ))}
    </>
  );
};

// Pre-load all assets to prevent pop-in
CHARACTER_MODELS.forEach(p => useGLTF.preload(p));
WEAPONS.forEach(w => useGLTF.preload(w.modelPath));

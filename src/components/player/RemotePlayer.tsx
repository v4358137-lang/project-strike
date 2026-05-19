/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';

// ── Character model paths ─────────────────────────────────────────────────────
const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

const WEAPON_MODELS = [
  '/models/weapons/ak-47_4k_rifle_many_pieces.glb',
  '/models/weapons/heavy_smg.glb',
];

// Target real-world human height in Three.js units (meters)
const TARGET_HEIGHT = 1.75;

// Stable skin assignment per player ID
function stableIndex(id: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

// ── Weapon in hand (attached via bone) ───────────────────────────────────────
const RemoteWeapon = ({
  weaponIdx,
  handBone,
}: {
  weaponIdx: number;
  handBone: THREE.Object3D | null;
}) => {
  const path = WEAPON_MODELS[weaponIdx % WEAPON_MODELS.length];
  const { scene } = useGLTF(path) as { scene: THREE.Group };

  const weaponClone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  useEffect(() => {
    if (!handBone) return;
    weaponClone.scale.setScalar(0.015);
    weaponClone.rotation.set(0, Math.PI, 0);
    weaponClone.position.set(0, 0, 0);
    handBone.add(weaponClone);
    return () => { handBone.remove(weaponClone); };
  }, [handBone, weaponClone]);

  return null;
};

// ── Individual remote player ──────────────────────────────────────────────────
const RemotePlayerMesh = ({
  player,
  charIdx,
}: {
  player: RemotePlayerState;
  charIdx: number;
}) => {
  const groupRef    = useRef<THREE.Group>(null);
  const targetPos   = useRef(new THREE.Vector3(...player.position));
  const targetRotY  = useRef(player.rotation[1]);
  const handBoneRef = useRef<THREE.Object3D | null>(null);
  const scaledHeightRef = useRef(TARGET_HEIGHT);

  const charPath = CHARACTER_MODELS[charIdx];
  const { scene, animations } = useGLTF(charPath) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  // ── Clone with SkeletonUtils so skinned mesh + textures work correctly ───
  const clonedScene = useMemo(() => {
    // SkeletonUtils.clone properly handles bones, skinning, and material refs
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // ── Auto-scale to human height ─────────────────────────────────────────
    // Measure before any scale is applied
    const box = new THREE.Box3().setFromObject(clone);
    const currentHeight = box.getSize(new THREE.Vector3()).y;
    const scaleFactor = currentHeight > 0 ? TARGET_HEIGHT / currentHeight : 1;
    clone.scale.setScalar(scaleFactor);
    scaledHeightRef.current = TARGET_HEIGHT;

    // ── Ensure materials render correctly (not white) ──────────────────────
    clone.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;

      // Tag every mesh for raycast hit detection
      mesh.userData['playerId'] = player.id;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;

      // Clone materials so each player has independent state,
      // but keep texture references shared (saves GPU memory)
      const fixMat = (m: THREE.Material): THREE.Material => {
        const mat = m.clone();
        // Force the material to re-upload to GPU
        mat.needsUpdate = true;
        // Make sure it's not invisible
        mat.transparent = false;
        mat.depthWrite  = true;
        return mat;
      };

      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(fixMat);
      } else {
        mesh.material = fixMat(mesh.material);
      }
    });

    return clone;
  }, [scene, player.id]);

  // ── useAnimations needs the GROUP (not just the cloned scene) ────────────
  // We attach clonedScene as a child of groupRef, then pass groupRef to useAnimations
  const { actions, mixer } = useAnimations(animations, groupRef);

  // ── Find right hand bone once after clone is ready ────────────────────────
  useEffect(() => {
    clonedScene.traverse((child) => {
      const n = child.name.toLowerCase();
      if (
        n.includes('hand_r') || n.includes('righthand') ||
        n.includes('hand.r')  || n.includes('r_hand')   ||
        n.includes('mixamorigright') || n.includes('wrist_r')
      ) {
        handBoneRef.current = child;
      }
    });
  }, [clonedScene]);

  // ── Animation crossfade based on server action field ──────────────────────
  useEffect(() => {
    if (!actions || animations.length === 0) return;

    const names = Object.keys(actions);
    if (names.length === 0) return;

    const find = (...kws: string[]) => {
      for (const kw of kws) {
        const hit = names.find(n => n.toLowerCase().includes(kw));
        if (hit) return hit;
      }
      return names[0];
    };

    let target: string;
    switch (player.action) {
      case 'running':  target = find('run', 'sprint', 'jog'); break;
      case 'walking':  target = find('walk', 'move');         break;
      default:         target = find('idle', 'stand', 'breathing');
    }

    const next = actions[target];
    if (!next) return;

    // Stop all current animations and crossfade to the new one
    Object.values(actions).forEach(a => a?.fadeOut(0.2));
    next.reset().fadeIn(0.2).play();
    next.setLoop(THREE.LoopRepeat, Infinity);

    return () => { next.fadeOut(0.15); };
  }, [player.action, actions, animations]);

  // Update mixer every frame (required for cloned scenes)
  useFrame((_, delta) => { mixer.update(delta); });

  // ── Entity interpolation ─────────────────────────────────────────────────
  useEffect(() => {
    targetPos.current.set(...player.position);
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

  const healthPct = player.health / 100;
  const hColor = healthPct > 0.5 ? '#2dc653' : healthPct > 0.25 ? '#f4a261' : '#e63946';
  // Put the name tag above the character's actual height
  const tagY = scaledHeightRef.current + 0.3;

  return (
    <group ref={groupRef} position={player.position}>
      {/* Character model — clonedScene attached as child so useAnimations works */}
      <primitive object={clonedScene} />

      {/* Weapon in right hand */}
      <RemoteWeapon weaponIdx={player.weaponIdx} handBone={handBoneRef.current} />

      {/* Name tag + health bar — Billboard always faces the local camera */}
      <Billboard follow lockX={false} lockY={false} lockZ={false} position={[0, tagY, 0]}>
        {/* Player name */}
        <Text
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#000000"
          position={[0, 0.14, 0]}
          fontWeight="bold"
        >
          {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
        </Text>

        {/* Health bar background */}
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[0.65, 0.065]} />
          <meshBasicMaterial color="#1a1a1a" transparent opacity={0.85} />
        </mesh>

        {/* Health bar fill */}
        <mesh position={[-(0.325 - (0.65 * healthPct) / 2), 0, 0.001]}>
          <planeGeometry args={[0.65 * healthPct, 0.065]} />
          <meshBasicMaterial color={hColor} />
        </mesh>
      </Billboard>
    </group>
  );
};

// ── Container ─────────────────────────────────────────────────────────────────
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

// Pre-load all assets to avoid pop-in on first join
CHARACTER_MODELS.forEach(m => useGLTF.preload(m));
WEAPON_MODELS.forEach(m => useGLTF.preload(m));

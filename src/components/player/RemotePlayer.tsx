/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';

// ── Character models — cycle through them per-player for visual variety ──────
const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

const WEAPON_MODELS = [
  '/models/weapons/ak-47_4k_rifle_many_pieces.glb',
  '/models/weapons/heavy_smg.glb',
];

// Stable hash so same player always gets same character skin
function stableIndex(id: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % length;
}

// ── Weapon held by remote player ─────────────────────────────────────────────
const RemoteWeapon = ({ weaponIdx, handBone }: { weaponIdx: number; handBone: THREE.Object3D | null }) => {
  const path = WEAPON_MODELS[weaponIdx % WEAPON_MODELS.length];
  const { scene } = useGLTF(path) as { scene: THREE.Group };

  const weaponClone = useMemo(() => {
    const clone = scene.clone(true);
    return clone;
  }, [scene]);

  // Attach the weapon to the hand bone when available
  useEffect(() => {
    if (!handBone) return;
    weaponClone.scale.set(0.02, 0.02, 0.02);
    weaponClone.rotation.set(0, Math.PI, 0);
    weaponClone.position.set(0, 0, 0);
    handBone.add(weaponClone);
    return () => {
      handBone.remove(weaponClone);
    };
  }, [handBone, weaponClone]);

  return null; // rendered via bone attachment
};

// ── Individual remote player entity ──────────────────────────────────────────
const RemotePlayerMesh = ({ player, charIdx }: { player: RemotePlayerState; charIdx: number }) => {
  const groupRef      = useRef<THREE.Group>(null);
  const targetPos     = useRef(new THREE.Vector3(...player.position));
  const targetRotY    = useRef(player.rotation[1]);
  const handBoneRef   = useRef<THREE.Object3D | null>(null);

  const charPath = CHARACTER_MODELS[charIdx];
  const { scene, animations } = useGLTF(charPath) as { scene: THREE.Group; animations: THREE.AnimationClip[] };

  // Clone the character scene so each player has independent mesh/skeleton
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  const { actions, mixer } = useAnimations(animations, clonedScene);

  // ── Tag every mesh for raycast hit detection ─────────────────────────────
  useEffect(() => {
    clonedScene.traverse((child) => {
      child.userData['playerId'] = player.id;
    });
    if (groupRef.current) {
      groupRef.current.userData['playerId'] = player.id;
    }
  }, [player.id, clonedScene]);

  // ── Find the right hand bone to attach the weapon ───────────────────────
  useEffect(() => {
    clonedScene.traverse((child) => {
      const n = child.name.toLowerCase();
      if (n.includes('hand_r') || n.includes('righthand') || n.includes('hand.r') || n.includes('r_hand') || n.includes('mixamorigright')) {
        handBoneRef.current = child;
      }
    });
  }, [clonedScene]);

  // ── Play animations based on action ──────────────────────────────────────
  useEffect(() => {
    if (!actions || animations.length === 0) return;

    const actionNames = Object.keys(actions);
    if (actionNames.length === 0) return;

    // Helper: find best matching clip name
    const findClip = (...keywords: string[]) => {
      for (const kw of keywords) {
        const found = actionNames.find(n => n.toLowerCase().includes(kw));
        if (found) return found;
      }
      return actionNames[0]; // fallback to first
    };

    let clipName: string;
    switch (player.action) {
      case 'running':
        clipName = findClip('run', 'sprint', 'jog');
        break;
      case 'walking':
        clipName = findClip('walk', 'move');
        break;
      default:
        clipName = findClip('idle', 'stand', 'breathing');
    }

    // Crossfade to new animation
    const nextAction = actions[clipName];
    if (!nextAction) return;

    const currentlyPlaying = actionNames.find(n => {
      const a = actions[n];
      return a && a.isRunning();
    });

    if (currentlyPlaying && currentlyPlaying !== clipName) {
      const current = actions[currentlyPlaying];
      current?.fadeOut(0.2);
    }

    nextAction.reset().fadeIn(0.2).play();
    nextAction.setLoop(THREE.LoopRepeat, Infinity);

    return () => {
      nextAction.fadeOut(0.1);
    };
  }, [player.action, actions, animations]);

  // ── Advance mixer manually (cloned scene not auto-updated by useAnimations) ──
  useFrame((_, delta) => {
    mixer.update(delta);
  });

  // ── Entity interpolation ─────────────────────────────────────────────────
  useEffect(() => {
    targetPos.current.set(...player.position);
    targetRotY.current = player.rotation[1];
  }, [player.position, player.rotation]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const alpha = Math.min(delta * 20, 1);
    groupRef.current.position.lerp(targetPos.current, alpha);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotY.current,
      alpha
    );
  });

  if (player.isDead) return null;

  const healthPct  = player.health / 100;
  const healthColor = healthPct > 0.5 ? '#2dc653' : healthPct > 0.25 ? '#f4a261' : '#e63946';

  return (
    <group ref={groupRef} position={player.position}>
      {/* Character GLB model */}
      <primitive object={clonedScene} />

      {/* Weapon attached via bone (rendered through side-effect in RemoteWeapon) */}
      <RemoteWeapon weaponIdx={player.weaponIdx} handBone={handBoneRef.current} />

      {/* Name tag + health bar always faces camera */}
      <Billboard follow={true} position={[0, 2.4, 0]}>
        {/* Player name */}
        <Text
          fontSize={0.18}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.01}
          outlineColor="#000000"
          position={[0, 0.12, 0]}
        >
          {player.name || player.id.slice(0, 6)}
        </Text>

        {/* Health bar background */}
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[0.7, 0.07]} />
          <meshBasicMaterial color="#222222" transparent opacity={0.85} />
        </mesh>

        {/* Health bar fill */}
        <mesh position={[-(0.35 - (0.7 * healthPct) / 2), 0, 0.001]}>
          <planeGeometry args={[0.7 * healthPct, 0.07]} />
          <meshBasicMaterial color={healthColor} />
        </mesh>
      </Billboard>
    </group>
  );
};

// ── Container that renders all remote players ─────────────────────────────────
export const RemotePlayers = () => {
  const remotePlayers = useNetworkStore((s) => s.remotePlayers);

  return (
    <>
      {Array.from(remotePlayers.values()).map((player) => (
        <RemotePlayerMesh
          key={player.id}
          player={player}
          charIdx={stableIndex(player.id, CHARACTER_MODELS.length)}
        />
      ))}
    </>
  );
};

// Pre-load all character + weapon models so there's no pop-in on first join
useGLTF.preload(CHARACTER_MODELS[0]);
useGLTF.preload(CHARACTER_MODELS[1]);
useGLTF.preload(CHARACTER_MODELS[2]);
useGLTF.preload(WEAPON_MODELS[0]);
useGLTF.preload(WEAPON_MODELS[1]);

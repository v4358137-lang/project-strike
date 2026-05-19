/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Billboard, Text } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';
import { WEAPONS } from '../weapons/WeaponManager';
import { findBones, applyProceduralAnimation, type BoneSet } from './ProceduralAnimator';

const CHARACTER_MODELS = [
  '/models/characters/hero__character.glb',
  '/models/characters/cyberpunk_black_man_character.glb',
  '/models/characters/grapple_pilot.glb',
];

// Character stands 1.75 m tall. Physics capsule centre → feet = 1.0 unit.
const TARGET_HEIGHT = 1.75;
const FOOT_OFFSET   = 1.0; // capsule halfHeight(0.5) + radius(0.5)

function stableIdx(id: string, n: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

// ── Weapon held at right shoulder ─────────────────────────────────────────────
const HandWeapon = ({ weaponIdx }: { weaponIdx: number }) => {
  const w = WEAPONS[weaponIdx % WEAPONS.length];
  const { scene } = useGLTF(w.modelPath) as { scene: THREE.Group };

  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene) as THREE.Group;
    c.updateMatrixWorld(true);
    const box    = new THREE.Box3().setFromObject(c);
    const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    // Scale to realistic rifle length (~65 cm)
    if (maxDim > 0) c.scale.setScalar(0.65 / maxDim);
    return c;
  }, [scene]);

  // Position relative to the FOOT-LEVEL group:
  // • X = 0.18 → slightly right of centre
  // • Y = 1.28 → shoulder / chest height above feet
  // • Z = -0.05 → slightly forward
  // • Rotation: barrel points forward (character faces -Z after rotY=0)
  return (
    <group position={[0.18, 1.28, -0.05]} rotation={[0.1, Math.PI, 0.05]}>
      <primitive object={clone} />
    </group>
  );
};

// ── Individual remote player ──────────────────────────────────────────────────
const RemotePlayerMesh = ({
  player, charIdx,
}: { player: RemotePlayerState; charIdx: number }) => {

  const groupRef    = useRef<THREE.Group>(null);
  const animRef     = useRef<THREE.Group>(null);
  const bonesRef    = useRef<BoneSet | null>(null);
  const hasClipsRef = useRef(false);

  // World Y for the group = capsule-centre minus foot-offset
  const footWorldY = (cy: number) => cy - FOOT_OFFSET;

  const targetPos  = useRef(new THREE.Vector3(
    player.position[0], footWorldY(player.position[1]), player.position[2],
  ));
  const targetRotY = useRef(player.rotation[1]);

  const { scene, animations } = useGLTF(CHARACTER_MODELS[charIdx]) as {
    scene: THREE.Group;
    animations: THREE.AnimationClip[];
  };

  // ── Clone & prepare (runs once per player per character model) ────────────
  const clonedScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as THREE.Group;

    // 1. Scale to human height
    clone.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(clone);
    const h    = box1.getSize(new THREE.Vector3()).y;
    if (h > 0) clone.scale.setScalar(TARGET_HEIGHT / h);

    // 2. Measure feet position and set clone.position.y so feet are at Y = 0
    //    IMPORTANT: set on clone directly so ALL children (even detached meshes)
    //    are lifted together — prevents the split-head / floating-head bug.
    clone.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(clone);
    clone.position.y = -box2.min.y; // lift everything so feet → local Y 0

    // 3. Fix materials so textures show correctly
    clone.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData['playerId'] = player.id; // raycast tag
      mesh.castShadow = mesh.receiveShadow = true;
      const fix = (m: THREE.Material): THREE.Material => {
        const c = m.clone(); c.needsUpdate = true; return c;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(fix)
        : fix(mesh.material as THREE.Material);
    });

    return clone;
  }, [scene, player.id]);

  // ── Animations: GLB clips first, procedural fallback ─────────────────────
  const { actions } = useAnimations(animations, animRef);

  useEffect(() => {
    const clipNames = Object.keys(actions);
    hasClipsRef.current = clipNames.length > 0;

    if (!hasClipsRef.current) {
      bonesRef.current = findBones(clonedScene);
      return;
    }

    const find = (...kws: string[]) =>
      kws.reduce<string | undefined>(
        (f, kw) => f ?? clipNames.find(n => n.toLowerCase().includes(kw)),
        undefined,
      ) ?? clipNames[0];

    const clip =
      player.action === 'running'    ? find('run', 'sprint', 'jog')    :
      player.action === 'walking'    ? find('walk', 'move')             :
      player.action === 'shooting'   ? find('shoot', 'fire', 'attack')  :
      player.action === 'crouching'  ? find('crouch', 'duck')           :
      player.action === 'jumping'    ? find('jump', 'leap')             :
                                       find('idle', 'stand', 'breath');

    const next = actions[clip];
    if (!next) return;
    Object.values(actions).forEach(ac => ac?.fadeOut(0.22));
    next.reset().fadeIn(0.22).play();
    next.setLoop(THREE.LoopRepeat, Infinity);
    return () => { next.fadeOut(0.18); };
  }, [player.action, actions, animations, clonedScene]);

  // ── Per-frame: procedural bones OR interpolation ──────────────────────────
  useFrame(({ clock }, delta) => {
    if (!hasClipsRef.current && bonesRef.current) {
      applyProceduralAnimation(bonesRef.current, player.action, clock.getElapsedTime(), delta);
    }
    if (!groupRef.current) return;
    const al = Math.min(delta * 18, 1);
    groupRef.current.position.lerp(targetPos.current, al);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y, targetRotY.current, al,
    );
  });

  // Update targets when server state changes
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
    // Group sits at foot level (capsule-centre − 1.0)
    <group
      ref={groupRef}
      position={[player.position[0], footWorldY(player.position[1]), player.position[2]]}
    >
      {/* animRef wraps clonedScene — mixer finds all bones inside this subtree.
          clonedScene.position.y already includes the foot-lift so NO separate
          child-group offset is needed → prevents body-part separation. */}
      <group ref={animRef}>
        <primitive object={clonedScene} />
      </group>

      {/* Weapon — positioned relative to foot-level group at shoulder height */}
      <HandWeapon weaponIdx={player.weaponIdx} />

      {/* Name tag + health bar, always faces camera */}
      <Billboard follow position={[0, TARGET_HEIGHT + 0.4, 0]}>
        <Text
          fontSize={0.15}
          color="#ffffff"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.011}
          outlineColor="#000"
          position={[0, 0.11, 0]}
        >
          {player.name?.trim() || player.id.slice(0, 6).toUpperCase()}
        </Text>

        {/* Health bar bg */}
        <mesh>
          <planeGeometry args={[0.65, 0.065]} />
          <meshBasicMaterial color="#111" transparent opacity={0.82} />
        </mesh>

        {/* Health fill */}
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

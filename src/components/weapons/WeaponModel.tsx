import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { WeaponData } from './types';
import { useInputStore } from '../../store/useInputStore';

interface Props {
  weapon: WeaponData;
  isReloading: boolean;
}

export const WeaponModel = ({ weapon, isReloading }: Props) => {
  const groupRef = useRef<THREE.Group>(null);
  const { ads, sprint } = useInputStore();
  const { camera } = useThree();

  // Load the GLTF model based on weapon config
  const { scene } = useGLTF(weapon.modelPath) as { scene: THREE.Group };

  // ── CRITICAL FIX: Attach weapon group to camera so it follows player view ──
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    camera.add(group);
    return () => {
      camera.remove(group);
    };
  }, [camera]);

  // Pre-create vectors/eulers ONCE outside useFrame (not every frame)
  const defaultPosition = useRef(new THREE.Vector3(0.2, -0.6, -0.5));
  const adsPosition     = useRef(new THREE.Vector3(0.0, -0.25, -0.4));
  const sprintPosition  = useRef(new THREE.Vector3(0.3, -0.70, -0.2));
  const reloadRotation  = useRef(new THREE.Euler(0, 0, Math.PI / 4));
  const defaultRotation = useRef(new THREE.Euler(0, 0, 0));
  const targetVec       = useRef(new THREE.Vector3());
  const targetQuat      = useRef(new THREE.Quaternion());

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // Pick target position & rotation based on player state
    let targetPos = defaultPosition.current;
    let targetRot = defaultRotation.current;

    if (isReloading) {
      targetRot = reloadRotation.current;
    } else if (sprint && !ads) {
      targetPos = sprintPosition.current;
    } else if (ads) {
      targetPos = adsPosition.current;
    }

    // Subtle weapon sway (use mouse delta, not absolute position — smoother)
    const swayX = state.mouse.x * 0.04;
    const swayY = state.mouse.y * 0.04;

    targetVec.current.set(
      targetPos.x + swayX,
      targetPos.y + swayY,
      targetPos.z
    );

    groupRef.current.position.lerp(targetVec.current, 12 * delta);
    targetQuat.current.setFromEuler(targetRot);
    groupRef.current.quaternion.slerp(targetQuat.current, 12 * delta);
  });

  const baseScale = weapon.scale || [1, 1, 1];
  const basePos   = weapon.positionOffset || [0, 0, 0];
  const baseRot   = weapon.rotationOffset || [0, 0, 0];

  return (
    // groupRef is added to camera via useEffect — invisible wrapper here
    <group ref={groupRef}>
      <group
        scale={baseScale as [number, number, number]}
        position={basePos as [number, number, number]}
        rotation={baseRot as [number, number, number]}
      >
        <primitive object={scene} />
      </group>
    </group>
  );
};

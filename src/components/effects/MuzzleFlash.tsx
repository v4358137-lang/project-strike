import * as THREE from 'three';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';

interface MuzzleFlashProps {
  /** Whether the character is currently shooting */
  active: boolean;
}

// Pre-allocated — never allocate inside useFrame
const _flashScale = new THREE.Vector3();

/**
 * Small, realistic muzzle flash — positioned at gun barrel tip.
 * Renders a random-size bright disc + warm point light that flickers.
 * Automatically hides when `active` is false.
 */
export const MuzzleFlash = ({ active }: MuzzleFlashProps) => {
  const lightRef = useRef<THREE.PointLight>(null);
  const mesh1Ref = useRef<THREE.Mesh>(null);
  const mesh2Ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const on = active;

    if (lightRef.current) {
      lightRef.current.intensity = on ? Math.random() * 4 + 2 : 0;
    }

    if (mesh1Ref.current) {
      mesh1Ref.current.visible = on;
      if (on) {
        const s = Math.random() * 0.06 + 0.04;
        _flashScale.setScalar(s);
        mesh1Ref.current.scale.copy(_flashScale);
        mesh1Ref.current.rotation.z = Math.random() * Math.PI;
      }
    }
    if (mesh2Ref.current) {
      mesh2Ref.current.visible = on;
      if (on) {
        const s = Math.random() * 0.04 + 0.02;
        _flashScale.setScalar(s);
        mesh2Ref.current.scale.copy(_flashScale);
        mesh2Ref.current.rotation.z = Math.random() * Math.PI * 2;
      }
    }
  });

  // Material shared across all flash instances
  const mat1 = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffe080',
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  const mat2 = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  // Place flash at barrel tip: slightly in front of weapon (local -Z)
  // Weapon group faces forward so barrel tip is at negative Z in weapon-local space
  return (
    <group position={[0, 0, -0.35]}>
      {/* Warm point light — illuminates environment */}
      <pointLight
        ref={lightRef}
        color="#ffaa33"
        intensity={0}
        distance={3}
        decay={2}
      />

      {/* Primary flash disc */}
      <mesh ref={mesh1Ref} visible={false} material={mat1}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* Secondary inner bright core */}
      <mesh ref={mesh2Ref} visible={false} material={mat2}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
};

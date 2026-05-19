import { Suspense, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody, MeshCollider } from '@react-three/rapier';
import * as THREE from 'three';

interface Props {
  mapUrl?: string;
}

// Always-present solid floor so the player NEVER falls into the void
const SolidFloor = () => (
  <RigidBody type="fixed" colliders="cuboid" position={[0, -1, 0]} name="floor">
    <mesh receiveShadow>
      <boxGeometry args={[500, 2, 500]} />
      <meshStandardMaterial color="#1a1a1a" roughness={1} />
    </mesh>
  </RigidBody>
);

// Breaks the GLB scene into individual mesh colliders
// This is far more reliable than a single trimesh on the whole scene
const CustomMap = ({ mapUrl }: { mapUrl: string }) => {
  const { scene } = useGLTF(mapUrl);
  const meshes = useRef<THREE.Mesh[]>([]);

  // Collect all meshes from the GLB
  meshes.current = [];
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.current.push(child as THREE.Mesh);
    }
  });

  return (
    <>
      {/* Render the scene normally for visuals */}
      <primitive object={scene} />

      {/* Per-mesh hull colliders — much more reliable than whole-scene trimesh */}
      {meshes.current.map((mesh, i) => {
        // Get world position/rotation/scale of each mesh
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        mesh.getWorldQuaternion(worldQuat);
        mesh.getWorldScale(worldScale);

        return (
          <RigidBody
            key={i}
            type="fixed"
            colliders={false}
            position={[worldPos.x, worldPos.y, worldPos.z]}
            quaternion={[worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w]}
          >
            <MeshCollider type="hull">
              <mesh
                geometry={mesh.geometry}
                scale={[worldScale.x, worldScale.y, worldScale.z]}
                visible={false}
              />
            </MeshCollider>
          </RigidBody>
        );
      })}
    </>
  );
};

// Fallback visible while GLB loads — a solid platform
const LoadingFloor = () => (
  <RigidBody type="fixed" colliders="cuboid" position={[0, 0, 0]}>
    <mesh receiveShadow>
      <boxGeometry args={[200, 1, 200]} />
      <meshStandardMaterial color="#222" roughness={0.9} />
    </mesh>
  </RigidBody>
);

export const MapLoader = ({ mapUrl }: Props) => {
  return (
    <>
      {/* Always present — absolute safety net against falling into void */}
      <SolidFloor />

      {mapUrl ? (
        <Suspense fallback={<LoadingFloor />}>
          <CustomMap mapUrl={mapUrl} />
        </Suspense>
      ) : (
        <LoadingFloor />
      )}
    </>
  );
};

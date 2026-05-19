import { Suspense } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody, MeshCollider } from '@react-three/rapier';

interface Props { mapUrl?: string; }

// Always-present floor — prevents falling into void while map loads
const SolidFloor = () => (
  <RigidBody type="fixed" colliders="cuboid" position={[0, -1, 0]}>
    <mesh receiveShadow>
      <boxGeometry args={[500, 2, 500]} />
      <meshStandardMaterial color="#1a1a1a" />
    </mesh>
  </RigidBody>
);

const CustomMap = ({ mapUrl }: { mapUrl: string }) => {
  const { scene } = useGLTF(mapUrl);
  return (
    // MeshCollider trimesh is the correct, fast way to collide a full GLB map
    <RigidBody type="fixed" colliders={false}>
      <MeshCollider type="trimesh">
        <primitive object={scene} />
      </MeshCollider>
    </RigidBody>
  );
};

export const MapLoader = ({ mapUrl }: Props) => (
  <>
    <SolidFloor />
    {mapUrl && (
      <Suspense fallback={null}>
        <CustomMap mapUrl={mapUrl} />
      </Suspense>
    )}
  </>
);

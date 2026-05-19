import { Suspense } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';

interface Props {
  mapUrl?: string;
}

// Fallback map if the user hasn't uploaded their GLB yet
const FallbackMap = () => (
  <RigidBody type="fixed" colliders="cuboid" position={[0, -0.5, 0]}>
    <mesh receiveShadow>
      <boxGeometry args={[100, 1, 100]} />
      <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
    </mesh>
    {/* Some basic obstacles */}
    <mesh position={[5, 1, 5]} castShadow receiveShadow>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#333" />
    </mesh>
    <mesh position={[-5, 2, -5]} castShadow receiveShadow>
      <boxGeometry args={[4, 4, 4]} />
      <meshStandardMaterial color="#333" />
    </mesh>
  </RigidBody>
);

const CustomMap = ({ mapUrl }: { mapUrl: string }) => {
  const { scene } = useGLTF(mapUrl);
  
  // Trimesh collider is perfect for complex static environments like maps
  return (
    <RigidBody type="fixed" colliders="trimesh">
      <primitive object={scene} />
    </RigidBody>
  );
};

export const MapLoader = ({ mapUrl }: Props) => {
  return (
    <Suspense fallback={null}>
      {mapUrl ? <CustomMap mapUrl={mapUrl} /> : <FallbackMap />}
    </Suspense>
  );
};

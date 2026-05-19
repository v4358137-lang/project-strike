import { useGLTF } from '@react-three/drei';
import { RigidBody, MeshCollider } from '@react-three/rapier';

interface Props { mapUrl?: string; }

/**
 * Always-present solid floor — catches the player if the GLB map hasn't
 * loaded yet or if they walk off the edge.
 */
export const SolidFloor = () => (
  <RigidBody type="fixed" colliders="cuboid" position={[0, -1, 0]}>
    <mesh receiveShadow>
      <boxGeometry args={[600, 2, 600]} />
      <meshStandardMaterial color="#1a1a1a" />
    </mesh>
  </RigidBody>
);

/**
 * The actual GLB map with a trimesh collider.
 * Must be rendered INSIDE a parent Suspense so that loading signals
 * fire only after this component (and thus the GLB) has resolved.
 */
export const CustomMap = ({ mapUrl }: { mapUrl: string }) => {
  const { scene } = useGLTF(mapUrl);
  return (
    <RigidBody type="fixed" colliders={false}>
      <MeshCollider type="trimesh">
        <primitive object={scene} />
      </MeshCollider>
    </RigidBody>
  );
};

/**
 * MapLoader — exports both floor and map separately so App.tsx can
 * control exactly when Suspense resolves (and hence when to signal "loaded").
 */
export const MapLoader = ({ mapUrl }: Props) => (
  <>
    <SolidFloor />
    {mapUrl && <CustomMap mapUrl={mapUrl} />}
  </>
);

// Preload the map GLB as early as possible
if (typeof window !== 'undefined') {
  useGLTF.preload('/models/maps/low_poly_industrial_zone.glb');
}

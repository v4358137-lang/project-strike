import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useNetworkStore, type RemotePlayerState } from '../../store/useNetworkStore';

// Individual remote player — uses entity interpolation for smooth movement
const RemotePlayerMesh = ({ player }: { player: RemotePlayerState }) => {
  const groupRef   = useRef<THREE.Group>(null);
  const targetPos  = useRef(new THREE.Vector3(...player.position));
  const targetRot  = useRef(new THREE.Euler(...player.rotation));

  // Tag the group root with player ID so WeaponManager raycasting can identify hits
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.userData['playerId'] = player.id;
      groupRef.current.traverse((child) => {
        child.userData['playerId'] = player.id;
      });
    }
  }, [player.id]);

  // Update targets when player state changes (in effect, not render body)
  useEffect(() => {
    targetPos.current.set(...player.position);
    targetRot.current.set(...player.rotation);
  }, [player.position, player.rotation]);

  // Entity interpolation: smoothly glide to server position every frame
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.position.lerp(targetPos.current, Math.min(delta * 20, 1));
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRot.current.y,
      Math.min(delta * 20, 1)
    );
  });

  if (player.isDead) return null;

  return (
    <group ref={groupRef} position={player.position}>
      {/* Body capsule */}
      <mesh position={[0, 0.5, 0]}>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color="#e63946" metalness={0.2} roughness={0.8} />
      </mesh>

      {/* Head — hitbox */}
      <mesh position={[0, 1.35, 0]}>
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshStandardMaterial color="#f4a261" metalness={0.1} roughness={0.9} />
      </mesh>

      {/* Health bar backing */}
      <mesh position={[0, 1.85, 0]}>
        <planeGeometry args={[0.8, 0.07]} />
        <meshBasicMaterial color="#333" />
      </mesh>

      {/* Health bar fill — width scales with health% */}
      <mesh position={[-(0.4 - (0.8 * player.health / 100) / 2), 1.85, 0.001]}>
        <planeGeometry args={[0.8 * player.health / 100, 0.07]} />
        <meshBasicMaterial
          color={player.health > 50 ? '#2dc653' : player.health > 25 ? '#f4a261' : '#e63946'}
        />
      </mesh>
    </group>
  );
};

// Container that renders all remote players from the network store
export const RemotePlayers = () => {
  const remotePlayers = useNetworkStore((s) => s.remotePlayers);

  return (
    <>
      {Array.from(remotePlayers.values()).map((player) => (
        <RemotePlayerMesh key={player.id} player={player} />
      ))}
    </>
  );
};

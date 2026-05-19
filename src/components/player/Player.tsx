import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, Euler } from 'three';
import { useInputStore } from '../../store/useInputStore';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useGameStore } from '../../store/useGameStore';

const SPEED = 5;
const SPRINT_MULTIPLIER = 1.8;
const JUMP_FORCE = 8;
const NETWORK_TICK = 1 / 30; // 30Hz network update

export const Player = () => {
  const rigidBody = useRef<RapierRigidBody>(null);
  const { rapier, world } = useRapier();
  const velocity = useRef(new Vector3());
  const direction = useRef(new Vector3());
  const frontVector = useRef(new Vector3());
  const sideVector = useRef(new Vector3());
  const networkTimer = useRef(0);
  
  // Camera angles
  const euler = useRef(new Euler(0, 0, 0, 'YXZ'));
  
  const sendUpdate = useNetworkStore(s => s.sendUpdate);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement) {
        euler.current.y -= e.movementX * 0.002;
        euler.current.x -= e.movementY * 0.002;
        euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useFrame((state, delta) => {
    if (!rigidBody.current) return;
    
    const { forward, backward, left, right, jump, sprint, crouch, shoot } = useInputStore.getState();
    
    frontVector.current.set(0, 0, Number(backward) - Number(forward));
    sideVector.current.set(Number(left) - Number(right), 0, 0);
    
    direction.current.subVectors(frontVector.current, sideVector.current)
      .normalize()
      .multiplyScalar(SPEED * (sprint ? SPRINT_MULTIPLIER : 1))
      .applyEuler(new Euler(0, euler.current.y, 0));
    
    const velocityCurrent = rigidBody.current.linvel();
    
    // Smooth velocity
    velocity.current.x = THREE.MathUtils.lerp(velocity.current.x, direction.current.x, 10 * delta);
    velocity.current.z = THREE.MathUtils.lerp(velocity.current.z, direction.current.z, 10 * delta);
    velocity.current.y = velocityCurrent.y;
    
    // Jump logic with raycast to check if grounded
    const translation = rigidBody.current.translation();
    // Capsule halfHeight=0.5, radius=0.5 -> bottom is at -1.0. 
    // Start raycast just below the capsule to avoid self-collision
    const origin = new Vector3(translation.x, translation.y - 1.05, translation.z);
    const rayDir = { x: 0, y: -1, z: 0 };
    const ray = new rapier.Ray(origin, rayDir);
    const hit = world.castRay(ray, 0.2, true);
    
    const isGrounded = hit !== null;

    if (jump && isGrounded) {
       velocity.current.y = JUMP_FORCE;
    }
    
    rigidBody.current.setLinvel(velocity.current, true);
    
    // Update camera rotation
    state.camera.quaternion.setFromEuler(euler.current);
    
    // Position camera at player head
    state.camera.position.set(translation.x, translation.y + 0.8, translation.z);

    // Network broadcast at 30Hz
    networkTimer.current += delta;
    if (networkTimer.current >= NETWORK_TICK) {
      networkTimer.current = 0;
      const isMoving = forward || backward || left || right;
      const hSpeed = Math.sqrt(direction.current.x ** 2 + direction.current.z ** 2);
      const playerName = useGameStore.getState().playerName ?? 'Player';
      const isShooting = shoot;
      const action = crouch ? 'crouching'
        : !isGrounded && velocity.current.y > 0.5 ? 'jumping'
        : sprint && isMoving ? 'running'
        : isMoving ? 'walking'
        : isShooting ? 'shooting'
        : 'idle';
      sendUpdate({
        name: playerName,
        position: [translation.x, translation.y, translation.z],
        rotation: [euler.current.x, euler.current.y, euler.current.z],
        action,
        velocity: hSpeed,
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBody}
      colliders={false}
      mass={80}
      type="dynamic"
      position={[0, 3, 0]}
      enabledRotations={[false, false, false]}
      canSleep={false}
      linearDamping={2}
      angularDamping={100}
      friction={0.8}
      restitution={0}
    >
      <CapsuleCollider args={[0.5, 0.5]} friction={1} restitution={0} />
    </RigidBody>
  );
};

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3, Euler, MathUtils } from 'three';
import { useInputStore } from '../../store/useInputStore';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useNetworkStore } from '../../store/useNetworkStore';
import { useGameStore } from '../../store/useGameStore';

const SPEED        = 5;
const SPRINT_MUL   = 1.8;
const JUMP_FORCE   = 9;
const NETWORK_TICK = 1 / 30;

// Pre-allocated — never `new` inside useFrame
const _front  = new Vector3();
const _side   = new Vector3();
const _dir    = new Vector3();
const _camEul = new Euler(0, 0, 0, 'YXZ');

export const Player = () => {
  const rigidBody  = useRef<RapierRigidBody>(null);
  const { rapier, world } = useRapier();
  const vel        = useRef(new Vector3());
  const netTimer   = useRef(0);
  const euler      = useRef(new Euler(0, 0, 0, 'YXZ'));
  const sendUpdate = useNetworkStore(s => s.sendUpdate);

  // ── Mouse look ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      euler.current.y -= e.movementX * 0.002;
      euler.current.x  = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, euler.current.x - e.movementY * 0.002),
      );
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  useFrame((state, delta) => {
    if (!rigidBody.current) return;
    const rb = rigidBody.current;

    const { forward, backward, left, right, jump, sprint, crouch, shoot } =
      useInputStore.getState();

    // Build desired XZ velocity (camera-relative)
    _front.set(0, 0, Number(backward) - Number(forward));
    _side.set(Number(left) - Number(right), 0, 0);
    _dir.subVectors(_front, _side);

    // Only normalize when there is input (avoids divide-by-zero)
    if (_dir.lengthSq() > 0) {
      _dir.normalize();
    }
    _dir.multiplyScalar(SPEED * (sprint ? SPRINT_MUL : 1));

    // Rotate direction by camera Y angle (reuse pre-allocated euler)
    _camEul.set(0, euler.current.y, 0);
    _dir.applyEuler(_camEul);

    // Current physics velocity (keep Y for gravity)
    const curVel = rb.linvel();

    // Smooth XZ, preserve Y (gravity)
    const t = Math.min(10 * delta, 1);
    vel.current.x = MathUtils.lerp(vel.current.x, _dir.x, t);
    vel.current.z = MathUtils.lerp(vel.current.z, _dir.z, t);
    vel.current.y = curVel.y;

    // Grounded check via short downward raycast
    const pos = rb.translation();
    const ray = new rapier.Ray(
      { x: pos.x, y: pos.y - 1.05, z: pos.z },
      { x: 0,     y: -1,            z: 0     },
    );
    const hit       = world.castRay(ray, 0.25, true);
    const isGrounded = hit !== null;

    // Jump (1-frame impulse, not accumulated)
    if (jump && isGrounded) {
      vel.current.y = JUMP_FORCE;
    }

    rb.setLinvel(vel.current, true);

    // Camera follows capsule centre
    state.camera.quaternion.setFromEuler(euler.current);
    state.camera.position.set(pos.x, pos.y + 0.8, pos.z);

    // Network broadcast at 30 Hz
    netTimer.current += delta;
    if (netTimer.current >= NETWORK_TICK) {
      netTimer.current = 0;
      const isMoving = forward || backward || left || right;
      const hSpeed   = Math.sqrt(vel.current.x ** 2 + vel.current.z ** 2);
      const name     = useGameStore.getState().playerName ?? 'Player';

      const action =
        crouch         ? 'crouching'  :
        !isGrounded && vel.current.y > 0.5 ? 'jumping' :
        sprint && isMoving ? 'running'  :
        isMoving       ? 'walking'   :
        shoot          ? 'shooting'  :
                         'idle';

      sendUpdate({
        name,
        position: [pos.x, pos.y, pos.z],
        rotation: [euler.current.x, euler.current.y, euler.current.z],
        action,
        velocity: hSpeed,
        weaponIdx: useInputStore.getState().weapon1 ? 0
                 : useInputStore.getState().weapon2 ? 1 : undefined,
      } as Parameters<typeof sendUpdate>[0]);
    }
  });

  return (
    <RigidBody
      ref={rigidBody}
      colliders={false}
      mass={1}           // ← back to 1: setLinvel works correctly with mass=1
      type="dynamic"
      position={[0, 20, 0]}
      enabledRotations={[false, false, false]}
      canSleep={false}
      linearDamping={0}  // ← 0: we control velocity directly via setLinvel
      angularDamping={100}
      restitution={0}
    >
      {/* friction=0 on collider: we apply velocity directly, not via forces */}
      <CapsuleCollider args={[0.5, 0.5]} friction={0} restitution={0} />
    </RigidBody>
  );
};

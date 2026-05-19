import { useState, useEffect, useRef, useCallback } from 'react';
import { useInputStore } from '../../store/useInputStore';
import { useGameStore } from '../../store/useGameStore';
import { WeaponModel } from './WeaponModel.tsx';
import { useFrame, useThree } from '@react-three/fiber';
import { useNetworkStore } from '../../store/useNetworkStore';
import * as THREE from 'three';

import type { WeaponData } from './types';

const WEAPONS: WeaponData[] = [
  {
    id: 'ak47',
    name: 'AK-47',
    modelPath: '/models/weapons/ak-47_4k_rifle_many_pieces.glb',
    damage: 35,
    fireRate: 0.1,
    magazineSize: 30,
    reloadTime: 2.5,
    recoil: 0.05,
    isAutomatic: true,
    scale: [0.09, 0.09, 0.09],
    positionOffset: [0, 0, 0],
    rotationOffset: [0, Math.PI, 0],
  },
  {
    id: 'smg',
    name: 'Heavy SMG',
    modelPath: '/models/weapons/heavy_smg.glb',
    damage: 20,
    fireRate: 0.08,
    magazineSize: 40,
    reloadTime: 1.8,
    recoil: 0.03,
    isAutomatic: true,
    scale: [0.02, 0.02, 0.02],
    positionOffset: [0, -0.1, 0.1],
    rotationOffset: [0, Math.PI, 0],
  },
];

// Raycasting helpers (allocated once, reused every frame)
const _raycaster = new THREE.Raycaster();
const _shootDir  = new THREE.Vector3();

export const WeaponManager = () => {
  const [isReloading, setIsReloading]   = useState(false);
  const [lastShotTime, setLastShotTime] = useState(0);
  const reloadingRef = useRef(false);

  const { shoot, reload: reloadInput } = useInputStore();
  const { ammo, setAmmo, reload, magazines } = useGameStore();
  const sendHit    = useNetworkStore((s) => s.sendHit);
  const remotePlayers = useNetworkStore((s) => s.remotePlayers);

  const { camera, scene } = useThree();

  const currentWeapon = WEAPONS[0];

  // Initialize ammo on mount
  useEffect(() => {
    useGameStore.setState({
      ammo: currentWeapon.magazineSize,
      maxAmmo: currentWeapon.magazineSize,
    });
  }, [currentWeapon]);

  // Reload handler — uses a ref guard to avoid effect-chaining
  const startReload = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    setIsReloading(true);
    setTimeout(() => {
      reload();
      setIsReloading(false);
      reloadingRef.current = false;
    }, currentWeapon.reloadTime * 1000);
  }, [reload, currentWeapon.reloadTime]);

  useEffect(() => {
    if (reloadInput && !reloadingRef.current && ammo < currentWeapon.magazineSize && magazines > 0) {
      startReload();
    }
  }, [reloadInput, ammo, currentWeapon.magazineSize, magazines, startReload]);

  // ── Fire & Raycast Hit-detection ─────────────────────────────────────────
  const fireWeapon = useCallback(() => {
    // Cast a ray from camera center into the scene
    camera.getWorldDirection(_shootDir);
    _raycaster.set(camera.position, _shootDir);
    _raycaster.far = 200;

    // Collect all meshes belonging to remote players in the scene
    const remoteIds = Array.from(remotePlayers.keys());
    if (remoteIds.length === 0) return;

    // We need to find meshes in the scene tagged to remote players.
    // Remote player meshes are NOT tagged with an ID, so we raycast the full scene
    // and check distance — this is good enough for a first pass.
    const intersects = _raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
      // Walk up the object hierarchy to find the group root
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData['playerId']) {
        obj = obj.parent;
      }
      if (obj && obj.userData['playerId']) {
        const targetId = obj.userData['playerId'] as string;
        sendHit(targetId, currentWeapon.damage);
        break; // only hit the first target
      }
    }
  }, [camera, scene, remotePlayers, sendHit, currentWeapon.damage]);

  useFrame((state) => {
    if (isReloading) return;

    if (shoot && ammo > 0) {
      const time = state.clock.getElapsedTime();
      if (time - lastShotTime > currentWeapon.fireRate) {
        setLastShotTime(time);
        setAmmo(ammo - 1);
        fireWeapon();
      }
    }
  });

  return (
    <group>
      <WeaponModel weapon={currentWeapon} isReloading={isReloading} />
    </group>
  );
};

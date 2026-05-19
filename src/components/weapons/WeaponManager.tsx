import { useState, useEffect, useRef, useCallback } from 'react';
import { useInputStore } from '../../store/useInputStore';
import { useGameStore } from '../../store/useGameStore';
import { useFrame, useThree } from '@react-three/fiber';
import { useNetworkStore } from '../../store/useNetworkStore';
import * as THREE from 'three';
import type { WeaponData } from './types';

export const WEAPONS: WeaponData[] = [
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

// Raycasting helpers — allocated once, reused every frame
const _raycaster = new THREE.Raycaster();
const _shootDir  = new THREE.Vector3();

export const WeaponManager = () => {
  const [weaponIdx, setWeaponIdx]       = useState(0);
  const [isReloading, setIsReloading]   = useState(false);
  const [lastShotTime, setLastShotTime] = useState(0);
  const reloadingRef = useRef(false);

  const { shoot, reload: reloadInput, weapon1, weapon2 } = useInputStore();
  const { ammo, setAmmo, reload, magazines } = useGameStore();
  const sendHit       = useNetworkStore((s) => s.sendHit);
  const sendUpdate    = useNetworkStore((s) => s.sendUpdate);
  const remotePlayers = useNetworkStore((s) => s.remotePlayers);

  const { camera, scene } = useThree();

  const currentWeapon = WEAPONS[weaponIdx];

  // ── Weapon switching via keys 1 / 2 ────────────────────────────────────
  useEffect(() => {
    if (weapon1 && weaponIdx !== 0) {
      setWeaponIdx(0);
      reloadingRef.current = false;
      setIsReloading(false);
      useGameStore.setState({ ammo: WEAPONS[0].magazineSize, maxAmmo: WEAPONS[0].magazineSize });
      sendUpdate({ weaponIdx: 0 });
    }
  }, [weapon1, weaponIdx, sendUpdate]);

  useEffect(() => {
    if (weapon2 && weaponIdx !== 1) {
      setWeaponIdx(1);
      reloadingRef.current = false;
      setIsReloading(false);
      useGameStore.setState({ ammo: WEAPONS[1].magazineSize, maxAmmo: WEAPONS[1].magazineSize });
      sendUpdate({ weaponIdx: 1 });
    }
  }, [weapon2, weaponIdx, sendUpdate]);

  // ── Ammo init on weapon change ──────────────────────────────────────────
  useEffect(() => {
    useGameStore.setState({
      ammo: currentWeapon.magazineSize,
      maxAmmo: currentWeapon.magazineSize,
    });
  }, [currentWeapon]);

  // ── Reload ──────────────────────────────────────────────────────────────
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

  // ── Fire + raycast hit detection ────────────────────────────────────────
  const fireWeapon = useCallback(() => {
    camera.getWorldDirection(_shootDir);
    _raycaster.set(camera.position, _shootDir);
    _raycaster.far = 200;

    if (remotePlayers.size === 0) return;

    const intersects = _raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData['playerId']) {
        obj = obj.parent;
      }
      if (obj && obj.userData['playerId']) {
        sendHit(obj.userData['playerId'] as string, currentWeapon.damage);
        break;
      }
    }
  }, [camera, scene, remotePlayers, sendHit, currentWeapon.damage]);

  useFrame((state) => {
    if (isReloading) return;
    if (shoot && ammo > 0) {
      const t = state.clock.getElapsedTime();
      if (t - lastShotTime > currentWeapon.fireRate) {
        setLastShotTime(t);
        setAmmo(ammo - 1);
        fireWeapon();
      }
    }
  });

  // Weapon mesh is rendered on the character model (Player.tsx / RemotePlayer.tsx).
  // WeaponManager only owns: shooting raycasts, ammo, reload, weapon switching.
  return null;
};

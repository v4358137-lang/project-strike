export interface WeaponData {
  id: string;
  name: string;
  modelPath: string; // The .glb path
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadTime: number;
  recoil: number;
  isAutomatic: boolean;
  scale?: [number, number, number];
  positionOffset?: [number, number, number];
  rotationOffset?: [number, number, number];
}

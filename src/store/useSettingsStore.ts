import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  masterVolume: number;
  sfxVolume: number;
  sensitivity: number;
  fov: number;
  graphicsQuality: 'low' | 'medium' | 'high' | 'ultra';
  setMasterVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
  setSensitivity: (v: number) => void;
  setFov: (v: number) => void;
  setGraphicsQuality: (q: 'low' | 'medium' | 'high' | 'ultra') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      masterVolume: 1.0,
      sfxVolume: 1.0,
      sensitivity: 0.5,
      fov: 90,
      graphicsQuality: 'high',
      setMasterVolume: (v) => set({ masterVolume: v }),
      setSfxVolume: (v) => set({ sfxVolume: v }),
      setSensitivity: (v) => set({ sensitivity: v }),
      setFov: (v) => set({ fov: v }),
      setGraphicsQuality: (q) => set({ graphicsQuality: q }),
    }),
    {
      name: 'fps-settings',
    }
  )
);

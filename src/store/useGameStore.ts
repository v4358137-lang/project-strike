import { create } from 'zustand';

interface GameState {
  health: number;
  ammo: number;
  maxAmmo: number;
  magazines: number;
  isDead: boolean;
  score: number;
  kills: number;
  matchState: 'waiting' | 'playing' | 'ended';
  setHealth: (health: number) => void;
  takeDamage: (amount: number) => void;
  setAmmo: (ammo: number) => void;
  reload: () => void;
  setMatchState: (state: 'waiting' | 'playing' | 'ended') => void;
  addKill: () => void;
  respawn: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  health: 100,
  ammo: 30,
  maxAmmo: 30,
  magazines: 3,
  isDead: false,
  score: 0,
  kills: 0,
  matchState: 'waiting',
  
  setHealth: (health) => set({ health, isDead: health <= 0 }),
  takeDamage: (amount) => set((state) => {
    const newHealth = Math.max(0, state.health - amount);
    return { health: newHealth, isDead: newHealth <= 0 };
  }),
  setAmmo: (ammo) => set({ ammo }),
  reload: () => set((state) => {
    if (state.magazines > 0 && state.ammo < state.maxAmmo) {
      return { ammo: state.maxAmmo, magazines: state.magazines - 1 };
    }
    return state;
  }),
  setMatchState: (matchState) => set({ matchState }),
  addKill: () => set((state) => ({ kills: state.kills + 1, score: state.score + 100 })),
  respawn: () => set({ health: 100, isDead: false, ammo: 30, magazines: 3 }),
}));

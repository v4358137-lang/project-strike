import { useGameStore } from '../store/useGameStore';
import { Crosshair } from './Crosshair.tsx';
import { Heart, Skull } from 'lucide-react';

export const HUD = () => {
  const { health, ammo, maxAmmo, magazines, kills, score, matchState } = useGameStore();

  if (matchState !== 'playing') return null;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none select-none overflow-hidden">
      <Crosshair />
      
      {/* Bottom Left: Health */}
      <div className="absolute bottom-8 left-8 flex items-end gap-4">
        <div className="flex items-center gap-2 text-white bg-black/40 backdrop-blur-md px-6 py-3 rounded-lg border-b-4 border-l-4 border-red-500/50">
          <Heart className="w-8 h-8 text-red-500" />
          <span className="text-4xl font-bold font-mono tracking-tighter">
            {health}
          </span>
        </div>
      </div>
      
      {/* Bottom Right: Ammo */}
      <div className="absolute bottom-8 right-8 flex items-end gap-4">
        <div className="flex flex-col items-end text-white bg-black/40 backdrop-blur-md px-6 py-3 rounded-lg border-b-4 border-r-4 border-blue-500/50">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-bold font-mono tracking-tighter">{ammo}</span>
            <span className="text-xl text-white/50 font-mono">/ {maxAmmo}</span>
          </div>
          <div className="text-sm text-white/70 font-mono tracking-widest mt-1">
            MAGS: {magazines}
          </div>
        </div>
      </div>

      {/* Top Right: Killfeed / Score */}
      <div className="absolute top-8 right-8 flex flex-col gap-2 items-end">
        <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-lg text-white">
          <Skull className="w-4 h-4 text-white/70" />
          <span className="font-bold font-mono">{kills} KILLS</span>
        </div>
        <div className="text-xl font-bold text-white/90 font-mono drop-shadow-lg shadow-black">
          SCORE: {score}
        </div>
      </div>
      
      {/* Damage Overlay */}
      {health < 40 && (
        <div className="absolute inset-0 bg-red-500/10 pointer-events-none animate-pulse mix-blend-overlay" />
      )}
    </div>
  );
};

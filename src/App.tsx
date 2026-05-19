import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense, useState, useRef } from 'react';
import { Player } from './components/player/Player';
import { RemotePlayers } from './components/player/RemotePlayer';
import { WeaponManager } from './components/weapons/WeaponManager';
import { MapLoader } from './components/map/MapLoader';
import { EnvironmentSetup } from './components/environment/EnvironmentSetup';
import { PostProcessing } from './components/effects/PostProcessing';
import { HUD } from './ui/HUD';
import { KeyboardManager } from './store/useInputStore';
import { PointerLockControls } from '@react-three/drei';
import { useNetworkStore } from './store/useNetworkStore';
import { useGameStore } from './store/useGameStore';


// ─── Lobby Screen ─────────────────────────────────────────────────────────────
const LobbyScreen = ({ onJoin }: { onJoin: (roomId: string, name: string) => void }) => {
  const [roomInput, setRoomInput] = useState('');
  const [name, setName] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleJoin = () => {
    const id = roomInput.trim().toUpperCase() || 'GLOBAL';
    setIsConnecting(true);
    onJoin(id, name);
  };



  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
      {/* Glow orb */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #e63946 0%, transparent 70%)' }}
      />

      <div className="relative z-10 flex flex-col items-center gap-8 px-8 w-full max-w-lg">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-7xl font-black tracking-tighter text-white uppercase"
            style={{ textShadow: '0 0 40px rgba(230,57,70,0.8)' }}
          >
            PROJECT<br/>
            <span className="text-[#e63946]">STRIKE</span>
          </h1>
          <p className="text-white/40 mt-2 text-sm font-mono tracking-widest uppercase">
            Tactical Multiplayer FPS
          </p>
        </div>

        {/* Form */}
        <div className="w-full flex flex-col gap-3">
          <input
            type="text"
            placeholder="Your Name (optional)"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-white/5 border border-white/10 text-white px-4 py-3 rounded font-mono text-sm placeholder-white/20 focus:outline-none focus:border-[#e63946]/50 transition-colors"
          />
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Room ID (e.g. ZONE-1)"
              value={roomInput}
              onChange={e => setRoomInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              className="flex-1 bg-white/5 border border-white/10 text-white px-4 py-3 rounded font-mono text-sm placeholder-white/20 focus:outline-none focus:border-[#e63946]/50 transition-colors"
            />
          <button
            onClick={() => onJoin(roomInput.trim().toUpperCase() || 'GLOBAL', name)}
            disabled={isConnecting}
            className="px-6 py-3 bg-white/10 border border-white/20 text-white font-bold text-sm uppercase tracking-widest rounded hover:bg-white/20 transition-all disabled:opacity-50"
          >
            {isConnecting ? '...' : 'Join'}
          </button>
        </div>

        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-white/20 text-xs font-mono">OR</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button
          onClick={() => onJoin('GLOBAL', name)}
          disabled={isConnecting}
          className="w-full py-4 bg-[#e63946] text-white font-black text-lg uppercase tracking-widest rounded hover:bg-[#c1121f] active:scale-95 transition-all disabled:opacity-50"
          style={{ boxShadow: '0 0 30px rgba(230,57,70,0.4)' }}
        >
          {isConnecting ? 'Connecting...' : '⚡ Quick Play'}
        </button>
        </div>

        <p className="text-white/20 text-xs font-mono">
          WASD · Mouse Aim · Left Click Shoot · Right Click ADS · R Reload · Space Jump · Shift Sprint
        </p>
      </div>
    </div>
  );
};

// ─── Room Info HUD overlay ─────────────────────────────────────────────────────
const RoomHUD = () => {
  const roomId = useNetworkStore(s => s.roomId);
  const remotePlayers = useNetworkStore(s => s.remotePlayers);
  return (
    <div className="absolute top-4 left-4 z-50 flex flex-col gap-1 pointer-events-none">
      <div className="bg-black/50 backdrop-blur px-3 py-1.5 rounded text-white/70 font-mono text-xs">
        ROOM: <span className="text-[#e63946] font-bold">{roomId ?? '—'}</span>
      </div>
      <div className="bg-black/50 backdrop-blur px-3 py-1.5 rounded text-white/70 font-mono text-xs">
        PLAYERS: <span className="text-white font-bold">{remotePlayers.size + 1}</span>
      </div>
    </div>
  );
};

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState<'lobby' | 'game'>('lobby');
  const connect = useNetworkStore(s => s.connect);
  const setMatchState = useGameStore(s => s.setMatchState);
  const [pointerLocked, setPointerLocked] = useState(false);

  const handleJoin = (roomId: string, playerName: string) => {
    useGameStore.getState().setPlayerName(playerName || 'Player');
    connect(roomId);
    setPhase('game');
    setTimeout(() => {
      setMatchState('playing');
    }, 800);
  };

  return (
    <div className="w-screen h-screen bg-black relative">
      {phase === 'lobby' && <LobbyScreen onJoin={handleJoin} />}

      {phase === 'game' && (
        <>
          <KeyboardManager />
          <HUD />
          <RoomHUD />

          {/* Click-to-lock overlay when pointer escaped */}
          {!pointerLocked && (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center cursor-pointer"
              onClick={() => document.body.requestPointerLock?.()}
            >
              <div className="bg-black/70 backdrop-blur px-8 py-5 rounded-lg text-white text-center">
                <p className="font-bold text-lg">Click to Resume</p>
                <p className="text-white/40 text-sm font-mono mt-1">ESC to exit pointer lock</p>
              </div>
            </div>
          )}

          <Canvas
            shadows
            camera={{ fov: 90 }}
          >
            <Suspense fallback={null}>
              <EnvironmentSetup />
              
              <Physics gravity={[0, -30, 0]}>
                <MapLoader mapUrl="/models/maps/low_poly_industrial_zone.glb" />
                <Player />
                <RemotePlayers />
                <WeaponManager />
              </Physics>

              <PostProcessing />
            </Suspense>

            <PointerLockControls
              onLock={() => setPointerLocked(true)}
              onUnlock={() => setPointerLocked(false)}
            />
          </Canvas>
        </>
      )}
    </div>
  );
}

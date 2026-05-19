import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { Suspense, useState, useRef, useCallback, useEffect, Component, type ReactNode } from 'react';
import { Player } from './components/player/Player';
import { RemotePlayers } from './components/player/RemotePlayer';
import { WeaponManager } from './components/weapons/WeaponManager';
import { MapLoader } from './components/map/MapLoader';
import { SolidFloor } from './components/map/MapLoader';
import { EnvironmentSetup } from './components/environment/EnvironmentSetup';
import { PostProcessing } from './components/effects/PostProcessing';
import { HUD } from './ui/HUD';
import { KeyboardManager } from './store/useInputStore';
import { PointerLockControls } from '@react-three/drei';
import { useNetworkStore } from './store/useNetworkStore';
import { useGameStore } from './store/useGameStore';

/* ─── Error Boundary (prevents Suspense from hanging on GLB 404s) ─────────── */
interface EBState { error: boolean }
class AssetErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, EBState> {
  state: EBState = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.error ? null : this.props.children; }
}

/* ─── Loading Screen ─────────────────────────────────────────────────────────
   Displays a tactical loading UI. Never gets stuck:
   - Normal path: MapLoadedSignal fires when Suspense resolves.
   - Fallback: 25-second hard timeout dismisses loading screen.
 ─────────────────────────────────────────────────────────────────────────── */
const LoadingScreen = ({ hint }: { hint: string }) => (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'linear-gradient(135deg, #05050a 0%, #0a0f1a 60%, #0f0a14 100%)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Rajdhani', 'Orbitron', 'Courier New', monospace",
    color: '#fff',
    pointerEvents: 'none', // allow clicks to fall through to Canvas
  }}>
    {/* Grid overlay */}
    <div style={{
      position: 'absolute', inset: 0, opacity: 0.04,
      backgroundImage:
        'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),' +
        'linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
      backgroundSize: '50px 50px',
    }} />
    {/* Red glow */}
    <div style={{
      position: 'absolute', top: '35%', left: '50%',
      transform: 'translate(-50%,-50%)',
      width: 600, height: 600, borderRadius: '50%', opacity: 0.12,
      background: 'radial-gradient(circle, #e63946 0%, transparent 70%)',
    }} />

    <div style={{ position: 'relative', textAlign: 'center' }}>
      <h1 style={{
        fontSize: '5rem', fontWeight: 900, letterSpacing: '0.25em',
        lineHeight: 1, margin: 0, textTransform: 'uppercase',
        textShadow: '0 0 60px rgba(230,57,70,0.9), 0 0 120px rgba(230,57,70,0.4)',
      }}>
        PROJECT<br />
        <span style={{ color: '#e63946' }}>STRIKE</span>
      </h1>
      <p style={{ color: 'rgba(255,255,255,0.35)', letterSpacing: '0.3em', fontSize: '0.8rem', marginTop: '0.5rem' }}>
        TACTICAL MULTIPLAYER SHOOTER
      </p>

      {/* Animated shimmer bar */}
      <div style={{
        margin: '2.5rem auto 0', width: 340, height: 3,
        background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: '45%', borderRadius: 2,
          background: 'linear-gradient(90deg, transparent, #e63946, #ff6b6b, #e63946, transparent)',
          animation: 'loadBar 1.6s ease-in-out infinite',
        }} />
      </div>

      <p style={{ marginTop: '1.2rem', color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', letterSpacing: '0.25em' }}>
        {hint}
      </p>

      {/* Corner brackets */}
      {(['tl','tr','bl','br'] as const).map(c => (
        <div key={c} style={{
          position: 'absolute',
          top:    c[0] === 't' ? -32 : 'auto',
          bottom: c[0] === 'b' ? -32 : 'auto',
          left:   c[1] === 'l' ? -32 : 'auto',
          right:  c[1] === 'r' ? -32 : 'auto',
          width: 20, height: 20,
          borderTop:    c[0] === 't' ? '2px solid #e63946' : 'none',
          borderBottom: c[0] === 'b' ? '2px solid #e63946' : 'none',
          borderLeft:   c[1] === 'l' ? '2px solid #e63946' : 'none',
          borderRight:  c[1] === 'r' ? '2px solid #e63946' : 'none',
        }} />
      ))}
    </div>

    <style>{`
      @keyframes loadBar {
        0%   { transform: translateX(-200%); }
        100% { transform: translateX(900%); }
      }
    `}</style>
  </div>
);

/* ─── MapLoadedSignal ─────────────────────────────────────────────────────────
   Lives INSIDE the Suspense boundary. Fires onLoaded() on the FIRST frame
   after Suspense resolves (meaning all GLB assets inside it have downloaded).
 ─────────────────────────────────────────────────────────────────────────── */
const MapLoadedSignal = ({ onLoaded }: { onLoaded: () => void }) => {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    // Give physics 1 frame to fully initialise before spawning
    requestAnimationFrame(() => requestAnimationFrame(onLoaded));
  });
  return null;
};

/* ─── Lobby Screen ────────────────────────────────────────────────────────── */
const LobbyScreen = ({ onJoin }: { onJoin: (roomId: string, name: string) => void }) => {
  const [room, setRoom] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const join = (r: string) => { setBusy(true); onJoin(r || 'GLOBAL', name); };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black">
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }} />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #e63946 0%, transparent 70%)' }} />

      <div className="relative z-10 flex flex-col items-center gap-8 px-8 w-full max-w-lg">
        <div className="text-center">
          <h1 className="text-7xl font-black tracking-tighter text-white uppercase"
            style={{ textShadow: '0 0 40px rgba(230,57,70,0.8)' }}>
            PROJECT<br />
            <span className="text-[#e63946]">STRIKE</span>
          </h1>
          <p className="text-white/40 mt-2 text-sm font-mono tracking-widest uppercase">
            Tactical Multiplayer FPS
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <input type="text" placeholder="Your Name (optional)"
            value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-white/5 border border-white/10 text-white px-4 py-3 rounded font-mono text-sm placeholder-white/20 focus:outline-none focus:border-[#e63946]/50 transition-colors" />
          <div className="flex gap-2">
            <input type="text" placeholder="Room ID (e.g. ZONE-1)"
              value={room} onChange={e => setRoom(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && join(room)}
              className="flex-1 bg-white/5 border border-white/10 text-white px-4 py-3 rounded font-mono text-sm placeholder-white/20 focus:outline-none focus:border-[#e63946]/50 transition-colors" />
            <button onClick={() => join(room)} disabled={busy}
              className="px-6 py-3 bg-white/10 border border-white/20 text-white font-bold text-sm uppercase tracking-widest rounded hover:bg-white/20 transition-all disabled:opacity-50">
              {busy ? '...' : 'Join'}
            </button>
          </div>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/20 text-xs font-mono">OR</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button onClick={() => join('GLOBAL')} disabled={busy}
            className="w-full py-4 bg-[#e63946] text-white font-black text-lg uppercase tracking-widest rounded hover:bg-[#c1121f] active:scale-95 transition-all disabled:opacity-50"
            style={{ boxShadow: '0 0 30px rgba(230,57,70,0.4)' }}>
            {busy ? 'Connecting...' : '⚡ Quick Play'}
          </button>
        </div>

        <p className="text-white/20 text-xs font-mono">
          WASD · Mouse Aim · LMB Shoot · RMB ADS · R Reload · Space Jump · Shift Sprint
        </p>
      </div>
    </div>
  );
};

/* ─── Room HUD ────────────────────────────────────────────────────────────── */
const RoomHUD = () => {
  const roomId       = useNetworkStore(s => s.roomId);
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

/* ─── App ─────────────────────────────────────────────────────────────────── */
export default function App() {
  const [phase, setPhase]           = useState<'lobby' | 'loading' | 'game'>('lobby');
  const [hint, setHint]             = useState('LOADING MAP…');
  const [pointerLocked, setPointerLocked] = useState(false);
  const loadedRef                   = useRef(false);
  const connect                     = useNetworkStore(s => s.connect);
  const setMatchState               = useGameStore(s => s.setMatchState);

  /** Called by MapLoadedSignal — all GLBs resolved, physics running */
  const handleLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setPhase('game');
    setMatchState('playing');
  }, [setMatchState]);

  /** Hard timeout: if Suspense never resolves (network error etc.), force game */
  useEffect(() => {
    if (phase !== 'loading') return;
    setHint('LOADING MAP…');
    const hints = [
      'LOADING MAP…',
      'BUILDING PHYSICS WORLD…',
      'SPAWNING PLAYERS…',
      'ALMOST READY…',
    ];
    let i = 0;
    const hintTimer = setInterval(() => {
      i = (i + 1) % hints.length;
      setHint(hints[i]);
    }, 3000);

    // 30-second hard timeout — never stuck
    const failsafe = setTimeout(() => {
      if (!loadedRef.current) {
        console.warn('[App] Loading timeout — forcing game start');
        handleLoaded();
      }
    }, 30_000);

    return () => { clearInterval(hintTimer); clearTimeout(failsafe); };
  }, [phase, handleLoaded]);

  const handleJoin = useCallback((roomId: string, playerName: string) => {
    useGameStore.getState().setPlayerName(playerName.trim() || 'Player');
    connect(roomId);
    loadedRef.current = false;
    setPhase('loading');
  }, [connect]);

  const isLoading = phase === 'loading';
  const inGame    = phase === 'game';

  return (
    <div className="w-screen h-screen bg-black relative overflow-hidden">

      {/* ── Lobby ─────────────────────────────────────────────────────────── */}
      {phase === 'lobby' && <LobbyScreen onJoin={handleJoin} />}

      {/* ── Loading screen (pointer-events:none so Canvas can receive clicks) */}
      {isLoading && <LoadingScreen hint={hint} />}

      {/* ── 3-D Canvas (mounts as soon as user joins; hidden behind loading) */}
      {(isLoading || inGame) && (
        <>
          <KeyboardManager />
          {inGame && <HUD />}
          {inGame && <RoomHUD />}

          {/* Click-to-lock overlay — only visible after loading completes */}
          {inGame && !pointerLocked && (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center cursor-pointer"
              onClick={() => document.body.requestPointerLock?.()}
            >
              <div className="bg-black/70 backdrop-blur px-8 py-5 rounded-lg text-white text-center">
                <p className="font-bold text-lg">Click to Play</p>
                <p className="text-white/40 text-sm font-mono mt-1">ESC to release mouse</p>
              </div>
            </div>
          )}

          <Canvas shadows camera={{ fov: 90 }}>
            {/* Environment always renders (lights/sky never suspended) */}
            <EnvironmentSetup />

            {/* SolidFloor renders immediately — player lands on it even before map GLB */}
            <Physics gravity={[0, -30, 0]}>
              <SolidFloor />

              {/*
                Suspense waits for:
                  • CustomMap (map GLB + trimesh collider)
                  • RemotePlayers (character + weapon GLBs — preloaded)
                  • WeaponManager (weapon GLBs — preloaded)
                MapLoadedSignal ONLY fires after ALL of these resolve.
                Player and RemotePlayers are INSIDE Suspense → only spawn
                after everything is ready (no falling through the map).
              */}
              <AssetErrorBoundary onError={handleLoaded}>
                <Suspense fallback={null}>
                  <MapLoadedSignal onLoaded={handleLoaded} />
                  <MapLoader mapUrl="/models/maps/low_poly_industrial_zone.glb" />
                  <Player />
                  <RemotePlayers />
                  <WeaponManager />
                  <PostProcessing />
                </Suspense>
              </AssetErrorBoundary>
            </Physics>

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

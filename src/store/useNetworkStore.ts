import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from './useGameStore';

export interface RemotePlayerState {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  health: number;
  isDead: boolean;
  weaponIdx: number;
  action: string;
  velocity: number; // horizontal speed magnitude for animation blending
  aimPitch?: number;
  shooting?: boolean;
  reloadProgress?: number;
}


interface NetworkState {
  socket: Socket | null;
  roomId: string | null;
  playerId: string | null;
  remotePlayers: Map<string, RemotePlayerState>;
  connect: (roomId: string) => void;
  disconnect: () => void;
  sendUpdate: (state: Partial<RemotePlayerState>) => void;
  sendHit: (targetId: string, damage: number) => void;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  socket: null,
  roomId: null,
  playerId: null,
  remotePlayers: new Map(),

  connect: (roomId: string) => {
    // In production on Render, frontend + backend share the same origin
    const url = import.meta.env.PROD
      ? window.location.origin
      : 'http://localhost:3001';

    const socket = io(url, {
      transports: ['websocket', 'polling'], // websocket first, polling fallback
    });

    socket.on('connect', () => {
      console.log('Connected to server:', socket.id);
      socket.emit('joinRoom', roomId, (response: { id: string; status: string }) => {
        set({ playerId: response.id });
        console.log('Joined room', roomId, 'as', response.id);
      });
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });

    // Server broadcasts all player states at 30Hz
    socket.on('tick', (players: RemotePlayerState[]) => {
      const { playerId } = get();
      const newMap = new Map<string, RemotePlayerState>();
      players.forEach((p) => {
        if (p.id !== playerId) {
          newMap.set(p.id, p);
        }
      });
      set({ remotePlayers: newMap });
    });

    // Server tells THIS client it was hit — update local health
    socket.on('youWereHit', ({ health }: { damage: number; health: number; attackerId: string }) => {
      useGameStore.getState().setHealth(health);
    });

    // Server forcibly respawns this client (after death timer)
    socket.on('forceRespawn', ({ position }: { position: [number, number, number] }) => {
      useGameStore.getState().respawn();
      // Broadcast the new position so we record it
      console.log('Respawned at', position);
    });

    // Another player died — add kill credit if WE were the killer
    socket.on('playerDied', ({ killerId }: { id: string; killerId: string }) => {
      const { playerId: myId } = get();
      if (killerId === myId) {
        useGameStore.getState().addKill();
      }
    });

    socket.on('playerLeft', (id: string) => {
      const { remotePlayers } = get();
      const next = new Map(remotePlayers);
      next.delete(id);
      set({ remotePlayers: next });
    });

    set({ socket, roomId });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) socket.disconnect();
    set({ socket: null, roomId: null, playerId: null, remotePlayers: new Map() });
  },

  sendUpdate: (state: Partial<RemotePlayerState>) => {
    const { socket, roomId } = get();
    if (socket && roomId) {
      socket.emit('updateState', { roomId, ...state });
    }
  },

  sendHit: (targetId: string, damage: number) => {
    const { socket, roomId } = get();
    if (socket && roomId) {
      socket.emit('playerHit', { roomId, targetId, damage });
    }
  },
}));

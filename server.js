import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());

// Serve the built Vite frontend from /dist (for Render.com production)
const distPath = join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const TICK_RATE = 30; // 30Hz server tick

// Spread-out spawn points so players don't stack on join
const SPAWN_POINTS = [
  [0,   20,  0],
  [10,  20,  10],
  [-10, 20,  10],
  [10,  20, -10],
  [-10, 20, -10],
  [20,  20,  0],
  [-20, 20,  0],
  [0,   20,  20],
  [0,   20, -20],
  [15,  20,  15],
];

let spawnIndex = 0;
const getSpawnPoint = () => {
  const pt = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
  spawnIndex++;
  return pt;
};

/** @type {Map<string, Map<string, object>>} */
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('joinRoom', (roomId, callback) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    const roomPlayers = rooms.get(roomId);

    const spawnPos = getSpawnPoint();

    roomPlayers.set(socket.id, {
      id: socket.id,
      position: spawnPos,
      rotation: [0, 0, 0],
      health: 100,
      isDead: false,
      weaponIdx: 0,
      action: 'idle',
    });

    console.log(`Player ${socket.id} joined room ${roomId} at ${spawnPos}`);

    // Notify others in the room a new player joined
    socket.to(roomId).emit('playerJoined', { id: socket.id, position: spawnPos });

    if (callback) callback({ status: 'ok', id: socket.id });
  });

  socket.on('updateState', (data) => {
    const { roomId, ...state } = data;
    if (!roomId) return;

    const roomPlayers = rooms.get(roomId);
    if (roomPlayers && roomPlayers.has(socket.id)) {
      const player = roomPlayers.get(socket.id);
      Object.assign(player, state);
    }
  });

  socket.on('playerHit', (data) => {
    const { roomId, targetId, damage } = data;
    if (!roomId) return;

    const roomPlayers = rooms.get(roomId);
    if (!roomPlayers || !roomPlayers.has(targetId)) return;

    const target = roomPlayers.get(targetId);
    if (target.isDead) return; // ignore hits on dead players

    target.health = Math.max(0, target.health - damage);

    // Tell the hit player their new health immediately
    io.to(targetId).emit('youWereHit', { damage, health: target.health, attackerId: socket.id });

    if (target.health <= 0) {
      target.isDead = true;
      io.to(roomId).emit('playerDied', { id: targetId, killerId: socket.id });

      // Auto-respawn after 3 seconds
      setTimeout(() => {
        if (!roomPlayers.has(targetId)) return;
        const p = roomPlayers.get(targetId);
        p.health = 100;
        p.isDead = false;
        p.position = getSpawnPoint();
        io.to(roomId).emit('playerRespawned', { id: targetId, position: p.position });
        io.to(targetId).emit('forceRespawn', { position: p.position });
      }, 3000);
    }
  });

  socket.on('respawn', (roomId) => {
    const roomPlayers = rooms.get(roomId);
    if (roomPlayers && roomPlayers.has(socket.id)) {
      const player = roomPlayers.get(socket.id);
      player.health = 100;
      player.isDead = false;
      player.position = getSpawnPoint();
      io.to(roomId).emit('playerRespawned', { id: socket.id, position: player.position });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    for (const [roomId, roomPlayers] of rooms.entries()) {
      if (roomPlayers.has(socket.id)) {
        roomPlayers.delete(socket.id);
        io.to(roomId).emit('playerLeft', socket.id);
        if (roomPlayers.size === 0) {
          rooms.delete(roomId);
        }
        break;
      }
    }
  });
});

// 30Hz broadcast tick — sends full room state to all players
setInterval(() => {
  for (const [roomId, roomPlayers] of rooms.entries()) {
    const state = Array.from(roomPlayers.values());
    if (state.length > 0) {
      io.to(roomId).emit('tick', state);
    }
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Project Strike server running on port ${PORT}`);
});

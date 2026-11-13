import express from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { initDb } from './db.js';
import { router as roomRouter } from './routes/roomRoutes.js';
import { boardManager } from './engine/boardRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 8007;

// Initialize Database
initDb();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/v1', roomRouter);

app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SyncBoard Real-Time Canvas Engine',
    version: '1.0.0',
    activeRooms: boardManager.rooms.size
  });
});

// WebSocket Protocol Broker
wss.on('connection', (ws) => {
  let currentRoomId = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'join') {
        currentRoomId = msg.roomId || 'default-canvas';
        const session = boardManager.getOrCreateRoom(currentRoomId);
        session.addClient(ws, {
          id: msg.userId,
          name: msg.userName,
          color: msg.userColor
        });

        // Send initial state & peer list to connecting user
        const shapes = boardManager.getRoomShapes(currentRoomId);
        const peers = session.getPeers(ws);

        ws.send(JSON.stringify({
          type: 'init_room',
          roomId: currentRoomId,
          shapes,
          peers
        }));

        // Broadcast to other peers that someone joined
        const selfUser = session.clients.get(ws);
        session.broadcast({
          type: 'peer_joined',
          peer: {
            id: selfUser.id,
            name: selfUser.name,
            color: selfUser.color,
            cursor: selfUser.cursor
          }
        }, ws);

      } else if (msg.type === 'cursor') {
        if (!currentRoomId) return;
        const session = boardManager.rooms.get(currentRoomId);
        if (session) {
          const user = session.updateCursor(ws, msg.x, msg.y);
          if (user) {
            session.broadcast({
              type: 'peer_cursor',
              id: user.id,
              x: msg.x,
              y: msg.y
            }, ws);
          }
        }

      } else if (msg.type === 'shape_create') {
        if (!currentRoomId) return;
        const saved = boardManager.saveShape(currentRoomId, msg.shape);
        const session = boardManager.rooms.get(currentRoomId);
        if (session) {
          session.broadcast({
            type: 'shape_created',
            shape: saved
          }, ws);
        }
        // Acknowledge back to author with authoritative shape id
        ws.send(JSON.stringify({ type: 'shape_ack', tempId: msg.tempId, shape: saved }));

      } else if (msg.type === 'shape_update') {
        if (!currentRoomId) return;
        const saved = boardManager.saveShape(currentRoomId, msg.shape);
        const session = boardManager.rooms.get(currentRoomId);
        if (session) {
          session.broadcast({
            type: 'shape_updated',
            shape: saved
          }, ws);
        }

      } else if (msg.type === 'shape_delete') {
        if (!currentRoomId) return;
        boardManager.deleteShape(msg.shapeId);
        const session = boardManager.rooms.get(currentRoomId);
        if (session) {
          session.broadcast({
            type: 'shape_deleted',
            shapeId: msg.shapeId
          }, ws);
        }

      } else if (msg.type === 'clear_board') {
        if (!currentRoomId) return;
        boardManager.clearRoomShapes(currentRoomId);
        const session = boardManager.rooms.get(currentRoomId);
        if (session) {
          session.broadcast({
            type: 'board_cleared'
          }, ws);
        }
      }
    } catch (err) {
      console.error('[WS Error]', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && boardManager.rooms.has(currentRoomId)) {
      const session = boardManager.rooms.get(currentRoomId);
      const user = session.removeClient(ws);
      if (user) {
        session.broadcast({
          type: 'peer_left',
          id: user.id
        });
      }
    }
  });
});

// Serve Frontend Static SPA
const frontendPath = join(__dirname, '../../frontend');
if (existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(join(frontendPath, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`[SyncBoard] Real-time collaboration server running on port ${PORT}`);
});

export { app, server };

import { db } from '../db.js';
import crypto from 'node:crypto';

class RoomSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.clients = new Map(); // ws -> { id, name, color, cursor: {x,y} }
  }

  addClient(ws, user) {
    this.clients.set(ws, {
      id: user.id || crypto.randomUUID().slice(0, 8),
      name: user.name || 'Anonymous Architect',
      color: user.color || getRandomColor(),
      cursor: { x: 0, y: 0 }
    });
  }

  removeClient(ws) {
    const user = this.clients.get(ws);
    this.clients.delete(ws);
    return user;
  }

  updateCursor(ws, x, y) {
    const user = this.clients.get(ws);
    if (user) {
      user.cursor = { x, y };
      return user;
    }
    return null;
  }

  getPeers(excludeWs = null) {
    const peers = [];
    for (const [ws, user] of this.clients.entries()) {
      if (ws !== excludeWs) {
        peers.push({
          id: user.id,
          name: user.name,
          color: user.color,
          cursor: user.cursor
        });
      }
    }
    return peers;
  }

  broadcast(messageObj, excludeWs = null) {
    const payload = JSON.stringify(messageObj);
    for (const [ws] of this.clients.entries()) {
      if (ws !== excludeWs && ws.readyState === 1) { // 1 = OPEN
        ws.send(payload);
      }
    }
  }
}

export class BoardManager {
  constructor() {
    this.rooms = new Map(); // roomId -> RoomSession
  }

  getOrCreateRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new RoomSession(roomId));
    }
    return this.rooms.get(roomId);
  }

  // Database operations
  getRoomShapes(roomId) {
    const stmt = db.prepare(`
      SELECT id, room_id, type, data_json, z_index, created_at, updated_at
      FROM shapes
      WHERE room_id = ? AND is_deleted = 0
      ORDER BY z_index ASC
    `);
    const rows = stmt.all(roomId);
    return rows.map(r => ({
      id: r.id,
      roomId: r.room_id,
      type: r.type,
      data: JSON.parse(r.data_json),
      zIndex: r.z_index,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  saveShape(roomId, shape) {
    const shapeId = shape.id || ('shape-' + crypto.randomUUID().slice(0, 8));
    const zIndex = shape.zIndex || Date.now();

    const existing = db.prepare('SELECT id FROM shapes WHERE id = ?').get(shapeId);
    if (existing) {
      db.prepare(`
        UPDATE shapes
        SET type = ?, data_json = ?, z_index = ?, is_deleted = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(shape.type, JSON.stringify(shape.data), zIndex, shapeId);
    } else {
      db.prepare(`
        INSERT INTO shapes (id, room_id, type, data_json, z_index)
        VALUES (?, ?, ?, ?, ?)
      `).run(shapeId, roomId, shape.type, JSON.stringify(shape.data), zIndex);
    }

    return {
      id: shapeId,
      roomId,
      type: shape.type,
      data: shape.data,
      zIndex
    };
  }

  deleteShape(shapeId) {
    db.prepare('UPDATE shapes SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(shapeId);
  }

  clearRoomShapes(roomId) {
    db.prepare('UPDATE shapes SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE room_id = ?').run(roomId);
  }

  saveSnapshot(roomId, snapshotName) {
    const shapes = this.getRoomShapes(roomId);
    const snapId = 'snap-' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO snapshots (id, room_id, name, shapes_json)
      VALUES (?, ?, ?, ?)
    `).run(snapId, roomId, snapshotName || 'Canvas Snapshot', JSON.stringify(shapes));

    return {
      id: snapId,
      roomId,
      name: snapshotName,
      shapeCount: shapes.length,
      createdAt: new Date().toISOString()
    };
  }

  restoreSnapshot(roomId, snapshotId) {
    const snap = db.prepare('SELECT shapes_json FROM snapshots WHERE id = ? AND room_id = ?').get(snapshotId, roomId);
    if (!snap) throw new Error('Snapshot not found.');

    const shapes = JSON.parse(snap.shapes_json);
    this.clearRoomShapes(roomId);

    for (const s of shapes) {
      this.saveShape(roomId, s);
    }
    return shapes;
  }
}

export const boardManager = new BoardManager();

function getRandomColor() {
  const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5'];
  return colors[Math.floor(Math.random() * colors.length)];
}

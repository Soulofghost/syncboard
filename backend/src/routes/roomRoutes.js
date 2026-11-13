import express from 'express';
import { db } from '../db.js';
import { boardManager } from '../engine/boardRoom.js';
import crypto from 'node:crypto';

export const router = express.Router();

// 1. Rooms
router.get('/rooms', (req, res) => {
  try {
    const query = `
      SELECT
        r.*,
        COUNT(CASE WHEN s.is_deleted = 0 THEN s.id END) as active_shape_count
      FROM rooms r
      LEFT JOIN shapes s ON r.id = s.room_id
      GROUP BY r.id
      ORDER BY r.updated_at DESC
    `;
    const rooms = db.prepare(query).all();
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rooms', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required.' });

  const roomId = 'room-' + crypto.randomUUID().slice(0, 8);
  try {
    db.prepare('INSERT INTO rooms (id, name, description) VALUES (?, ?, ?)').run(
      roomId,
      name.trim(),
      description ? description.trim() : ''
    );
    const created = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const shapes = boardManager.getRoomShapes(roomId);
    res.json({
      ...room,
      shapes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  try {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    res.json({ status: 'deleted', roomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Snapshots
router.post('/rooms/:roomId/snapshot', (req, res) => {
  const { roomId } = req.params;
  const { name } = req.body;
  try {
    const snapshot = boardManager.saveSnapshot(roomId, name);
    res.status(201).json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rooms/:roomId/snapshots', (req, res) => {
  const { roomId } = req.params;
  try {
    const snapshots = db.prepare('SELECT id, room_id, name, created_at FROM snapshots WHERE room_id = ? ORDER BY created_at DESC').all(roomId);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rooms/:roomId/snapshots/:snapshotId/restore', (req, res) => {
  const { roomId, snapshotId } = req.params;
  try {
    const shapes = boardManager.restoreSnapshot(roomId, snapshotId);
    // Broadcast restore to connected clients
    const session = boardManager.rooms.get(roomId);
    if (session) {
      session.broadcast({ type: 'board_restored', shapes });
    }
    res.json({ status: 'restored', shapeCount: shapes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

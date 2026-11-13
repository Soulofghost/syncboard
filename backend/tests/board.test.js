import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { db, initDb } from '../src/db.js';
import { boardManager } from '../src/engine/boardRoom.js';

describe('SyncBoard Collaboration Engine Tests', () => {
  before(() => {
    initDb();
  });

  test('Database seeds default architecture canvas room and initial shapes', () => {
    const room = db.prepare("SELECT * FROM rooms WHERE id = 'default-canvas'").get();
    assert.ok(room, 'Default canvas room should exist');
    assert.equal(room.id, 'default-canvas');

    const shapes = boardManager.getRoomShapes('default-canvas');
    assert.ok(shapes.length >= 4, 'Should contain pre-seeded architecture shapes');
  });

  test('boardManager can create, retrieve and update new shapes', () => {
    const testRoomId = 'test-room-1';
    db.prepare("INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)").run(testRoomId, 'Integration Room');

    // Create shape
    const shapePayload = {
      id: 'shape-unit-test-1',
      type: 'rect',
      data: { x: 50, y: 80, width: 120, height: 90, stroke: '#2563eb' }
    };
    const saved = boardManager.saveShape(testRoomId, shapePayload);
    assert.equal(saved.id, 'shape-unit-test-1');
    assert.equal(saved.type, 'rect');
    assert.equal(saved.data.width, 120);

    // Update shape
    shapePayload.data.width = 250;
    const updated = boardManager.saveShape(testRoomId, shapePayload);
    assert.equal(updated.data.width, 250);

    // Verify retrieval
    const activeShapes = boardManager.getRoomShapes(testRoomId);
    const found = activeShapes.find(s => s.id === 'shape-unit-test-1');
    assert.ok(found);
    assert.equal(found.data.width, 250);
  });

  test('boardManager soft-deletes shapes without dropping historical rows', () => {
    const testRoomId = 'test-room-1';
    boardManager.deleteShape('shape-unit-test-1');

    // Should not appear in active shapes list
    const active = boardManager.getRoomShapes(testRoomId);
    const found = active.find(s => s.id === 'shape-unit-test-1');
    assert.equal(found, undefined, 'Soft-deleted shape must not appear in active list');

    // Should still exist in database with is_deleted = 1
    const rawRow = db.prepare("SELECT is_deleted FROM shapes WHERE id = 'shape-unit-test-1'").get();
    assert.equal(rawRow.is_deleted, 1);
  });

  test('boardManager takes snapshots and restores canvas state', () => {
    const testRoomId = 'test-room-snapshot';
    db.prepare("INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)").run(testRoomId, 'Snapshot Room');

    // Add 2 shapes
    boardManager.saveShape(testRoomId, {
      id: 'snap-s1',
      type: 'note',
      data: { text: 'Key Insight 1', color: '#fef08a' }
    });
    boardManager.saveShape(testRoomId, {
      id: 'snap-s2',
      type: 'circle',
      data: { x: 200, y: 200, radius: 50 }
    });

    // Save snapshot
    const snap = boardManager.saveSnapshot(testRoomId, 'Pre-Deployment Milestone');
    assert.ok(snap.id.startsWith('snap-'));
    assert.equal(snap.shapeCount, 2);

    // Clear board
    boardManager.clearRoomShapes(testRoomId);
    assert.equal(boardManager.getRoomShapes(testRoomId).length, 0);

    // Restore snapshot
    const restored = boardManager.restoreSnapshot(testRoomId, snap.id);
    assert.equal(restored.length, 2);
    assert.equal(boardManager.getRoomShapes(testRoomId).length, 2);
  });

  test('RoomSession manages client cursor presence and peer lists', () => {
    const session = boardManager.getOrCreateRoom('default-canvas');
    const mockWs1 = { readyState: 1, send: () => {} };
    const mockWs2 = { readyState: 1, send: () => {} };

    session.addClient(mockWs1, { id: 'user-alpha', name: 'Alice', color: '#2563eb' });
    session.addClient(mockWs2, { id: 'user-beta', name: 'Bob', color: '#059669' });

    session.updateCursor(mockWs1, 450, 320);

    const peersForBob = session.getPeers(mockWs2);
    assert.equal(peersForBob.length, 1);
    assert.equal(peersForBob[0].id, 'user-alpha');
    assert.equal(peersForBob[0].cursor.x, 450);
    assert.equal(peersForBob[0].cursor.y, 320);

    // Cleanup
    session.removeClient(mockWs1);
    session.removeClient(mockWs2);
  });
});

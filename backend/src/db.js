import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = process.env.SYNCBOARD_DB || join(DATA_DIR, 'syncboard.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode & foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shapes (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('pen', 'rect', 'circle', 'arrow', 'note', 'text')),
      data_json TEXT NOT NULL,
      z_index INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      shapes_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
  `);

  // Seed default demonstration room if none exist
  const roomCount = db.prepare('SELECT count(*) as count FROM rooms').get().count;
  if (roomCount === 0) {
    seedDemoRoom();
  }
}

function seedDemoRoom() {
  const insertRoom = db.prepare('INSERT INTO rooms (id, name, description) VALUES (?, ?, ?)');
  insertRoom.run('default-canvas', 'System Architecture & Sprint Canvas', 'Primary collaborative workspace for microservice architecture mapping');

  const insertShape = db.prepare(`
    INSERT INTO shapes (id, room_id, type, data_json, z_index)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Initial sticky note
  insertShape.run(
    'shape-note-1',
    'default-canvas',
    'note',
    JSON.stringify({
      x: 120,
      y: 100,
      width: 220,
      height: 160,
      text: 'Sprint Goal:\nDeploy Distributed WAL Engine & Verify Concurrent Peer Sync',
      color: '#fef08a',
      textColor: '#854d0e'
    }),
    1
  );

  // Initial architecture block
  insertShape.run(
    'shape-rect-1',
    'default-canvas',
    'rect',
    JSON.stringify({
      x: 420,
      y: 110,
      width: 200,
      height: 120,
      stroke: '#2563eb',
      strokeWidth: 2,
      fill: '#eff6ff',
      label: 'API Gateway / WS Proxy'
    }),
    2
  );

  // Initial database circle
  insertShape.run(
    'shape-circle-1',
    'default-canvas',
    'circle',
    JSON.stringify({
      x: 740,
      y: 110,
      radius: 65,
      stroke: '#059669',
      strokeWidth: 2,
      fill: '#ecfdf5',
      label: 'Cluster Storage'
    }),
    3
  );

  // Initial arrow connecting them
  insertShape.run(
    'shape-arrow-1',
    'default-canvas',
    'arrow',
    JSON.stringify({
      fromX: 620,
      fromY: 170,
      toX: 740,
      toY: 170,
      stroke: '#64748b',
      strokeWidth: 2
    }),
    4
  );
}

# SyncBoard | Real-Time Collaborative Canvas & Multiplayer Whiteboard Workspace

[![CI Pipeline](https://github.com/Soulofghost/syncboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Soulofghost/syncboard/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js v22+](https://img.shields.io/badge/Node.js-v22%2B-brightgreen.svg)](https://nodejs.org/)
[![WebSocket](https://img.shields.io/badge/WebSocket-RFC%206455-purple.svg)](https://github.com/websockets/ws)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Engine-orange.svg)](https://www.sqlite.org/)

---

## 1. Project Introduction

**SyncBoard** is a low-latency, real-time multiplayer digital whiteboard and architecture canvas designed for distributed engineering teams, solutions architects, and product designers. Powered by WebSocket message brokering and transactional SQLite Write-Ahead Logging (WAL), SyncBoard enables simultaneous multi-user sketching, live cursor presence interpolation, room isolation, and instant version snapshot rollbacks.

---

## 2. Problem Statement

Distributed engineering teams rely heavily on visual ideation and system architecture mapping during design reviews and sprint planning. However, existing collaboration tools suffer from:
- **High Latency & State Inconsistency:** Out-of-sync canvas elements and jerky cursor updates degrade the experience of remote pairing.
- **Data Lock-in & Clunky History:** Inability to easily capture point-in-time architecture snapshots or export clean vector/raster deliverables.
- **Heavy Infrastructure Overhead:** Many solutions require heavy microservice infrastructure (Redis, PubSub clusters, complex operational transformation servers) even for small-to-medium enterprise teams.

---

## 3. Proposed Solution

SyncBoard addresses these challenges with a lean, high-throughput architecture:
- **Sub-50ms Delta Broadcasts:** Low-overhead binary/JSON WebSocket protocol broadcasting shape creations, coordinate modifications, and throttled cursor vectors.
- **Durable Local-First Persistence:** Transactional SQLite backing ensures every drawn element is persisted without cloud vendor lock-in.
- **State Version Snapshots:** Point-in-time milestone snapshots allowing teams to freeze architectural decisions and revert at any time.

---

## 4. Key Features

- **Multi-Tool Creative Palette:** Freehand Pen (with path smoothing), Rectangles, Circles, Arrow connectors, Sticky Notes, and Text Labels.
- **Smooth Cursor Presence:** Sub-pixel remote pointer interpolation displaying peer names, color-coded identification, and real-time movements.
- **Multi-Tenant Room Isolation:** Instant room creation and switching with independent canvas state and client membership.
- **Version Snapshots & Restore:** Capture named milestones and instantly roll back the entire canvas state with automatic client synchronization.
- **One-Click Image Export:** High-resolution PNG export directly from the HTML5 Canvas context.

---

## 5. Architecture Diagram

```mermaid
flowchart TD
    Client1["Peer A (Browser Canvas)"]
    Client2["Peer B (Browser Canvas)"]
    WSBroker["WebSocket Server & Message Broker (/ws)"]
    RESTAPI["Express REST API (/api/v1)"]
    Manager["BoardManager (In-Memory Room State)"]
    DB[("SQLite WAL Engine (syncboard.db)")]

    Client1 <-->|WebSocket Stream (Cursors / Shapes)| WSBroker
    Client2 <-->|WebSocket Stream (Cursors / Shapes)| WSBroker
    Client1 -->|REST API (Rooms / Snapshots)| RESTAPI
    Client2 -->|REST API (Rooms / Snapshots)| RESTAPI

    WSBroker <--> Manager
    RESTAPI <--> Manager
    Manager <-->|Persist Shapes & Snapshots| DB
```

---

## 6. Technology Stack

- **Runtime:** Node.js v22+
- **WebSocket Protocol:** `ws` (RFC 6455 compliant)
- **Web Framework:** Express.js 4.19
- **Database Engine:** `node:sqlite` (SQLite 3 with Write-Ahead Logging)
- **Frontend Architecture:** HTML5 Canvas API, Vanilla ES6 JavaScript, Space Grotesk & Plus Jakarta Sans typography
- **DevOps:** Docker, Docker Compose, GitHub Actions CI
- **Testing:** Node.js native test runner (`node:test`, `node:assert/strict`)

---

## 7. Folder Structure

```
syncboard/
├── .github/
│   └── workflows/
│       └── ci.yml
├── backend/
│   ├── src/
│   │   ├── engine/
│   │   │   └── boardRoom.js
│   │   ├── routes/
│   │   │   └── roomRoutes.js
│   │   ├── db.js
│   │   └── server.js
│   ├── tests/
│   │   └── board.test.js
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── LICENSE
└── README.md
```

---

## 8. Installation Instructions

### Prerequisites
- Node.js 22.x or later
- npm or yarn

### Setup Steps
```bash
git clone https://github.com/Soulofghost/syncboard.git
cd syncboard/backend
npm install
npm start
```

Access the application in your browser at `http://localhost:8007`.

---

## 9. Environment Configuration

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `8007` | HTTP & WebSocket server port |
| `SYNCBOARD_DB` | `./backend/data/syncboard.db` | SQLite database file location |
| `NODE_ENV` | `development` | Runtime environment mode |

---

## 10. Database Setup

Database schema and demonstration architecture room are automatically initialized on startup via `initDb()`:
```javascript
import { initDb } from './src/db.js';
initDb();
```

---

## 11. API Documentation

### Primary REST Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Health status and active room count |
| `GET` | `/api/v1/rooms` | List collaboration rooms with shape count |
| `POST` | `/api/v1/rooms` | Create new collaboration canvas |
| `GET` | `/api/v1/rooms/:roomId` | Retrieve room metadata & active shapes |
| `DELETE` | `/api/v1/rooms/:roomId` | Delete room and linked shapes |
| `GET` | `/api/v1/rooms/:roomId/snapshots` | List version snapshots |
| `POST` | `/api/v1/rooms/:roomId/snapshot` | Save current board snapshot |
| `POST` | `/api/v1/rooms/:roomId/snapshots/:id/restore` | Rollback room to snapshot state |

### WebSocket Protocol (`ws://<host>:<port>/ws`)

| Message Type | Direction | Payload Description |
| :--- | :--- | :--- |
| `join` | Client &rarr; Server | `{ roomId, userId, userName, userColor }` |
| `init_room` | Server &rarr; Client | Initial snapshot of room shapes & active peers |
| `cursor` | Client &rarr; Server | Throttled coordinates `{ x, y }` |
| `peer_cursor` | Server &rarr; Peers | Remote cursor update `{ id, x, y }` |
| `shape_create` | Client &rarr; Server | New shape payload `{ type, data }` |
| `shape_created` | Server &rarr; Peers | Authoritative shape broadcast |
| `shape_update` | Client &rarr; Server | Coordinate/attribute modification |
| `shape_delete` | Client &rarr; Server | Soft-delete shape notification |
| `clear_board` | Client &rarr; Server | Purge all shapes from room |

---

## 12. Application Interface Overview

SyncBoard features a human-designed, uncluttered design language:
- **Clean Matrix Canvas:** Subtle dot-grid background for precision visual alignment.
- **Glassmorphic Floating Dock:** Bottom-docked tool selector with color chips and action shortcuts.
- **Peer Presence Pills:** Color-coordinated avatar pills indicating active collaborators.
- **Remote Cursors:** Labeled pointers tracking peer attention in real-time.

---

## 13. Testing Instructions

Run the automated test suite using the Node.js test runner:

```bash
cd backend
npm test
```

Expected output:
```
▶ SyncBoard Collaboration Engine Tests
  ✔ Database seeds default architecture canvas room and initial shapes
  ✔ boardManager can create, retrieve and update new shapes
  ✔ boardManager soft-deletes shapes without dropping historical rows
  ✔ boardManager takes snapshots and restores canvas state
  ✔ RoomSession manages client cursor presence and peer lists
✔ SyncBoard Collaboration Engine Tests (25ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

---

## 14. Security Considerations

- **Input Sanitization:** JSON schema validation on incoming WebSocket messages to prevent malformed shape injection.
- **Soft Deletion:** Shapes are marked as `is_deleted = 1` rather than dropped, preserving historical audit trails.
- **Resource Limits:** WebSocket payload limits and coordinate bounds checking prevent canvas memory bloat.

---

## 15. Deployment Instructions

### Docker Deployment
```bash
docker compose up -d --build
```
Access the application at `http://localhost:8007`.

---

## 16. Known Limitations

- High concurrency beyond 1,000 active concurrent WebSocket writers on a single node requires clustering via Redis adapter or horizontal scaling.
- Text tool currently supports single-line and multiline labels via prompt dialog; inline rich-text editing planned for next version.

---

## 17. Future Roadmap

- [ ] Inline WYSIWYG rich text editor for sticky notes and freeform labels.
- [ ] SVG vector import / export alongside raster PNG export.
- [ ] Read-only view link sharing with access expiration tokens.
- [ ] Infinite canvas pan and zoom with touchpad pinch gestures.

---

## 18. License

SPDX-License-Identifier: MIT
Copyright (c) 2026 Alvin MS (@Soulofghost). All rights reserved.

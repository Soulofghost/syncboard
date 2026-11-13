// SyncBoard Real-Time Canvas Client
const API_BASE = '/api/v1';

let state = {
  currentRoomId: 'default-canvas',
  currentUser: {
    id: 'user-' + Math.random().toString(36).substring(2, 8),
    name: 'Architect ' + Math.floor(10 + Math.random() * 90),
    color: ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2'][Math.floor(Math.random() * 6)]
  },
  activeTool: 'select',
  activeColor: '#0f172a',
  shapes: [],
  peers: new Map(), // id -> { name, color, cursor: {x,y} }
  isDrawing: false,
  currentShape: null,
  dragTarget: null,
  dragOffset: { x: 0, y: 0 }
};

let ws = null;
let canvas, ctx;
let lastCursorBroadcast = 0;

document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  setupUI();
  connectWebSocket();
});

function initCanvas() {
  canvas = document.getElementById('whiteboardCanvas');
  ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 60;
    renderBoard();
  }

  window.addEventListener('resize', resize);
  resize();

  // Mouse / Pointer Events
  canvas.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);
}

function setupUI() {
  // Tools
  const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTool = btn.dataset.tool;
    });
  });

  // Color chips
  const colorChips = document.querySelectorAll('.color-chip');
  colorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      colorChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeColor = chip.dataset.color;
    });
  });

  // Clear Board
  document.getElementById('btnClearBoard').addEventListener('click', () => {
    if (confirm('Clear all shapes on current canvas?')) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'clear_board' }));
      }
      state.shapes = [];
      renderBoard();
    }
  });

  // Export
  document.getElementById('btnExport').addEventListener('click', exportCanvasPNG);

  // Modals
  setupModals();
}

function setupModals() {
  const roomsModal = document.getElementById('roomsModal');
  const btnRooms = document.getElementById('btnRooms');
  const btnCloseRooms = document.getElementById('btnCloseRooms');
  const createRoomForm = document.getElementById('createRoomForm');

  btnRooms.addEventListener('click', () => {
    loadRooms();
    roomsModal.classList.remove('hidden');
  });
  btnCloseRooms.addEventListener('click', () => roomsModal.classList.add('hidden'));

  createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newRoomName').value.trim();
    if (!name) return;

    const res = await fetch(`${API_BASE}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const newRoom = await res.json();
    document.getElementById('newRoomName').value = '';
    switchRoom(newRoom.id, newRoom.name);
    roomsModal.classList.add('hidden');
  });

  // Snapshots
  const snapModal = document.getElementById('snapshotsModal');
  const btnSnapshots = document.getElementById('btnSnapshots');
  const btnCloseSnapshots = document.getElementById('btnCloseSnapshots');
  const createSnapshotForm = document.getElementById('createSnapshotForm');

  btnSnapshots.addEventListener('click', () => {
    loadSnapshots();
    snapModal.classList.remove('hidden');
  });
  btnCloseSnapshots.addEventListener('click', () => snapModal.classList.add('hidden'));

  createSnapshotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('snapshotName').value.trim();
    if (!name) return;

    await fetch(`${API_BASE}/rooms/${state.currentRoomId}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    document.getElementById('snapshotName').value = '';
    loadSnapshots();
  });
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join',
      roomId: state.currentRoomId,
      userId: state.currentUser.id,
      userName: state.currentUser.name,
      userColor: state.currentUser.color
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'init_room') {
        state.shapes = msg.shapes || [];
        state.peers.clear();
        (msg.peers || []).forEach(p => state.peers.set(p.id, p));
        updatePresenceBar();
        renderBoard();

      } else if (msg.type === 'peer_joined') {
        state.peers.set(msg.peer.id, msg.peer);
        updatePresenceBar();

      } else if (msg.type === 'peer_left') {
        state.peers.delete(msg.id);
        removeCursorElement(msg.id);
        updatePresenceBar();

      } else if (msg.type === 'peer_cursor') {
        const peer = state.peers.get(msg.id);
        if (peer) {
          peer.cursor = { x: msg.x, y: msg.y };
          renderRemoteCursor(peer);
        }

      } else if (msg.type === 'shape_created') {
        state.shapes.push(msg.shape);
        renderBoard();

      } else if (msg.type === 'shape_updated') {
        const idx = state.shapes.findIndex(s => s.id === msg.shape.id);
        if (idx !== -1) {
          state.shapes[idx] = msg.shape;
          renderBoard();
        }

      } else if (msg.type === 'shape_deleted') {
        state.shapes = state.shapes.filter(s => s.id !== msg.shapeId);
        renderBoard();

      } else if (msg.type === 'board_cleared') {
        state.shapes = [];
        renderBoard();

      } else if (msg.type === 'board_restored') {
        state.shapes = msg.shapes;
        renderBoard();
      }
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

// Canvas Interaction Handlers
function handlePointerDown(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  state.isDrawing = true;

  if (state.activeTool === 'select') {
    // Find clicked shape (iterate in reverse z-order)
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (isHit(s, x, y)) {
        state.dragTarget = s;
        state.dragOffset = { x: x - (s.data.x || 0), y: y - (s.data.y || 0) };
        break;
      }
    }
  } else if (state.activeTool === 'eraser') {
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (isHit(s, x, y)) {
        ws.send(JSON.stringify({ type: 'shape_delete', shapeId: s.id }));
        state.shapes.splice(i, 1);
        renderBoard();
        break;
      }
    }
  } else if (state.activeTool === 'pen') {
    state.currentShape = {
      id: 'temp-' + Date.now(),
      type: 'pen',
      data: {
        points: [{ x, y }],
        stroke: state.activeColor,
        strokeWidth: 3
      }
    };
  } else if (state.activeTool === 'rect') {
    state.currentShape = {
      id: 'temp-' + Date.now(),
      type: 'rect',
      data: {
        x, y, width: 0, height: 0,
        stroke: state.activeColor,
        strokeWidth: 2,
        fill: 'rgba(255,255,255,0.7)'
      }
    };
  } else if (state.activeTool === 'circle') {
    state.currentShape = {
      id: 'temp-' + Date.now(),
      type: 'circle',
      data: {
        x, y, radius: 0,
        stroke: state.activeColor,
        strokeWidth: 2,
        fill: 'rgba(255,255,255,0.7)'
      }
    };
  } else if (state.activeTool === 'arrow') {
    state.currentShape = {
      id: 'temp-' + Date.now(),
      type: 'arrow',
      data: {
        fromX: x, fromY: y, toX: x, toY: y,
        stroke: state.activeColor,
        strokeWidth: 2
      }
    };
  } else if (state.activeTool === 'note') {
    const text = prompt('Enter note content:') || 'Quick Note';
    const noteShape = {
      id: 'shape-' + Math.random().toString(36).substring(2, 9),
      type: 'note',
      data: {
        x, y, width: 180, height: 140,
        text,
        color: '#fef08a',
        textColor: '#854d0e'
      }
    };
    commitShape(noteShape);
    state.isDrawing = false;
  } else if (state.activeTool === 'text') {
    const text = prompt('Enter label text:') || 'Label';
    const textShape = {
      id: 'shape-' + Math.random().toString(36).substring(2, 9),
      type: 'text',
      data: {
        x, y, text,
        stroke: state.activeColor,
        fontSize: 18
      }
    };
    commitShape(textShape);
    state.isDrawing = false;
  }
}

function handlePointerMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Broadcast cursor (throttled to 30ms)
  const now = Date.now();
  if (now - lastCursorBroadcast > 30 && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'cursor', x, y }));
    lastCursorBroadcast = now;
  }

  if (!state.isDrawing) return;

  if (state.activeTool === 'select' && state.dragTarget) {
    state.dragTarget.data.x = x - state.dragOffset.x;
    state.dragTarget.data.y = y - state.dragOffset.y;
    renderBoard();
  } else if (state.activeTool === 'pen' && state.currentShape) {
    state.currentShape.data.points.push({ x, y });
    renderBoard();
    drawShape(state.currentShape);
  } else if (state.activeTool === 'rect' && state.currentShape) {
    state.currentShape.data.width = x - state.currentShape.data.x;
    state.currentShape.data.height = y - state.currentShape.data.y;
    renderBoard();
    drawShape(state.currentShape);
  } else if (state.activeTool === 'circle' && state.currentShape) {
    const dx = x - state.currentShape.data.x;
    const dy = y - state.currentShape.data.y;
    state.currentShape.data.radius = Math.sqrt(dx * dx + dy * dy);
    renderBoard();
    drawShape(state.currentShape);
  } else if (state.activeTool === 'arrow' && state.currentShape) {
    state.currentShape.data.toX = x;
    state.currentShape.data.toY = y;
    renderBoard();
    drawShape(state.currentShape);
  }
}

function handlePointerUp() {
  if (!state.isDrawing) return;
  state.isDrawing = false;

  if (state.activeTool === 'select' && state.dragTarget) {
    // Send shape update
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'shape_update', shape: state.dragTarget }));
    }
    state.dragTarget = null;
  } else if (state.currentShape) {
    commitShape(state.currentShape);
    state.currentShape = null;
  }
}

function commitShape(shape) {
  const shapePayload = {
    id: shape.id.startsWith('temp-') ? ('shape-' + Math.random().toString(36).substring(2, 9)) : shape.id,
    type: shape.type,
    data: shape.data
  };
  state.shapes.push(shapePayload);
  renderBoard();

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'shape_create', shape: shapePayload }));
  }
}

function renderBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.shapes.forEach(drawShape);
}

function drawShape(s) {
  ctx.save();
  const d = s.data;

  if (s.type === 'pen' && d.points && d.points.length > 1) {
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(d.points[0].x, d.points[0].y);
    for (let i = 1; i < d.points.length; i++) {
      ctx.lineTo(d.points[i].x, d.points[i].y);
    }
    ctx.stroke();

  } else if (s.type === 'rect') {
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 2;
    ctx.fillStyle = d.fill || '#fff';
    ctx.fillRect(d.x, d.y, d.width, d.height);
    ctx.strokeRect(d.x, d.y, d.width, d.height);
    if (d.label) {
      ctx.font = '600 13px Plus Jakarta Sans';
      ctx.fillStyle = d.stroke;
      ctx.fillText(d.label, d.x + 12, d.y + 24);
    }

  } else if (s.type === 'circle') {
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 2;
    ctx.fillStyle = d.fill || '#fff';
    ctx.beginPath();
    ctx.arc(d.x, d.y, Math.abs(d.radius || 10), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (d.label) {
      ctx.font = '600 13px Plus Jakarta Sans';
      ctx.fillStyle = d.stroke;
      ctx.textAlign = 'center';
      ctx.fillText(d.label, d.x, d.y + 4);
    }

  } else if (s.type === 'arrow') {
    ctx.strokeStyle = d.stroke || '#0f172a';
    ctx.lineWidth = d.strokeWidth || 2;
    ctx.beginPath();
    ctx.moveTo(d.fromX, d.fromY);
    ctx.lineTo(d.toX, d.toY);
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(d.toY - d.fromY, d.toX - d.fromX);
    ctx.fillStyle = d.stroke;
    ctx.beginPath();
    ctx.moveTo(d.toX, d.toY);
    ctx.lineTo(d.toX - 12 * Math.cos(angle - Math.PI / 6), d.toY - 12 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(d.toX - 12 * Math.cos(angle + Math.PI / 6), d.toY - 12 * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();

  } else if (s.type === 'note') {
    ctx.fillStyle = d.color || '#fef08a';
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillRect(d.x, d.y, d.width || 180, d.height || 140);
    ctx.shadowColor = 'transparent';

    ctx.font = '600 15px Caveat';
    ctx.fillStyle = d.textColor || '#854d0e';
    wrapText(ctx, d.text || '', d.x + 14, d.y + 26, (d.width || 180) - 28, 20);

  } else if (s.type === 'text') {
    ctx.font = `600 ${d.fontSize || 16}px Plus Jakarta Sans`;
    ctx.fillStyle = d.stroke || '#0f172a';
    ctx.fillText(d.text || '', d.x, d.y);
  }

  ctx.restore();
}

function isHit(s, px, py) {
  const d = s.data;
  if (s.type === 'rect' || s.type === 'note') {
    const w = d.width || 180;
    const h = d.height || 140;
    return px >= d.x && px <= d.x + w && py >= d.y && py <= d.y + h;
  }
  if (s.type === 'circle') {
    const dist = Math.sqrt((px - d.x) ** 2 + (py - d.y) ** 2);
    return dist <= Math.abs(d.radius || 20);
  }
  if (s.type === 'text') {
    return px >= d.x && px <= d.x + 120 && py >= d.y - 20 && py <= d.y + 10;
  }
  return false;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split('\n');
  let currentY = y;
  for (let paragraph of words) {
    const pWords = paragraph.split(' ');
    let line = '';
    for (let n = 0; n < pWords.length; n++) {
      const testLine = line + pWords[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = pWords[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
}

// Presence & Remote Cursors
function updatePresenceBar() {
  const container = document.getElementById('peersList');
  let html = `<div class="peer-avatar" style="background:${state.currentUser.color};" title="You (${state.currentUser.name})">You</div>`;

  state.peers.forEach(peer => {
    const initials = peer.name.slice(0, 2).toUpperCase();
    html += `<div class="peer-avatar" style="background:${peer.color};" title="${peer.name}">${initials}</div>`;
  });
  container.innerHTML = html;
}

function renderRemoteCursor(peer) {
  const layer = document.getElementById('cursorsLayer');
  let curEl = document.getElementById('cur-' + peer.id);

  if (!curEl) {
    curEl = document.createElement('div');
    curEl.id = 'cur-' + peer.id;
    curEl.className = 'remote-cursor';
    curEl.innerHTML = `
      <svg class="cursor-pointer" viewBox="0 0 24 24" fill="${peer.color}">
        <path d="M4 0l16 12-7 2-4 10z"/>
      </svg>
      <span class="cursor-label" style="background:${peer.color};">${escapeHtml(peer.name)}</span>
    `;
    layer.appendChild(curEl);
  }

  curEl.style.transform = `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`;
}

function removeCursorElement(id) {
  const el = document.getElementById('cur-' + id);
  if (el) el.remove();
}

async function loadRooms() {
  const list = document.getElementById('roomsList');
  try {
    const res = await fetch(`${API_BASE}/rooms`);
    const rooms = await res.json();
    list.innerHTML = rooms.map(r => `
      <div class="room-card-item" onclick="switchRoom('${r.id}', '${escapeHtml(r.name)}')">
        <div class="room-info">
          <strong>${escapeHtml(r.name)}</strong>
          <p>${r.active_shape_count} active elements · ${escapeHtml(r.description || 'Workspace')}</p>
        </div>
        <button class="btn btn-sm btn-outline">Join</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load rooms:', err);
  }
}

function switchRoom(roomId, roomName) {
  state.currentRoomId = roomId;
  document.getElementById('currentRoomLabel').textContent = `Room: ${roomName}`;
  document.getElementById('roomsModal').classList.add('hidden');

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'join',
      roomId,
      userId: state.currentUser.id,
      userName: state.currentUser.name,
      userColor: state.currentUser.color
    }));
  }
}

async function loadSnapshots() {
  const list = document.getElementById('snapshotsList');
  try {
    const res = await fetch(`${API_BASE}/rooms/${state.currentRoomId}/snapshots`);
    const snapshots = await res.json();
    if (snapshots.length === 0) {
      list.innerHTML = '<p style="color:#64748b;font-size:0.85rem;padding:12px;">No snapshots saved for this room yet.</p>';
      return;
    }
    list.innerHTML = snapshots.map(s => `
      <div class="snap-item">
        <div>
          <strong>${escapeHtml(s.name)}</strong>
          <p style="font-size:0.75rem;color:#64748b;">${new Date(s.created_at).toLocaleString()}</p>
        </div>
        <button class="btn btn-sm btn-primary" onclick="restoreSnapshot('${s.id}')">Restore</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load snapshots:', err);
  }
}

window.restoreSnapshot = async function(id) {
  if (confirm('Revert current canvas to this snapshot version?')) {
    await fetch(`${API_BASE}/rooms/${state.currentRoomId}/snapshots/${id}/restore`, { method: 'POST' });
    document.getElementById('snapshotsModal').classList.add('hidden');
  }
};

function exportCanvasPNG() {
  const link = document.createElement('a');
  link.download = `syncboard-${state.currentRoomId}-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

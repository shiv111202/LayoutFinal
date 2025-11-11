// core/interactions.js
import { draw, worldToScreen, screenToWorld } from "./render.js";
import { polygons, selected, setSelected, pushState, toast, view, showRoomLengths, showRoomNames, moveSharedEdgesEnabled, alignEnabled, snapEnabled, snapStep } from "./state.js";
import { pointInPoly, distPtSeg } from "./utils.js";
import { computeNeighbors } from "./state.js";

/** === Local State === **/
let canvas;
let mouse = {
  x: 0, y: 0, wx: 0, wy: 0,
  down: false, drag: false, button: 0,
  start: { x: 0, y: 0, wx: 0, wy: 0 }
};
let panning = false;
let shiftHeld = false;
let addVertexMode = false;
let highlightEdge = { poly: null, idx: null };

/** === Main setup === **/
export function setupInteractions(c) {
  canvas = c;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onMouseWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

/** === Helpers === **/
function nearestVertex(poly, p, tol = 0.4) {
  let best = -1, bestd = Infinity;
  for (let i = 0; i < poly.coords.length; i++) {
    const d = Math.hypot(p[0] - poly.coords[i][0], p[1] - poly.coords[i][1]);
    if (d < bestd) {
      bestd = d;
      best = i;
    }
  }
  return bestd < tol ? best : null;
}

function nearestEdge(poly, p) {
  const cs = poly.coords;
  if (!cs.length) return null;
  const lens = cs.map((_, i) => {
    const a = cs[i], b = cs[(i + 1) % cs.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const avg = lens.reduce((s, v) => s + v, 0) / Math.max(1, lens.length);
  const baseTol = 0.5 * Math.max(1.0, avg / 10.0);
  let best = -1, bestd = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = distPtSeg(p, cs[i], cs[(i + 1) % cs.length]);
    if (d < bestd) {
      bestd = d;
      best = i;
    }
  }
  return bestd < baseTol ? best : null;
}

/** === Event Handlers === **/
function onMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x;
  mouse.wy = w.y;
  mouse.down = true;
  mouse.button = e.button;
  mouse.drag = false;
  mouse.start = { x: mouse.x, y: mouse.y, wx: w.x, wy: w.y };

  // === Add Vertex Mode ===
  if (addVertexMode && selected && e.button === 0) {
    const wx = mouse.wx;
    const wy = mouse.wy;
    const edgeIdx = nearestEdge(selected, [wx, wy]);
    if (edgeIdx == null) {
      toast("⚠️ Click closer to an edge");
      return;
    }

    const a = selected.coords[edgeIdx];
    const b = selected.coords[(edgeIdx + 1) % selected.coords.length];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const ap = [wx - a[0], wy - a[1]];
    const len2 = ab[0] ** 2 + ab[1] ** 2;
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
    t = Math.max(0.001, Math.min(0.999, t));

    let newPt = [a[0] + ab[0] * t, a[1] + ab[1] * t];

    // snap nearby vertices
    const SNAP_TOL = 0.15;
    for (const poly of polygons) {
      for (const [vx, vy] of poly.coords) {
        if (Math.abs(vx - newPt[0]) < SNAP_TOL) newPt[0] = vx;
        if (Math.abs(vy - newPt[1]) < SNAP_TOL) newPt[1] = vy;
      }
    }

    pushState();
    selected.coords.splice(edgeIdx + 1, 0, newPt);
    addVertexMode = false;
    canvas.style.cursor = "default";
    toast("✅ Vertex added");
    draw();
    return;
  }

  // === Panning ===
  if (e.button === 1 || e.button === 2) {
    panning = true;
    return;
  }

  // === Vertex / Edge selection ===
  if (selected) {
    selected.selected_vertex = nearestVertex(selected, [w.x, w.y], 0.4);
    if (selected.selected_vertex != null) {
      pushState();
      return;
    }
    const edgeIdx = nearestEdge(selected, [w.x, w.y]);
    if (edgeIdx != null) {
      selected.selected_edge = edgeIdx;
      pushState();
      return;
    }
  }

  // === Room selection ===
  const poly = polygons.find((p) => pointInPoly({ x: w.x, y: w.y }, p));
  if (poly) {
    setSelected(poly);
    draw();
  } else {
    setSelected(null);
    draw();
  }
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x;
  mouse.wy = w.y;

  if (!mouse.down) {
    draw();
    return;
  }

  mouse.drag =
    Math.abs(mouse.x - mouse.start.x) > 2 ||
    Math.abs(mouse.y - mouse.start.y) > 2;

  // === Panning ===
  if (panning) {
    const dx = (mouse.x - mouse.start.x) / view.scale;
    const dy = (mouse.y - mouse.start.y) / view.scale;
    view.x -= dx;
    view.y -= dy;
    mouse.start.x = mouse.x;
    mouse.start.y = mouse.y;
    draw();
    return;
  }

  if (!selected) return;

  const snapped = (v) =>
    snapEnabled ? Math.round(v / snapStep) * snapStep : v;

  // === Vertex Drag ===
  if (selected.selected_vertex != null) {
    let x = snapped(mouse.wx),
      y = snapped(mouse.wy);
    [x, y] = alignEnabled ? alignPoint([x, y], selected) : [x, y];
    selected.coords[selected.selected_vertex] = [x, y];
    draw();
    return;
  }

  // === Edge Drag ===
  if (selected.selected_edge != null) {
    const idx = selected.selected_edge;
    const coords = selected.coords;
    const p1 = coords[idx];
    const p2 = coords[(idx + 1) % coords.length];
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const move = [snapped(mouse.wx) - mid[0], snapped(mouse.wy) - mid[1]];
    const edgeVec = [p2[0] - p1[0], p2[1] - p1[1]];
    if (Math.hypot(edgeVec[0], edgeVec[1]) < 1e-9) return;
    let shift = [move[0], move[1]];

    if (!shiftHeld) {
      const normal = [edgeVec[1], -edgeVec[0]];
      const nlen = Math.hypot(normal[0], normal[1]);
      const n = [normal[0] / nlen, normal[1] / nlen];
      const dot = move[0] * n[0] + move[1] * n[1];
      shift = [n[0] * dot, n[1] * dot];
    }

    moveSharedEdge(selected, idx, shift);
    draw();
    return;
  }
}

function onMouseUp() {
  if (selected) {
    selected.selected_vertex = null;
    selected.selected_edge = null;
  }
  mouse.down = false;
  panning = false;

  // ✅ Recompute neighbors after every move
  computeNeighbors();
  draw();
}


function onMouseWheel(e) {
  const { clientX, clientY } = e;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const worldBefore = screenToWorld(x, y);
  const delta = -e.deltaY;
  const k = Math.exp(delta * 0.0012);
  view.scale = Math.min(300, Math.max(0.02, view.scale * k));
  const worldAfter = screenToWorld(x, y);
  view.x += worldBefore.x - worldAfter.x;
  view.y += worldBefore.y - worldAfter.y;
  e.preventDefault();
  draw();
}

/** === Keyboard === **/
function onKeyDown(e) {
  if (e.key === "Shift") shiftHeld = true;

  if (e.key === "g" || e.key === "G") {
    toast(`Grid snap: ${(snapEnabled = !snapEnabled) ? "ON" : "OFF"}`);
  } else if (e.key === "r" || e.key === "R") {
    if (selected) {
      pushState();
      const nn = prompt(
        `Enter new name for '${selected.room.roomName}':`,
        selected.room.roomName
      );
      if (nn) {
        selected.room.roomName = nn;
        draw();
      }
    }
  } else if (e.key === "c" || e.key === "C") {
    if (!selected) {
      toast("⚠️ Select a room first");
      return;
    }
    addVertexMode = true;
    canvas.style.cursor = "crosshair";
    toast("✂️ Add Vertex Mode: click on an edge to insert");
  } else if (e.key === "Escape") {
    if (addVertexMode) {
      addVertexMode = false;
      canvas.style.cursor = "default";
      toast("❌ Add Vertex Mode canceled");
    }
  }
}

function onKeyUp(e) {
  if (e.key === "Shift") shiftHeld = false;
}

/** === Alignment & Shared Edge === **/
function alignPoint([x, y], current) {
  if (!alignEnabled) return [x, y];

  const candidates = current.neighbors ? [...current.neighbors] : [];
  for (const n of [...candidates]) {
    if (n.neighbors) {
      for (const nn of n.neighbors) candidates.push(nn);
    }
  }

  const SNAP_TOL = 0.4; // 🔼 increase if needed

  for (const poly of new Set(candidates)) {
    if (poly === current) continue;
    for (const [vx, vy] of poly.coords) {
      if (Math.abs(vx - x) < SNAP_TOL) x = vx;
      if (Math.abs(vy - y) < SNAP_TOL) y = vy;
    }
  }
  return [x, y];
}



function findSharedEdges() {
  const sharedEdges = new Map();
  for (const poly of polygons) {
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      const edgeKey = [p1[0], p1[1], p2[0], p2[1]].map(v => Math.round(v * 1000) / 1000).join(',');
      const reverseKey = [p2[0], p2[1], p1[0], p1[1]].map(v => Math.round(v * 1000) / 1000).join(',');
      if (!sharedEdges.has(edgeKey) && !sharedEdges.has(reverseKey)) {
        sharedEdges.set(edgeKey, [poly]);
      } else {
        const existingKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
        const polys = sharedEdges.get(existingKey);
        if (!polys.includes(poly)) polys.push(poly);
      }
    }
  }
  return sharedEdges;
}

function moveSharedEdge(movingPoly, edgeIdx, shift) {
  const sharedEdges = findSharedEdges();
  const movingCoords = movingPoly.coords;
  const p1 = movingCoords[edgeIdx];
  const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

  // normalize helper
  const round = (v) => Math.round(v * 1000) / 1000;
  const keyA = `${round(p1[0])},${round(p1[1])},${round(p2[0])},${round(p2[1])}`;
  const keyB = `${round(p2[0])},${round(p2[1])},${round(p1[0])},${round(p1[1])}`;
  const sharedKey = sharedEdges.has(keyA) ? keyA : keyB;
  const sharedPolys = sharedEdges.get(sharedKey);

  // if toggle OFF or not found
  if (!moveSharedEdgesEnabled || !sharedPolys || sharedPolys.length === 1) {
    const coords = movingPoly.coords;
    coords[edgeIdx] = [coords[edgeIdx][0] + shift[0], coords[edgeIdx][1] + shift[1]];
    coords[(edgeIdx + 1) % coords.length] = [
      coords[(edgeIdx + 1) % coords.length][0] + shift[0],
      coords[(edgeIdx + 1) % coords.length][1] + shift[1],
    ];
    return;
  }

  // apply to all polygons sharing the same edge (tolerant check)
  const EPS = 0.05;
  for (const poly of sharedPolys) {
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i];
      const b = coords[(i + 1) % coords.length];
      const isSameEdge =
        (Math.abs(a[0] - p1[0]) < EPS && Math.abs(a[1] - p1[1]) < EPS &&
         Math.abs(b[0] - p2[0]) < EPS && Math.abs(b[1] - p2[1]) < EPS) ||
        (Math.abs(a[0] - p2[0]) < EPS && Math.abs(a[1] - p2[1]) < EPS &&
         Math.abs(b[0] - p1[0]) < EPS && Math.abs(b[1] - p1[1]) < EPS);

      if (isSameEdge) {
        coords[i] = [a[0] + shift[0], a[1] + shift[1]];
        coords[(i + 1) % coords.length] = [b[0] + shift[0], b[1] + shift[1]];
      }
    }
  }
}

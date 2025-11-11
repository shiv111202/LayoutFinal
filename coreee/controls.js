// ------------------------------
// controls.js — UI, keyboard, mouse, and canvas interactions (final fixed)
// ------------------------------

import * as State from "./state.js"; // ✅ import everything as State

import { toast } from "./utils.js";
import { draw, fitView } from "./render.js";
import { moveSharedEdge } from "./edgeOps.js";
import { pointInPoly, distPtSeg } from "./geometry.js";
import { saveJSON, loadJSONFile } from "./io.js";

const { canvas, mouse, view, polygons, highlightEdge, flags, worldToScreen, screenToWorld } = State;

// --- Undo helpers ---
function pushState() {
  const snap = polygons.map((p) => ({
    room: p.room.roomName,
    coords: p.coords.map(([x, y]) => [x, y]),
  }));
  flags.undoStack = flags.undoStack || [];
  flags.undoStack.push(snap);
  if (flags.undoStack.length > 30) flags.undoStack.shift();
}

function undo() {
  if (!flags.undoStack?.length) return;
  const last = flags.undoStack.pop();
  polygons.forEach((poly, i) => {
    poly.coords = last[i].coords.map(([x, y]) => [x, y]);
    poly.room.roomName = last[i].room;
  });
  draw(flags.snapStep);
}

// --- Vertex / edge helpers ---
function nearestVertex(poly, p, tol = 0.4) {
  let best = -1,
    bestd = Infinity;
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
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const avg = lens.reduce((s, v) => s + v, 0) / Math.max(1, lens.length);
  const baseTol = 0.5 * Math.max(1.0, avg / 10.0);
  let best = -1,
    bestd = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = distPtSeg(p, cs[i], cs[(i + 1) % cs.length]);
    if (d < bestd) {
      bestd = d;
      best = i;
    }
  }
  return bestd < baseTol ? best : null;
}

// ------------------------------
// DOM + keyboard
// ------------------------------

document.getElementById("loadFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  await loadJSONFile(f);
  fitView();
  draw(flags.snapStep);
});

document.getElementById("saveBtn").addEventListener("click", saveJSON);
document.getElementById("resetViewBtn").addEventListener("click", () => {
  fitView();
  draw(flags.snapStep);
});

document.getElementById("addVertexBtn").addEventListener("click", () => {
  if (!State.selected) {
    toast("⚠️ Select a room first");
    return;
  }
  flags.addVertexMode = true;
  canvas.style.cursor = "crosshair";
  toast("✂️ Add Vertex Mode: click on an edge to insert");
});

document.getElementById("showNamesToggle").addEventListener("change", (e) => {
  flags.showRoomNames = e.target.checked;
  draw(flags.snapStep);
});

document.getElementById("showLengthsToggle").addEventListener("change", (e) => {
  flags.showRoomLengths = e.target.checked;
  draw(flags.snapStep);
});

document.getElementById("sharedEdgeToggle").addEventListener("change", (e) => {
  flags.moveSharedEdgesEnabled = e.target.checked;
  toast(`Shared Edge Movement: ${flags.moveSharedEdgesEnabled ? "ON" : "OFF"}`);
});

document.getElementById("gridToggle").addEventListener("change", (e) => {
  flags.alignEnabled = e.target.checked;
  draw(flags.snapStep);
});

document.getElementById("snapStep").addEventListener("input", (e) => {
  const v = Number(e.target.value) || 1;
  flags.snapStep = v;
  draw(v);
});

document.getElementById("unitSelect").addEventListener("change", (e) => {
  toast(`Unit: ${e.target.value}`);
  draw(flags.snapStep);
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") flags.shiftHeld = true;
  else if (e.key === "g" || e.key === "G") {
    flags.snapEnabled = !flags.snapEnabled;
    toast(`Grid snap: ${flags.snapEnabled ? "ON" : "OFF"}`);
  } else if (e.key === "r" || e.key === "R") {
    if (State.selected) {
      pushState();
      const nn = prompt(
        `Enter new name for '${State.selected.room.roomName}':`,
        State.selected.room.roomName
      );
      if (nn) {
        State.selected.room.roomName = nn;
        draw(flags.snapStep);
      }
    }
  } else if (e.key.toLowerCase() === "s") saveJSON();
  else if (e.ctrlKey && e.key.toLowerCase() === "z") undo();
  else if (e.key.toLowerCase() === "c") {
    if (!State.selected) {
      toast("⚠️ Select a room first");
      return;
    }
    flags.addVertexMode = true;
    canvas.style.cursor = "crosshair";
    toast("✂️ Add Vertex Mode: click on an edge to insert");
  } else if (e.key === "Escape" && flags.addVertexMode) {
    flags.addVertexMode = false;
    canvas.style.cursor = "default";
    toast("❌ Add Vertex Mode canceled");
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") flags.shiftHeld = false;
});

// ------------------------------
// Zoom
// ------------------------------
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener(
  "wheel",
  (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const worldBefore = screenToWorld(x, y);
    const k = Math.exp(-e.deltaY * 0.0012);
    view.scale = Math.min(300, Math.max(0.02, view.scale * k));
    const worldAfter = screenToWorld(x, y);
    view.x += worldBefore.x - worldAfter.x;
    view.y += worldBefore.y - worldAfter.y;

    e.preventDefault();
    draw(flags.snapStep);
  },
  { passive: false }
);

// ------------------------------
// Mouse logic (selection, drag, pan)
// ------------------------------

function updateMousePosition(e) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x;
  mouse.wy = w.y;
}

function findPolygonAt(x, y) {
  for (let i = polygons.length - 1; i >= 0; i--) {
    const poly = polygons[i];
    if (pointInPoly({ x, y }, poly)) return poly;
  }
  return null;
}

canvas.addEventListener("mousedown", (e) => {
  updateMousePosition(e);
  mouse.down = true;
  mouse.button = e.button;
  mouse.start = { ...mouse };

  if (e.button === 2) {
    flags.panning = true;
    canvas.style.cursor = "grabbing";
    return;
  }

  if (flags.addVertexMode && State.selected && e.button === 0) {
    const edgeIdx = nearestEdge(State.selected, [mouse.wx, mouse.wy]);
    if (edgeIdx == null) return toast("⚠️ Click closer to an edge");

    const cs = State.selected.coords;
    cs.splice(edgeIdx + 1, 0, [mouse.wx, mouse.wy]);
    flags.addVertexMode = false;
    canvas.style.cursor = "default";
    toast("✅ Vertex added");
    draw(flags.snapStep);
    return;
  }

  const poly = findPolygonAt(mouse.wx, mouse.wy);
  if (poly && e.button === 0) {
    State.selected = poly; // ✅ now safe
    State.selected.selected_vertex = nearestVertex(poly, [mouse.wx, mouse.wy]);
    State.selected.selected_edge =
      State.selected.selected_vertex == null
        ? nearestEdge(poly, [mouse.wx, mouse.wy])
        : null;
    pushState();
  } else if (!poly && e.button === 0) {
    State.selected = null;
  }

  draw(flags.snapStep);
});

canvas.addEventListener("mousemove", (e) => {
  updateMousePosition(e);

  if (flags.panning && mouse.down && mouse.button === 2) {
    const dx = (mouse.start.x - mouse.x) / view.scale;
    const dy = (mouse.start.y - mouse.y) / view.scale;
    view.x += dx;
    view.y += dy;
    mouse.start.x = mouse.x;
    mouse.start.y = mouse.y;
    draw(flags.snapStep);
    return;
  }

  if (!mouse.down || !State.selected) {
    const poly = findPolygonAt(mouse.wx, mouse.wy);
    if (poly) {
      const edgeIdx = nearestEdge(poly, [mouse.wx, mouse.wy]);
      highlightEdge.poly = edgeIdx != null ? poly : null;
      highlightEdge.idx = edgeIdx;
    } else {
      highlightEdge.poly = null;
      highlightEdge.idx = null;
    }
    draw(flags.snapStep);
    return;
  }

  if (mouse.down && e.button === 0 && State.selected) {
    const dx = mouse.wx - mouse.start.wx;
    const dy = mouse.wy - mouse.start.wy;
    mouse.start.wx = mouse.wx;
    mouse.start.wy = mouse.wy;

    if (State.selected.selected_vertex != null) {
      const i = State.selected.selected_vertex;
      const c = State.selected.coords[i];
      State.selected.coords[i] = [c[0] + dx, c[1] + dy];
    } else if (State.selected.selected_edge != null) {
      moveSharedEdge(State.selected, State.selected.selected_edge, [dx, dy]);
    } else {
      for (let i = 0; i < State.selected.coords.length; i++) {
        State.selected.coords[i][0] += dx;
        State.selected.coords[i][1] += dy;
      }
    }
    draw(flags.snapStep);
  }
});

canvas.addEventListener("mouseup", () => {
  mouse.down = false;
  if (flags.panning) {
    flags.panning = false;
    canvas.style.cursor = "default";
  }
  if (State.selected) {
    State.selected.selected_vertex = null;
    State.selected.selected_edge = null;
  }
  draw(flags.snapStep);
});

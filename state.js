// state.js — single shared state object, viewport helpers, undo, neighbors, immovable

export const canvas = document.getElementById("c");
export const ctx = canvas.getContext("2d");

// All mutable state lives on this one object.
// Every other module imports `state` and reads/writes its properties directly.
export const state = {
  DPR: window.devicePixelRatio || 1,

  data: {},
  polygons: [],
  selected: null,
  highlightEdge: { poly: null, idx: null },

  mouse: {
    x: 0, y: 0,
    wx: 0, wy: 0,
    down: false, button: 0, drag: false,
    start: { x: 0, y: 0, wx: 0, wy: 0 },
  },

  panning: false,
  shiftHeld: false,
  snapEnabled: false,
  alignEnabled: true,
  snapStep: 16,
  undoStack: [],
  redoStack: [],
  addVertexMode: false,
  swapMode: false,
  swapSource: null,
  showRoomNames: false,
  showDoorLocation: false,
  showRoomLengths: false,
  moveSharedEdgesEnabled: false,
  gridLines: [],
  wardPolys: [],
  clinicPolys: [],
  roomConstraints: {},
  grid: { show: true },
  currentUnit: "m",
  currentLanguage: "eng", // 'jpn' | 'eng'
  currentFloor: "all",
  immovableList: [],

  // ── Dimension tool ─────────────────────────────────────
  dimensionMode: false,
  dimPoint1: null,
  dimPreview: null,
  dimensions: [], // { p1, p2, floor }
  dimHover: null, // preview before first click

  // Viewport
  view: { x: 0, y: 0, scale: 1.0 },
};

// ── Constants (never mutated) ─────────────────────────────────────────────────
export const TAU = Math.PI * 2;
export const SNAP_TOL = 0.3;
export const unitFactors = { m: 1, cm: 100, mm: 1000, ft: 3.28084 };
export const skipKeys = [
  "nursingZones",
  "patientZones",
  "evZone",
  "internalRoadPolygons",
  "externalRoadPolygons",
  "footpathPolygons",
  "zones",
];

// ── Viewport helpers ──────────────────────────────────────────────────────────
export function worldToScreen(wx, wy) {
  const { view } = state;
  return { x: (wx - view.x) * view.scale, y: (view.y - wy) * view.scale };
}

export function screenToWorld(sx, sy) {
  const { view } = state;
  return { x: sx / view.scale + view.x, y: view.y - sy / view.scale };
}

// ── Undo ──────────────────────────────────────────────────────────────────────
export function pushState() {
  const snap = state.polygons.map((p) => ({
    room: p.room.roomName,
    coords: p.coords.map((q) => [q[0], q[1]]),
  }));
  state.undoStack.push(snap);
  if (state.undoStack.length > 30) state.undoStack.shift();
  // Any new action clears the redo history
  state.redoStack = [];
}

export function undo(drawFn) {
  if (!state.undoStack.length) return;
  // Save current state to redoStack before reverting
  const current = state.polygons.map((p) => ({
    room: p.room.roomName,
    coords: p.coords.map((q) => [q[0], q[1]]),
  }));
  state.redoStack.push(current);
  if (state.redoStack.length > 30) state.redoStack.shift();

  const last = state.undoStack.pop();
  state.polygons.forEach((poly, i) => {
    poly.coords = last[i].coords.map((q) => [q[0], q[1]]);
    poly.room.roomName = last[i].room;
  });
  drawFn();
}

export function redo(drawFn) {
  if (!state.redoStack.length) return;
  // Save current state to undoStack before re-applying
  const current = state.polygons.map((p) => ({
    room: p.room.roomName,
    coords: p.coords.map((q) => [q[0], q[1]]),
  }));
  state.undoStack.push(current);
  if (state.undoStack.length > 30) state.undoStack.shift();

  const next = state.redoStack.pop();
  state.polygons.forEach((poly, i) => {
    poly.coords = next[i].coords.map((q) => [q[0], q[1]]);
    poly.room.roomName = next[i].room;
  });
  drawFn();
}

// ── Neighbor computation ──────────────────────────────────────────────────────
export function computeNeighbors() {
  for (const poly of state.polygons) poly.neighbors = new Set();

  const EPS = 0.1;

  for (let i = 0; i < state.polygons.length; i++) {
    const a = state.polygons[i];
    if (a.isColumn) continue;

    for (let j = i + 1; j < state.polygons.length; j++) {
      const b = state.polygons[j];
      if (b.isColumn) continue;

      let shared = false;
      for (const [ax, ay] of a.coords) {
        for (const [bx, by] of b.coords) {
          if (Math.abs(ax - bx) < EPS && Math.abs(ay - by) < EPS) {
            shared = true;
            break;
          }
        }
        if (shared) break;
      }

      if (shared) {
        a.neighbors.add(b);
        b.neighbors.add(a);
      }
    }
  }
  console.log("✅ Neighbor relationships computed");
}

// ── Immovable rules ───────────────────────────────────────────────────────────
export function applyImmovableRules(rooms) {
  state.immovableList = ["stairs", "shower", "hcwc"];

  for (const room of rooms) {
    const roomNameLower = (room.roomName || "").toLowerCase();
    const groupLower = (room.roomGroup || "").toLowerCase();

    if (state.immovableList.includes(roomNameLower)) room._isFixed = true;
    if (state.immovableList.includes(groupLower)) room._isFixed = true;
  }

  return rooms;
}

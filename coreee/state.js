// ------------------------------
// state.js — Shared global state
// ------------------------------

export const TAU = Math.PI * 2;

// --- Canvas & Context ---
export const canvas = document.getElementById("c");
export const ctx = canvas.getContext("2d");

// --- Device Pixel Ratio ---
export let DPR = window.devicePixelRatio || 1;

// --- Resize handling ---
export function resizeCanvas(drawFn) {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width * DPR));
  canvas.height = Math.max(1, Math.floor(r.height * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (drawFn) drawFn();
}

// --- Global App Data ---
export let data = { wardInfo: { coreRoomLayout: [] } };
export let polygons = [];
export let selected = null;
export let highlightEdge = { poly: null, idx: null };

// --- Grid & Layout Info ---
export let gridLines = [];
export const grid = { show: true };
export let layoutBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// --- Viewport (pan/zoom) ---
export const view = { x: 0, y: 0, scale: 1.0 };

// --- Mouse State ---
export const mouse = {
  x: 0,
  y: 0,
  wx: 0,
  wy: 0,
  down: false,
  button: 0,
  drag: false,
  start: { x: 0, y: 0, wx: 0, wy: 0 },
};

// --- Interaction Flags ---
// ------------------------------
// state.js — shared flags (fixed)
// ------------------------------

export const flags = {
  panning: false,
  shiftHeld: false,
  snapEnabled: false,
  alignEnabled: true,
  snapStep: 4,
  addVertexMode: false,
  showRoomNames: false,
  showRoomLengths: false,
  moveSharedEdgesEnabled: false,
};


// --- Constants ---
export const SNAP_TOL = 0.3;

// --- Unit System ---
export let currentUnit = "m";
export const unitFactors = { m: 1, cm: 100, mm: 1000, ft: 3.28084 };

// --- Utility Coordinate Transforms ---
export function worldToScreen(wx, wy) {
  return { x: (wx - view.x) * view.scale, y: (wy - view.y) * view.scale };
}

export function screenToWorld(sx, sy) {
  return { x: sx / view.scale + view.x, y: sy / view.scale + view.y };
}

// core/state.js
let renderFns = {};
export function linkRender(fns) {
  renderFns = fns;
}
const draw = (...a) => renderFns.draw?.(...a);
const fitView = (...a) => renderFns.fitView?.(...a);

import { hslToRgb } from "./utils.js";

/** === GLOBAL STATE === **/
export let data = { wardInfo: { coreRoomLayout: [] } };
export let polygons = [];
export let selected = null;
export let highlightEdge = { poly: null, idx: null };
export let undoStack = [];

export let DPR = window.devicePixelRatio || 1;
export let view = { x: 0, y: 0, scale: 1.0 };

// UI toggles
export let grid = { show: true, step: 0.5 };
export let showRoomNames = false;
export let showRoomLengths = false;
export let moveSharedEdgesEnabled = false;
export let alignEnabled = true;
export let snapEnabled = false;
export let snapStep = 0.01;

// Units
export let currentUnit = "m";
export const unitFactors = { m: 1, cm: 100, mm: 1000, ft: 3.28084 };

/** === STATE MANAGEMENT === **/
export function setSelected(poly) {
  selected = poly;
}

export function pushState() {
  const snap = polygons.map((p) => ({
    room: p.room.roomName,
    coords: p.coords.map((q) => [q[0], q[1]]),
  }));
  undoStack.push(snap);
  if (undoStack.length > 30) undoStack.shift();
}

export function undo() {
  if (!undoStack.length) return;
  const last = undoStack.pop();
  polygons.forEach((poly, i) => {
    poly.coords = last[i].coords.map((q) => [q[0], q[1]]);
    poly.room.roomName = last[i].room;
  });
  draw();
}

/** === TOAST SYSTEM === **/
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = 1;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.opacity = 0.7), 1200);
}

/** === COLOR UTIL === **/
export function randomColor() {
  const h = Math.random();
  const s = 0.6,
    l = 0.55;
  const rgb = hslToRgb(h, s, l);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** === DATA HANDLING === **/
export async function loadJSON(text) {
  try {
    data = JSON.parse(text);

    // Collect all room arrays inside wardInfo
    const layouts = Object.values(data.wardInfo || {})
      .flat()
      .filter((room) => room && room.vertices && room.vertices.length);

    // Keep consistent color per room name
    const colorMap = {};
    function getColorForRoom(name) {
      const key = name?.trim() || "Unnamed";
      if (!colorMap[key]) colorMap[key] = randomColor();
      return colorMap[key];
    }

    // Convert to polygons
    polygons = layouts.map((room) => {
      const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
      return {
        room,
        coords,
        color: getColorForRoom(room.roomName),
        selected_vertex: null,
        selected_edge: null,
      };
    });

    computeNeighbors();
    fitView();
    draw();
    toast(`✅ Loaded ${polygons.length} rooms`);
  } catch (err) {
    console.error("Error loading JSON:", err);
    toast("❌ Invalid or malformed JSON");
  }
}

export function saveJSON() {
  polygons.forEach((p) => {
    p.room.vertices = p.coords.map(([x, y]) => ({
      X: Number(x),
      Y: Number(y),
      Z: 0,
    }));
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "edited.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("💾 Saved as edited.json");
}

/** === NEIGHBOR DETECTION === **/
export function computeNeighbors() {
  for (const poly of polygons) poly.neighbors = new Set();

  const EPS = 0.3; // 🔼 tolerance for matching vertex proximity

  for (let i = 0; i < polygons.length; i++) {
    const a = polygons[i];
    for (let j = i + 1; j < polygons.length; j++) {
      const b = polygons[j];

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

  console.log("✅ Neighbor relationships computed with tolerance:", EPS);
}

/** === UI HOOKS === **/
export function setupToggles() {
  document.getElementById("showNamesToggle").addEventListener("change", (e) => {
    showRoomNames = e.target.checked;
    draw();
  });

  document
    .getElementById("showLengthsToggle")
    .addEventListener("change", (e) => {
      showRoomLengths = e.target.checked;
      draw();
    });

  document
    .getElementById("sharedEdgeToggle")
    .addEventListener("change", (e) => {
      moveSharedEdgesEnabled = e.target.checked;
      toast(`Shared Edge Movement: ${moveSharedEdgesEnabled ? "ON" : "OFF"}`);
    });

  document.getElementById("gridToggle").addEventListener("change", (e) => {
    grid.show = e.target.checked;
    draw();
  });

  document.getElementById("alignToggle").addEventListener("change", (e) => {
    alignEnabled = e.target.checked;
  });

  document.getElementById("snapStep").addEventListener("input", (e) => {
    const v = Number(e.target.value) || 1;
    snapStep = v;
    draw();
  });

  document.getElementById("unitSelect").addEventListener("change", (e) => {
    currentUnit = e.target.value;
    toast(`Unit: ${currentUnit}`);
    draw();
  });
}

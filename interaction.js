// interaction.js — mouse, keyboard, wheel events + edge/vertex picking + shared-edge movement

import { toast, pointInPoly, distPtSeg } from "./utils.js";
import {
  canvas, state, SNAP_TOL,
  worldToScreen, screenToWorld,
  pushState, undo, redo,
} from "./state.js";
import { draw } from "./renderer.js";
import { saveJSON } from "./loader.js";

// ── Picking helpers ───────────────────────────────────────────────────────────
function nearestVertex(poly, p, tol = 0.4) {
  let best = -1, bestd = Infinity;
  for (let i = 0; i < poly.coords.length; i++) {
    const d = Math.hypot(p[0] - poly.coords[i][0], p[1] - poly.coords[i][1]);
    if (d < bestd) { bestd = d; best = i; }
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
  const avg     = lens.reduce((s, v) => s + v, 0) / Math.max(1, lens.length);
  const baseTol = 0.5 * Math.max(1.0, avg / 10.0);
  let best = -1, bestd = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const d = distPtSeg(p, cs[i], cs[(i + 1) % cs.length]);
    if (d < bestd) { bestd = d; best = i; }
  }
  return bestd < baseTol ? best : null;
}

// ── Shared-edge helpers ───────────────────────────────────────────────────────
function findSharedEdges() {
  const sharedEdges = new Map();

  for (const poly of state.polygons) {
    if (poly.isColumn) continue;
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      const round = (v) => Math.round(v * 1000) / 1000;
      const edgeKey    = [p1[0], p1[1], p2[0], p2[1]].map(round).join(",");
      const reverseKey = [p2[0], p2[1], p1[0], p1[1]].map(round).join(",");

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
  const sharedEdges  = findSharedEdges();
  const movingCoords = movingPoly.coords;
  const p1 = movingCoords[edgeIdx];
  const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

  const round = (v) => Math.round(v * 1000) / 1000;
  const edgeKey    = [p1[0], p1[1], p2[0], p2[1]].map(round).join(",");
  const reverseKey = [p2[0], p2[1], p1[0], p1[1]].map(round).join(",");
  const sharedKey  = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
  const sharedPolys = sharedEdges.get(sharedKey);

  // Step 1: Compute new positions
  let newA = [p1[0] + shift[0], p1[1] + shift[1]];
  let newB = [p2[0] + shift[0], p2[1] + shift[1]];

  // Step 2: Alignment snapping (parallel edge)
  if (state.alignEnabled) {
    const dir = [newB[0] - newA[0], newB[1] - newA[1]];
    const len = Math.hypot(dir[0], dir[1]);
    if (len > 1e-6) {
      const ux = dir[0] / len, uy = dir[1] / len;
      const nx = -uy,          ny = ux;
      const SNAP_DIST  = 0.1;
      const ANGLE_TOL  = 0.05;

      const movingPolys =
        state.moveSharedEdgesEnabled && sharedPolys && sharedPolys.length > 1
          ? sharedPolys
          : [movingPoly];

      for (const poly of state.polygons) {
        if (movingPolys.includes(poly) || poly.isColumn) continue;
        const cs = poly.coords;
        for (let i = 0; i < cs.length; i++) {
          const a = cs[i], b = cs[(i + 1) % cs.length];
          const ab    = [b[0] - a[0], b[1] - a[1]];
          const abLen = Math.hypot(ab[0], ab[1]);
          if (abLen < 1e-6) continue;
          const vx = ab[0] / abLen, vy = ab[1] / abLen;
          const dot = ux * vx + uy * vy;
          if (Math.abs(Math.abs(dot) - 1) > ANGLE_TOL) continue;
          const distA   = (newA[0] - a[0]) * nx + (newA[1] - a[1]) * ny;
          const distB   = (newB[0] - a[0]) * nx + (newB[1] - a[1]) * ny;
          const avgDist = (distA + distB) / 2;
          if (Math.abs(avgDist) < SNAP_DIST) {
            newA = [newA[0] - avgDist * nx, newA[1] - avgDist * ny];
            newB = [newB[0] - avgDist * nx, newB[1] - avgDist * ny];
            break;
          }
        }
      }
    }
  }

  // Step 3: Constraint checks for all affected polygons
  const polysToCheck =
    state.moveSharedEdgesEnabled && sharedPolys && sharedPolys.length > 1
      ? sharedPolys
      : [movingPoly];

  const isHorizontal = Math.abs(p1[1] - p2[1]) < 0.05;
  const isVertical   = Math.abs(p1[0] - p2[0]) < 0.05;

  for (const polyToCheck of polysToCheck) {
    const testCoords = polyToCheck.coords.map(([x, y]) => [x, y]);

    let foundEdgeIndex = -1;
    let isReversed = false;

    for (let i = 0; i < testCoords.length; i++) {
      const a = testCoords[i];
      const b = testCoords[(i + 1) % testCoords.length];

      const isForwardEdge =
        Math.abs(a[0] - p1[0]) < 0.01 && Math.abs(a[1] - p1[1]) < 0.01 &&
        Math.abs(b[0] - p2[0]) < 0.01 && Math.abs(b[1] - p2[1]) < 0.01;

      const isReverseEdge =
        Math.abs(a[0] - p2[0]) < 0.01 && Math.abs(a[1] - p2[1]) < 0.01 &&
        Math.abs(b[0] - p1[0]) < 0.01 && Math.abs(b[1] - p1[1]) < 0.01;

      if (isForwardEdge || isReverseEdge) {
        foundEdgeIndex = i;
        isReversed     = isReverseEdge;
        if (isReversed) {
          testCoords[i] = newB;
          testCoords[(i + 1) % testCoords.length] = newA;
        } else {
          testCoords[i] = newA;
          testCoords[(i + 1) % testCoords.length] = newB;
        }
        break;
      }
    }

    const xs = testCoords.map(([x]) => x);
    const ys = testCoords.map(([, y]) => y);
    const newWidth  = Math.max(...xs) - Math.min(...xs);
    const newHeight = Math.max(...ys) - Math.min(...ys);

    const name       = (polyToCheck.room.roomName || "").trim().toLowerCase();
    const constraint = state.roomConstraints[name];

    if (constraint && foundEdgeIndex !== -1) {
      const currCoords = polyToCheck.coords;
      const currXs = currCoords.map(([x]) => x);
      const currYs = currCoords.map(([, y]) => y);
      const currW  = Math.max(...currXs) - Math.min(...currXs);
      const currH  = Math.max(...currYs) - Math.min(...currYs);

      // Horizontal edge — height restriction
      if (isHorizontal && constraint.min_height > 0 && newHeight < constraint.min_height) {
        const delta   = constraint.min_height - currH;
        const centerY = (Math.min(...currYs) + Math.max(...currYs)) / 2;
        const edgeY   = p1[1];
        if (edgeY > centerY) {
          newA = [p1[0], p1[1] + delta];
          newB = [p2[0], p2[1] + delta];
        } else {
          newA = [p1[0], p1[1] - delta];
          newB = [p2[0], p2[1] - delta];
        }
        toast(`↕️ '${polyToCheck.room.roomName}' snapped to min height (${constraint.min_height}m)`);
        if (isReversed) {
          testCoords[foundEdgeIndex] = newB;
          testCoords[(foundEdgeIndex + 1) % testCoords.length] = newA;
        } else {
          testCoords[foundEdgeIndex] = newA;
          testCoords[(foundEdgeIndex + 1) % testCoords.length] = newB;
        }
      }

      // Vertical edge — width restriction
      if (isVertical && constraint.min_width > 0 && newWidth < constraint.min_width) {
        const delta   = constraint.min_width - currW;
        const centerX = (Math.min(...currXs) + Math.max(...currXs)) / 2;
        const edgeX   = p1[0];
        if (edgeX > centerX) {
          newA = [p1[0] + delta, p1[1]];
          newB = [p2[0] + delta, p2[1]];
        } else {
          newA = [p1[0] - delta, p1[1]];
          newB = [p2[0] - delta, p2[1]];
        }
        toast(`↔️ '${polyToCheck.room.roomName}' snapped to min width (${constraint.min_width}m)`);
        if (isReversed) {
          testCoords[foundEdgeIndex] = newB;
          testCoords[(foundEdgeIndex + 1) % testCoords.length] = newA;
        } else {
          testCoords[foundEdgeIndex] = newA;
          testCoords[(foundEdgeIndex + 1) % testCoords.length] = newB;
        }
      }
    }

    // Ward boundary check
    if (state.wardPolys && state.wardPolys.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const w of state.wardPolys) {
        for (const [x, y] of w.coords) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      for (const [x, y] of testCoords) {
        if (x < minX - 0.001 || x > maxX + 0.001 || y < minY - 0.001 || y > maxY + 0.001) {
          toast(`🚫 '${polyToCheck.room.roomName}' cannot go outside ward boundary`);
          return;
        }
      }
    }
  }

  // Step 4: Apply shift if all checks passed
  if (!state.moveSharedEdgesEnabled || !sharedPolys || sharedPolys.length === 1) {
    movingCoords[edgeIdx] = newA;
    movingCoords[(edgeIdx + 1) % movingCoords.length] = newB;
    return;
  }

  for (const poly of sharedPolys) {
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i], b = coords[(i + 1) % coords.length];
      const isForwardEdge =
        Math.abs(a[0] - p1[0]) < 0.01 && Math.abs(a[1] - p1[1]) < 0.01 &&
        Math.abs(b[0] - p2[0]) < 0.01 && Math.abs(b[1] - p2[1]) < 0.01;
      const isReverseEdge =
        Math.abs(a[0] - p2[0]) < 0.01 && Math.abs(a[1] - p2[1]) < 0.01 &&
        Math.abs(b[0] - p1[0]) < 0.01 && Math.abs(b[1] - p1[1]) < 0.01;

      if (isForwardEdge || isReverseEdge) {
        if (isReverseEdge) {
          coords[i] = newB;
          coords[(i + 1) % coords.length] = newA;
        } else {
          coords[i] = newA;
          coords[(i + 1) % coords.length] = newB;
        }
        break;
      }
    }
  }
}

// ── Vertex alignment helper ───────────────────────────────────────────────────
function alignPoint([x, y], current) {
  const SNAP_TOL_ = 0.3;
  const EDGE_TOL  = 0.25;
  const candidates = current.neighbors ? [...current.neighbors] : [];

  for (const n of [...candidates]) {
    if (n.neighbors) for (const nn of n.neighbors) candidates.push(nn);
  }

  for (const poly of new Set(candidates)) {
    if (poly === current || poly.isColumn) continue;

    for (const [vx, vy] of poly.coords) {
      if (Math.abs(vx - x) < SNAP_TOL_) x = vx;
      if (Math.abs(vy - y) < SNAP_TOL_) y = vy;
    }

    const cs = poly.coords;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ab  = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(ab[0], ab[1]);
      if (len < 1e-6) continue;
      const nx = ab[1] / len, ny = -ab[0] / len;
      const dist = (x - a[0]) * nx + (y - a[1]) * ny;
      if (Math.abs(dist) < EDGE_TOL) { x -= dist * nx; y -= dist * ny; }
    }
  }

  return [x, y];
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") {
    state.shiftHeld = true;
  } else if (e.key === "g" || e.key === "G") {
    state.snapEnabled = !state.snapEnabled;
    toast(`Grid snap: ${state.snapEnabled ? "ON" : "OFF"}`);
  } else if (e.key === "r" || e.key === "R") {
    if (state.selected) {
      pushState();
      const nn = prompt(
        `Enter new name for '${state.selected.room.roomName}':`,
        state.selected.room.roomName
      );
      if (nn) { state.selected.room.roomName = nn; draw(); }
    }
  } else if (e.key === "s" || e.key === "S") {
    saveJSON();
  } else if (
    e.key === "u" || e.key === "U" ||
    (e.ctrlKey && e.key.toLowerCase() === "z")
  ) {
    undo(draw);
  } else if (
    (e.ctrlKey && e.key.toLowerCase() === "y") ||
    (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")
  ) {
    redo(draw);
  } else if (e.key === "c" || e.key === "C") {
    if (!state.selected) { toast("⚠️ Select a room first"); return; }
    state.addVertexMode = true;
    canvas.style.cursor = "crosshair";
    toast("✂️ Add Vertex Mode: click on an edge to insert");
  } else if (e.key === "Escape") {
    if (state.addVertexMode) {
      state.addVertexMode = false;
      canvas.style.cursor = "crosshair";
      toast("❌ Add Vertex Mode canceled");
    }
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") state.shiftHeld = false;
});

// ── Mouse events ──────────────────────────────────────────────────────────────
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - rect.left;
  state.mouse.y = e.clientY - rect.top;
  const w = screenToWorld(state.mouse.x, state.mouse.y);
  state.mouse.wx = w.x;
  state.mouse.wy = w.y;
  state.mouse.down   = true;
  state.mouse.button = e.button;
  state.mouse.drag   = false;
  state.mouse.start  = { x: state.mouse.x, y: state.mouse.y, wx: w.x, wy: w.y };

  if (state.selected && state.selected.isColumn) {
    toast("⚠️ Column polygons are locked");
    return;
  } else if (state.selected && state.selected.isFixed) {
    toast("⚠️ Polygons are locked");
    return;
  }

  // Add vertex mode
  if (state.addVertexMode && state.selected && e.button === 0) {
    const wx = state.mouse.wx, wy = state.mouse.wy;
    const edgeIdx = nearestEdge(state.selected, [wx, wy]);
    if (edgeIdx == null) { toast("⚠️ Click closer to an edge"); return; }

    const a  = state.selected.coords[edgeIdx];
    const b  = state.selected.coords[(edgeIdx + 1) % state.selected.coords.length];
    const ab = [b[0] - a[0], b[1] - a[1]];
    const ap = [wx - a[0], wy - a[1]];
    const len2 = ab[0] ** 2 + ab[1] ** 2;
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
    t = Math.max(0.001, Math.min(0.999, t));

    const newPt = [a[0] + ab[0] * t, a[1] + ab[1] * t];

    // Snap to nearby vertex
    const SNAP_TOL_ADD = 0.15;
    for (const poly of state.polygons) {
      for (const [vx, vy] of poly.coords) {
        if (Math.abs(vx - newPt[0]) < SNAP_TOL_ADD) newPt[0] = vx;
        if (Math.abs(vy - newPt[1]) < SNAP_TOL_ADD) newPt[1] = vy;
      }
    }

    pushState();
    state.selected.coords.splice(edgeIdx + 1, 0, newPt, [...newPt]);
    toast("✅ Two overlapping vertices added");
    state.addVertexMode = false;
    canvas.style.cursor = "crosshair";
    draw();
    return;
  }

  if (e.button === 1 || e.button === 2) {
    state.panning = true;
    return;
  }

  const edgeIdx = state.selected ? nearestEdge(state.selected, [w.x, w.y]) : null;
  if (state.selected && edgeIdx != null) {
    state.selected.selected_edge = edgeIdx;
    pushState();
    return;
  }

  const poly = state.polygons.find((p) => pointInPoly({ x: w.x, y: w.y }, p));

  if (poly) {
    if (poly.isColumn) {
      toast("⚠️ Column polygons are locked");
      state.selected = poly;
      setTimeout(() => { state.selected = null; draw(); }, 300);
      draw();
      return;
    } else if (poly.isFixed) {
      toast(`⚠️ ${poly.room.roomName} polygon is locked`);
      state.selected = poly;
      setTimeout(() => { state.selected = null; draw(); }, 300);
      draw();
      return;
    }
    state.selected = poly;
    draw();
    return;
  }

  state.selected = null;
  draw();
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = e.clientX - rect.left;
  state.mouse.y = e.clientY - rect.top;
  const w = screenToWorld(state.mouse.x, state.mouse.y);
  state.mouse.wx = w.x;
  state.mouse.wy = w.y;

  if (state.selected?.isFixed) return;

  if (state.selected) {
    state.highlightEdge.idx  = nearestEdge(state.selected, [w.x, w.y]);
    state.highlightEdge.poly = state.selected;
  } else {
    state.highlightEdge.idx  = null;
    state.highlightEdge.poly = null;
  }

  if (!state.mouse.down) { draw(); return; }

  state.mouse.drag =
    Math.abs(state.mouse.x - state.mouse.start.x) > 2 ||
    Math.abs(state.mouse.y - state.mouse.start.y) > 2;

  if (state.panning) {
    const dx = (state.mouse.x - state.mouse.start.x) / state.view.scale;
    const dy = (state.mouse.y - state.mouse.start.y) / state.view.scale;
    state.view.x -= dx;
    state.view.y -= dy;
    state.mouse.start.x = state.mouse.x;
    state.mouse.start.y = state.mouse.y;
    draw();
    return;
  }

  if (!state.selected) return;

  const snapped = (v) =>
    state.snapEnabled ? Math.round(v / state.snapStep) * state.snapStep : v;

  function align(x, y, current) {
    if (!state.alignEnabled) return [x, y];
    const candidates = current.neighbors ? [...current.neighbors] : [];
    for (const n of [...candidates]) {
      if (n.neighbors) for (const nn of n.neighbors) candidates.push(nn);
    }
    for (const poly of new Set(candidates)) {
      if (poly === current || poly.isColumn) continue;
      for (const [vx, vy] of poly.coords) {
        if (Math.abs(vx - x) < SNAP_TOL) x = vx;
        if (Math.abs(vy - y) < SNAP_TOL) y = vy;
      }
    }
    return [x, y];
  }

  if (state.selected.selected_vertex != null) {
    let x = snapped(state.mouse.wx), y = snapped(state.mouse.wy);
    [x, y] = align(x, y, state.selected);
    state.selected.coords[state.selected.selected_vertex] = [x, y];
    draw();
    return;
  }

  if (state.selected.selected_edge != null) {
    const idx    = state.selected.selected_edge;
    const coords = state.selected.coords;
    const p1 = coords[idx];
    const p2 = coords[(idx + 1) % coords.length];
    const mid  = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const move = [snapped(state.mouse.wx) - mid[0], snapped(state.mouse.wy) - mid[1]];
    const edgeVec = [p2[0] - p1[0], p2[1] - p1[1]];
    if (Math.hypot(edgeVec[0], edgeVec[1]) < 1e-9) return;

    let shift = [move[0], move[1]];
    if (!state.shiftHeld) {
      const normal = [edgeVec[1], -edgeVec[0]];
      const nlen   = Math.hypot(normal[0], normal[1]);
      const n      = [normal[0] / nlen, normal[1] / nlen];
      const dot    = move[0] * n[0] + move[1] * n[1];
      shift        = [n[0] * dot, n[1] * dot];
    }

    moveSharedEdge(state.selected, idx, shift);
    draw();
    return;
  }
});

window.addEventListener("mouseup", () => {
  if (state.selected) {
    state.selected.selected_vertex = null;
    state.selected.selected_edge   = null;
  }
  state.mouse.down = false;
  state.panning    = false;
  draw();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    const { clientX, clientY } = e;
    const rect  = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const worldBefore = screenToWorld(x, y);
    const k = Math.exp(-e.deltaY * 0.0012);
    state.view.scale = Math.min(300, Math.max(8, state.view.scale * k));
    const worldAfter = screenToWorld(x, y);
    state.view.x += worldBefore.x - worldAfter.x;
    state.view.y += worldBefore.y - worldAfter.y;
    e.preventDefault();
    draw();
  },
  { passive: false }
);
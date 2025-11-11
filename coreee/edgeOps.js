// ------------------------------
// edgeOps.js — Shared edge detection and movement (updated for flags)
// ------------------------------

import {
  polygons,
  flags // ✅ use flags object instead of individual variables
} from "./state.js";

import { alignPoint } from "./neighbor.js";

// ✅ Find all shared edges between polygons
export function findSharedEdges() {
  const sharedEdges = new Map(); // key: "x1,y1,x2,y2" → polygons sharing it

  for (const poly of polygons) {
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];

      const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
        .map((v) => Math.round(v * 1000) / 1000)
        .join(",");

      const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
        .map((v) => Math.round(v * 1000) / 1000)
        .join(",");

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

// ✅ Move an edge, optionally moving neighboring polygons that share it
export function moveSharedEdge(movingPoly, edgeIdx, shift) {
  const sharedEdges = findSharedEdges();
  const movingCoords = movingPoly.coords;
  const p1 = movingCoords[edgeIdx];
  const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

  const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
    .map((v) => Math.round(v * 1000) / 1000)
    .join(",");

  const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
    .map((v) => Math.round(v * 1000) / 1000)
    .join(",");

  const sharedKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
  const sharedPolys = sharedEdges.get(sharedKey);

  // ✅ When shared edge movement is disabled or no shared polygons → move only this one
  if (!flags.moveSharedEdgesEnabled || !sharedPolys || sharedPolys.length === 1) {
    const coords = movingPoly.coords;
    const a = coords[edgeIdx];
    const b = coords[(edgeIdx + 1) % coords.length];

    let newA = [a[0] + shift[0], a[1] + shift[1]];
    let newB = [b[0] + shift[0], b[1] + shift[1]];

    // optional alignment
    if (flags.alignEnabled) {
      newA = alignPoint(newA, movingPoly);
      newB = alignPoint(newB, movingPoly);
    }

    coords[edgeIdx] = newA;
    coords[(edgeIdx + 1) % coords.length] = newB;
    return;
  }

  // ✅ When ON, move all polygons sharing this edge
  for (const poly of sharedPolys) {
    const coords = poly.coords;
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i];
      const b = coords[(i + 1) % coords.length];

      const isSameEdge =
        (Math.abs(a[0] - p1[0]) < 0.01 &&
          Math.abs(a[1] - p1[1]) < 0.01 &&
          Math.abs(b[0] - p2[0]) < 0.01 &&
          Math.abs(b[1] - p2[1]) < 0.01) ||
        (Math.abs(a[0] - p2[0]) < 0.01 &&
          Math.abs(a[1] - p2[1]) < 0.01 &&
          Math.abs(b[0] - p1[0]) < 0.01 &&
          Math.abs(b[1] - p1[1]) < 0.01);

      if (isSameEdge) {
        coords[i] = [a[0] + shift[0], a[1] + shift[1]];
        coords[(i + 1) % coords.length] = [b[0] + shift[0], b[1] + shift[1]];
        break;
      }
    }
  }
}

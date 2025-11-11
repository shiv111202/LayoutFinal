// ------------------------------
// neighbor.js — Polygon adjacency and alignment helpers
// ------------------------------

import { polygons } from "./state.js";

// ✅ Compute polygon neighbor relationships
export function computeNeighbors() {
  for (const poly of polygons) poly.neighbors = new Set();

  const EPS = 0.1; // tolerance for shared vertices
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

  console.log("✅ Neighbor relationships computed");
}

// ✅ Align a single vertex with nearby room edges/points
export function alignPoint([x, y], current) {
  if (!current.neighbors) return [x, y];

  const candidates = [...current.neighbors];
  for (const n of [...candidates]) {
    if (n.neighbors) {
      for (const nn of n.neighbors) candidates.push(nn);
    }
  }

  for (const poly of new Set(candidates)) {
    if (poly === current || poly.isFixed) continue;
    for (const [vx, vy] of poly.coords) {
      if (Math.abs(vx - x) < 0.3) x = vx;
      if (Math.abs(vy - y) < 0.3) y = vy;
    }
  }

  return [x, y];
}

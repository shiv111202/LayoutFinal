// ------------------------------
// geometry.js — Core geometric helpers
// ------------------------------

// ✅ Compute centroid for a simple polygon (non-self-intersecting)
export function centroid(poly) {
  const pts = poly.coords;
  let a = 0, cx = 0, cy = 0;

  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }

  a = a / 2;
  if (Math.abs(a) < 1e-9) {
    // fallback: average of vertices
    let sx = 0, sy = 0;
    pts.forEach(([x, y]) => { sx += x; sy += y; });
    return { x: sx / pts.length, y: sy / pts.length };
  }

  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// ✅ Check if a point is inside polygon using ray-casting
export function pointInPoly(p, poly) {
  const x = p.x, y = p.y;
  let inside = false;
  const pts = poly.coords;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    const inter =
      (yi > y !== yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (inter) inside = !inside;
  }

  return inside;
}

// ✅ Distance between a point and a segment
export function distPtSeg(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const len2 = abx * abx + aby * aby;

  if (len2 < 1e-12) return Math.hypot(apx, apy);

  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

// ✅ Compute polygon area (absolute)
export function polygonArea(coords) {
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

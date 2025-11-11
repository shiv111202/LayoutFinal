// core/utils.js

/** === Toast helper (optional fallback) === **/
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = 1;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.opacity = 0.7), 1200);
}

/** === Centroid for simple non-self-intersecting polygons === **/
export function centroid(poly) {
  const pts = poly.coords;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i],
      [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  a = a / 2;
  if (Math.abs(a) < 1e-9) {
    // Fallback for degenerate polygons
    let sx = 0, sy = 0;
    pts.forEach((p) => {
      sx += p[0];
      sy += p[1];
    });
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** === Point-in-Polygon check (Ray casting algorithm) === **/
export function pointInPoly(p, poly) {
  const x = p.x, y = p.y;
  let inside = false;
  const pts = poly.coords;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0],
      yi = pts[i][1],
      xj = pts[j][0],
      yj = pts[j][1];
    const inter =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

/** === Distance from point to line segment === **/
export function distPtSeg(p, a, b) {
  const ax = a[0], ay = a[1];
  const bx = b[0], by = b[1];
  const abx = bx - ax, aby = by - ay;
  const apx = p[0] - ax, apy = p[1] - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx, cy = ay + t * aby;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** === Polygon Area (Shoelace formula) === **/
export function polygonArea(coords) {
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % coords.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

/** === Color utilities === **/
export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** === Random Color (based on HSL) === **/
export function randomColor() {
  const h = Math.random();
  const s = 0.6, l = 0.55;
  const rgb = hslToRgb(h, s, l);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

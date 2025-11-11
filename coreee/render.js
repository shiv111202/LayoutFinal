// ------------------------------
// render.js — Canvas rendering (updated for flags)
// ------------------------------

import {
  ctx,
  canvas,
  DPR,
  polygons,
  selected,
  highlightEdge,
  gridLines,
  grid,
  unitFactors,
  currentUnit,
  view,
  layoutBounds,
  flags, // ✅ updated import
} from "./state.js";

import { centroid, polygonArea } from "./geometry.js";
import { worldToScreen } from "./state.js";

// ✅ Draw base grid (uniform grid lines)
export function drawGrid() {
  if (!grid.show) return;

  const xlim = worldToScreen(0, 0).x;
  const xhi = worldToScreen(canvas.width / DPR, 0).x;
  const ylim = worldToScreen(0, 0).y;
  const yhi = worldToScreen(0, canvas.height / DPR).y;

  let step = Math.max(0.2, flags.snapStep);
  let baseX = 0,
    baseY = 0;

  // 🔹 Align with drawGrids if gridLines exist
  if (gridLines && gridLines.length > 0) {
    const allX = gridLines.map((g) => [g.startPoint.X, g.endPoint.X]).flat();
    const allY = gridLines.map((g) => [g.startPoint.Y, g.endPoint.Y]).flat();
    allX.sort((a, b) => a - b);
    allY.sort((a, b) => a - b);

    if (allX.length > 1) {
      const diffs = [];
      for (let i = 1; i < allX.length; i++) {
        const d = Math.abs(allX[i] - allX[i - 1]);
        if (d > 0.01) diffs.push(d);
      }
      if (diffs.length) step = Math.min(...diffs);
    }

    baseX = allX[0];
    baseY = allY[0];
  }

  const startX = Math.floor((xlim - baseX) / step) * step + baseX;
  const endX = Math.ceil((xhi - baseX) / step) * step + baseX;
  const startY = Math.floor((ylim - baseY) / step) * step + baseY;
  const endY = Math.ceil((yhi - baseY) / step) * step + baseY;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.04)";
  ctx.beginPath();

  for (let x = startX; x <= endX; x += step) {
    const s = worldToScreen(x, 0);
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, canvas.height / DPR);
  }

  for (let y = startY; y <= endY; y += step) {
    const s = worldToScreen(0, y);
    ctx.moveTo(0, s.y);
    ctx.lineTo(canvas.width / DPR, s.y);
  }

  ctx.stroke();
}

// ✅ Draw imported Revit grid lines
export function drawGrids() {
  if (!gridLines.length) return;

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(180,180,180,0.6)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();

  for (const g of gridLines) {
    const s = worldToScreen(g.startPoint.X, g.startPoint.Y);
    const e = worldToScreen(g.endPoint.X, g.endPoint.Y);
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

// ✅ Draw a single polygon (room)
export function drawPolygon(poly, isSel = false) {
  ctx.beginPath();
  poly.coords.forEach(([x, y], i) => {
    const s = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();

  // Fill with semi-transparent color
  ctx.fillStyle = poly === selected
    ? "rgba(239,68,68,0.25)"
    : poly.color.replace("rgb", "rgba").replace(")", ",0.25)");
  ctx.fill();

  // Outline (walls)
  ctx.lineWidth = isSel ? 3.5 : 2.5;
  ctx.strokeStyle = isSel ? "#ef4444" : poly.color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  if (poly.isFixed) ctx.strokeStyle = "rgba(160,160,160,0.9)";

  // Vertices
  for (const [x, y] of poly.coords) {
    const s = worldToScreen(x, y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#cbd5e1";
    ctx.fill();
  }

  // Edge lengths
  if (flags.showRoomLengths && !poly.isFixed) {
    for (let i = 0; i < poly.coords.length; i++) {
      const a = poly.coords[i];
      const b = poly.coords[(i + 1) % poly.coords.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * unitFactors[currentUnit];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

      const dx = b[0] - a[0], dy = b[1] - a[1];
      const angle = Math.atan2(dy, dx);

      const centroidPt = centroid(poly);
      const nx = -dy, ny = dx;
      const normLen = Math.hypot(nx, ny);
      const ux = nx / normLen, uy = ny / normLen;
      const toCentroidX = centroidPt.x - mid[0];
      const toCentroidY = centroidPt.y - mid[1];
      const dot = toCentroidX * ux + toCentroidY * uy;
      const inward = dot > 0 ? 1 : -1;

      const offset = 0.15;
      const labelPos = [mid[0] + ux * inward * offset, mid[1] + uy * inward * offset];
      const sm = worldToScreen(labelPos[0], labelPos[1]);

      let fixedAngle = angle;
      if (fixedAngle > Math.PI / 2 || fixedAngle < -Math.PI / 2) {
        fixedAngle += Math.PI;
      }

      ctx.save();
      ctx.translate(sm.x, sm.y);
      ctx.rotate(fixedAngle);
      ctx.font = "bold 11px ui-sans-serif, system-ui, -apple-system";
      ctx.fillStyle = "#ffffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(length.toFixed(2) + " " + currentUnit, 0, 0);
      ctx.restore();
    }
  }

  // Room name + area
  if (flags.showRoomNames) {
    const c = centroid(poly);
    const sc = worldToScreen(c.x, c.y);
    const area_m2 = polygonArea(poly.coords);
    const area = area_m2 * unitFactors[currentUnit] ** 2;
    const areaText = `(${area.toFixed(2)} ${currentUnit}²)`;

    const displayName = poly.isFixed ? "" : poly.room.roomName || "Unnamed";
    ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = poly.isFixed
      ? "#a3a3a3"
      : isSel
      ? "#ef4444"
      : "#ffffffff";

    if (!poly.isFixed) {
      ctx.fillText(displayName, sc.x, sc.y);
      ctx.fillText(areaText, sc.x, sc.y + 14);
    }
  }
}

// ✅ Draw all polygons + overlays
export function draw() {
  ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  drawGrid();
  drawGrids();

  // Draw non-selected rooms first
  for (const poly of polygons) {
    if (poly === selected) continue;
    drawPolygon(poly, false);
  }

  // Selected on top
  if (selected) drawPolygon(selected, true);

  // Hover edge highlight
  if (highlightEdge.poly && highlightEdge.idx != null) {
    const cs = highlightEdge.poly.coords;
    const i = highlightEdge.idx;
    const a = worldToScreen(cs[i][0], cs[i][1]);
    const b = worldToScreen(cs[(i + 1) % cs.length][0], cs[(i + 1) % cs.length][1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Layout border
  if (layoutBounds) {
    const { minX, minY, maxX, maxY } = layoutBounds;
    const s1 = worldToScreen(minX, minY);
    const s2 = worldToScreen(maxX, maxY);
    ctx.strokeStyle = "rgba(255, 0, 0, 0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(s1.x, s2.y, s2.x - s1.x, s1.y - s2.y);
  }
}

// ✅ Fit viewport to all polygons
export function fitView() {
  if (!polygons.length) {
    view.x = 0;
    view.y = 0;
    view.scale = 20;
    return;
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of polygons) {
    for (const [x, y] of p.coords) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const pad = 1;
  const w = maxX - minX || 1,
    h = maxY - minY || 1;
  const vw = canvas.width / DPR,
    vh = canvas.height / DPR;
  const scale = 0.9 * Math.min(vw / w, vh / h);

  view.scale = isFinite(scale) ? scale : 20;
  view.x = minX - (vw / (2 * view.scale) - w / 2) - pad;
  view.y = minY - (vh / (2 * view.scale) - h / 2) - pad;
}

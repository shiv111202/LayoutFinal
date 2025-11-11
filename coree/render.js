// core/render.js
import { centroid, polygonArea, hslToRgb } from "./utils.js";
import { polygons, selected, highlightEdge, showRoomNames, showRoomLengths, currentUnit, unitFactors, grid, view, DPR, toast } from "./state.js";

let canvas, ctx;

export function initCanvas(c) {
  canvas = c;
  ctx = canvas.getContext("2d");
}

export function resizeCanvas() {
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * DPR));
  canvas.height = Math.max(1, Math.floor(rect.height * DPR));
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  draw();
}

/** === Coordinate conversions === **/
export function worldToScreen(wx, wy) {
  return { x: (wx - view.x) * view.scale, y: (wy - view.y) * view.scale };
}

export function screenToWorld(sx, sy) {
  return { x: sx / view.scale + view.x, y: sy / view.scale + view.y };
}

/** === Grid === **/
export function drawGrid() {
  if (!grid.show) return;
  const xlim = screenToWorld(0, 0).x;
  const xhi = screenToWorld(canvas.width / DPR, 0).x;
  const ylim = screenToWorld(0, 0).y;
  const yhi = screenToWorld(0, canvas.height / DPR).y;
  const step = Math.max(0.2, grid.step || 0.5);
  const startX = Math.floor(xlim / step) * step;
  const endX = Math.ceil(xhi / step) * step;
  const startY = Math.floor(ylim / step) * step;
  const endY = Math.ceil(yhi / step) * step;

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

/** === Draw Polygon === **/
function drawPolygon(poly, isSel) {
  const TAU = Math.PI * 2;

  // --- Fill ---
  ctx.beginPath();
  poly.coords.forEach(([x, y], i) => {
    const s = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();

  ctx.fillStyle =
    isSel
      ? "rgba(239,68,68,0.25)"
      : poly.color.replace("rgb", "rgba").replace(")", ",0.25)");
  ctx.fill();

  // --- Outline ---
  ctx.lineWidth = isSel ? 3.5 : 2.5;
  ctx.strokeStyle = isSel ? "#ef4444" : poly.color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // --- Vertices ---
  for (const [x, y] of poly.coords) {
    const s = worldToScreen(x, y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, TAU);
    ctx.fillStyle = "#cbd5e1";
    ctx.fill();
  }

  // --- Edge Length Labels ---
  if (showRoomLengths) {
    for (let i = 0; i < poly.coords.length; i++) {
      const a = poly.coords[i];
      const b = poly.coords[(i + 1) % poly.coords.length];
      const length =
        Math.hypot(b[0] - a[0], b[1] - a[1]) * unitFactors[currentUnit];

      // midpoint
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const angle = Math.atan2(dy, dx);

      // centroid
      const centroid = poly.centroid || poly.coords.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
      centroid[0] /= poly.coords.length;
      centroid[1] /= poly.coords.length;

      // inward normal
      const nx = -dy, ny = dx;
      const len = Math.hypot(nx, ny);
      const ux = nx / len, uy = ny / len;
      const toC = [centroid[0] - mid[0], centroid[1] - mid[1]];
      const inward = (toC[0] * ux + toC[1] * uy) > 0 ? 1 : -1;
      const offset = 0.15;
      const labelPos = [
        mid[0] + ux * inward * offset,
        mid[1] + uy * inward * offset
      ];
      const sm = worldToScreen(labelPos[0], labelPos[1]);

      // rotate text along edge
      let fixedAngle = angle;
      if (fixedAngle > Math.PI / 2 || fixedAngle < -Math.PI / 2) {
        fixedAngle += Math.PI;
      }

      // prevent oversized text
      const text = `${length.toFixed(2)} ${currentUnit}`;
      const textWidth = ctx.measureText ? ctx.measureText(text).width : 0;
      const worldLen = Math.hypot(b[0] - a[0], b[1] - a[1]) * view.scale;
      if (textWidth > worldLen) continue; // skip if too large

      ctx.save();
      ctx.translate(sm.x, sm.y);
      ctx.rotate(fixedAngle);
      ctx.font = "bold 11px ui-sans-serif, system-ui, -apple-system";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  // --- Room name + area ---
  if (showRoomNames) {
    const c = centroid(poly);
    const sc = worldToScreen(c.x, c.y);
    const area_m2 = polygonArea(poly.coords);
    const area = area_m2 * unitFactors[currentUnit] ** 2;
    const areaText = `(${area.toFixed(2)} ${currentUnit}²)`;

    ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isSel ? "#ef4444" : "#ffffff";
    ctx.fillText(poly.room.roomName || "Room", sc.x, sc.y);
    ctx.fillText(areaText, sc.x, sc.y + 12 * 1.2);
  }
}

/** === Main Draw === **/
export function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  drawGrid();

  // Draw all non-selected polygons first
  for (const poly of polygons) {
    if (poly === selected) continue;
    drawPolygon(poly, false);
  }

  // Selected polygon on top
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
}

/** === Fit View === **/
export function fitView() {
  if (!polygons.length) {
    view.x = 0;
    view.y = 0;
    view.scale = 20;
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygons) {
    for (const [x, y] of p.coords) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const pad = 1;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const vw = canvas.width / DPR, vh = canvas.height / DPR;
  const scale = 0.9 * Math.min(vw / w, vh / h);
  view.scale = isFinite(scale) ? scale : 20;
  view.x = minX - (vw / (2 * view.scale) - w / 2) - pad;
  view.y = minY - (vh / (2 * view.scale) - h / 2) - pad;
}

// renderer.js — canvas drawing: background grid, JSON grids, polygons, labels, crosshair

import { centroid, pointInPoly, polygonArea } from "./utils.js";
import { getJapaneseName } from "./namemap.js";
import { TAU, canvas, ctx, state, worldToScreen, screenToWorld, unitFactors } from "./state.js";

function getActiveBoundaryPolys() {
  if (state.currentFloor === "all") {
    return [...state.wardPolys, ...state.clinicPolys];
  }

  const matchesFloor = (poly) => String(poly.floor) === String(state.currentFloor);
  const clinicMatches = state.clinicPolys.filter(matchesFloor);
  if (clinicMatches.length) return clinicMatches;

  const wardMatches = state.wardPolys.filter(matchesFloor);
  if (wardMatches.length) return wardMatches;

  return state.wardPolys.length ? state.wardPolys : state.clinicPolys;
}

// ── Canvas resize ─────────────────────────────────────────────────────────────
export function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width  = Math.max(1, Math.floor(r.width  * state.DPR));
  canvas.height = Math.max(1, Math.floor(r.height * state.DPR));
  ctx.setTransform(state.DPR, 0, 0, state.DPR, 0, 0);
  draw();
}

// ── Fit all polygons into view ────────────────────────────────────────────────
export function fitView() {
  if (!state.polygons.length) {
    state.view.x = 0;
    state.view.y = 0;
    state.view.scale = 20;
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of state.polygons) {
    for (const [x, y] of p.coords) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const pad = 1;
  minX -= pad; minY -= pad;
  maxX += pad; maxY += pad;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const vw = canvas.width / state.DPR, vh = canvas.height / state.DPR;
  const scale = 0.9 * Math.min(vw / w, vh / h);
  state.view.scale = isFinite(scale) ? scale : 20;
  state.view.x = minX - (vw / state.view.scale - w) / 2;
  state.view.y = maxY + (vh / state.view.scale - h) / 2;
}

// ── Background grid ───────────────────────────────────────────────────────────
function drawGrid() {
  if (!state.grid.show) return;
  const xlim  = screenToWorld(0, 0).x;
  const xhi   = screenToWorld(canvas.width  / state.DPR, 0).x;
  const y0    = screenToWorld(0, 0).y;
  const y1    = screenToWorld(0, canvas.height / state.DPR).y;
  const ylim  = Math.min(y0, y1);
  const yhi   = Math.max(y0, y1);
  const step  = Math.max(0.2, state.snapStep);
  const startX = Math.floor(xlim / step) * step;
  const endX   = Math.ceil(xhi  / step) * step;
  const startY = Math.floor(ylim / step) * step;
  const endY   = Math.ceil(yhi  / step) * step;

  ctx.lineWidth   = 1;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.04)";
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    const s = worldToScreen(x, 0);
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, canvas.height / state.DPR);
  }
  for (let y = startY; y <= endY; y += step) {
    const s = worldToScreen(0, y);
    ctx.moveTo(0, s.y);
    ctx.lineTo(canvas.width / state.DPR, s.y);
  }
  ctx.stroke();
}

// ── JSON structural grid lines ────────────────────────────────────────────────
function drawGrids() {
  const boundaryPolys = getActiveBoundaryPolys();
  if (!state.gridLines.length || !boundaryPolys.length) return;
  ctx.lineWidth   = 1.2;
  ctx.strokeStyle = "rgba(180,180,180,0.6)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();

  for (const g of state.gridLines) {
    const midX = (g.startPoint.X + g.endPoint.X) / 2;
    const midY = (g.startPoint.Y + g.endPoint.Y) / 2;
    const inside = boundaryPolys.some((w) => pointInPoly({ x: midX, y: midY }, w));

    if (inside) {
      const s = worldToScreen(g.startPoint.X, g.startPoint.Y);
      const e = worldToScreen(g.endPoint.X,   g.endPoint.Y);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

// ── Single polygon ────────────────────────────────────────────────────────────
function drawPolygon(poly, isSel) {
  // Fill
  ctx.beginPath();
  poly.coords.forEach(([x, y], i) => {
    const s = worldToScreen(x, y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else         ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = poly === state.selected
    ? "rgba(239,68,68,0.25)"
    : poly.color.replace("rgb", "rgba").replace(")", ",0.5)");
  ctx.fill();

  // Outline
  ctx.lineWidth   = isSel ? 3.5 : 2.5;
  ctx.strokeStyle = isSel ? "#ef4444" : poly.color;
  ctx.lineJoin    = "round";
  ctx.lineCap     = "round";
  ctx.stroke();

  if (poly.isFixed) ctx.strokeStyle = "rgba(160,160,160,0.9)";

  // Vertices
  for (const [x, y] of poly.coords) {
    const s = worldToScreen(x, y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, TAU);
    ctx.fillStyle = "#cbd5e1";
    ctx.fill();
  }

  // Edge length labels
  if (state.showRoomLengths && !poly.isColumn) {
    const factor = unitFactors[state.currentUnit];
    for (let i = 0; i < poly.coords.length; i++) {
      const a = poly.coords[i];
      const b = poly.coords[(i + 1) % poly.coords.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * factor;
      const mid    = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const angle  = Math.atan2(dy, dx);

      // Inward offset from centroid
      const cen = poly.coords.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
      cen[0] /= poly.coords.length;
      cen[1] /= poly.coords.length;
      const nx = -dy, ny = dx;
      const normLen = Math.hypot(nx, ny);
      const ux = nx / normLen, uy = ny / normLen;
      const dot = (cen[0] - mid[0]) * ux + (cen[1] - mid[1]) * uy;
      const inward = dot > 0 ? 1 : -1;
      const labelPos = [mid[0] + ux * inward * 0.15, mid[1] + uy * inward * 0.15];
      const sm = worldToScreen(labelPos[0], labelPos[1]);

      let fixedAngle = angle;
      if (fixedAngle > Math.PI / 2 || fixedAngle < -Math.PI / 2) fixedAngle += Math.PI;

      ctx.save();
      ctx.translate(sm.x, sm.y);
      ctx.rotate(fixedAngle);
      ctx.font         = "bold 11px ui-sans-serif, system-ui, -apple-system";
      ctx.fillStyle    = "rgba(0, 0, 0, 0.85)";
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(length.toFixed(2) + " " + state.currentUnit, 0, 0);
      ctx.restore();
    }
  }

  // Room name + area label
  if (state.showRoomNames) {
    const c      = centroid(poly);
    const sc     = worldToScreen(c.x, c.y);
    const factor = unitFactors[state.currentUnit];
    const area   = polygonArea(poly.coords) * factor ** 2;
    const areaText = `(${area.toFixed(2)} ${state.currentUnit}\u00b2)`;

    // Pick English or Japanese display name based on language setting
    let displayName = "";
    if (!(poly.isColumn && poly.isFixed)) {
      const engName = poly.room.roomName || "N/A";
      if (state.currentLanguage === "jpn") {
        const jpn = getJapaneseName(engName);
        displayName = jpn || engName; // fall back to English if no translation found
      } else {
        displayName = engName;
      }
    }

    // Use a font that supports Japanese characters
    ctx.font         = "bold 12px \'Noto Sans JP\', \'Hiragino Sans\', \'Meiryo\', ui-sans-serif, system-ui";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = poly.isFixed ? "rgba(0, 0, 0, 0.85)" : isSel ? "#ef4444" : "rgba(0, 0, 0, 0.85)";

    if (!poly.isColumn) {
      ctx.fillText(displayName, sc.x, sc.y);
      ctx.fillText(areaText,    sc.x, sc.y + 12 * 1.2);
    }
  }
}

// ── Main draw ─────────────────────────────────────────────────────────────────
export function draw() {
  ctx.clearRect(0, 0, canvas.width / state.DPR, canvas.height / state.DPR);
  drawGrid();
  drawGrids();

  const boundaryPolys = getActiveBoundaryPolys();

  // Red bounding box around the active floor boundary
  if (boundaryPolys.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of boundaryPolys) {
      for (const [x, y] of w.coords) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
    const sTopLeft = worldToScreen(minX, maxY);
    const sBottomRight = worldToScreen(maxX, minY);
    ctx.save();
    ctx.lineWidth   = 2;
    ctx.strokeStyle = "rgba(255,0,0,0.9)";
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(
      sTopLeft.x,
      sTopLeft.y,
      sBottomRight.x - sTopLeft.x,
      sBottomRight.y - sTopLeft.y
    );
    ctx.restore();
  }

  // Non-selected polygons first, then selected on top
  for (const poly of state.polygons) {
    if (poly !== state.selected) drawPolygon(poly, false);
  }
  if (state.selected) drawPolygon(state.selected, true);

  // Hover edge highlight
  if (state.highlightEdge.poly && state.highlightEdge.idx != null) {
    const cs = state.highlightEdge.poly.coords;
    const i  = state.highlightEdge.idx;
    const a  = worldToScreen(cs[i][0], cs[i][1]);
    const b  = worldToScreen(cs[(i + 1) % cs.length][0], cs[(i + 1) % cs.length][1]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.lineWidth   = 3;
    ctx.stroke();
  }

  // Crosshair
  ctx.save();
  ctx.lineWidth   = 1.2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(state.mouse.x, 0);
  ctx.lineTo(state.mouse.x, canvas.height / state.DPR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, state.mouse.y);
  ctx.lineTo(canvas.width / state.DPR, state.mouse.y);
  ctx.stroke();
  ctx.restore();
}

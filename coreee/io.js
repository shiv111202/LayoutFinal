// ------------------------------
// io.js — Load/save JSON + room extraction
// ------------------------------

import {
  data,
  polygons,
  gridLines,
  layoutBounds,
  view,
} from "./state.js";

import { computeNeighbors } from "./neighbor.js";
import { randomColor, toast } from "./utils.js";
import { resizeCanvas } from "./state.js";
import { worldToScreen } from "./state.js";

// ✅ Load JSON file from input
export async function loadJSONFile(file) {
  const text = await file.text();
  let jsonData;

  try {
    jsonData = JSON.parse(text);
  } catch (err) {
    console.error("❌ Invalid JSON:", err);
    toast("❌ Invalid or malformed JSON");
    return;
  }

  Object.assign(data, jsonData);
  gridLines.length = 0;

  // --- Collect all rooms + grids ---
  const skipKeys = [
    "nursingZones",
    "patientZones",
    "evZone",
    "internalRoadPolygons",
    "externalRoadPolygons",
  ];

  function collectRoomsAndGrids(obj, parentKey = "") {
    let rooms = [];
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.includes(key)) continue;

      if (key === "horizontalGrids" || key === "verticalGrids") {
        if (Array.isArray(value)) gridLines.push(...value);
        continue;
      }

      if (Array.isArray(value)) {
        const valid = value.filter((r) => r && r.vertices && r.vertices.length);
        for (const room of valid) {
          if (key === "columnPolygons" || parentKey === "columnPolygons") {
            room._isFixed = true;
          }
          rooms.push(room);
        }
      } else if (typeof value === "object" && value !== null) {
        rooms.push(...collectRoomsAndGrids(value, key));
      }
    }
    return rooms;
  }

  const layouts = collectRoomsAndGrids(data);

  // --- Maintain consistent colors per room name ---
  const colorMap = {};
  function getColorForRoom(name) {
    const key = name?.trim() || "Unnamed";
    if (!colorMap[key]) colorMap[key] = randomColor();
    return colorMap[key];
  }

  // --- Build polygons ---
  polygons.length = 0;
  layouts.forEach((room) => {
    const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
    polygons.push({
      room,
      coords,
      color: getColorForRoom(room.roomName),
      selected_vertex: null,
      selected_edge: null,
      isFixed: !!room._isFixed,
    });
  });

  // --- Compute layout bounds ---
  computeLayoutBounds();
  computeNeighbors();
  toast(`✅ Loaded ${polygons.length} rooms from selected JSON.`);
}

// ✅ Compute layout bounds and store globally
export function computeLayoutBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const p of polygons) {
    for (const [x, y] of p.coords) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  layoutBounds.minX = minX;
  layoutBounds.minY = minY;
  layoutBounds.maxX = maxX;
  layoutBounds.maxY = maxY;

  console.log("📏 Layout bounds:", layoutBounds);
}

// ✅ Clean and save polygons as JSON
export function saveJSON() {
  const EPS = 1e-6;
  const isSame = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

  function cleanCoords(coords) {
    if (!coords || coords.length < 2) return coords;

    const cleaned = [];
    let skipNext = false;

    for (let i = 0; i < coords.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const a = coords[i];
      const b = coords[(i + 1) % coords.length];

      if (isSame(a, b)) {
        skipNext = true;
        continue;
      }

      cleaned.push(a);
    }

    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (isSame(first, last)) cleaned.pop();

    return cleaned.length >= 3 ? cleaned : coords;
  }

  polygons.forEach((p) => {
    const cleanedCoords = cleanCoords(p.coords);
    p.room.vertices = cleanedCoords.map(([x, y]) => ({
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

  toast("💾 Saved edited.json");
}

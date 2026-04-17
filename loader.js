// loader.js — JSON floor-plan loader, restriction loader, saveJSON

import { toast } from "./utils.js";
import {
  state, skipKeys,
  computeNeighbors, applyImmovableRules,
} from "./state.js";
import { draw, fitView } from "./renderer.js";

const COLOR_MAP = {
  "ss": "rgb(250,225,250)",
  "interview room": "rgb(250,225,250)",
  "examination and treatment room": "rgb(250,225,250)",
  "conference room": "rgb(250,225,250)",
  "chemical storage": "rgb(250, 225, 225)",
  "equipment storage": "rgb(250,225,250)",
  "break room": "rgb(250,225,250)",
  "nap room": "rgb(250,225,250)",
  "waste treatment room": "rgb(250,225,250)",
  "hcwc": "rgb(250,225,250)",
  "bathroom": "rgb(250,225,250)",
  "changing room": "rgb(250,225,250)",
  "unit shower": "rgb(250,225,250)",
  "special bath": "rgb(250,225,250)",
  "laundry room": "rgb(250,225,250)",

  "light garden": "rgb(255,255,255)",
  "staircase": "rgb(255,255,255)",
  "balcony": "rgb(255,255,255)",
  "external staircase": "rgb(255,255,255)",
  "lobby": "rgb(255,255,255)",
  "entrance hall": "rgb(255,255,255)",
  "windbreak room": "rgb(255,255,255)",
  "ev lobby": "rgb(255,255,255)",
  "common passage": "rgb(255,255,255)",

  "p-15, b-15": "rgb(220,240,245)",
  "mri imaging room": "rgb(220,240,245)",
  "x-ray tv examination room": "rgb(220,240,245)",
  "ct photography room": "rgb(220,240,245)",
  "x-ray photography room": "rgb(220,240,245)",
  "angiography room": "rgb(220,240,245)",
  "waiting hall": "rgb(220,240,245)",
  "reception": "rgb(220,240,245)",
  "consultation room": "rgb(220,240,245)",
  "functional training room": "rgb(220,240,245)",
  "speech therapy room": "rgb(220,240,245)",
  "physiological test room": "rgb(220,240,245)",
  "operating room": "rgb(220,240,245)",

  "emergency room": "rgb(255,235,220)",
  "intravenous drip room": "rgb(255,235,220)",
  "staff passage": "rgb(255,235,220)",
  "storage": "rgb(255,235,220)",

  "boiler room": "rgb(230,225,235)",
  "fire pump room": "rgb(230,225,235)",
  "medical waste storage": "rgb(230,225,235)",
  "waste storage": "rgb(230,225,235)",
  "linen storage": "rgb(230,225,235)",
  "central warehouse": "rgb(230,225,235)",
  "pharmacy area": "rgb(230,225,235)",

  "guard room": "rgb(235,240,220)",
  "nursery": "rgb(235,240,220)",
  "shop": "rgb(235,240,220)",
  "medical office room": "rgb(235,240,220)",
  "director's room": "rgb(235,240,220)",
  "library": "rgb(235,240,220)",
  "server room": "rgb(235,240,220)",
};

// Helper: build a polygon object from a room record
function normalizeName(name) {
  return name
    ?.toLowerCase()
    .trim()
    .replace(/[-–—]\s*\d+$/, "") // removes " - 1", " - 2"
    .replace(/\s+/g, " "); // normalize spaces
}

function getColorFromMap(roomName) {
  const normalized = normalizeName(roomName);

  // 1. Exact match
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];

  // 2. Partial match (e.g., "light garden - 1")
  for (const key in COLOR_MAP) {
    if (normalized.includes(key)) {
      return COLOR_MAP[key];
    }
  }

  // 3. Fallback
  return "rgb(200,200,200)";
}

function roomToPoly(room, colorMap) {
  const key = room.roomName || "N/A";

  return {
    room,
    coords: room.vertices.map((v) => [Number(v.X), Number(v.Y)]),
    color: getColorFromMap(key),
    selected_vertex: null,
    selected_edge: null,
    isFixed: !!room._isFixed,
    isColumn: !!room._isColumn,
  };
}

// ── Drag & drop support ───────────────────────────────────────────────────────
document.addEventListener("dragover", (e) => e.preventDefault());

document.addEventListener("drop", (e) => {
  e.preventDefault();
  const input = document.getElementById("loadFile");
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  input.files = files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

// ── Floor-plan JSON loader ────────────────────────────────────────────────────
document.getElementById("loadFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const text = await f.text();

  try {
    const loadedData = JSON.parse(text);
    console.log(loadedData);

    // Full reset
    state.data         = loadedData;
    state.polygons     = [];
    state.wardPolys    = [];
    state.clinicPolys  = [];
    state.gridLines    = [];
    state.undoStack    = [];
    state.selected     = null;
    state.highlightEdge = { poly: null, idx: null };
    state.roomConstraints = {};
    state.currentFloor = "all";

    // Collect rooms & grid lines from the JSON tree
    function collectRoomsAndGrids(obj, parentKey = "") {
      const rooms = [];
      for (const [key, value] of Object.entries(obj)) {
        if (skipKeys.includes(key)) continue;

        if (key === "horizontalGrids" || key === "verticalGrids") {
          if (Array.isArray(value)) state.gridLines.push(...value);
          continue;
        }

        if (Array.isArray(value)) {
          const valid = value.filter((r) => r && r.vertices && r.vertices.length);
          for (const room of valid) {
            if (key === "columnPolygons" || parentKey === "columnPolygons") {
              room._isFixed  = true;
              room._isColumn = true;
            }
            rooms.push(room);
          }
        } else if (typeof value === "object" && value !== null) {
          rooms.push(...collectRoomsAndGrids(value, key));
        }
      }
      return rooms;
    }

    const layouts = collectRoomsAndGrids(loadedData);
    applyImmovableRules(layouts);

    // Collect wardInfo boundary polygons
    if (loadedData.wardInfo) {
      for (const arr of Object.values(loadedData.wardInfo)) {
        if (!Array.isArray(arr)) continue;
        const valid = arr.filter((r) => r && r.vertices && r.vertices.length);
        for (const r of valid) {
          state.wardPolys.push({
            room:   r,
            coords: r.vertices.map((v) => [Number(v.X), Number(v.Y)]),
            floor: r.applicableFloors ?? r.applicableFloor ?? null,
          });
        }
      }
    }

    if (loadedData.clinicInfo?.zones) {
      const valid = loadedData.clinicInfo.zones.filter((z) => z && z.vertices && z.vertices.length);
      for (const z of valid) {
        state.clinicPolys.push({
          room: z,
          coords: z.vertices.map((v) => [Number(v.X), Number(v.Y)]),
          floor: z.applicableFloors ?? z.applicableFloor ?? null,
        });
      }
    }

    const filteredLayouts = layouts;

    // Build ONE poly object per room — never recreated after this point.
    // Floor switching only shows/hides entries from this map, so all
    // coord edits made on any floor are preserved when switching floors.
    // Stored on state so saveJSON can flush ALL rooms, not just visible floor.
    const colorMap = {};
    state.polyMap = new Map(); // room object -> live poly object
    for (const r of filteredLayouts) {
      state.polyMap.set(r, roomToPoly(r, colorMap));
    }
    const polyMap = state.polyMap; // local alias

    function roomMatchesFloor(room, selectedFloor) {
      if (selectedFloor === "all") return true;

      const floorValue = room.applicableFloors ?? room.applicableFloor;
      if (floorValue == null) {
        // Keep legacy behavior only for shapes with no floor metadata at all.
        return !!room._isColumn;
      }

      if (Array.isArray(floorValue)) {
        return floorValue.some((floor) => String(floor) === String(selectedFloor));
      }

      return String(floorValue) === String(selectedFloor);
    }

    // Apply a floor filter by picking from polyMap (no recreation)
    function applyFloor(selectedFloor) {
      state.currentFloor = selectedFloor;
      state.polygons =
        selectedFloor === "all"
          ? filteredLayouts.map((r) => polyMap.get(r))
          : filteredLayouts
              .filter((room) => roomMatchesFloor(room, selectedFloor))
              .map((r) => polyMap.get(r));
    }

    // Populate floor dropdown
    const floors = [
      ...new Set(
        filteredLayouts
          .map((r) => r.applicableFloors ?? r.applicableFloor)
          .filter((f) => f != null)
      ),
    ].sort((a, b) => a - b);

    // Auto-select the lowest floor (closest to 0) on load
    const defaultFloor = floors.length > 0 ? floors[0] : null;

    const floorSelect = document.getElementById("floorSelect");
    floorSelect.innerHTML =
      `<option value="all" ${defaultFloor === null ? "selected" : ""}>All Floors</option>` +
      floors.map((f) =>
        `<option value="${f}" ${f === defaultFloor ? "selected" : ""}>Floor ${f}</option>`
      ).join("");

    // Replace node to remove any stale listener from a previous file load
    const newFloorSelect = floorSelect.cloneNode(true);
    floorSelect.parentNode.replaceChild(newFloorSelect, floorSelect);

    newFloorSelect.addEventListener("change", (ev) => {
      const selectedFloor = ev.target.value;
      state.selected = null; // clear selection when switching floors
      applyFloor(selectedFloor);
      computeNeighbors();
      draw();
      fitView();
      toast(
        selectedFloor === "all"
          ? "Showing all floors"
          : `Showing floor ${selectedFloor}`
      );
    });

    // Apply the default floor immediately on load
    applyFloor(defaultFloor ?? "all");
    fitView();
    computeNeighbors();
    draw();
    toast(`Loaded ${state.polygons.length} rooms from JSON. (Floor ${defaultFloor ?? "all"})`);
  } catch (err) {
    console.error("Error loading JSON:", err);
    toast("❌ Invalid or malformed JSON");
  }
});

// ── Restriction JSON loader ───────────────────────────────────────────────────
document.getElementById("loadRestriction").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsedData = JSON.parse(e.target.result);
      state.roomConstraints = {};
      parsedData.forEach((r) => {
        const name = r.room_names?.trim().toLowerCase();
        if (!name) return;
        state.roomConstraints[name] = {
          min_width:  Number(r.min_width)  || 0,
          min_height: Number(r.min_height) || 0,
        };
      });
      console.log("✅ Loaded room constraints:", state.roomConstraints);
      toast(`✅ Loaded ${Object.keys(state.roomConstraints).length} room constraints`);
    } catch (err) {
      console.error("⚠️ Error parsing JSON:", err);
      toast("⚠️ Invalid JSON file format");
    }
  };
  reader.readAsText(file);
});

// ── Save JSON ─────────────────────────────────────────────────────────────────
export function saveJSON() {
  // Flush ALL rooms (all floors), not just the currently visible ones
  const allPolys = state.polyMap
    ? [...state.polyMap.values()]
    : state.polygons;
  allPolys.forEach((p) => {
    p.room.vertices = p.coords.map(([x, y]) => ({ X: Number(x), Y: Number(y), Z: 0 }));
  });
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = "edited.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Saved edited.json");
}

(() => {
  /*** Utility ***/
  const TAU = Math.PI * 2;
  const toast = (msg) => {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.opacity = 1;
    clearTimeout(t._h);

    // fade to 0.7 after 1.2s
    t._h = setTimeout(() => (t.style.opacity = 0.7), 1200);

    // fade out completely after 5s
    t._h2 = setTimeout(() => (t.style.opacity = 0), 5000);
  };

  function centroid(poly) {
    const pts = poly.coords;
    let a = 0,
      cx = 0,
      cy = 0;
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
      let sx = 0,
        sy = 0;
      pts.forEach((p) => {
        sx += p[0];
        sy += p[1];
      });
      return { x: sx / pts.length, y: sy / pts.length };
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  function pointInPoly(p, poly) {
    const x = p.x,
      y = p.y;
    let inside = false;
    const pts = poly.coords;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0],
        yi = pts[i][1],
        xj = pts[j][0],
        yj = pts[j][1];
      const inter =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
      if (inter) inside = !inside;
    }
    return inside;
  }

  const distPtSeg = (p, a, b) => {
    const ax = a[0],
      ay = a[1],
      bx = b[0],
      by = b[1];
    const abx = bx - ax,
      aby = by - ay;
    const apx = p[0] - ax,
      apy = p[1] - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) return Math.hypot(apx, apy);
    let t = (apx * abx + apy * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx,
      cy = ay + t * aby;
    return Math.hypot(p[0] - cx, p[1] - cy);
  };

  /*** State ***/
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  let DPR = window.devicePixelRatio || 1;
  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * DPR));
    canvas.height = Math.max(1, Math.floor(r.height * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }
  new ResizeObserver(resizeCanvas).observe(
    document.getElementById("canvasWrap")
  );

  let data = {};
  let polygons = [];
  let selected = null;
  let highlightEdge = { poly: null, idx: null };
  let mouse = {
    x: 0,
    y: 0,
    wx: 0,
    wy: 0,
    down: false,
    button: 0,
    drag: false,
    start: { x: 0, y: 0, wx: 0, wy: 0 },
  };
  let panning = false;
  let shiftHeld = false;
  let snapEnabled = false;
  let alignEnabled = true;
  let snapStep = 16;
  let undoStack = [];
  let addVertexMode = false;
  let showRoomNames = false;
  let showRoomLengths = false;
  let moveSharedEdgesEnabled = false;
  let gridLines = [];
  let wardPolys = [];
  let roomConstraints = {};
  const grid = { show: true };
  const SNAP_TOL = 0.3;
  let currentUnit = "m";
  const unitFactors = { m: 1, cm: 100, mm: 1000, ft: 3.28084 };
  const skipKeys = [
    "nursingZones",
    "patientZones",
    "evZone",
    "internalRoadPolygons",
    "externalRoadPolygons",
    "footpathPolygons",
    "zones",
  ];
  let immovableList = [];

  // Viewport
  let view = { x: 0, y: 0, scale: 1.0 };
  function worldToScreen(wx, wy) {
    return { x: (wx - view.x) * view.scale, y: (wy - view.y) * view.scale };
  }
  function screenToWorld(sx, sy) {
    return { x: sx / view.scale + view.x, y: sy / view.scale + view.y };
  }

  function pushState() {
    const snap = polygons.map((p) => ({
      room: p.room.roomName,
      coords: p.coords.map((q) => [q[0], q[1]]),
    }));
    undoStack.push(snap);
    if (undoStack.length > 30) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    const last = undoStack.pop();
    polygons.forEach((poly, i) => {
      poly.coords = last[i].coords.map((q) => [q[0], q[1]]);
      poly.room.roomName = last[i].room;
    });
    draw();
  }

  function randomColor() {
    const h = Math.random();
    const s = 0.6,
      l = 0.55;
    const rgb = hslToRgb(h, s, l);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  function computeNeighbors() {
    for (const poly of polygons) poly.neighbors = new Set();

    const EPS = 0.1; // tolerance for shared vertices

    for (let i = 0; i < polygons.length; i++) {
      const a = polygons[i];
      if (a.isColumn) continue; // ✅ skip columns entirely

      for (let j = i + 1; j < polygons.length; j++) {
        const b = polygons[j];
        if (b.isColumn) continue; // ✅ skip columns entirely

        // Check if any vertices are close enough to be considered touching
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

  function applyImmovableRules(rooms, data) {
    // immovableList = Array.isArray(data.immovablePolygons)
    //   ? data.immovablePolygons.map((s) => s.toLowerCase())
    //   : [];

    immovableList = ["stairs", "shower", "hcwc"];

    if (!immovableList.length) return rooms;

    for (const room of rooms) {
      const roomNameLower = (room.roomName || "").toLowerCase();
      const groupLower = (room.roomGroup || "").toLowerCase();

      // if roomName matches
      if (immovableList.includes(roomNameLower)) {
        room._isFixed = true;
      }

      // if roomGroup matches
      if (immovableList.includes(groupLower)) {
        room._isFixed = true;
      }

      // NOTE: columnPolygons logic remains separate & untouched
    }

    return rooms;
  }

  // allow drop
  document.addEventListener("dragover", (e) => e.preventDefault());

  document.addEventListener("drop", (e) => {
      e.preventDefault();

      const input = document.getElementById("loadFile");
      const files = e.dataTransfer?.files;
      if (!files?.length) return;

      // put dropped files into the input
      input.files = files;

      // trigger SAME existing change listener
      input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  document.getElementById("loadFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();

    try {
      data = JSON.parse(text);

      // --- FULL RESET before loading new JSON ---
      polygons = [];
      wardPolys = [];
      gridLines = [];
      undoStack = [];
      selected = null;
      highlightEdge = { poly: null, idx: null };
      roomConstraints = {};

      // --- Collect all rooms + grids, skipping certain zones ---
      function collectRoomsAndGrids(obj, parentKey = "") {
        let rooms = [];
        for (const [key, value] of Object.entries(obj)) {
          if (skipKeys.includes(key)) continue;
          if (key === "horizontalGrids" || key === "verticalGrids") {
            if (Array.isArray(value)) gridLines.push(...value);
            continue;
          }

          if (Array.isArray(value)) {
            const valid = value.filter(
              (r) => r && r.vertices && r.vertices.length
            );
            for (const room of valid) {
              // Mark column polygons as immovable
              if (key === "columnPolygons" || parentKey === "columnPolygons") {
                room._isFixed = true;
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

      gridLines = [];

      const layouts = collectRoomsAndGrids(data);
      // Apply immovable rules from JSON without touching columnPolygons logic
      applyImmovableRules(layouts, data);

      // --- Identify wardInfo boundary polygon ---

      if (data.wardInfo) {
        for (const [key, arr] of Object.entries(data.wardInfo)) {
          if (Array.isArray(arr)) {
            const valid = arr.filter(
              (r) => r && r.vertices && r.vertices.length
            );
            wardPolys.push(
              ...valid.map((r) => ({
                room: r,
                coords: r.vertices.map((v) => [Number(v.X), Number(v.Y)]),
              }))
            );
          }
        }
      }

      // --- Helper: Check if polygon is inside any wardInfo boundary ---
      function isInsideWard(poly) {
        if (!wardPolys.length) return true; // fallback if no wardInfo boundary
        const c = centroid(poly);
        return wardPolys.some((w) => pointInPoly(c, w));
      }

      // --- Filter: only include rooms inside or children of wardInfo ---
      const filteredLayouts = layouts.filter((room) => {
        const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
        const poly = { coords };
        const inside = isInsideWard(poly);

        const isChildOfWard =
          room._parentKey?.includes("wardInfo") ||
          room.roomGroup?.includes("wardInfo");

        if (room._isFixed && !inside && !isChildOfWard) return false; // exclude out-of-bound columns
        return true;
      });

      // --- Maintain consistent colors per room name ---
      const colorMap = {};
      function getColorForRoom(name) {
        const key = name?.trim() || "N/A";
        if (!colorMap[key]) colorMap[key] = randomColor();
        return colorMap[key];
      }

      // --- Build polygons for filtered rooms only ---
      polygons = filteredLayouts.map((room) => {
        const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
        const lineColor = getColorForRoom(room.roomName);
        return {
          room,
          coords,
          color: lineColor,
          selected_vertex: null,
          selected_edge: null,
          isFixed: !!room._isFixed, // preserve immovable property
          isColumn: !!room._isColumn,
        };
      });

      // --- Collect all unique floor numbers ---
      const floors = [
        ...new Set(
          filteredLayouts
            .map((r) => r.applicableFloors)
            .filter((f) => f != null)
        ),
      ].sort((a, b) => a - b);

      // --- Populate floor dropdown dynamically ---
      const floorSelect = document.getElementById("floorSelect");
      floorSelect.innerHTML =
        `<option value="all" selected>All Floors</option>` +
        floors.map((f) => `<option value="${f}">Floor ${f}</option>`).join("");

      function roomToPoly(room) {
        return {
          room,
          coords: room.vertices.map((v) => [Number(v.X), Number(v.Y)]),
          color: getColorForRoom(room.roomName),
          selected_vertex: null,
          selected_edge: null,
          isFixed: !!room._isFixed,
          isColumn: !!room._isColumn,
        };
      }

      // --- Add event listener to filter rooms by floor ---
      floorSelect.addEventListener("change", (e) => {
        const selectedFloor = e.target.value;
        polygons =
          selectedFloor === "all"
            ? filteredLayouts.map(roomToPoly)
            : filteredLayouts
                .filter((room) => {
                  // KEEP all columns ALWAYS
                  if (room._isFixed) return true;

                  // Normal rooms → filter by floor
                  return room.applicableFloors == selectedFloor;
                })
                .map(roomToPoly);

        computeNeighbors();
        draw();
        fitView();
        toast(
          selectedFloor === "all"
            ? "Showing all floors"
            : `Showing floor ${selectedFloor}`
        );
      });

      fitView();
      computeNeighbors();
      draw();
      toast(`Loaded ${polygons.length} rooms from JSON.`);
    } catch (err) {
      console.error("Error loading JSON:", err);
      toast("❌ Invalid or malformed JSON");
    }
  });

  document
    .getElementById("loadRestriction")
    .addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          roomConstraints = {};
          data.forEach((r) => {
            const name = r.room_names?.trim().toLowerCase();
            if (!name) return;
            roomConstraints[name] = {
              min_width: Number(r.min_width) || 0,
              min_height: Number(r.min_height) || 0,
            };
          });

          console.log("✅ Loaded room constraints:", roomConstraints);
          toast(
            `✅ Loaded ${Object.keys(roomConstraints).length} room constraints`
          );
        } catch (err) {
          console.error("⚠️ Error parsing JSON:", err);
          toast("⚠️ Invalid JSON file format");
        }
      };
      reader.readAsText(file);
    });

  function saveJSON() {
    polygons.forEach((p) => {
      p.room.vertices = p.coords.map(([x, y]) => ({
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
    toast("Saved edited.json");
  }

  document.getElementById("saveBtn").addEventListener("click", saveJSON);

  document.getElementById("resetViewBtn").addEventListener("click", () => {
    fitView();
    draw();
  });

  document.getElementById("addVertexBtn").addEventListener("click", () => {
    if (!selected) {
      toast("⚠️ Select a room first");
      return;
    }
    addVertexMode = true;
    canvas.style.cursor = "crosshair";
    toast("✂️ Add Vertex Mode: click on an edge to insert");
  });

  document.getElementById("showNamesToggle").addEventListener("change", (e) => {
    showRoomNames = e.target.checked;
    draw();
  });

  document
    .getElementById("showLengthsToggle")
    .addEventListener("change", (e) => {
      showRoomLengths = e.target.checked;
      draw();
    });

  document
    .getElementById("sharedEdgeToggle")
    .addEventListener("change", (e) => {
      moveSharedEdgesEnabled = e.target.checked;
      toast(`Shared Edge Movement: ${moveSharedEdgesEnabled ? "ON" : "OFF"}`);
    });

  // Controls
  document.getElementById("gridToggle").addEventListener("change", (e) => {
    grid.show = e.target.checked;
    draw();
  });

  document.getElementById("alignToggle").addEventListener("change", (e) => {
    alignEnabled = e.target.checked;
  });

  document.getElementById("snapStep").addEventListener("input", (e) => {
    const v = Number(e.target.value) || 1;
    snapStep = v;
    draw();
  });

  document.getElementById("unitSelect").addEventListener("change", (e) => {
    currentUnit = e.target.value;
    toast(`Unit: ${currentUnit}`);
    draw();
  });

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift") shiftHeld = true;
    else if (e.key === "g" || e.key === "G") {
      snapEnabled = !snapEnabled;
      toast(`Grid snap: ${snapEnabled ? "ON" : "OFF"}`);
    } else if (e.key === "r" || e.key === "R") {
      if (selected) {
        pushState();
        const nn = prompt(
          `Enter new name for '${selected.room.roomName}':`,
          selected.room.roomName
        );
        if (nn) {
          selected.room.roomName = nn;
          draw();
        }
      }
    } else if (e.key === "s" || e.key === "S") {
      saveJSON();
    } else if (
      e.key === "u" ||
      e.key === "U" ||
      (e.ctrlKey && e.key.toLowerCase() === "z")
    ) {
      undo();
    } else if (e.key === "c" || e.key === "C") {
      if (!selected) {
        toast("⚠️ Select a room first");
        return;
      }
      addVertexMode = true;
      canvas.style.cursor = "crosshair";
      toast("✂️ Add Vertex Mode: click on an edge to insert");
    } else if (e.key === "Escape") {
      if (addVertexMode) {
        addVertexMode = false;
        canvas.style.cursor = "crosshair";
        toast("❌ Add Vertex Mode canceled");
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") shiftHeld = false;
  });

  // Mouse events
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    const w = screenToWorld(mouse.x, mouse.y);
    mouse.wx = w.x;
    mouse.wy = w.y;
    mouse.down = true;
    mouse.button = e.button;
    mouse.drag = false;
    mouse.start = { x: mouse.x, y: mouse.y, wx: w.x, wy: w.y };
    if (selected && selected.isColumn) {
      toast("⚠️ Column polygons are locked");
      return;
    } else if (selected && selected.isFixed) {
      toast("⚠️ Polygons are locked");
      return;
    }

    if (addVertexMode && selected && e.button === 0) {
      const wx = mouse.wx;
      const wy = mouse.wy;

      // Find nearest edge to mouse
      const edgeIdx = nearestEdge(selected, [wx, wy]);
      if (edgeIdx == null) {
        toast("⚠️ Click closer to an edge");
        return;
      }

      const a = selected.coords[edgeIdx];
      const b = selected.coords[(edgeIdx + 1) % selected.coords.length];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const ap = [wx - a[0], wy - a[1]];
      const len2 = ab[0] ** 2 + ab[1] ** 2;
      let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
      t = Math.max(0.001, Math.min(0.999, t));

      // --- compute projected point ---
      const newPt = [a[0] + ab[0] * t, a[1] + ab[1] * t];

      // --- SNAP to nearby vertex ---
      const SNAP_TOL = 0.15;
      for (const poly of polygons) {
        for (const [vx, vy] of poly.coords) {
          if (Math.abs(vx - newPt[0]) < SNAP_TOL) newPt[0] = vx;
          if (Math.abs(vy - newPt[1]) < SNAP_TOL) newPt[1] = vy;
        }
      }

      // ✅ Save state before modifying
      pushState();

      // Insert the same vertex twice at the same position
      selected.coords.splice(edgeIdx + 1, 0, newPt, [...newPt]);

      toast("✅ Two overlapping vertices added");

      // Exit mode
      addVertexMode = false;
      canvas.style.cursor = "crosshair";
      draw();
      return; // prevent normal selection logic from running
    }

    if (e.button === 1 || e.button === 2) {
      panning = true;
      return;
    }

    const HIT_VERTEX_TOL = 0.4;
    selected?.coords &&
      (selected.selected_vertex = nearestVertex(
        selected,
        [w.x, w.y],
        HIT_VERTEX_TOL
      ));
    if (selected && selected.selected_vertex != null) {
      pushState();
      return;
    }

    const edgeIdx = selected ? nearestEdge(selected, [w.x, w.y]) : null;
    if (selected && edgeIdx != null) {
      selected.selected_edge = edgeIdx;
      pushState();
      return;
    }

    const poly = polygons.find((p) => pointInPoly({ x: w.x, y: w.y }, p));

    if (poly) {
      // If the polygon is fixed (like a column), show toast but do not lock selection permanently
      if (poly.isColumn) {
        toast("⚠️ Column polygons are locked");
        selected = poly;
        setTimeout(() => {
          selected = null;
          draw();
        }, 300);
        // immediately clear selection
        draw();
        return;
      } else if (poly.isFixed) {
        // console.log(poly.room.roomName)
        toast(`⚠️ ${poly.room.roomName} polygon is locked`);
        selected = poly;
        setTimeout(() => {
          selected = null;
          draw();
        }, 300);
        // immediately clear selection
        draw();
        return;
      }

      selected = poly;
      draw();
      return;
    }

    selected = null;
    draw();
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    const w = screenToWorld(mouse.x, mouse.y);
    mouse.wx = w.x;
    mouse.wy = w.y;

    if (selected?.isFixed) return;

    if (selected) {
      highlightEdge.idx = nearestEdge(selected, [w.x, w.y]);
      highlightEdge.poly = selected;
    } else {
      highlightEdge.idx = null;
      highlightEdge.poly = null;
    }

    if (!mouse.down) {
      draw();
      return;
    }

    mouse.drag =
      Math.abs(mouse.x - mouse.start.x) > 2 ||
      Math.abs(mouse.y - mouse.start.y) > 2;

    if (panning) {
      const dx = (mouse.x - mouse.start.x) / view.scale;
      const dy = (mouse.y - mouse.start.y) / view.scale;
      view.x -= dx;
      view.y -= dy;
      mouse.start.x = mouse.x;
      mouse.start.y = mouse.y;
      draw();
      return;
    }

    if (!selected) return;

    const snapped = (v) =>
      snapEnabled ? Math.round(v / snapStep) * snapStep : v;

    function align(x, y, current) {
      if (!alignEnabled) return [x, y];
      const candidates = current.neighbors ? [...current.neighbors] : [];

      // Optionally include neighbors-of-neighbors
      for (const n of [...candidates]) {
        if (n.neighbors) {
          for (const nn of n.neighbors) candidates.push(nn);
        }
      }

      // ✅ Skip alignment with fixed (column) polygons
      for (const poly of new Set(candidates)) {
        if (poly === current || poly.isColumn) continue;
        for (const [vx, vy] of poly.coords) {
          if (Math.abs(vx - x) < SNAP_TOL) x = vx;
          if (Math.abs(vy - y) < SNAP_TOL) y = vy;
        }
      }
      return [x, y];
    }

    if (selected.selected_vertex != null) {
      let x = snapped(mouse.wx),
        y = snapped(mouse.wy);
      [x, y] = align(x, y, selected);
      selected.coords[selected.selected_vertex] = [x, y];
      draw();
      return;
    }

    if (selected.selected_edge != null) {
      const idx = selected.selected_edge;
      const coords = selected.coords;
      const p1 = coords[idx];
      const p2 = coords[(idx + 1) % coords.length];
      const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const move = [snapped(mouse.wx) - mid[0], snapped(mouse.wy) - mid[1]];
      const edgeVec = [p2[0] - p1[0], p2[1] - p1[1]];
      if (Math.hypot(edgeVec[0], edgeVec[1]) < 1e-9) return;
      let shift = [move[0], move[1]];
      if (!shiftHeld) {
        const normal = [edgeVec[1], -edgeVec[0]];
        const nlen = Math.hypot(normal[0], normal[1]);
        const n = [normal[0] / nlen, normal[1] / nlen];
        const dot = move[0] * n[0] + move[1] * n[1];
        shift = [n[0] * dot, n[1] * dot];
      }

      // Use the new shared edge movement function
      moveSharedEdge(selected, idx, shift);

      draw();
      return;
    }
  });

  window.addEventListener("mouseup", () => {
    if (selected) {
      selected.selected_vertex = null;
      selected.selected_edge = null;
    }
    mouse.down = false;
    panning = false;
    draw();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      const { clientX, clientY } = e;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left,
        y = clientY - rect.top;
      const worldBefore = screenToWorld(x, y);
      const delta = -e.deltaY;
      const k = Math.exp(delta * 0.0012);
      view.scale = Math.min(300, Math.max(8, view.scale * k));
      const worldAfter = screenToWorld(x, y);
      view.x += worldBefore.x - worldAfter.x;
      view.y += worldBefore.y - worldAfter.y;
      e.preventDefault();
      draw();
    },
    { passive: false }
  );

  /*** Picking helpers ***/
  function nearestVertex(poly, p, tol = 0.4) {
    let best = -1,
      bestd = Infinity;
    for (let i = 0; i < poly.coords.length; i++) {
      const d = Math.hypot(p[0] - poly.coords[i][0], p[1] - poly.coords[i][1]);
      if (d < bestd) {
        bestd = d;
        best = i;
      }
    }
    return bestd < tol ? best : null;
  }

  function nearestEdge(poly, p) {
    const cs = poly.coords;
    if (!cs.length) return null;
    const lens = cs.map((_, i) => {
      const a = cs[i],
        b = cs[(i + 1) % cs.length];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    });
    const avg = lens.reduce((s, v) => s + v, 0) / Math.max(1, lens.length);
    const baseTol = 0.5 * Math.max(1.0, avg / 10.0);
    let best = -1,
      bestd = Infinity;
    for (let i = 0; i < cs.length; i++) {
      const d = distPtSeg(p, cs[i], cs[(i + 1) % cs.length]);
      if (d < bestd) {
        bestd = d;
        best = i;
      }
    }
    return bestd < baseTol ? best : null;
  }

  function findSharedEdges() {
    const sharedEdges = new Map(); // key: "x1,y1,x2,y2", value: array of polygons sharing this edge

    for (const poly of polygons) {
      if (poly.isColumn) continue;
      const coords = poly.coords;
      for (let i = 0; i < coords.length; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % coords.length];

        // Create normalized edge key (always store in consistent order)
        const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
          .map((v) => Math.round(v * 1000) / 1000) // Round to handle floating point issues
          .join(",");

        const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
          .map((v) => Math.round(v * 1000) / 1000)
          .join(",");

        if (!sharedEdges.has(edgeKey) && !sharedEdges.has(reverseKey)) {
          sharedEdges.set(edgeKey, [poly]);
        } else {
          const existingKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
          const polys = sharedEdges.get(existingKey);
          if (!polys.includes(poly)) {
            polys.push(poly);
          }
        }
      }
    }

    return sharedEdges;
  }

  function moveSharedEdge(movingPoly, edgeIdx, shift) {
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

    // === STEP 1: Calculate new potential positions ===
    let newA = [p1[0] + shift[0], p1[1] + shift[1]];
    let newB = [p2[0] + shift[0], p2[1] + shift[1]];

    // === STEP 2: Alignment snapping (parallel edge) ===
    if (alignEnabled) {
      const dir = [newB[0] - newA[0], newB[1] - newA[1]];
      const len = Math.hypot(dir[0], dir[1]);
      if (len > 1e-6) {
        const ux = dir[0] / len;
        const uy = dir[1] / len;
        const nx = -uy,
          ny = ux;
        const SNAP_DIST = 0.1;
        const ANGLE_TOL = 0.05;

        // Determine which polygons will move
        const movingPolys =
          moveSharedEdgesEnabled && sharedPolys && sharedPolys.length > 1
            ? sharedPolys
            : [movingPoly];

        for (const poly of polygons) {
          // Skip if this polygon will be moved or is fixed
          if (movingPolys.includes(poly) || poly.isColumn) continue;

          const cs = poly.coords;
          for (let i = 0; i < cs.length; i++) {
            const a = cs[i];
            const b = cs[(i + 1) % cs.length];
            const ab = [b[0] - a[0], b[1] - a[1]];
            const abLen = Math.hypot(ab[0], ab[1]);
            if (abLen < 1e-6) continue;
            const vx = ab[0] / abLen;
            const vy = ab[1] / abLen;
            const dot = ux * vx + uy * vy;
            if (Math.abs(Math.abs(dot) - 1) > ANGLE_TOL) continue;

            const distA = (newA[0] - a[0]) * nx + (newA[1] - a[1]) * ny;
            const distB = (newB[0] - a[0]) * nx + (newB[1] - a[1]) * ny;
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

    // === STEP 3: Check constraints for ALL affected polygons ===
    const polysToCheck =
      moveSharedEdgesEnabled && sharedPolys && sharedPolys.length > 1
        ? sharedPolys
        : [movingPoly];

    // Define these ONCE at the top level since they're based on the original edge
    const isHorizontal = Math.abs(p1[1] - p2[1]) < 0.05;
    const isVertical = Math.abs(p1[0] - p2[0]) < 0.05;

    // Check each polygon that will be affected by this move
    for (const polyToCheck of polysToCheck) {
      // Simulate updated polygon after move for THIS specific polygon
      const testCoords = polyToCheck.coords.map(([x, y]) => [x, y]);

      let foundEdgeIndex = -1;
      let isReversed = false;

      // Find and update the shared edge in this polygon's coordinates
      for (let i = 0; i < testCoords.length; i++) {
        const a = testCoords[i];
        const b = testCoords[(i + 1) % testCoords.length];

        // Check if edge matches in forward direction (p1->p2)
        const isForwardEdge =
          Math.abs(a[0] - p1[0]) < 0.01 &&
          Math.abs(a[1] - p1[1]) < 0.01 &&
          Math.abs(b[0] - p2[0]) < 0.01 &&
          Math.abs(b[1] - p2[1]) < 0.01;

        // Check if edge matches in reverse direction (p2->p1)
        const isReverseEdge =
          Math.abs(a[0] - p2[0]) < 0.01 &&
          Math.abs(a[1] - p2[1]) < 0.01 &&
          Math.abs(b[0] - p1[0]) < 0.01 &&
          Math.abs(b[1] - p1[1]) < 0.01;

        if (isForwardEdge || isReverseEdge) {
          foundEdgeIndex = i;
          isReversed = isReverseEdge;

          // Apply the movement in the correct order for this polygon
          if (isReversed) {
            testCoords[i] = newB; // p2 becomes newB
            testCoords[(i + 1) % testCoords.length] = newA; // p1 becomes newA
          } else {
            testCoords[i] = newA; // p1 becomes newA
            testCoords[(i + 1) % testCoords.length] = newB; // p2 becomes newB
          }
          break;
        }
      }

      const xs = testCoords.map(([x]) => x);
      const ys = testCoords.map(([_, y]) => y);
      const newWidth = Math.max(...xs) - Math.min(...xs);
      const newHeight = Math.max(...ys) - Math.min(...ys);

      const name = (polyToCheck.room.roomName || "").trim().toLowerCase();
      const constraint = roomConstraints[name];

      // === FIXED: Snap to minimum allowed for EACH polygon ===
      if (constraint && foundEdgeIndex !== -1) {
        const currCoords = polyToCheck.coords;
        const currXs = currCoords.map(([x]) => x);
        const currYs = currCoords.map(([_, y]) => y);
        const currW = Math.max(...currXs) - Math.min(...currXs);
        const currH = Math.max(...currYs) - Math.min(...currYs);

        // Horizontal edge (height restriction)
        if (
          isHorizontal &&
          constraint.min_height > 0 &&
          newHeight < constraint.min_height
        ) {
          const delta = constraint.min_height - currH;

          // Determine movement direction based on edge position relative to room center
          const centerY = (Math.min(...currYs) + Math.max(...currYs)) / 2;
          const edgeY = p1[1]; // since it's horizontal, both points have same Y

          if (edgeY > centerY) {
            // Top edge - move upward to increase height
            newA = [p1[0], p1[1] + delta];
            newB = [p2[0], p2[1] + delta];
          } else {
            // Bottom edge - move downward to increase height
            newA = [p1[0], p1[1] - delta];
            newB = [p2[0], p2[1] - delta];
          }
          toast(
            `↕️ '${polyToCheck.room.roomName}' snapped to min height (${constraint.min_height}m)`
          );

          // Update testCoords with corrected positions
          if (isReversed) {
            testCoords[foundEdgeIndex] = newB;
            testCoords[(foundEdgeIndex + 1) % testCoords.length] = newA;
          } else {
            testCoords[foundEdgeIndex] = newA;
            testCoords[(foundEdgeIndex + 1) % testCoords.length] = newB;
          }
        }

        // Vertical edge (width restriction)
        if (
          isVertical &&
          constraint.min_width > 0 &&
          newWidth < constraint.min_width
        ) {
          const delta = constraint.min_width - currW;

          // Determine movement direction based on edge position relative to room center
          const centerX = (Math.min(...currXs) + Math.max(...currXs)) / 2;
          const edgeX = p1[0]; // since it's vertical, both points have same X

          if (edgeX > centerX) {
            // Right edge - move rightward to increase width
            newA = [p1[0] + delta, p1[1]];
            newB = [p2[0] + delta, p2[1]];
          } else {
            // Left edge - move leftward to increase width
            newA = [p1[0] - delta, p1[1]];
            newB = [p2[0] - delta, p2[1]];
          }
          toast(
            `↔️ '${polyToCheck.room.roomName}' snapped to min width (${constraint.min_width}m)`
          );

          // Update testCoords with corrected positions
          if (isReversed) {
            testCoords[foundEdgeIndex] = newB;
            testCoords[(foundEdgeIndex + 1) % testCoords.length] = newA;
          } else {
            testCoords[foundEdgeIndex] = newA;
            testCoords[(foundEdgeIndex + 1) % testCoords.length] = newB;
          }
        }
      }

      // 🔸 Check ward boundary for EACH polygon
      if (wardPolys && wardPolys.length) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;

        for (const w of wardPolys) {
          for (const [x, y] of w.coords) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }

        // Check if new vertices stay inside for THIS polygon
        for (const [x, y] of testCoords) {
          if (
            x < minX - 0.001 ||
            x > maxX + 0.001 ||
            y < minY - 0.001 ||
            y > maxY + 0.001
          ) {
            toast(
              `🚫 '${polyToCheck.room.roomName}' cannot go outside ward boundary`
            );
            return;
          }
        }
      }
    }

    // === STEP 4: Apply shift if all checks passed ===
    if (!moveSharedEdgesEnabled || !sharedPolys || sharedPolys.length === 1) {
      movingCoords[edgeIdx] = newA;
      movingCoords[(edgeIdx + 1) % movingCoords.length] = newB;
      return;
    }

    // Apply move to all polygons sharing this edge with correct coordinate order
    for (const poly of sharedPolys) {
      const coords = poly.coords;
      for (let i = 0; i < coords.length; i++) {
        const a = coords[i];
        const b = coords[(i + 1) % coords.length];

        // Check if edge matches in forward direction (p1->p2)
        const isForwardEdge =
          Math.abs(a[0] - p1[0]) < 0.01 &&
          Math.abs(a[1] - p1[1]) < 0.01 &&
          Math.abs(b[0] - p2[0]) < 0.01 &&
          Math.abs(b[1] - p2[1]) < 0.01;

        // Check if edge matches in reverse direction (p2->p1)
        const isReverseEdge =
          Math.abs(a[0] - p2[0]) < 0.01 &&
          Math.abs(a[1] - p2[1]) < 0.01 &&
          Math.abs(b[0] - p1[0]) < 0.01 &&
          Math.abs(b[1] - p1[1]) < 0.01;

        if (isForwardEdge || isReverseEdge) {
          if (isReverseEdge) {
            // For reversed edges, swap newA and newB to maintain winding order
            coords[i] = newB;
            coords[(i + 1) % coords.length] = newA;
          } else {
            // For forward edges, use newA->newB order
            coords[i] = newA;
            coords[(i + 1) % coords.length] = newB;
          }
          break;
        }
      }
    }
  }

  //Helper for aligning a single moved vertex with nearby room edges/points.
  function alignPoint([x, y], current) {
    const SNAP_TOL = 0.3; // vertex snap
    const EDGE_TOL = 0.25; // distance tolerance for edge alignment
    const candidates = current.neighbors ? [...current.neighbors] : [];

    // Include neighbors-of-neighbors
    for (const n of [...candidates]) {
      if (n.neighbors) {
        for (const nn of n.neighbors) candidates.push(nn);
      }
    }

    // 🔸 Avoid aligning with self or columns
    for (const poly of new Set(candidates)) {
      if (poly === current || poly.isColumn) continue;

      // ✅ 1. SNAP TO NEARBY VERTICES (as before)
      for (const [vx, vy] of poly.coords) {
        if (Math.abs(vx - x) < SNAP_TOL) x = vx;
        if (Math.abs(vy - y) < SNAP_TOL) y = vy;
      }

      // ✅ 2. ALIGN TO NEARBY EDGES
      const cs = poly.coords;
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i];
        const b = cs[(i + 1) % cs.length];

        const ab = [b[0] - a[0], b[1] - a[1]];
        const len = Math.hypot(ab[0], ab[1]);
        if (len < 1e-6) continue;

        // Unit normal vector
        const nx = ab[1] / len;
        const ny = -ab[0] / len;

        // Signed distance from (x,y) to edge line
        const dist = (x - a[0]) * nx + (y - a[1]) * ny;

        // If within tolerance, project onto edge line
        if (Math.abs(dist) < EDGE_TOL) {
          x -= dist * nx;
          y -= dist * ny;
        }
      }
    }

    return [x, y];
  }

  /*** Rendering ***/
  function drawGrid() {
    if (!grid.show) return;
    const xlim = screenToWorld(0, 0).x;
    const xhi = screenToWorld(canvas.width / DPR, 0).x;
    const ylim = screenToWorld(0, 0).y;
    const yhi = screenToWorld(0, canvas.height / DPR).y;
    const step = Math.max(0.2, snapStep);
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

  function drawGrids() {
    if (!gridLines.length || !wardPolys.length) return;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(180,180,180,0.6)";
    ctx.setLineDash([4, 4]);

    ctx.beginPath();

    for (const g of gridLines) {
      const midX = (g.startPoint.X + g.endPoint.X) / 2;
      const midY = (g.startPoint.Y + g.endPoint.Y) / 2;
      const inside = wardPolys.some((w) =>
        pointInPoly({ x: midX, y: midY }, w)
      );

      // ✅ Only draw grid lines whose midpoint is inside ward boundary
      if (inside) {
        const s = worldToScreen(g.startPoint.X, g.startPoint.Y);
        const e = worldToScreen(g.endPoint.X, g.endPoint.Y);
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);
      }
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  function polygonArea(coords) {
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[(i + 1) % coords.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
  }

  function drawPolygon(poly, isSel) {
    // fill
    ctx.beginPath();
    poly.coords.forEach(([x, y], i) => {
      const s = worldToScreen(x, y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle =
      poly === selected
        ? "rgba(239,68,68,0.25)" // slightly stronger red for selected room
        : poly.color.replace("rgb", "rgba").replace(")", ",0.25)");
    ctx.fill();

    // outline (walls)
    ctx.lineWidth = isSel ? 3.5 : 2.5;
    ctx.strokeStyle = isSel ? "#ef4444" : poly.color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    if (poly.isFixed) {
      ctx.strokeStyle = "rgba(160,160,160,0.9)";
    }

    // vertices
    for (const [x, y] of poly.coords) {
      const s = worldToScreen(x, y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, TAU);
      ctx.fillStyle = "#cbd5e1";
      ctx.fill();
    }

    // draw edge lengths
    // draw edge lengths — skip if column
    if (showRoomLengths && !poly.isColumn) {
      for (let i = 0; i < poly.coords.length; i++) {
        const a = poly.coords[i];
        const b = poly.coords[(i + 1) % poly.coords.length];
        const length =
          Math.hypot(b[0] - a[0], b[1] - a[1]) * unitFactors[currentUnit];

        // midpoint
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

        // direction of edge
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const angle = Math.atan2(dy, dx);

        // inward offset
        const centroid =
          poly.centroid ||
          poly.coords.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
        centroid[0] /= poly.coords.length;
        centroid[1] /= poly.coords.length;

        const nx = -dy,
          ny = dx;
        const normLen = Math.hypot(nx, ny);
        const ux = nx / normLen,
          uy = ny / normLen;
        const toCentroidX = centroid[0] - mid[0];
        const toCentroidY = centroid[1] - mid[1];
        const dot = toCentroidX * ux + toCentroidY * uy;
        const inward = dot > 0 ? 1 : -1;

        const offset = 0.15;
        const labelPos = [
          mid[0] + ux * inward * offset,
          mid[1] + uy * inward * offset,
        ];
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

    // centroid label and area
    if (showRoomNames) {
      const c = centroid(poly);
      const sc = worldToScreen(c.x, c.y);
      const area_m2 = polygonArea(poly.coords);
      const area = area_m2 * unitFactors[currentUnit] ** 2;
      const areaText = `(${area.toFixed(2)} ${currentUnit}²)`;

      const displayName =
        poly.isColumn && poly.isFixed ? "" : poly.room.roomName || "N/A";

      ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = poly.isFixed
        ? "#a3a3a3"
        : isSel
        ? "#ef4444"
        : "#ffffffff";

      // ✅ NEW CONDITION
      // if (!poly.isColumn) {
      //   ctx.fillText(displayName, sc.x, sc.y);
      //   ctx.fillText(areaText, sc.x, sc.y + 12 * 1.2);
      // }

      if (!poly.isColumn) {
        ctx.fillText(displayName, sc.x, sc.y);
        ctx.fillText(areaText, sc.x, sc.y + 12 * 1.2);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
    drawGrid();
    drawGrids();

    // === Draw red bounding box around wardInfo ===
    if (wardPolys && wardPolys.length) {
      // compute overall ward boundary limits
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const w of wardPolys) {
        for (const [x, y] of w.coords) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      // convert to screen coords
      const sMin = worldToScreen(minX, minY);
      const sMax = worldToScreen(maxX, maxY);

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,0,0,0.9)";
      ctx.setLineDash([5, 3]); // optional dashed style
      ctx.strokeRect(sMin.x, sMax.y, sMax.x - sMin.x, sMin.y - sMax.y);
      ctx.restore();
    }

    // Draw non-selected rooms first
    for (const poly of polygons) {
      if (poly === selected) continue;

      drawPolygon(poly, false);
    }

    // Then draw the selected one on top (if any)
    if (selected) {
      drawPolygon(selected, true);
    }

    // Hover edge highlight on top of everything
    if (highlightEdge.poly && highlightEdge.idx != null) {
      const cs = highlightEdge.poly.coords;
      const i = highlightEdge.idx;
      const a = worldToScreen(cs[i][0], cs[i][1]);
      const b = worldToScreen(
        cs[(i + 1) % cs.length][0],
        cs[(i + 1) % cs.length][1]
      );
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(250,204,21,0.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // === DRAW CROSSHAIR LINES ===
    ctx.save();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.setLineDash([6, 4]);

    const mx = mouse.x;
    const my = mouse.y;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, canvas.height / DPR);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(canvas.width / DPR, my);
    ctx.stroke();

    ctx.restore();
  }

  function fitView() {
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

  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
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

  // Boot
  resizeCanvas();
  toast("Load your 0.json to start");
})();

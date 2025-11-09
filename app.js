
// app.js - modulelet
(() => {
  /*** Utility ***/
  const TAU = Math.PI * 2;
  const toast = (msg) => {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.style.opacity = 1;
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.style.opacity = 0.7), 1200);
  };

  // Basic centroid for simple polygon (non-self-intersecting)
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

  let data = { wardInfo: { coreRoomLayout: [] } };
  let polygons = [];
  let selected = null;
  let highlightEdge = { poly: null, idx: null };

  // Viewport
  let view = { x: 0, y: 0, scale: 1.0 };
  function worldToScreen(wx, wy) {
    return { x: (wx - view.x) * view.scale, y: (wy - view.y) * view.scale };
  }
  function screenToWorld(sx, sy) {
    return { x: sx / view.scale + view.x, y: sy / view.scale + view.y };
  }

  // Interactions
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
  let snapStep = 0.01;
  let undoStack = [];
  let addVertexMode = false;
  let showRoomNames = true;
  let showRoomLengths = true;
  let moveSharedEdgesEnabled = true;


  const grid = { show: true };
  const SNAP_TOL = 0.3;

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

  /*** Loading & Saving ***/
  // document.getElementById("loadFile").addEventListener("change", async (e) => {
  //   const f = e.target.files?.[0];
  //   if (!f) return;
  //   const text = await f.text();
  //   try {
  //     data = JSON.parse(text);
  //     // Combine all room arrays in wardInfo (e.g., coreRoomLayout, toiletLayout, etc.)
  //     const layouts = Object.values(data.wardInfo || {})
  //       .flat()
  //       .filter(Boolean);

  //     polygons = layouts
  //       .map((room) => {
  //         if (!room.vertices || !room.vertices.length) return null;
  //         const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
  //         const lineColor = randomColor();
  //         return {
  //           room,
  //           coords,
  //           color: lineColor,
  //           selected_vertex: null,
  //           selected_edge: null,
  //         };
  //       })
  //       .filter(Boolean);
  //     fitView();
  //     draw();
  //     toast("Loaded " + polygons.length + " rooms");
  //   } catch (err) {
  //     console.error(err);
  //     toast("❌ Invalid JSON");
  //   }
  // });

  function randomColor() {
    const h = Math.random();
    const s = 0.6,
      l = 0.55;
    const rgb = hslToRgb(h, s, l);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  // --- Precompute neighbors once ---
  function computeNeighbors() {
    for (const poly of polygons) poly.neighbors = new Set();

    const EPS = 0.1; // tolerance for shared vertices
    for (let i = 0; i < polygons.length; i++) {
      const a = polygons[i];
      for (let j = i + 1; j < polygons.length; j++) {
        const b = polygons[j];

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

  document.getElementById("loadFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();

    try {
      data = JSON.parse(text);

      // --- Collect all room arrays in wardInfo (any layout type) ---
      const layouts = Object.values(data.wardInfo || {})
        .flat()
        .filter((room) => room && room.vertices && room.vertices.length);

      // --- Maintain consistent colors per room name ---
      const colorMap = {};
      function getColorForRoom(name) {
        const key = name?.trim() || "Unnamed";
        if (!colorMap[key]) colorMap[key] = randomColor();
        return colorMap[key];
      }

      // --- Build polygons for all rooms ---
      polygons = layouts.map((room) => {
        const coords = room.vertices.map((v) => [Number(v.X), Number(v.Y)]);
        const lineColor = getColorForRoom(room.roomName);
        return {
          room,
          coords,
          color: lineColor,
          selected_vertex: null,
          selected_edge: null,
        };
      });

      fitView();
      computeNeighbors();
      draw();
      toast(`Loaded ${polygons.length} rooms from wardInfo`);
    } catch (err) {
      console.error("Error loading JSON:", err);
      toast("❌ Invalid or malformed JSON");
    }
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

  document.getElementById("showLengthsToggle").addEventListener("change", (e) => {
    showRoomLengths = e.target.checked;
    draw();
  });

  document.getElementById("sharedEdgeToggle").addEventListener("change", (e) => {
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

  let currentUnit = "m";
  const unitFactors = { m: 1, cm: 100, mm: 1000, ft: 3.28084 };

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
    }

    else if (e.key === "c" || e.key === "C") {
      if (!selected) {
        toast("⚠️ Select a room first");
        return;
      }
      addVertexMode = true;
      canvas.style.cursor = "crosshair";
      toast("✂️ Add Vertex Mode: click on an edge to insert");
    }

    else if (e.key === "Escape") {
      if (addVertexMode) {
        addVertexMode = false;
        canvas.style.cursor = "default";
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

    // --- ADD VERTEX MODE HANDLER ---
    if (addVertexMode && selected && e.button === 0) {
      const wx = mouse.wx;
      const wy = mouse.wy;

      // Find nearest edge to mouse
      const edgeIdx = nearestEdge(selected, [wx, wy]);
      if (edgeIdx == null) {
        toast("⚠️ Click closer to an edge");
        return;
      }

      // Compute the projected point on that edge
      const a = selected.coords[edgeIdx];
      const b = selected.coords[(edgeIdx + 1) % selected.coords.length];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const ap = [wx - a[0], wy - a[1]];
      const len2 = ab[0] ** 2 + ab[1] ** 2;
      let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
      t = Math.max(0.001, Math.min(0.999, t));

      let newPt = [a[0] + ab[0] * t, a[1] + ab[1] * t];

      // --- SNAP to nearby vertex/edge ---
      const SNAP_TOL = 0.15;
      for (const poly of polygons) {
        for (const [vx, vy] of poly.coords) {
          if (Math.abs(vx - newPt[0]) < SNAP_TOL) newPt[0] = vx;
          if (Math.abs(vy - newPt[1]) < SNAP_TOL) newPt[1] = vy;
        }
      }

      // ✅ Save state before modifying
      pushState();

      // Insert vertex into that edge
      selected.coords.splice(edgeIdx + 1, 0, newPt);

      toast("✅ Vertex added successfully");

      // Exit mode
      addVertexMode = false;
      canvas.style.cursor = "default";
      draw();
      return; // <- Important: prevent normal selection logic from running
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

    // if (addVertexMode && selected) {
    //   const { wx, wy } = mouse;
    //   const edgeIdx = nearestEdge(selected, [wx, wy]);
    //   if (edgeIdx == null) {
    //     toast("⚠️ Click closer to an edge");
    //     return;
    //   }

    //   // Compute projection of click point on that edge
    //   const a = selected.coords[edgeIdx];
    //   const b = selected.coords[(edgeIdx + 1) % selected.coords.length];
    //   const ab = [b[0] - a[0], b[1] - a[1]];
    //   const ap = [wx - a[0], wy - a[1]];
    //   const len2 = ab[0] ** 2 + ab[1] ** 2;
    //   let t = (ap[0] * ab[0] + ap[1] * ab[1]) / len2;
    //   t = Math.max(0.001, Math.min(0.999, t));
    //   let newPt = [a[0] + ab[0] * t, a[1] + ab[1] * t];

    //   // --- snap to existing vertices nearby ---
    //   const SNAP_TOL = 0.2;
    //   for (const poly of polygons) {
    //     for (const [vx, vy] of poly.coords) {
    //       if (Math.abs(vx - newPt[0]) < SNAP_TOL) newPt[0] = vx;
    //       if (Math.abs(vy - newPt[1]) < SNAP_TOL) newPt[1] = vy;
    //     }
    //   }

    //   // Insert the vertex into that edge
    //   selected.coords.splice(edgeIdx + 1, 0, newPt);
    //   toast("✅ Vertex added");

    //   addVertexMode = false;
    //   canvas.style.cursor = "default";
    //   draw();
    //   return;
    // }



    const poly = polygons.find((p) => pointInPoly({ x: w.x, y: w.y }, p));
    if (poly) {
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

      // Optionally also include their neighbors-of-neighbors
      for (const n of [...candidates]) {
        if (n.neighbors) {
          for (const nn of n.neighbors) candidates.push(nn);
        }
      }

      for (const poly of new Set(candidates)) {
        if (poly === current) continue;
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

    // Replace the edge movement section in mousemove event with this:
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
      view.scale = Math.min(300, Math.max(0.02, view.scale * k));
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

  // Add this function to detect shared edges between polygons
  function findSharedEdges() {
    const sharedEdges = new Map(); // key: "x1,y1,x2,y2", value: array of polygons sharing this edge

    for (const poly of polygons) {
      const coords = poly.coords;
      for (let i = 0; i < coords.length; i++) {
        const p1 = coords[i];
        const p2 = coords[(i + 1) % coords.length];

        // Create normalized edge key (always store in consistent order)
        const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
          .map(v => Math.round(v * 1000) / 1000) // Round to handle floating point issues
          .join(',');

        const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
          .map(v => Math.round(v * 1000) / 1000)
          .join(',');

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

  // Update the edge movement code to move all shared edges
  // function moveSharedEdge(movingPoly, edgeIdx, shift) {
  //   const sharedEdges = findSharedEdges();
  //   const movingCoords = movingPoly.coords;
  //   const p1 = movingCoords[edgeIdx];
  //   const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

  //   // Find the edge key for the moving edge
  //   const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
  //     .map(v => Math.round(v * 1000) / 1000)
  //     .join(',');

  //   const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
  //     .map(v => Math.round(v * 1000) / 1000)
  //     .join(',');

  //   const sharedKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
  //   const sharedPolys = sharedEdges.get(sharedKey) || [movingPoly];

  //   // Move this edge in all polygons that share it
  //   for (const poly of sharedPolys) {
  //     const coords = poly.coords;
  //     for (let i = 0; i < coords.length; i++) {
  //       const a = coords[i];
  //       const b = coords[(i + 1) % coords.length];

  //       // Check if this is the same edge (in either direction)
  //       const isSameEdge =
  //         (Math.abs(a[0] - p1[0]) < 0.01 && Math.abs(a[1] - p1[1]) < 0.01 &&
  //           Math.abs(b[0] - p2[0]) < 0.01 && Math.abs(b[1] - p2[1]) < 0.01) ||
  //         (Math.abs(a[0] - p2[0]) < 0.01 && Math.abs(a[1] - p2[1]) < 0.01 &&
  //           Math.abs(b[0] - p1[0]) < 0.01 && Math.abs(b[1] - p1[1]) < 0.01);

  //       if (isSameEdge) {
  //         coords[i] = [a[0] + shift[0], a[1] + shift[1]];
  //         coords[(i + 1) % coords.length] = [b[0] + shift[0], b[1] + shift[1]];
  //         break;
  //       }
  //     }
  //   }
  // }

  // function moveSharedEdge(movingPoly, edgeIdx, shift) {
  //   const sharedEdges = findSharedEdges();
  //   const movingCoords = movingPoly.coords;
  //   const p1 = movingCoords[edgeIdx];
  //   const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

  //   const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
  //     .map(v => Math.round(v * 1000) / 1000)
  //     .join(',');

  //   const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
  //     .map(v => Math.round(v * 1000) / 1000)
  //     .join(',');

  //   const sharedKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
  //   const sharedPolys = sharedEdges.get(sharedKey);

  //   // If no shared edge, move only current polygon and then try to align
  //   if (!sharedPolys || sharedPolys.length === 1) {
  //     const coords = movingPoly.coords;
  //     const a = coords[edgeIdx];
  //     const b = coords[(edgeIdx + 1) % coords.length];
  //     let newA = [a[0] + shift[0], a[1] + shift[1]];
  //     let newB = [b[0] + shift[0], b[1] + shift[1]];

  //     // Apply align logic to both points
  //     if (alignEnabled) {
  //       newA = alignPoint(newA, movingPoly);
  //       newB = alignPoint(newB, movingPoly);
  //     }

  //     coords[edgeIdx] = newA;
  //     coords[(edgeIdx + 1) % coords.length] = newB;
  //     return;
  //   }

  //   // Otherwise, move shared edge in all connected polygons
  //   for (const poly of sharedPolys) {
  //     const coords = poly.coords;
  //     for (let i = 0; i < coords.length; i++) {
  //       const a = coords[i];
  //       const b = coords[(i + 1) % coords.length];

  //       const isSameEdge =
  //         (Math.abs(a[0] - p1[0]) < 0.01 && Math.abs(a[1] - p1[1]) < 0.01 &&
  //           Math.abs(b[0] - p2[0]) < 0.01 && Math.abs(b[1] - p2[1]) < 0.01) ||
  //         (Math.abs(a[0] - p2[0]) < 0.01 && Math.abs(a[1] - p2[1]) < 0.01 &&
  //           Math.abs(b[0] - p1[0]) < 0.01 && Math.abs(b[1] - p1[1]) < 0.01);

  //       if (isSameEdge) {
  //         coords[i] = [a[0] + shift[0], a[1] + shift[1]];
  //         coords[(i + 1) % coords.length] = [b[0] + shift[0], b[1] + shift[1]];
  //         break;
  //       }
  //     }
  //   }
  // }

  function moveSharedEdge(movingPoly, edgeIdx, shift) {
    const sharedEdges = findSharedEdges();
    const movingCoords = movingPoly.coords;
    const p1 = movingCoords[edgeIdx];
    const p2 = movingCoords[(edgeIdx + 1) % movingCoords.length];

    const edgeKey = [p1[0], p1[1], p2[0], p2[1]]
      .map(v => Math.round(v * 1000) / 1000)
      .join(',');

    const reverseKey = [p2[0], p2[1], p1[0], p1[1]]
      .map(v => Math.round(v * 1000) / 1000)
      .join(',');

    const sharedKey = sharedEdges.has(edgeKey) ? edgeKey : reverseKey;
    const sharedPolys = sharedEdges.get(sharedKey);

    // ✅ When toggle is OFF, move only selected polygon’s edge
    if (!moveSharedEdgesEnabled || !sharedPolys || sharedPolys.length === 1) {
      const coords = movingPoly.coords;
      const a = coords[edgeIdx];
      const b = coords[(edgeIdx + 1) % coords.length];
      let newA = [a[0] + shift[0], a[1] + shift[1]];
      let newB = [b[0] + shift[0], b[1] + shift[1]];

      // Optional alignment snap
      if (alignEnabled) {
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
          (Math.abs(a[0] - p1[0]) < 0.01 && Math.abs(a[1] - p1[1]) < 0.01 &&
            Math.abs(b[0] - p2[0]) < 0.01 && Math.abs(b[1] - p2[1]) < 0.01) ||
          (Math.abs(a[0] - p2[0]) < 0.01 && Math.abs(a[1] - p2[1]) < 0.01 &&
            Math.abs(b[0] - p1[0]) < 0.01 && Math.abs(b[1] - p1[1]) < 0.01);

        if (isSameEdge) {
          coords[i] = [a[0] + shift[0], a[1] + shift[1]];
          coords[(i + 1) % coords.length] = [b[0] + shift[0], b[1] + shift[1]];
          break;
        }
      }
    }
  }


  /**
   * Helper for aligning a single moved vertex with nearby room edges/points.
   */
  function alignPoint([x, y], current) {
    const candidates = current.neighbors ? [...current.neighbors] : [];
    for (const n of [...candidates]) {
      if (n.neighbors) {
        for (const nn of n.neighbors) candidates.push(nn);
      }
    }

    for (const poly of new Set(candidates)) {
      if (poly === current) continue;
      for (const [vx, vy] of poly.coords) {
        if (Math.abs(vx - x) < 0.3) x = vx; // SNAP_TOL
        if (Math.abs(vy - y) < 0.3) y = vy;
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

  // function draw() {
  //   ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
  //   drawGrid();

  //   for (const poly of polygons) {
  //     const isSel = poly === selected;

  //     // fill
  //     ctx.beginPath();
  //     poly.coords.forEach(([x, y], i) => {
  //       const s = worldToScreen(x, y);
  //       if (i === 0) ctx.moveTo(s.x, s.y);
  //       else ctx.lineTo(s.x, s.y);
  //     });
  //     ctx.closePath();
  //     ctx.fillStyle = "rgba(56,189,248,0.08)";
  //     ctx.fill();

  //     // outline
  //     // outline (walls)
  //     ctx.lineWidth = isSel ? 3.5 : 2.5;
  //     ctx.strokeStyle = isSel ? "#ef4444" : poly.color;
  //     ctx.lineJoin = "round";
  //     ctx.lineCap = "round";
  //     ctx.stroke();

  //     // vertices
  //     for (const [x, y] of poly.coords) {
  //       const s = worldToScreen(x, y);
  //       ctx.beginPath();
  //       ctx.arc(s.x, s.y, 3, 0, TAU);
  //       ctx.fillStyle = "#cbd5e1";
  //       ctx.fill();
  //     }

  //     // centroid label
  //     const c = centroid(poly);
  //     const sc = worldToScreen(c.x, c.y);
  //     ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system";
  //     ctx.textAlign = "center";
  //     ctx.textBaseline = "middle";
  //     ctx.fillStyle = isSel ? "#ef4444" : "#1e40af";
  //     ctx.fillText(poly.room.roomName || "Room", sc.x, sc.y);
  //   }

  //   // hover edge highlight
  //   if (highlightEdge.poly && highlightEdge.idx != null) {
  //     const cs = highlightEdge.poly.coords;
  //     const i = highlightEdge.idx;
  //     const a = worldToScreen(cs[i][0], cs[i][1]);
  //     const b = worldToScreen(
  //       cs[(i + 1) % cs.length][0],
  //       cs[(i + 1) % cs.length][1]
  //     );
  //     ctx.beginPath();
  //     ctx.moveTo(a.x, a.y);
  //     ctx.lineTo(b.x, b.y);
  //     ctx.strokeStyle = "rgba(250,204,21,0.9)";
  //     ctx.lineWidth = 3;
  //     ctx.stroke();
  //   }
  // }

  function polygonArea(coords) {
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[(i + 1) % coords.length];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
  }


  // Helper to draw one polygon
  function drawPolygon(poly, isSel) {
    // fill
    // fill with semi-transparent room color
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

    // vertices
    for (const [x, y] of poly.coords) {
      const s = worldToScreen(x, y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, TAU);
      ctx.fillStyle = "#cbd5e1";
      ctx.fill();
    }

    // // draw edge lengths
    // if (showRoomLengths) {
    //   for (let i = 0; i < poly.coords.length; i++) {
    //     const a = poly.coords[i];
    //     const b = poly.coords[(i + 1) % poly.coords.length];
    //     const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * unitFactors[currentUnit];
    //     const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    //     const sm = worldToScreen(mid[0], mid[1]);
    //     ctx.font = "bold 11px ui-sans-serif, system-ui, -apple-system";
    //     ctx.fillStyle = "#ffffffff";
    //     ctx.textAlign = "center";
    //     ctx.textBaseline = "middle";
    //     ctx.fillText(length.toFixed(2) + " " + currentUnit, sm.x, sm.y);
    //   }
    // }

    // draw edge lengths
    if (showRoomLengths) {
      for (let i = 0; i < poly.coords.length; i++) {
        const a = poly.coords[i];
        const b = poly.coords[(i + 1) % poly.coords.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * unitFactors[currentUnit];

        // midpoint
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

        // direction of edge
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const angle = Math.atan2(dy, dx);

        // --- find inward offset ---
        const centroid = poly.centroid || poly.coords.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
        centroid[0] /= poly.coords.length;
        centroid[1] /= poly.coords.length;

        // edge normal vector
        const nx = -dy;
        const ny = dx;
        const normLen = Math.hypot(nx, ny);
        const ux = nx / normLen;
        const uy = ny / normLen;

        // direction from edge to centroid
        const toCentroidX = centroid[0] - mid[0];
        const toCentroidY = centroid[1] - mid[1];
        const dot = toCentroidX * ux + toCentroidY * uy;
        const inward = dot > 0 ? 1 : -1;

        // offset text slightly inward (in world units)
        const offset = 0.15; // tweak for more/less inward spacing
        const labelPos = [
          mid[0] + ux * inward * offset,
          mid[1] + uy * inward * offset,
        ];

        // convert to screen coordinates
        const sm = worldToScreen(labelPos[0], labelPos[1]);

        // --- ensure text is upright ---
        let fixedAngle = angle;
        if (fixedAngle > Math.PI / 2 || fixedAngle < -Math.PI / 2) {
          fixedAngle += Math.PI;
        }

        // --- draw rotated text ---
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

      ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isSel ? "#ef4444" : "#ffffffff";
      ctx.fillText(poly.room.roomName || "Room", sc.x, sc.y);
      ctx.fillText(areaText, sc.x, sc.y + 12 * 1.2);
    }

  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
    drawGrid();

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

  function randomColor() {
    const h = Math.random();
    const s = 0.6,
      l = 0.55;
    const rgb = hslToRgb(h, s, l);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
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

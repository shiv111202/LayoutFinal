// core/main.js
import { initCanvas, resizeCanvas, fitView, draw } from "./render.js";
import { setupInteractions } from "./interactions.js";
import { loadJSON, saveJSON, toast, setupToggles } from "./state.js";

import { linkRender } from "./state.js";
import * as renderFns from "./render.js";
linkRender(renderFns);


export function initApp() {
  const canvas = document.getElementById("c");

  // initialize canvas rendering
  initCanvas(canvas);
  resizeCanvas();
  toast("📂 Load your 0.json to start");

  // --- File Controls ---
  document.getElementById("loadFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await loadJSON(text);
  });

  document.getElementById("saveBtn").addEventListener("click", saveJSON);

  document.getElementById("resetViewBtn").addEventListener("click", () => {
    fitView();
    draw();
  });

  // --- Sidebar toggles setup ---
  setupToggles();

  // --- Canvas Interactions ---
  setupInteractions(canvas);

  // --- Handle resizing ---
  new ResizeObserver(resizeCanvas).observe(document.getElementById("canvasWrap"));
}

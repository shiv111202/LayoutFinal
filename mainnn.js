// ------------------------------
// main.js — Application entry point
// ------------------------------

import { resizeCanvas, canvas } from "./core/state.js";
import { draw, fitView } from "./core/render.js";
import { toast } from "./core/utils.js";
import "./core/controls.js"; // sets up all event listeners automatically

// ✅ Initial setup
function initApp() {
  // Observe canvas container resize
  const wrap = document.getElementById("canvasWrap");
  if (wrap) {
    new ResizeObserver(() => resizeCanvas(draw)).observe(wrap);
  } else {
    console.warn("⚠️ canvasWrap not found in DOM");
  }

  // Initial fit and draw
  fitView();
  draw(4);

  // Startup message
  toast("📂 Load your JSON layout file to begin");
}

// ✅ Boot
window.addEventListener("DOMContentLoaded", initApp);

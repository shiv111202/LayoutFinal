// app.js — entry point: wires up UI controls and boots the application

import { toast } from "./utils.js";
import { state } from "./state.js";
import { draw, fitView, resizeCanvas } from "./renderer.js";
import { saveJSON } from "./loader.js";

// Side-effect import — registers mouse/keyboard event listeners
import "./interaction.js";

// ── Canvas auto-resize ────────────────────────────────────────────────────────
new ResizeObserver(resizeCanvas).observe(document.getElementById("canvasWrap"));

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", saveJSON);

document.getElementById("resetViewBtn").addEventListener("click", () => {
  fitView();
  draw();
});

document.getElementById("addVertexBtn").addEventListener("click", () => {
  if (!state.selected) {
    toast("⚠️ Select a room first");
    return;
  }
  state.addVertexMode = true;
  document.getElementById("c").style.cursor = "crosshair";
  toast("✂️ Add Vertex Mode: click on an edge to insert");
});

document.getElementById("swapRoomsBtn").addEventListener("click", () => {
  if (!state.selected) {
    toast("⚠️ Select a room first");
    return;
  }
  state.swapMode = true;
  state.swapSource = state.selected;
  toast("🔀 Swap Mode: click another room to swap names (click again to cancel)");
});

// ── Toggle controls ───────────────────────────────────────────────────────────
document.getElementById("showNamesToggle").addEventListener("change", (e) => {
  state.showRoomNames = e.target.checked;
  draw();
});

document.getElementById("showLengthsToggle").addEventListener("change", (e) => {
  state.showRoomLengths = e.target.checked;
  draw();
});

document.getElementById("sharedEdgeToggle").addEventListener("change", (e) => {
  state.moveSharedEdgesEnabled = e.target.checked;
  toast(`Shared Edge Movement: ${state.moveSharedEdgesEnabled ? "ON" : "OFF"}`);
});

document.getElementById("gridToggle").addEventListener("change", (e) => {
  state.grid.show = e.target.checked;
  draw();
});

document.getElementById("alignToggle").addEventListener("change", (e) => {
  state.alignEnabled = e.target.checked;
});

document.getElementById("snapStep").addEventListener("input", (e) => {
  state.snapStep = Number(e.target.value) || 1;
  draw();
});

document.getElementById("unitSelect").addEventListener("change", (e) => {
  state.currentUnit = e.target.value;
  toast(`Unit: ${state.currentUnit}`);
  draw();
});

document.getElementById("languageSelect").addEventListener("change", (e) => {
  state.currentLanguage = e.target.value;
  toast(`Language: ${e.target.value === "jpn" ? "Japanese" : "English"}`);
  draw();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
resizeCanvas();
toast("Load your 0.json to start");
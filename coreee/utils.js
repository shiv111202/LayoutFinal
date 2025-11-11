// ------------------------------
// utils.js — Common helper utilities
// ------------------------------

// Toast notification (simple fade-out)
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return console.warn("⚠️ toast element missing in DOM");
  t.textContent = msg;
  t.style.opacity = 1;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.opacity = 0.7), 1200);
}

// Generate random HSL-based color (pastel-ish)
export function randomColor() {
  const h = Math.random();
  const s = 0.6;
  const l = 0.55;
  const rgb = hslToRgb(h, s, l);
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// Convert HSL to RGB (helper used by randomColor)
export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
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

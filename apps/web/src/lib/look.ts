/**
 * The site look: «Сигнал» (`data-look="c"`, set in the root layout) with every
 * figure typed in mono (`data-figs="mono"`). Entity colours on black; canvas
 * inks are mapped into the same palette here.
 */

export type Look = "c";

/** Canvas and theme-color under the look. */
export const LOOK_BG = "#0e0e0e";

export function currentLook(): Look | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset.look === "c" ? "c" : null;
}

type Family = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "violet" | "grey";

/** Canvas inks by hue family of the source colour. */
const FAMILY: Record<Family, string> = {
  red: "#ff4f5e",
  orange: "#ff6a2b",
  yellow: "#ffd23c",
  green: "#2fd27f",
  teal: "#1ec8d8",
  blue: "#4f86ff",
  violet: "#ff7ab8",
  grey: "#8a8a8a",
};

function rgbOf(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function familyOf(rgb: [number, number, number]): Family {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return "grey";
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 18 || h >= 330) return "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 165) return "green";
  if (h < 196) return "teal";
  if (h < 245) return "blue";
  return "violet";
}

const memo = new Map<string, string>();

/** Map a canvas ink into the look's palette. No look on the page: unchanged. */
export function lookInk(color: string): string {
  if (!currentLook() || !color) return color;
  const hit = memo.get(color);
  if (hit) return hit;
  const rgb = rgbOf(color);
  const out = rgb ? FAMILY[familyOf(rgb)] : color;
  memo.set(color, out);
  return out;
}

/** Edge stroke for drawn crates and balls. Null keeps the component's own. */
export function lookEdge(): string | null {
  return currentLook() ? "#0e0e0e" : null;
}

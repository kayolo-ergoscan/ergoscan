/**
 * Design-direction preview (`?look=a|b|c`, `?look=off`). Concepts only: the
 * page structure stays, the visual language changes. Each look pins its ink
 * (A is paper, B and C are dark) and maps canvas inks into its own palette.
 */

import type { SkinInk } from "./skin-ink";

export const LOOKS = ["a", "b", "c"] as const;
export type Look = (typeof LOOKS)[number];

export const LOOK_STORAGE = "ergoscan.look";

/** A — Ledger (paper). B — Blueprint (cyanotype). C — Signal (entity colours on black). */
export const LOOK_INK: Record<Look, SkinInk> = { a: "day", b: "oled", c: "oled" };
export const LOOK_BG: Record<Look, string> = { a: "#efebe2", b: "#174a9c", c: "#0e0e0e" };

export function parseLook(v: string | null | undefined): Look | null {
  return v === "a" || v === "b" || v === "c" ? v : null;
}

export function currentLook(): Look | null {
  if (typeof document === "undefined") return null;
  return parseLook(document.documentElement.dataset.look);
}

/** Inline head script, after the ink boot. */
export const LOOK_BOOT = `(function(){try{var q=new URLSearchParams(location.search).get("look");if(q==="off"){localStorage.removeItem("${LOOK_STORAGE}");return;}var v=q||localStorage.getItem("${LOOK_STORAGE}");if(v!=="a"&&v!=="b"&&v!=="c")return;if(q)localStorage.setItem("${LOOK_STORAGE}",v);var r=document.documentElement;var ink=${JSON.stringify(LOOK_INK)}[v];r.setAttribute("data-look",v);r.setAttribute("data-ink",ink);r.classList.toggle("dark",ink!=="day");r.style.colorScheme=ink==="day"?"light":"dark";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(LOOK_BG)}[v]);}catch(e){}})();`;

type Family = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "violet" | "grey";

/** Canvas inks per look, by hue family of the source colour. */
const FAMILY: Record<Look, Record<Family, string>> = {
  a: {
    red: "#e0402a",
    orange: "#ee8a1a",
    yellow: "#f2c200",
    green: "#1d9a5b",
    teal: "#0f8f8a",
    blue: "#6fa8ef",
    violet: "#2152d9",
    grey: "#2a2721",
  },
  b: {
    red: "#ff9d8c",
    orange: "#ffb45e",
    yellow: "#ffe066",
    green: "#93f0c1",
    teal: "#86e8e2",
    blue: "#c4e2ff",
    violet: "#ffffff",
    grey: "#a7bde3",
  },
  c: {
    red: "#ff4f5e",
    orange: "#ff6a2b",
    yellow: "#ffd23c",
    green: "#2fd27f",
    teal: "#1ec8d8",
    blue: "#4f86ff",
    violet: "#ff7ab8",
    grey: "#8a8a8a",
  },
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

/** Map a canvas ink into the active look's palette. No look: unchanged. */
export function lookInk(color: string): string {
  const look = currentLook();
  if (!look || !color) return color;
  const key = `${look}|${color}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const rgb = rgbOf(color);
  const out = rgb ? FAMILY[look][familyOf(rgb)] : color;
  memo.set(key, out);
  return out;
}

/** Edge stroke for drawn crates and balls. Null keeps the component's own. */
export function lookEdge(): string | null {
  const look = currentLook();
  if (look === "a") return "rgba(21,19,14,0.88)";
  if (look === "b") return "rgba(255,255,255,0.95)";
  if (look === "c") return "#0e0e0e";
  return null;
}

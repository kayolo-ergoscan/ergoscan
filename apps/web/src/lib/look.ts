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

/**
 * Canvas inks by hue family of the source colour: the look's mark tier (looks.css --c-*),
 * one lightness band (OKLCH L 0.73–0.85, C ≤ 0.13) so crates, balls and chart lines stay
 * apart by hue without glowing on the black panel.
 */
const FAMILY: Record<Family, string> = {
  red: "#f4918e", // --down
  orange: "#ef945f", // --c-tx
  yellow: "#ebcb71", // --c-block
  green: "#71d29d", // --c-box
  teal: "#63ccde", // --c-net
  blue: "#86a6f0", // --c-token
  violet: "#e799b7", // --c-addr: contracts are addresses in this look
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

/**
 * How a pixel scene sits on a light ink (`--scene` of the ink, light.css): «day» paints it in
 * daylight on the card, «window» keeps the card dark (a window onto the night), «dusk» keeps the
 * night town under a dusk sky. On the dark inks it is «night».
 */
export type SceneMode = "night" | "day" | "window" | "dusk";

export function sceneMode(): SceneMode {
  if (typeof document === "undefined") return "night";
  const root = document.documentElement;
  const ink = root.dataset.ink ?? "";
  if (!ink.startsWith("light-")) return ink === "day" ? "day" : "night";
  const v = getComputedStyle(root).getPropertyValue("--scene").trim();
  return v === "day" || v === "window" || v === "dusk" ? v : "day";
}

/** The ground a scene paints on: its inks come from the dark family unless the scene is in daylight. */
export function sceneGround(): "light" | "dark" {
  return sceneMode() === "day" ? "light" : "dark";
}

let ground: "light" | "dark" | null = null;

/** Paint `fn` on a given ground (a scene card), whatever the page ink is. Synchronous draws only. */
export function onGround<T>(g: "light" | "dark", fn: () => T): T {
  const prev = ground;
  ground = g;
  try {
    return fn();
  } finally {
    ground = prev;
  }
}

function lightGround(): boolean {
  if (ground) return ground === "light";
  if (typeof document === "undefined") return false;
  return (document.documentElement.dataset.ink ?? "").startsWith("light-");
}

const memo = new Map<string, string>();
const memoLight = new Map<string, string>();
let lightFamily: { ink: string; fam: Record<Family, string>; edge: string } | null = null;

/** The light ink's canvas families (`--lk-*` in light.css, the mark tier on the card). */
function lightInks(): { fam: Record<Family, string>; edge: string } {
  const ink = document.documentElement.dataset.ink ?? "";
  if (lightFamily?.ink === ink) return lightFamily;
  const cs = getComputedStyle(document.documentElement);
  const fam = {} as Record<Family, string>;
  for (const k of Object.keys(FAMILY) as Family[]) fam[k] = cs.getPropertyValue(`--lk-${k}`).trim() || FAMILY[k];
  lightFamily = { ink, fam, edge: cs.getPropertyValue("--lk-edge").trim() || "#f2efe9" };
  memoLight.clear();
  return lightFamily;
}

/** Map a canvas ink into the look's palette. No look on the page: unchanged. */
export function lookInk(color: string): string {
  if (!currentLook() || !color) return color;
  if (lightGround()) {
    const { fam } = lightInks();
    const lit = memoLight.get(color);
    if (lit) return lit;
    const rgb = rgbOf(color);
    const out = rgb ? fam[familyOf(rgb)] : color;
    memoLight.set(color, out);
    return out;
  }
  const hit = memo.get(color);
  if (hit) return hit;
  const rgb = rgbOf(color);
  const out = rgb ? FAMILY[familyOf(rgb)] : color;
  memo.set(color, out);
  return out;
}

/** Edge stroke for drawn crates and balls. Null keeps the component's own. */
export function lookEdge(): string | null {
  if (!currentLook()) return null;
  return lightGround() ? lightInks().edge : "#0e0e0e";
}

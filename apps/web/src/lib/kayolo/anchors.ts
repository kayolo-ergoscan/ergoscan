/**
 * Header anchors for Э1b (design/brand/kayolo-life.md §3.1, §6.1, §9.5). Numbers come from rects,
 * never constants; rects are read on arrival, on resize and when an act starts, never per frame.
 */

import { SCOUT_CUES_EN, SCOUT_CUES_RU } from "@/lib/header-scout";
import type { Home } from "./memory";
import { NOOK_GAP, NOOK_HALF } from "./thresholds";

export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Centre x of his body at home, in the same coordinates as the boxes. «r» (the niche, default):
 * right edge of the title + 14 + 11, face −1. «l»: left of the title, face +1. «p»: by the price
 * label, face −1. Null without the box it needs.
 */
export function nookX(home: Home, title: Box | null, priceLabel: Box | null): { x: number; face: 1 | -1 } | null {
  if (home === "p" && priceLabel) return { x: priceLabel.left - 27, face: -1 };
  if (!title) return null;
  if (home === "l") return { x: title.left - NOOK_GAP - NOOK_HALF, face: 1 };
  return { x: title.right + NOOK_GAP + NOOK_HALF, face: -1 };
}

/** Page kinds for the block matrix (§8.3): blocks, dense, neutral. */
export type PageKind = "b" | "d" | "n";

export function pageKind(path: string): PageKind {
  const p = path.split("?")[0];
  if (p === "/" || /^\/(blocks|block|mempool|fees|transactions)(\/|$)/.test(p)) return "b";
  if (/^\/(tx|address|box|token|rent|status|learn)(\/|$)/.test(p)) return "d";
  return "n";
}

/** Width of the longest search cue in the search font (the phone park sits past it). */
let cueFont = "";
let cueWidth = 0;

export function cueWidthFor(font: string): number {
  if (font === cueFont) return cueWidth;
  const meas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!meas) return 0;
  meas.font = font;
  cueFont = font;
  cueWidth = 0;
  for (const word of [...SCOUT_CUES_EN, ...SCOUT_CUES_RU]) cueWidth = Math.max(cueWidth, meas.measureText(word).width);
  return cueWidth;
}

/** Screen-space gaze from his body toward a point (§2.6). */
export function gazeTo(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const c = (n: number) => Math.max(-1, Math.min(1, n));
  return { x: c((to.x - from.x) / 400), y: c((to.y - from.y) / 300) };
}

/**
 * Where «the tip» is for a glance (§9.5 fallbacks): the Blocks row of the rail on the desktop, the
 * Blocks cell of the tab bar on the phone; else a look down toward the page.
 */
export function tipPoint(): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  for (const sel of ['.nav-rail a[href="/blocks"]', 'nav a[href="/blocks"]']) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < window.innerHeight) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
}

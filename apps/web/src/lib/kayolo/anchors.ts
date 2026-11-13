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

/* ---------------- header rects (read at rest, never per frame) ---------------- */

function visible(el: Element | null | undefined): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width >= 2 && r.height >= 2 ? r : null;
}

/** The site header (the sticky bar on both layouts). */
export function headerEl(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector<HTMLElement>("header");
}

/**
 * The title on screen. While ChromeHeading crossfades, the old title is still in the DOM ahead of the
 * new one: the last visible one is the page's.
 */
export function titleRect(): DOMRect | null {
  const all = document.querySelectorAll<HTMLElement>('header [data-scout="title"]');
  for (let i = all.length - 1; i >= 0; i--) {
    const r = visible(all[i]);
    if (r) return r;
  }
  return null;
}

/** Header floor in viewport px: the bottom of the bar less 6 (the scout's floor). */
export function headerFloor(header: HTMLElement): number {
  return header.getBoundingClientRect().top + header.clientHeight - 6;
}

/** The desktop layout is on (the phone toolbar is hidden). */
export function wideLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

/** Home on the desktop (§3.1), viewport px. Null on the phone layout or without a title. */
export function nookPoint(home: Home): { x: number; y: number; face: 1 | -1 } | null {
  const header = headerEl();
  if (!header || !wideLayout()) return null;
  const title = titleRect();
  const label = visible(header.querySelector('[data-scout="price-label"]'));
  const n = nookX(home, title, label);
  if (!n) return null;
  return { x: n.x, y: headerFloor(header), face: n.face };
}

/** The phone park past the longest search cue (HeaderScout `seek`), viewport px. */
export function parkPoint(): { x: number; y: number; face: 1 | -1 } | null {
  const header = headerEl();
  if (!header) return null;
  for (const el of header.querySelectorAll<HTMLElement>('[data-scout="search"]')) {
    const r = visible(el);
    if (!r) continue;
    const host = header.getBoundingClientRect();
    const text = el.querySelector("span");
    const cs = getComputedStyle(text ?? el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`;
    const icon = visible(el.querySelector("svg"));
    const iconRight = icon ? icon.right : r.left + 18;
    const end = iconRight + 12 + cueWidthFor(font) + 40;
    const x = Math.max(host.left + 20, Math.min(end, host.left + header.clientWidth - 16));
    return { x, y: headerFloor(header), face: -1 };
  }
  return null;
}

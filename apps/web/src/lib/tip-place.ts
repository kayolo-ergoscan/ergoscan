/**
 * Where a hover tip goes: on the preferred side of its anchor, flipped to the
 * opposite side when it does not fit, then shifted along the edge so it stays
 * inside the viewport. Pure, so the rules are tested without a browser.
 */

export type TipSide = "top" | "bottom" | "left" | "right";

export type TipRect = { left: number; top: number; width: number; height: number };

export type TipSpot = { x: number; y: number; side: TipSide };

/** Space between the anchor and the tip. */
export const TIP_GAP = 8;
/** The tip never comes closer than this to a viewport edge. */
export const TIP_EDGE = 8;

const OPPOSITE: Record<TipSide, TipSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export function placeTip(
  anchor: TipRect,
  w: number,
  h: number,
  side: TipSide,
  vw: number,
  vh: number,
  gap = TIP_GAP,
  edge = TIP_EDGE
): TipSpot {
  const room: Record<TipSide, number> = {
    top: anchor.top - edge,
    bottom: vh - (anchor.top + anchor.height) - edge,
    left: anchor.left - edge,
    right: vw - (anchor.left + anchor.width) - edge,
  };
  const need = (s: TipSide) => (s === "top" || s === "bottom" ? h : w) + gap;
  let s = side;
  if (room[s] < need(s)) {
    const flip = OPPOSITE[s];
    if (room[flip] >= need(flip)) s = flip;
    else {
      // Neither side of this axis fits: try the other axis, else the roomiest side.
      const cross: TipSide[] = s === "top" || s === "bottom" ? ["right", "left"] : ["top", "bottom"];
      const fits = cross.find((c) => room[c] >= need(c));
      if (fits) s = fits;
      else {
        const all: TipSide[] = [s, flip, ...cross];
        s = all.reduce((best, c) => (room[c] - need(c) > room[best] - need(best) ? c : best), s);
      }
    }
  }
  let x: number;
  let y: number;
  if (s === "top" || s === "bottom") {
    x = anchor.left + anchor.width / 2 - w / 2;
    y = s === "top" ? anchor.top - gap - h : anchor.top + anchor.height + gap;
  } else {
    y = anchor.top + anchor.height / 2 - h / 2;
    x = s === "left" ? anchor.left - gap - w : anchor.left + anchor.width + gap;
  }
  return {
    x: Math.round(clamp(x, edge, vw - w - edge)),
    y: Math.round(clamp(y, edge, vh - h - edge)),
    side: s,
  };
}

/** A point (cursor, chart dot) as a zero-size anchor. */
export function pointRect(x: number, y: number, r = 0): TipRect {
  return { left: x - r, top: y - r, width: r * 2, height: r * 2 };
}

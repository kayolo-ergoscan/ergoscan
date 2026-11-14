/**
 * Home «Рента этой эпохи» + «Токены под угрозой» as one harbour (concept A «Маяк», approved by the
 * operator 14.11.2026). Pure painters: `(ctx, w, h, scene, moment, palette, look)`, so any frame of
 * a moment can be drawn and tested; the engine only decides when to draw.
 *
 * Every mark is a chain fact:
 * - a boat is one address of the rent tape (the soonest 15), one porthole per box (up to 13);
 * - its lamp: coral when its boxes are due, gold when they come due within a day;
 * - the lights on the horizon are the rest of this epoch's boxes, one light per 10;
 * - the lighthouse is the four-year mark; the tug is the miner who collects;
 * - on the reef card, a boat is a token whose boxes hold no more ERG than their rent: it stands as far
 *   from the reef as its first box is from four years (√ scale, 7 days), and sits as low in the
 *   water as that box is short (1 − ERG / rent).
 */
import { rentTapeTone, type RentTapeTone } from "@ergoscan/shared";
import { R, alpha, clamp, easeInOut, noise, rgb, shade } from "@/lib/home-city/common";
import type { HarbourPalette } from "./palette";

export type HarbourBoat = {
  address: string;
  boxCount: number;
  blocksUntilRent: number;
  rentNano: string;
  valueNano: string;
};

/** Due now / soon / later: the rent tape's own cut, the same everywhere on the site. */
export function toneOf(blocks: number): RentTapeTone {
  return rentTapeTone(blocks);
}

/** Linear mix of two colours, 0 → a, 1 → b. */
function mix(a: string, b: string, u: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const k = clamp(u, 0, 1);
  const c = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export type HarbourScene = {
  boats: readonly HarbourBoat[];
  /** Boxes turning four before this header epoch ends (the snapshot's count); null: unknown. */
  epochBoxes: number | null;
  phone: boolean;
  hover: string | null;
};

/** Words the painter draws, already in the reader's language. */
export type HarbourWords = {
  /** The head boat's label: [clock, " · rent"]. */
  head: (b: HarbourBoat) => [string, string];
  /** The horizon label for `rest` boxes beyond the boats. */
  lights: (rest: number) => string;
};

export type HarbourLook = { sans: string; mono: string; label: string };

export type HarbourMoment =
  | { kind: "claim"; ms: number; boxes: number; lines: readonly [string, string] }
  | { kind: "epoch"; ms: number; lines: readonly [string, string] };

/** How long each moment runs, ms. After that: no frames. */
export const CLAIM_MS = 4600;
export const EPOCH_MS = 2800;
/** Coins drawn for a claim (one per box, at most this many; the badge has the real count). */
export const CLAIM_COINS = 48;

export type HarbourHit =
  | { kind: "boat"; id: string; x0: number; y0: number; x1: number; y1: number }
  | { kind: "lighthouse"; id: string; x0: number; y0: number; x1: number; y1: number }
  | { kind: "tug"; id: string; x0: number; y0: number; x1: number; y1: number }
  /** `rest`: the boxes the lights stand for (beyond the boats drawn), so the tip says what was drawn. */
  | { kind: "lights"; id: string; rest: number; x0: number; y0: number; x1: number; y1: number };

/* ---------------- drawing helpers ---------------- */

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, Math.round(x), Math.round(y));
}

function textW(ctx: CanvasRenderingContext2D, s: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(s).width;
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, a));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * Soft card edges: the picture fades into the card instead of ending on a hard rectangle.
 * `destination-in` clears whatever the source does not cover, so every mask covers the whole canvas
 * (the gradient holds its last stop beyond the edge).
 */
function fadeEdges(ctx: CanvasRenderingContext2D, w: number, h: number, e: { left?: number; right?: number; top?: number; bottom?: number }) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const mask = (x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  if (e.left) mask(0, 0, e.left, 0);
  if (e.right) mask(w, 0, w - e.right, 0);
  if (e.top) mask(0, 0, 0, e.top);
  if (e.bottom) mask(0, h, 0, h - e.bottom);
  ctx.restore();
}

export function horizonY(phone: boolean): number {
  return phone ? 44 : 36;
}

function sky(ctx: CanvasRenderingContext2D, w: number, y0: number, pal: HarbourPalette) {
  if (!pal.sky || y0 <= 0) return;
  const g = ctx.createLinearGradient(0, 0, 0, y0);
  pal.sky.forEach((c, i) => g.addColorStop(i / Math.max(1, pal.sky!.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, y0);
}

function sea(ctx: CanvasRenderingContext2D, w: number, h: number, y0: number, seed: number, pal: HarbourPalette) {
  const n = pal.sea.length;
  for (let i = 0; i < n; i++) {
    const a = y0 + Math.round(((h - y0) * i) / n);
    const b = y0 + Math.round(((h - y0) * (i + 1)) / n);
    R(ctx, 0, a, w, b - a, pal.sea[i]!);
    if (i > 0) for (let x = 0; x < w; x += 2) if (noise(x + seed, a) > 0.5) R(ctx, x, a - 1, 1, 1, pal.sea[i]!);
  }
  for (let y = y0 + 3; y < h; y += 3) {
    const near = (y - y0) / Math.max(1, h - y0);
    const step = Math.round(24 - near * 10);
    for (let x = (noise(y, seed) * step) | 0; x < w; x += step + ((noise(x, y + seed) * 9) | 0)) {
      const len = 2 + Math.round(noise(x + 7, y) * (2 + near * 7));
      R(ctx, x, y, len, 1, noise(x, y * 3) > 0.84 ? pal.rippleHi : pal.ripple);
    }
  }
  const g = ctx.createLinearGradient(0, y0, 0, y0 + 14);
  g.addColorStop(0, pal.haze);
  g.addColorStop(1, alpha(pal.sea[0]!, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, w, 14);
  R(ctx, 0, y0, w, 1, pal.horizon);
}

/** A heap of rounded rocks from x0..x1 rising to `top` at its peak. */
function rocks(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, h: number, seed: number, pal: HarbourPalette, peakAt = 0.35) {
  const W = x1 - x0;
  const blobs: { cx: number; cy: number; r: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const u = noise(i, seed) * 0.9 + 0.05;
    const r = 8 + noise(i, seed + 1) * 12;
    const lift = Math.exp(-((u - peakAt) ** 2) / 0.08) * (h - top - r);
    blobs.push({ cx: x0 + u * W, cy: h - r * 0.4 - lift * 0.9, r });
  }
  blobs.sort((a, b) => a.cy - b.cy);
  const K = pal.rock;
  for (const b of blobs) {
    for (let y = Math.floor(b.cy - b.r); y < h; y++) {
      const dy = y - b.cy;
      const half = dy < 0 ? Math.sqrt(Math.max(0, b.r * b.r - dy * dy)) : b.r;
      const xa = Math.round(b.cx - half);
      const xb = Math.round(b.cx + half);
      if (xb <= xa) continue;
      R(ctx, xa, y, xb - xa, 1, dy < -b.r * 0.55 ? K[3] : dy < 0 ? K[2] : K[1]);
      const sh = Math.max(2, Math.round(half * 0.35));
      R(ctx, xb - sh, y, sh, 1, dy < 0 ? K[1] : K[0]);
      if (dy < -b.r * 0.75) R(ctx, xa + 2, y, Math.max(1, Math.round(half * 0.5)), 1, K[4]);
    }
  }
}

type Lantern = { x: number; y: number; x0: number; y0: number; x1: number; y1: number };

function lighthouse(ctx: CanvasRenderingContext2D, cx: number, top: number, by: number, s: number, flare: number, pal: HarbourPalette): Lantern {
  const L = pal.lighthouse;
  const lanternH = Math.round(13 * s);
  const roofH = Math.round(8 * s);
  const towerTop = top + roofH + lanternH + 4;
  const wTop = Math.round(14 * s);
  const wBot = Math.round(24 * s);
  const H = by - towerTop;
  for (let y = towerTop; y < by; y++) {
    const u = (y - towerTop) / H;
    const half = Math.round((wTop + (wBot - wTop) * u) / 2);
    const band = Math.floor(u * 5) % 2 === 1;
    R(ctx, cx - half, y, half, 1, band ? L.band : L.wall);
    R(ctx, cx, y, half, 1, band ? L.bandSh : L.wallSh);
    R(ctx, cx - half, y, 1, 1, band ? shade(L.band, 1.12) : L.wallHi);
  }
  R(ctx, cx - 3, by - Math.round(10 * s), 6, Math.round(10 * s), L.door);
  for (const f of [0.22, 0.5]) R(ctx, cx - 1, towerTop + Math.round(H * f), 3, 4, flare > 0.3 ? pal.light : shade(L.frame, 1.3));
  const gy = towerTop - 2;
  const gw = wTop + 8;
  R(ctx, cx - gw / 2, gy, gw, 2, L.frame);
  for (let x = Math.round(cx - gw / 2); x <= cx + gw / 2 - 1; x += 2) R(ctx, x, gy - 3, 1, 3, L.frame);
  R(ctx, cx - gw / 2, gy - 4, gw, 1, L.frame);
  const lw = Math.round(10 * s);
  const ly = gy - 4 - lanternH;
  R(ctx, Math.round(cx - lw / 2) - 1, ly, lw + 2, lanternH, L.frame);
  const glass = flare > 0 ? mix(L.glass, "#ffffff", flare * 0.8) : L.glass;
  R(ctx, Math.round(cx - lw / 2) + 1, ly + 1, lw - 2, lanternH - 2, glass);
  R(ctx, cx - 1, ly + 1, 1, lanternH - 2, shade(glass, 0.8));
  R(ctx, cx + 2, ly + 1, 1, lanternH - 2, shade(glass, 0.9));
  for (let k = 0; k < roofH; k++) {
    const hw = Math.round((lw / 2 + 3) * (1 - k / roofH)) + 1;
    R(ctx, cx - hw, ly - 1 - k, hw * 2, 1, L.roof);
  }
  R(ctx, cx - 1, ly - roofH - 3, 2, 3, L.roof);
  return { x: cx, y: ly + lanternH / 2, x0: cx - wBot / 2 - 2, y0: ly - roofH - 3, x1: cx + wBot / 2 + 2, y1: by };
}

/** Where the mast stands on a boat of `len` at scale `s`, from its bow (left). */
export function boatMastX(len: number, s: number): number {
  const cw = Math.max(5, Math.round(Math.min(len * 0.34, 16 * s)));
  const cx0 = len - cw - Math.round(3 * s);
  return cx0 + Math.round(cw / 2);
}

type BoatOpt = { boxes: number; more?: boolean; lamp: string | null; lit: boolean; sink?: number; hot?: boolean };

/** Side-view boat heading left (to the lighthouse): raised bow, cabin aft, one porthole per box. */
function boat(ctx: CanvasRenderingContext2D, x: number, wl: number, len: number, s: number, o: BoatOpt, pal: HarbourPalette) {
  const P = pal.hull;
  const hullH = Math.max(3, Math.round(7 * s));
  const sink = clamp(o.sink ?? 0, 0, 1);
  const dy = Math.round((hullH + 2) * sink);
  const deck = wl - hullH + dy;
  const cw = Math.max(5, Math.round(Math.min(len * 0.34, 16 * s)));
  const ch = Math.max(3, Math.round(6 * s));
  const cx0 = x + len - cw - Math.round(3 * s);
  const mx = x + boatMastX(len, s);
  const mh = Math.round(12 * s);
  const side = o.hot ? shade(P.side, 1.18) : P.side;
  const parts = () => {
    for (let k = 0; k <= hullH; k++) {
      const y = deck + k;
      const bow = Math.round((k / hullH) ** 1.3 * 5 * s);
      const sternIn = Math.round((k / hullH) ** 2 * 2 * s);
      const c = k === 0 ? P.rail : k === hullH ? P.keel : k === Math.round(hullH * 0.65) ? P.stripe : side;
      R(ctx, x + bow, y, len - bow - sternIn, 1, c);
    }
    R(ctx, x, deck - Math.max(1, Math.round(2 * s)), Math.round(5 * s), Math.max(1, Math.round(2 * s)), P.rail);
    const n = Math.min(o.boxes, Math.max(0, Math.floor((len - 10 * s) / (3.2 * s))));
    const pw = s >= 0.9 ? 2 : 1;
    for (let i = 0; i < n; i++) R(ctx, x + Math.round(6 * s + i * 3.2 * s), deck + Math.round(hullH * 0.3), pw, pw, o.lit ? pal.light : P.port);
    if (o.more) R(ctx, x + Math.round(6 * s + n * 3.2 * s), deck + Math.round(hullH * 0.3), 1, 1, P.port);
    R(ctx, cx0, deck - ch, cw, ch, P.cabin);
    R(ctx, cx0 + cw - Math.max(1, Math.round(cw * 0.3)), deck - ch, Math.max(1, Math.round(cw * 0.3)), ch, P.cabinSh);
    R(ctx, cx0 - 1, deck - ch - 1, cw + 2, 1, P.roof);
    if (ch >= 4) R(ctx, cx0 + 2, deck - ch + 2, Math.max(2, Math.round(3 * s)), Math.max(1, ch - 4), o.lit ? pal.light : P.window);
    R(ctx, mx, deck - ch - mh, 1, mh, P.mast);
    if (s >= 0.8) R(ctx, mx - Math.round(5 * s), deck - ch - Math.round(mh * 0.55), Math.round(10 * s), 1, P.yard);
    if (o.lamp) R(ctx, mx - (s >= 0.8 ? 1 : 0), deck - ch - mh - 2, s >= 0.8 ? 3 : 2, s >= 0.8 ? 3 : 2, o.lamp);
  };
  if (sink > 0) {
    // Above the water as is; below it the hull shows through the water, with bubbles over it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 20, -1000, len + 60, 1000 + wl);
    ctx.clip();
    parts();
    ctx.restore();
    // Only the hull's sunk slice: below the waterline, as deep as it sits (no block of tinted water).
    const under = { x: x - 1, y: wl + 1, w: len + 2, h: dy + 1 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(under.x, under.y, under.w, under.h);
    ctx.clip();
    ctx.globalAlpha = 0.5;
    parts();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.deep;
    ctx.fillRect(under.x, under.y, under.w, under.h);
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      R(ctx, x + Math.round(len * (0.25 + 0.25 * i)) + ((noise(i, x) * 3) | 0), wl - 2 - i * 2 - ((noise(x, i) * 2) | 0), 1, 1, alpha(pal.foam, 0.7 - i * 0.15));
    }
  } else parts();
  R(ctx, x + 1, wl, len - 2, 1, pal.waterline);
  for (let i = 0; i < len - 4; i += 3) if (noise(i, wl + x) > 0.45) R(ctx, x + 2 + i, wl + 2, 2, 1, pal.wake);
  if (o.lamp && s >= 0.6) {
    R(ctx, mx, wl + 3, 1, 2, alpha(o.lamp, 0.5));
    R(ctx, mx, wl + 7, 1, 1, alpha(o.lamp, 0.3));
  }
  return { mx, mastTop: deck - ch - mh - 2, top: deck - ch - mh - 2 };
}

/** The miner's tug, facing right: low hull, tall wheelhouse, a crane arm over its bow. */
function tug(ctx: CanvasRenderingContext2D, x: number, wl: number, s: number, reach: number, hookLen: number, pal: HarbourPalette) {
  const T = pal.tug;
  const len = Math.round(30 * s);
  const hullH = Math.round(8 * s);
  for (let k = 0; k <= hullH; k++) {
    const bow = Math.round((k / hullH) ** 1.3 * 4 * s);
    const st = Math.round((k / hullH) * 2 * s);
    R(ctx, x + st, wl - hullH + k, len - bow - st, 1, k === 0 ? T.hullHi : k === hullH ? T.hullLo : T.hull);
  }
  R(ctx, x + 2, wl - hullH + 3, len - 6, 1, pal.coral);
  for (let i = 0; i < 3; i++) R(ctx, x + Math.round(5 * s) + i * Math.round(7 * s), wl - hullH + 4, 3, 3, T.fender);
  const hx = x + Math.round(4 * s);
  const hw = Math.round(11 * s);
  const hh = Math.round(10 * s);
  R(ctx, hx, wl - hullH - hh, hw, hh, T.house);
  R(ctx, hx + hw - 3, wl - hullH - hh, 3, hh, T.houseSh);
  R(ctx, hx + 2, wl - hullH - hh + 2, hw - 5, Math.round(3 * s), pal.light);
  R(ctx, hx - 1, wl - hullH - hh - 1, hw + 2, 2, T.frame);
  R(ctx, hx + 2, wl - hullH - hh - Math.round(5 * s), 3, Math.round(4 * s), T.frame);
  R(ctx, hx + 2, wl - hullH - hh - Math.round(5 * s), 3, 1, pal.coral);
  const px = hx + hw + 2;
  const py = wl - hullH;
  const postH = Math.round(12 * s);
  R(ctx, px, py - postH, 2, postH, T.post);
  const tipX = px + reach;
  const tipY = py - Math.round(15 * s);
  for (let i = 0; i <= reach; i++) {
    const u = i / Math.max(1, reach);
    R(ctx, px + i, py - postH + (tipY - (py - postH)) * u, 1, 2, T.crane);
  }
  R(ctx, tipX, tipY + 1, 1, hookLen, T.hook);
  R(ctx, tipX - 1, tipY + 1 + hookLen, 3, 1, T.hook);
  R(ctx, tipX + 1, tipY + hookLen - 1, 1, 2, T.hook);
  R(ctx, hx + 5, wl - hullH - hh - Math.round(8 * s), 1, Math.round(4 * s), T.hook);
  R(ctx, hx + 4, wl - hullH - hh - Math.round(9 * s), 3, 2, pal.coral);
  R(ctx, x + 1, wl, len - 2, 1, pal.waterline);
  return { x0: x, y0: wl - hullH - hh - Math.round(9 * s), x1: tipX + 3, y1: wl + 1 };
}

type Row = { n: number; wl: number; s: number; x0: number };

function rowsFor(h: number, H0: number, phone: boolean): Row[] {
  const span = h - H0;
  return phone
    ? [
        { n: 3, wl: h - 18, s: 1.15, x0: 104 },
        { n: 4, wl: Math.round(H0 + span * 0.55), s: 0.8, x0: 78 },
        { n: 6, wl: Math.round(H0 + span * 0.27), s: 0.52, x0: 70 },
      ]
    : [
        { n: 3, wl: h - 16, s: 1.1, x0: 98 },
        { n: 4, wl: Math.round(H0 + span * 0.54), s: 0.78, x0: 72 },
        { n: 6, wl: Math.round(H0 + span * 0.25), s: 0.5, x0: 64 },
      ];
}

function boatLen(boxes: number, s: number): number {
  return Math.max(Math.round(24 * s), Math.round((14 + 3.2 * Math.min(boxes, 13)) * s));
}

/** Boats per row, nearest row first: the tape in order, as many as fit the row's width. */
export function harbourRows(w: number, h: number, boats: readonly HarbourBoat[], phone: boolean) {
  const H0 = horizonY(phone);
  const rows = rowsFor(h, H0, phone);
  const out: { row: Row; items: HarbourBoat[]; lens: number[] }[] = [];
  let k = 0;
  for (const row of rows) {
    const items: HarbourBoat[] = [];
    const lens: number[] = [];
    let used = 0;
    while (items.length < row.n && k < boats.length) {
      const len = boatLen(boats[k]!.boxCount, row.s);
      if (row.x0 + used + len + 4 * (items.length + 1) > w - 8) break;
      items.push(boats[k]!);
      lens.push(len);
      used += len;
      k += 1;
    }
    out.push({ row, items, lens });
  }
  return { rows: out, shown: k };
}

/** The tape's boxes the boats carry, and the rest: one horizon light per 10. */
export function harbourLights(epochBoxes: number | null, boats: readonly HarbourBoat[]): { rest: number; lights: number } {
  if (epochBoxes == null || !(epochBoxes > 0)) return { rest: 0, lights: 0 };
  const carried = boats.reduce((s, b) => s + b.boxCount, 0);
  const rest = Math.max(0, epochBoxes - carried);
  return { rest, lights: Math.ceil(rest / 10) };
}

/* ---------------- the rent card: the harbour ---------------- */

export function paintHarbour(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: HarbourScene,
  moment: HarbourMoment | null,
  pal: HarbourPalette,
  words: HarbourWords,
  look: HarbourLook
): HarbourHit[] {
  const phone = scene.phone;
  const H0 = horizonY(phone);
  const hits: HarbourHit[] = [];
  ctx.clearRect(0, 0, w, h);
  sky(ctx, w, H0, pal);
  sea(ctx, w, h, H0, 11, pal);
  const claim = moment?.kind === "claim" ? moment : null;
  const epoch = moment?.kind === "epoch" ? moment : null;
  const flare = claim ? clamp(1 - Math.abs(claim.ms - 500) / 1000, 0, 1) : epoch ? clamp(1 - Math.abs(epoch.ms - 300) / 700, 0, 1) * 0.6 : 0;

  // Lights on the horizon: the rest of this epoch's boxes. On a new epoch they come on left to right.
  const { rows: plan } = harbourRows(w, h, scene.boats, phone);
  const onBoats = plan.flatMap((p) => p.items);
  const { rest, lights } = harbourLights(scene.epochBoxes, onBoats);
  const lx0 = phone ? 70 : 64;
  const lx1 = w - 4;
  const band = phone ? 12 : 10;
  const pts: { x: number; y: number; k: number; i: number }[] = [];
  for (let i = 0; i < lights; i++) {
    const u = (i + 0.5) / lights;
    pts.push({
      x: Math.round(lx0 + u * (lx1 - lx0) + (noise(i, 31) - 0.5) * 3),
      y: H0 + 2 + Math.round(noise(i, 47) ** 1.6 * band),
      k: noise(i, 77),
      i,
    });
  }
  pts.sort((a, b) => a.y - b.y);
  for (const p of pts) {
    let on = 1;
    if (epoch) {
      const at = 150 + (p.i / Math.max(1, lights)) * 1100;
      on = clamp((epoch.ms - at) / 160, 0, 1);
      if (on <= 0) continue;
    }
    const near = (p.y - H0) / band;
    ctx.globalAlpha = on;
    R(ctx, p.x, p.y, near > 0.55 ? 2 : 1, 1, p.k > 0.86 ? pal.lightHot : alpha(pal.light, 0.55 + p.k * 0.4));
    R(ctx, p.x, p.y + 2, 1, 1, alpha(pal.light, 0.16 + near * 0.12));
    ctx.globalAlpha = 1;
  }
  if (lights) hits.push({ kind: "lights", id: "lights", rest, x0: lx0, y0: H0 - 14, x1: lx1, y1: H0 + band + 4 });

  // The queue: the tape's addresses, the soonest nearest the lighthouse. Far rows first.
  const placed: { b: HarbourBoat; x: number; len: number; wl: number; s: number; mx: number; top: number; ri: number }[] = [];
  for (let ri = plan.length - 1; ri >= 0; ri--) {
    const { row, items, lens } = plan[ri]!;
    if (!items.length) continue;
    const span = w - 8 - row.x0;
    const tot = lens.reduce((a, b) => a + b, 0);
    const gap = Math.max(4, (span - tot) / Math.max(1, items.length - (ri === 0 ? 0.6 : 0.2)));
    let x = row.x0 + (ri === 2 ? gap * 0.4 : 0);
    items.forEach((b, i) => {
      const t = toneOf(b.blocksUntilRent);
      const lamp = t === "due" ? pal.coral : t === "soon" ? pal.gold : null;
      const hot = scene.hover === b.address;
      const len = lens[i]!;
      const at = boat(ctx, Math.round(x), row.wl, len, row.s, { boxes: b.boxCount, more: b.boxCount > 13, lamp: hot && !lamp ? pal.light : lamp, lit: t !== "later" || hot, hot }, pal);
      placed.push({ b, x: Math.round(x), len, wl: row.wl, s: row.s, mx: at.mx, top: at.top, ri });
      hits.push({ kind: "boat", id: b.address, x0: Math.round(x) - 2, y0: at.top - 2, x1: Math.round(x) + len + 2, y1: row.wl + 3 });
      x += len + gap;
    });
  }
  fadeEdges(ctx, w, h, { left: 14, right: 16, bottom: 6 });

  // The lighthouse on its rocks: the four-year mark.
  const lhX = phone ? 28 : 26;
  const rockTop = h - (phone ? 54 : 48);
  rocks(ctx, -4, phone ? 66 : 60, rockTop, h + 2, 5, pal, 0.42);
  const L = lighthouse(ctx, lhX, phone ? 2 : 1, rockTop + 10, phone ? 1.1 : 1.04, flare, pal);
  hits.push({ kind: "lighthouse", id: "lighthouse", x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 });

  // Its beam: out over the horizon lights (sweeping once on a new epoch) and onto the head boat.
  const head = placed.find((p) => p.ri === 0);
  {
    let farY = H0;
    if (epoch) farY = H0 - 18 + easeInOut(epoch.ms / 1400) * 30;
    const g = ctx.createLinearGradient(L.x, L.y, w, farY);
    g.addColorStop(0, alpha(pal.gold, 0.16 + flare * 0.2));
    g.addColorStop(1, alpha(pal.gold, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L.x + 3, L.y - 2);
    ctx.lineTo(w, farY - 14);
    ctx.lineTo(w, farY + 12);
    ctx.lineTo(L.x + 3, L.y + 2);
    ctx.closePath();
    ctx.fill();
  }
  if (head) {
    const tx = head.x + head.len * 0.5;
    const ty = head.wl;
    const g = ctx.createLinearGradient(L.x, L.y, tx, ty);
    g.addColorStop(0, alpha(pal.gold, 0.22 + flare * 0.25));
    g.addColorStop(1, alpha(pal.gold, 0.04));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L.x + 3, L.y - 2);
    ctx.lineTo(tx + head.len * 0.7, ty + 3);
    ctx.lineTo(tx - head.len * 0.7, ty + 3);
    ctx.lineTo(L.x + 3, L.y + 3);
    ctx.closePath();
    ctx.fill();
  }
  glow(ctx, L.x, L.y, 24 + flare * 34, 0.4 + flare * 0.4, pal.gold);
  for (let y = rockTop + 14; y < h; y += 2) {
    if (noise(y, 3) > 0.4) R(ctx, (phone ? 62 : 56) + ((noise(y, 5) * 8) | 0), y, 2 + ((noise(y, 8) * 4) | 0), 1, alpha(pal.gold, 0.2));
  }

  // The collector's tug at the berth, its crane over the head boat; on a claim the hook dips.
  const tugX = phone ? 58 : 54;
  const ts = phone ? 1 : 0.95;
  const reachTo = head ? Math.round(head.x + 6 - (tugX + Math.round(15 * ts) + 2)) : 20;
  const dip = claim ? Math.sin(Math.PI * clamp(claim.ms / 900, 0, 1)) : 0;
  const T = tug(ctx, tugX, h - (phone ? 10 : 9), ts, clamp(reachTo, 10, 34), 6 + Math.round(dip * 8), pal);
  hits.push({ kind: "tug", id: "tug", x0: T.x0, y0: T.y0, x1: T.x1, y1: T.y1 });

  // A claim: beacon rings from the lantern (as the rent beacon on an address balance tile).
  if (claim && claim.ms < 2400) {
    const u = claim.ms / 1500;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const p = u - i * 0.2;
      if (p <= 0 || p > 1) continue;
      ctx.strokeStyle = alpha(pal.gold, (1 - p) * 0.85);
      ctx.beginPath();
      ctx.arc(L.x, L.y, 9 + p * 52, -Math.PI * 0.95, Math.PI * 0.05);
      ctx.stroke();
    }
  }

  // Labels: the head boat (when, rent); the horizon lights.
  if (head) {
    const [s1, s2] = words.head(head.b);
    const t = toneOf(head.b.blocksUntilRent);
    const f1 = `600 10px ${look.mono}`;
    const f2 = `400 10px ${look.mono}`;
    const tw = textW(ctx, s1, f1) + textW(ctx, s2, f2);
    const fy = Math.max(H0 + 12, head.top - 3);
    const fx = clamp(head.mx - 4, 2, w - tw - 6);
    ctx.fillStyle = pal.plate;
    ctx.fillRect(Math.round(fx - 3), Math.round(fy - 10), Math.round(tw + 6), 13);
    text(ctx, s1, fx, fy, f1, t === "due" ? pal.coral : pal.gold);
    text(ctx, s2, fx + textW(ctx, s1, f1), fy, f2, pal.plateMuted);
  }
  if (lights) {
    // The moment's plate sits up here too: the label steps aside while it shows.
    const quiet = 1 - badgeAlpha(moment);
    if (quiet > 0) {
      ctx.globalAlpha = quiet;
      text(ctx, words.lights(rest), w - 2, H0 - 6, `400 10px ${look.sans}`, look.label, "right");
      ctx.globalAlpha = 1;
    }
  }

  if (claim) paintClaim(ctx, w, h, claim, L, look, pal, phone);
  if (epoch) paintBadge(ctx, w, L, epoch.ms, EPOCH_MS, epoch.lines, look, pal);
  return hits;
}

function paintClaim(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: Extract<HarbourMoment, { kind: "claim" }>,
  L: Lantern,
  look: HarbourLook,
  pal: HarbourPalette,
  phone: boolean
) {
  // One coin per collected box, lifted from the berth into the lantern.
  const n = Math.min(m.boxes, CLAIM_COINS);
  const from = phone ? 70 : 64;
  for (let i = 0; i < n; i++) {
    const t0 = 350 + i * Math.min(30, 1400 / Math.max(1, n));
    const u = (m.ms - t0) / 760;
    if (u <= 0 || u >= 1) continue;
    const sx = from + noise(i, 1) * 40;
    const sy = h - 14 - noise(i, 2) * 10;
    const e = easeInOut(u);
    const x = sx + (L.x - sx) * e;
    const y = sy + (L.y - sy) * e - Math.sin(e * Math.PI) * 22;
    R(ctx, x - 1, y - 1, 3, 3, pal.coin);
    R(ctx, x - 1, y - 1, 2, 2, pal.coinHi);
  }
  if (m.ms > 700) paintBadge(ctx, w, L, m.ms - 700, CLAIM_MS - 700, m.lines, look, pal);
}

/** How much of the moment's plate shows: 0…1. */
export function badgeAlpha(m: HarbourMoment | null): number {
  if (!m) return 0;
  const ms = m.kind === "claim" ? m.ms - 700 : m.ms;
  const total = m.kind === "claim" ? CLAIM_MS - 700 : EPOCH_MS;
  if (ms <= 0) return 0;
  return clamp(ms / 300, 0, 1) * clamp((total - ms) / 600, 0, 1);
}

/** The moment's two-line plate by the lantern: fades in, holds, fades out. */
function paintBadge(
  ctx: CanvasRenderingContext2D,
  w: number,
  L: Lantern,
  ms: number,
  total: number,
  lines: readonly [string, string],
  look: HarbourLook,
  pal: HarbourPalette
) {
  const a = clamp(ms / 300, 0, 1) * clamp((total - ms) / 600, 0, 1);
  if (a <= 0) return;
  const f1 = `600 11px ${look.mono}`;
  const f2 = `400 10px ${look.mono}`;
  const tw = Math.max(textW(ctx, lines[0], f1), textW(ctx, lines[1], f2));
  const bx = Math.min(L.x + 16, w - tw - 8);
  const by = L.y - 2;
  ctx.globalAlpha = a;
  ctx.fillStyle = pal.plate;
  ctx.fillRect(Math.round(bx - 5), Math.round(by - 12), Math.round(tw + 10), 29);
  R(ctx, bx - 5, by - 12, 2, 29, pal.gold);
  text(ctx, lines[0], bx, by + 1, f1, pal.gold);
  text(ctx, lines[1], bx, by + 13, f2, pal.plateMuted);
  ctx.globalAlpha = 1;
}

/* ---------------- the danger card: the reef ---------------- */

export type ReefLane = {
  tokenId: string;
  /** Blocks until its first box turns four. */
  soonest: number;
  /** That box's ERG / its rent, 0…1 (it is short by definition: < 1). */
  ratio: number;
};

/** Reef geometry for a list `w` wide: shared by the painter and the DOM rows (logo on the mast). */
export function reefGeo(w: number, phone: boolean) {
  const reefW = phone ? 26 : 24;
  const buoyX = reefW + 9;
  const x0 = buoyX + 8;
  const x1 = Math.round(w * REEF_SEA_FR);
  const s = phone ? 0.86 : 0.78;
  const len = Math.round(24 * s);
  return { reefW, buoyX, x0, x1, s, len, mast: boatMastX(len, s) };
}

/** The share of the list's width the boats sail in; the text columns take the rest (CSS uses it too). */
export const REEF_SEA_FR = 0.36;
/** The reef's window: seven days of blocks. */
export const REEF_WINDOW_BLOCKS = 5040;

/** Boat x (its bow) for a lane: √(blocks / 7 days) from the buoys to the end of the sea. */
export function reefBoatX(g: ReturnType<typeof reefGeo>, soonest: number): number {
  const u = Math.sqrt(clamp(soonest / REEF_WINDOW_BLOCKS, 0, 1));
  return Math.round(g.x0 + u * Math.max(0, g.x1 - g.x0 - g.len - 4));
}

/** Where a reef boat's mast top is, from its lane's top: the DOM puts the token logo there. */
export function reefMastTop(pitch: number, ratio: number, s: number): number {
  const hullH = Math.max(3, Math.round(7 * s));
  const dy = Math.round((hullH + 2) * (1 - clamp(ratio, 0, 1)));
  const deck = pitch - 5 - hullH + dy;
  return deck - Math.max(3, Math.round(6 * s)) - Math.round(12 * s) - 2;
}

export function paintReef(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lanes: readonly ReefLane[],
  pitch: number,
  hover: string | null,
  phone: boolean,
  pal: HarbourPalette
) {
  ctx.clearRect(0, 0, w, h);
  const g = reefGeo(w, phone);
  sea(ctx, w, h, 0, 23, pal);
  {
    const tide = ctx.createLinearGradient(g.reefW, 0, g.reefW + 40, 0);
    tide.addColorStop(0, alpha(pal.coral, 0.16));
    tide.addColorStop(1, alpha(pal.coral, 0));
    ctx.fillStyle = tide;
    ctx.fillRect(0, 0, g.reefW + 40, h);
  }
  if (pal.reefTextFade) {
    // A light card: the water ends before the text columns, so the words sit on the card.
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const f = ctx.createLinearGradient(g.x1 - 10, 0, g.x1 + 26, 0);
    f.addColorStop(0, "rgba(0,0,0,1)");
    f.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = f;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else fadeEdges(ctx, w, h, { right: 12, bottom: 6 });
  fadeEdges(ctx, w, h, { top: 4, bottom: 6 });

  // The reef along the left edge, foam on its sea side.
  const edge = new Array<number>(h + 1).fill(0);
  const blobs = Math.max(6, Math.round(h / 22));
  for (let i = 0; i < blobs; i++) {
    const cy = 2 + (i / (blobs - 1)) * (h - 4);
    const r = 7 + noise(i, 3) * 7;
    const cx = g.reefW * 0.42 + (noise(i, 5) - 0.5) * 9;
    for (let y = Math.floor(cy - r); y < cy + r; y++) {
      if (y < 0 || y >= h) continue;
      const half = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
      const xa = Math.round(cx - half);
      const xb = Math.round(cx + half);
      R(ctx, xa, y, xb - xa, 1, y < cy - r * 0.4 ? pal.rock[3] : pal.rock[2]);
      const sh = Math.max(1, Math.round(half * 0.4));
      R(ctx, xb - sh, y, sh, 1, pal.rock[1]);
      if (y < cy - r * 0.7) R(ctx, xa + 1, y, Math.max(1, Math.round(half * 0.6)), 1, pal.rock[4]);
      edge[y] = Math.max(edge[y]!, xb);
    }
  }
  for (let y = 1; y < h - 1; y++) {
    const fx = edge[y]! + 1;
    if (noise(y, 7) > 0.35) R(ctx, fx, y, 1 + ((noise(y, 9) * 3) | 0), 1, pal.foam);
    if (noise(y, 8) > 0.7) R(ctx, fx + 3 + ((noise(y, 2) * 3) | 0), y, 2, 1, pal.foamDim);
  }

  lanes.forEach((lane, i) => {
    const y = i * pitch;
    const wl = y + pitch - 5;
    // The red buoys: the four-year line.
    R(ctx, g.buoyX - 1, wl - 4, 3, 4, pal.coral);
    R(ctx, g.buoyX - 1, wl - 4, 3, 1, shade(pal.coral, 1.5));
    R(ctx, g.buoyX, wl, 1, 2, pal.hull.window);
    if (i > 0) for (let x = g.x0; x < w - 4; x += 4) R(ctx, x, y, 2, 1, alpha(pal.foam, 0.06));
    const bx = reefBoatX(g, lane.soonest);
    const t = toneOf(lane.soonest);
    for (let k = 1; k < 4; k++) R(ctx, bx + g.len + k * 3, wl - 1, 2, 1, alpha(pal.foamDim, 0.3 - k * 0.07));
    const hot = hover === lane.tokenId;
    boat(ctx, bx, wl, g.len, g.s, { boxes: 0, sink: 1 - clamp(lane.ratio, 0, 1), lamp: t === "later" ? (hot ? pal.light : null) : t === "due" ? pal.coral : pal.gold, lit: hot, hot }, pal);
  });
}

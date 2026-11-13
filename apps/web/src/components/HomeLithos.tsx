"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LITHOS_HOLDING_PERIOD, type LithosHome } from "@ergoscan/shared";
import { EvidenceBadge, EvidenceDot } from "@/components/EvidenceBadge";
import { ReelText } from "@/components/ReelText";
import { Tip, TipHead, TipRow, TipRows, useFloatTip } from "@/components/Tip";
import { drawPixel, pixelColor } from "@/components/pixel";
import { canvasDpr, watchOnScreen } from "@/lib/canvas-run";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { REDUCE_QUERY, useMediaTick } from "@/lib/kayolo/motion";
import { lookEdge } from "@/lib/look";
import { HOME } from "@/lib/palette";
import { INK_EVENT } from "@/lib/skin-ink";
import { formatInt } from "@/lib/format";
import { blocksToMs, ergText, formatShare, formatSpan, formatWindowDays, splitHashrate } from "@/lib/lithos-header";
import {
  cartLanes,
  cartX,
  coinSpots,
  FLAG_GAP,
  idleSize,
  idleSpots,
  minerSpots,
  placeLabels,
  sceneCarts,
  sceneLayout,
  seamX,
  type Box,
  type CartSpot,
  type SceneLayout,
  type Seg,
} from "@/lib/lithos-home-scene";

/**
 * Home «Lithos»: how the pool works, drawn with the live numbers. Across the top, the network
 * seam: one stone per Ergo block of the hashrate window, the Lithos finds in gold. Below it an
 * isometric quarry: the round's miners (little «Пиксели») knock NISP chips off the rock into the
 * round's cart, registered miners outside the round doze on the plateau behind; carts roll along
 * NISP collection, the fraud-proof check and payout at the real progress of each round at the
 * chain tip, and the payout heap has one coin per waiting payout.
 *
 * Frames only when something happens: the first look, a new block (a stone drops into the seam,
 * the miners knock), a new Lithos find (a gem drops from the seam into the new round's cart and the
 * miners hop), a paid round, a hover. Off screen and on a hidden tab nothing is drawn; under
 * reduced motion every change is one still frame.
 */

const MAX_MINERS = 16;
const MAX_IDLE = 40;
const KNOCK_MS = 260;
const CHIP_MS = 560;
const INTRO_MS = 1500;
const BLOCK_BURST_MS = 1300;
/** A new block's stone falling into the seam. */
const STONE_MS = 460;
/** The find: the gem glints in the seam, falls into the round's cart, lands; the miners hop. */
const GEM_GLINT = 280;
const GEM_FALL = 760;
const GEM_LAND = GEM_GLINT + GEM_FALL;
const CHEER_MS = 720;
const FIND_MS = 3000;

/** Warm stone, light from the upper left: lit tops, the front in half light, the right sides in shade. */
const STONE = {
  top: "#a99271",
  topHi: "#bfa784",
  face: "#735f48",
  faceHi: "#816c52",
  grout: "#5c4b37",
  side: "#524333",
  backTop: "#86735a",
  backFace: "#57493a",
  backGrout: "#4a3e30",
  backSide: "#433829",
};
const GOLD_HI = "#fff2c4";
const GOLD_LO = "#b98f3c";

type Inks = {
  gold: string;
  violet: string;
  green: string;
  text: string;
  muted: string;
  miner: string;
  wash: string;
  washMid: string;
  washStrong: string;
  module: string;
  edge: string;
  heur: string;
  sans: string;
  mono: string;
};

function readInks(el: Element): Inks {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    gold: v("--c-block", "#ebcb71"),
    violet: v("--k-nft", "#c19fe9"),
    green: v("--up", "#88d9a5"),
    text: v("--text", "#ffffff"),
    muted: v("--muted-2", "#a3a3a3"),
    miner: pixelColor("brand"),
    wash: v("--wash", "rgba(255,255,255,0.06)"),
    washMid: v("--wash-mid", "rgba(255,255,255,0.1)"),
    washStrong: v("--wash-strong", "rgba(255,255,255,0.16)"),
    module: v("--module", "#1a1a1a"),
    edge: lookEdge() ?? "rgba(255,255,255,0.55)",
    heur: v("--k-rent", "#d99b2b"),
    sans: `${v("--font-sans", "")}${v("--font-sans", "") ? ", " : ""}ui-sans-serif, system-ui, sans-serif`,
    mono: `${v("--font-mono", "")}${v("--font-mono", "") ? ", " : ""}ui-monospace, monospace`,
  };
}

type Cart = {
  h: number;
  kind: CartSpot["kind"] | "pay";
  x: number;
  tx: number;
  /** How high its track runs above the front one, and where it is heading. */
  lift: number;
  tl: number;
  bumpAt: number;
  alpha: number;
  leaving: boolean;
};

type Chip = { x0: number; y0: number; t0: number; to: number };

type Hit = { kind: "cart" | "pay" | "miners" | "seam" | "next"; h?: number; x: number; y: number; w: number; hh: number };

/** Labels that the canvas draws, already in the page language. */
export type SceneText = {
  collect: string;
  check: string;
  pay: string;
  /** Under the collect and check stage names: how long the phase lasts. */
  period: string;
  /** «A Lithos block every ≈ N h on average» from the window, or null when the window is too thin. */
  next: string | null;
  /** Height, then miners and bank; on the phone's short track only the bank (the facts row has the miners). */
  round: (c: CartSpot, small: boolean) => [string, string];
  checkLeft: (c: CartSpot) => string;
  payout: string;
};

type SceneInput = {
  data: LithosHome | null;
  tip: number | null;
  text: SceneText;
};

function easeOut(u: number) {
  return 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
}

function fitText(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

/** Deterministic 0…1 noise for the stone textures: the same pixels every frame. */
function noise(a: number, b: number): number {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

type StonePal = { top: string; topHi: string; face: string; faceHi: string; grout: string; side: string };

/**
 * One block of rock, pixel-isometric: the front face with stone courses, the top face going back
 * two pixels across for each one up, the right side in shade. Drawn left to right, so the next
 * (lower) block covers the foot of this one's side.
 */
function rockBlock(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, bottom: number, iso: number, pal: StonePal, seed: number, course: number) {
  const dy = Math.round(iso / 2);
  const w = x1 - x0;
  // Right side, in shade: one column per pixel, each one higher than the last every second column.
  ctx.fillStyle = pal.side;
  for (let c = 0; c < iso; c++) {
    const lift = Math.floor((c + 1) / 2);
    ctx.fillRect(x1 + c, top - lift, 1, bottom - top);
  }
  // Top face: rows going back and right.
  ctx.fillStyle = pal.top;
  for (let r = 0; r < dy; r++) ctx.fillRect(x0 + 2 * r + 1, top - 1 - r, w, 1);
  ctx.fillStyle = pal.topHi;
  for (let i = 0; i < w; i += 3) {
    const n = noise(seed + i, 7);
    if (n > 0.72) ctx.fillRect(x0 + i + 1 + Math.floor(n * 3), top - 1 - Math.floor(n * dy), 1, 1);
  }
  // Front face with stone courses: a lit top line on every course, staggered joints.
  ctx.fillStyle = pal.face;
  ctx.fillRect(x0, top, w, bottom - top);
  ctx.fillStyle = pal.topHi;
  ctx.fillRect(x0, top, w, 1);
  for (let y = top + 1, row = 0; y < bottom - 1; row++) {
    const hh = course + Math.floor(noise(seed + 5, row) * 5) - 2;
    const n = noise(seed + 9, row);
    if (n > 0.62) {
      ctx.fillStyle = n > 0.85 ? pal.faceHi : pal.grout;
      ctx.globalAlpha = n > 0.85 ? 0.7 : 0.45;
      ctx.fillRect(x0, y, w, Math.min(hh, bottom - y));
      ctx.globalAlpha = 1;
    }
    y += hh;
    if (y >= bottom - 1) break;
    ctx.fillStyle = pal.grout;
    ctx.fillRect(x0, y, w, 1);
    ctx.fillStyle = pal.faceHi;
    ctx.fillRect(x0, y + 1, w, 1);
    // A crack now and then, not a joint in every course.
    if (noise(seed + row, 3) > 0.55) {
      const cx = Math.round(x0 + 3 + noise(seed + row, 4) * (w - 6));
      ctx.fillStyle = pal.grout;
      ctx.fillRect(cx, y + 2, 1, Math.min(hh - 2, bottom - y - 2));
    }
  }
}

/** Gold veins in a front face: short diagonal runs with a glint at the head. Lithos is a stone. */
function veins(ctx: CanvasRenderingContext2D, ink: Inks, x0: number, x1: number, top: number, bottom: number, seed: number, px: number) {
  const n = Math.max(1, Math.round((x1 - x0) / 36));
  for (let k = 0; k < n; k++) {
    const a = noise(seed, k * 3 + 1);
    const b = noise(seed, k * 3 + 2);
    const len = 3 + Math.floor(noise(seed, k * 3 + 3) * 4);
    const dir = b > 0.5 ? 1 : -1;
    let x = Math.round(x0 + 4 + a * (x1 - x0 - 8 - len * px));
    let y = Math.round(top + 6 + b * Math.max(1, bottom - top - 12 - len * px));
    if (dir < 0) x += len * px;
    for (let i = 0; i < len; i++) {
      ctx.fillStyle = i === 0 ? GOLD_HI : i === len - 1 ? GOLD_LO : ink.gold;
      ctx.fillRect(x, y, px, px);
      x += dir * px;
      y += i % 2 === 0 ? px : 0;
    }
  }
}

function drawRock(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks) {
  const { steps, cliff, cliffTop, ground, quarry, backEnd, backTop, iso } = L;
  const course = L.small ? 8 : 10;
  const back: StonePal = { top: STONE.backTop, topHi: STONE.top, face: STONE.backFace, faceHi: STONE.backFace, grout: STONE.backGrout, side: STONE.backSide };
  // Shadow on the ground under the rock.
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(0, ground, quarry + iso, 3);
  // The plateau behind, in half shade; then the front block and the steps.
  rockBlock(ctx, 0, backEnd, backTop, ground, iso, back, 11, course);
  rockBlock(ctx, 0, cliff, cliffTop, ground, iso, STONE, 23, course);
  steps.forEach((s, k) => rockBlock(ctx, s.x0, s.x1, s.top, ground, iso, STONE, 37 + k * 13, course));
  const px = L.small ? 1.5 : 2;
  veins(ctx, ink, 0, cliff, cliffTop, ground, 5, px);
  steps.forEach((s, k) => veins(ctx, ink, s.x0, s.x1, s.top, ground, 17 + k * 7, px));
  veins(ctx, ink, cliff + iso, backEnd, backTop, steps[0]!.top - iso, 41, px);
}

/** The network seam: a bed of small grey stones (every Ergo block), the Lithos finds as gold nuggets. */
function drawSeam(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, at: readonly number[], span: number) {
  const { y, h } = L.seam;
  const w = L.w;
  ctx.fillStyle = ink.wash;
  ctx.fillRect(0, y, w, h);
  ctx.fillStyle = ink.washStrong;
  ctx.fillRect(0, y, w, 1);
  // Pebbles: blocks are about a dozen to a pixel here, so they make a texture, not a count.
  const rows = Math.floor((h - 2) / 3);
  for (let x = 1; x < w - 2; x += 3) {
    for (let r = 0; r < rows; r++) {
      const n = noise(x, r + 3);
      if (n < 0.14) continue;
      ctx.fillStyle = n > 0.86 ? "rgba(255,255,255,0.34)" : n > 0.5 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.12)";
      ctx.fillRect(x + (r % 2), y + 2 + r * 3, n > 0.7 ? 3 : 2, 2);
    }
  }
  // Lithos finds: gold nuggets in place of their time, a glint on each.
  const nh = h - 2;
  for (const m of at) {
    const x = seamX(L, m, span);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x - 3, y + 1, 6, nh);
    ctx.fillStyle = ink.gold;
    ctx.fillRect(x - 2, y + 1, 4, nh);
    ctx.fillStyle = GOLD_HI;
    ctx.fillRect(x - 2, y + 1, 2, 2);
    ctx.fillStyle = GOLD_LO;
    ctx.fillRect(x + 1, y + nh - 1, 1, 2);
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, text: SceneText) {
  const y = L.ground;
  const a = L.collect.a;
  const b = L.payout.b;
  // Sleepers, then the two rails.
  ctx.fillStyle = ink.washMid;
  for (let x = a + 1; x < b - 3; x += L.small ? 7 : 8) ctx.fillRect(x, y - 1, L.small ? 3 : 4, 6);
  ctx.fillStyle = ink.washStrong;
  ctx.fillRect(a, y - 1, b - a, 1);
  ctx.fillRect(a, y + 4, b - a, 1);
  const segs: [typeof L.collect, string, string, boolean][] = [
    [L.collect, ink.gold, text.collect, true],
    [L.check, ink.violet, text.check, true],
    [L.payout, ink.green, text.pay, false],
  ];
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const [s, c, label, timed] of segs) {
    // The near rail takes the stretch's colour.
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(s.a + 2, y + 3, s.b - s.a - 4, 3);
    ctx.globalAlpha = 1;
    const ty = y + (L.small ? 18 : 21);
    ctx.font = `600 ${L.font.stage}px ${ink.sans}`;
    ctx.fillStyle = c;
    ctx.fillText(fitText(ctx, label, s.b - s.a - 6), s.a + 3, ty);
    if (timed) {
      ctx.font = `${L.font.small - 0.5}px ${ink.sans}`;
      ctx.fillStyle = ink.muted;
      ctx.fillText(fitText(ctx, text.period, s.b - s.a - 6), s.a + 3, ty + L.font.line - 1);
    }
  }
}

/** A track behind the front one, over one stretch: the same sleepers and rails, a little dimmer. */
function drawSiding(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, s: Seg, color: string, lift: number) {
  const y = L.ground - lift;
  const a = s.a + 4;
  const b = s.b - 4;
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = ink.washMid;
  for (let x = a + 1; x < b - 3; x += L.small ? 7 : 8) ctx.fillRect(x, y - 1, L.small ? 3 : 4, 5);
  ctx.fillStyle = ink.washStrong;
  ctx.fillRect(a, y - 1, b - a, 1);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(a, y + 3, b - a, 2);
  ctx.restore();
}

function drawCart(
  ctx: CanvasRenderingContext2D,
  L: SceneLayout,
  ink: Inks,
  x: number,
  color: string,
  chips: number,
  bump: number,
  alpha: number,
  lift: number
) {
  const hw = L.cartHw;
  const body = L.cartBody;
  const ground = L.ground - lift;
  const y = ground - 4 - bump * 2;
  const d = L.small ? 4 : Math.round(hw * 0.27);
  ctx.save();
  ctx.globalAlpha = alpha * 0.32;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, ground + 1, hw * 0.95, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;
  // Wheels.
  ctx.fillStyle = "#121116";
  ctx.strokeStyle = ink.washStrong;
  ctx.lineWidth = 1;
  for (const wx of [x - hw * 0.55, x + hw * 0.55]) {
    ctx.beginPath();
    ctx.arc(wx, ground - 2.5, L.small ? 2.6 : hw * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  const top = y - body;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = ink.edge;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - hw, y - d * 0.25);
  ctx.lineTo(x, y);
  ctx.lineTo(x, top + d);
  ctx.lineTo(x - hw, top + d * 0.35);
  ctx.closePath();
  ctx.globalAlpha = alpha * 0.94;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + hw, y - d * 0.3);
  ctx.lineTo(x + hw, top + d * 0.45);
  ctx.lineTo(x, top + d);
  ctx.closePath();
  ctx.globalAlpha = alpha * 0.52;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.stroke();
  // A slat on the front, like the home's crates.
  ctx.globalAlpha = alpha * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - hw + 2, y - body * 0.45);
  ctx.lineTo(x - 1, y - body * 0.45 + d * 0.3);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  // Open top: the rim, then the ore inside.
  ctx.beginPath();
  ctx.moveTo(x - hw, top + d * 0.35);
  ctx.lineTo(x, top);
  ctx.lineTo(x + hw, top + d * 0.45);
  ctx.lineTo(x, top + d);
  ctx.closePath();
  ctx.fillStyle = "#121116";
  ctx.fill();
  ctx.stroke();
  // Ore: one chip per miner who sent a NISP (up to 12), heaped in the middle.
  const n = Math.min(12, chips);
  const c = L.small ? 3 : hw * 0.19;
  for (let i = 0; i < n; i++) {
    const row = i < 5 ? 0 : i < 9 ? 1 : i < 11 ? 2 : 3;
    const inRow = row === 0 ? 5 : row === 1 ? 4 : row === 2 ? 2 : 1;
    const idx = i - (row === 0 ? 0 : row === 1 ? 5 : row === 2 ? 9 : 11);
    const cx = x + (idx - (inRow - 1) / 2) * (c + 1.2);
    const cy = top + d * 0.5 - row * (c - 0.6) - 1;
    ctx.fillStyle = ink.gold;
    ctx.fillRect(cx - c / 2, cy - c / 2, c, c);
    ctx.fillStyle = GOLD_HI;
    ctx.fillRect(cx - c / 2, cy - c / 2, Math.max(1, c * 0.35), Math.max(1, c * 0.35));
  }
  ctx.restore();
}

type LabelStyle = "strong" | "compact" | "plain";

/** The first line's font: a round's height in bold mono (smaller when it stands alone behind the lead), else sans. */
function labelFont(L: SceneLayout, ink: Inks, style: LabelStyle): string {
  if (style === "strong") return `600 ${L.font.strong}px ${ink.mono}`;
  if (style === "compact") return `600 ${L.font.small}px ${ink.mono}`;
  return `${L.font.small}px ${ink.sans}`;
}

/** Width of a label, measured in the fonts it is drawn with. */
function labelWidth(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, lines: [string, string], style: LabelStyle): number {
  const sans = `${L.font.small}px ${ink.sans}`;
  ctx.save();
  ctx.font = labelFont(L, ink, style);
  let w = ctx.measureText(lines[0]).width;
  if (lines[1]) {
    ctx.font = sans;
    w = Math.max(w, ctx.measureText(lines[1]).width);
  }
  ctx.restore();
  return w;
}

function drawCoins(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, n: number, pop: number) {
  const cx = (L.payout.a + L.payout.b) / 2;
  const spots = coinSpots(n);
  const rx = L.small ? 4 : 5.4;
  const step = rx * 2 + 0.6;
  spots.forEach((s, i) => {
    const last = i === spots.length - 1;
    const lift = last ? (1 - easeOut(pop)) * 14 : 0;
    const x = cx + s.dx * step;
    const y = L.ground - 3 - s.row * (rx * 0.95) - lift;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = ink.green;
    ctx.fill();
    ctx.strokeStyle = ink.module;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawIdle(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, n: number) {
  const s = idleSize(L);
  const spots = idleSpots(L, n);
  ctx.save();
  // Back rows first.
  for (let i = spots.length - 1; i >= 0; i--) {
    const p = spots[i]!;
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = ink.miner;
    ctx.fillRect(p.x, p.y - s, s, s);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.fillRect(p.x + s - 1, p.y - s, 1, s);
    // Shut eyes.
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#121116";
    ctx.fillRect(p.x + 1, p.y - s * 0.55, Math.max(1, s * 0.28), 1);
    ctx.fillRect(p.x + s * 0.58, p.y - s * 0.55, Math.max(1, s * 0.28), 1);
  }
  ctx.restore();
}

/** Where the next find hangs: under the seam's «now» end. */
function ghostAt(L: SceneLayout): { x: number; y: number } {
  return { x: L.w - (L.small ? 9 : 11), y: L.seam.y + L.seam.h + (L.small ? 15 : 20) };
}

/** The next find: a gem outline on a thread from the seam, with the average wait beside it. */
function drawGhost(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, label: string, u: number): { x: number; y: number; w: number; hh: number } {
  const g = ghostAt(L);
  ctx.save();
  ctx.fillStyle = ink.gold;
  ctx.globalAlpha = 0.45;
  for (let y = L.seam.y + L.seam.h + 2; y < g.y - 3 * u - 2; y += 3) ctx.fillRect(Math.round(g.x - 0.5), y, 1, 1);
  ctx.globalAlpha = 0.6;
  gemOutline(ctx, ink.gold, g.x, g.y, u);
  ctx.globalAlpha = 1;
  ctx.font = `${L.font.small}px ${ink.sans}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const dot = 3;
  const right = g.x - 4 * u - 8;
  ctx.fillStyle = ink.heur;
  ctx.beginPath();
  ctx.arc(right - dot, g.y, dot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink.muted;
  const tw = ctx.measureText(label).width;
  ctx.fillText(label, right - 2 * dot - 5, g.y + 0.5);
  ctx.restore();
  return { x: right - 2 * dot - 5 - tw - 4, y: g.y - 10, w: L.w - (right - 2 * dot - 5 - tw - 4), hh: 20 };
}

function gemOutline(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, u: number) {
  const rows = [3, 5, 7, 5, 3, 1];
  const x0 = Math.round(x);
  const y0 = Math.round(y - (rows.length * u) / 2);
  ctx.fillStyle = color;
  rows.forEach((n, r) => {
    const edge = r === 0 || r === rows.length - 1;
    for (let i = 0; i < n; i++) {
      if (!edge && i !== 0 && i !== n - 1) continue;
      ctx.fillRect(x0 + (i - (n - 1) / 2) * u - u / 2, y0 + r * u, u, u);
    }
  });
}

/** A cut gem in pixels: crown, girdle, pavilion. `u` is the size of one pixel. */
function drawGem(ctx: CanvasRenderingContext2D, ink: Inks, x: number, y: number, u: number) {
  const rows = [3, 5, 7, 5, 3, 1];
  const x0 = Math.round(x);
  const y0 = Math.round(y - (rows.length * u) / 2);
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const left = i < n / 2;
      ctx.fillStyle = r === 0 || (r === 1 && left) ? GOLD_HI : r <= 2 ? ink.gold : left ? ink.gold : GOLD_LO;
      ctx.fillRect(x0 + (i - (n - 1) / 2) * u - u / 2, y0 + r * u, u, u);
    }
  });
}

function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

/** Newest find the cut knows: the latest find height, or the newest round (a find opens a round). */
function newestFind(data: LithosHome | null): number {
  if (!data) return 0;
  return Math.max(data.last?.h ?? 0, data.holding[0]?.h ?? 0);
}

function LithosScene({ data, tip, text, label, tipFor }: SceneInput & { label: string; tipFor: (hit: Hit) => ReactNode }) {
  const host = useRef<HTMLCanvasElement>(null);
  const input = useRef<SceneInput>({ data, tip, text });
  input.current = { data, tip, text };
  const wakeRef = useRef<(ev?: "data") => void>(() => {});
  const hoverRef = useRef(false);
  const hitsRef = useRef<Hit[]>([]);
  const tipFn = useRef(tipFor);
  tipFn.current = tipFor;
  const floatTip = useFloatTip({ within: () => host.current });
  const reduceTick = useMediaTick(REDUCE_QUERY);

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia(REDUCE_QUERY).matches;
    let raf = 0;
    let dead = false;
    let visible = true;
    let ink = readInks(canvas);
    let last = performance.now();
    let introAt = 0;
    let busyUntil = 0;
    let settleUntil = 0;
    let coinPopAt = -1e9;
    let stoneAt = -1e9;
    let findAt = 0;
    let findH = 0;
    let landed = false;
    let prevTip: number | null = null;
    let prevPayout: number | null = null;
    let prevFind = 0;
    let primed = false;
    let wasBusy = false;
    const carts = new Map<number, Cart>();
    const chips: Chip[] = [];
    const knockAt: number[] = [];
    const nextKnock: number[] = [];
    const mark = new Image();
    let markOk = false;
    mark.onload = () => {
      markOk = true;
      wake();
    };
    mark.src = "/lithos-mark.png";

    const paint = (now: number) => {
      raf = 0;
      if (dead) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const parent = canvas.parentElement;
      const w = Math.max(1, parent?.clientWidth ?? 320);
      const h = Math.max(1, parent?.clientHeight ?? 200);
      const dpr = canvasDpr();
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const L = sceneLayout(w, h);
      const { data, tip, text } = input.current;
      const tipH = tip ?? data?.tip.height ?? 0;
      const spots = data ? sceneCarts(data.holding, data.evaluation, tipH) : [];
      const lanes = cartLanes(spots);
      const roundN = Math.min(MAX_MINERS, data?.miners.round ?? data?.holding[0]?.miners ?? 0);
      const registry = data?.miners.registry ?? null;
      const idleN = data ? Math.min(MAX_IDLE, Math.max(0, (registry ?? roundN) - roundN)) : 6;
      const miners = minerSpots(L, roundN);
      const hash = data?.hash ?? null;
      const span = hash ? Math.max(1, (hash.to - hash.from) / 60_000) : 1;
      const seamAt = data?.seam?.at ?? [];

      // Events: the first look, a new block, a new find, a new payout.
      const firstData = !primed && data != null;
      const findNow = newestFind(data);
      if (firstData) {
        primed = true;
        prevTip = tipH;
        prevPayout = data.payoutN;
        prevFind = findNow;
        if (!reduce) {
          introAt = now;
          busyUntil = now + INTRO_MS;
        }
      } else if (data) {
        if (prevTip != null && tipH > prevTip && !reduce) {
          busyUntil = Math.max(busyUntil, now + BLOCK_BURST_MS);
          stoneAt = now;
        }
        prevTip = tipH;
        if (findNow > prevFind) {
          prevFind = findNow;
          if (!reduce) {
            findAt = now;
            findH = findNow;
            landed = false;
            busyUntil = Math.max(busyUntil, now + FIND_MS);
          }
        }
        if (prevPayout != null && data.payoutN > prevPayout && !reduce) coinPopAt = now;
        prevPayout = data.payoutN;
      }

      // Carts follow their rounds. A round that left the check stretch rolls into payout and fades.
      const k = reduce ? 1 : 1 - Math.exp(-dt / 0.32);
      const seen = new Set<number>();
      for (const s of spots) {
        seen.add(s.h);
        const tx = cartX(L, s);
        const tl = (lanes.get(s.h)?.lane ?? 0) * L.lane;
        const c = carts.get(s.h);
        if (!c) {
          // A round we have not seen: on the first look every cart rolls in; later a new round
          // comes in at the start of the collect stretch.
          const isNewRound = !firstData && s.kind === "collect";
          carts.set(s.h, {
            h: s.h,
            kind: s.kind,
            x: reduce ? tx : firstData ? L.collect.a - 24 : isNewRound ? L.collect.a + L.cartHw : tx,
            tx,
            lift: tl,
            tl,
            bumpAt: -1e9,
            alpha: 1,
            leaving: false,
          });
        } else {
          c.kind = s.kind;
          c.tx = tx;
          c.tl = tl;
          c.leaving = false;
        }
      }
      for (const c of carts.values()) {
        if (seen.has(c.h)) continue;
        if (!c.leaving) {
          c.leaving = true;
          c.kind = "pay";
          c.tx = (L.payout.a + L.payout.b) / 2;
          c.tl = 0;
          if (!reduce) coinPopAt = now + 500;
        }
      }
      let moving = false;
      for (const c of [...carts.values()]) {
        c.x += (c.tx - c.x) * k;
        if (Math.abs(c.tx - c.x) < 0.3) c.x = c.tx;
        else moving = true;
        // A cart that becomes the lead of its stretch moves over to the front track.
        c.lift += (c.tl - c.lift) * k;
        if (Math.abs(c.tl - c.lift) < 0.3) c.lift = c.tl;
        else moving = true;
        if (c.leaving) {
          c.alpha = reduce ? 0 : Math.max(0, c.alpha - dt * 1.6);
          if (c.alpha <= 0) carts.delete(c.h);
          else moving = true;
        }
      }

      // Knocks and chips while something is going on. A new burst starts the miners one by one.
      const busy = !reduce && (hoverRef.current || now < busyUntil);
      if (busy && !wasBusy) for (let i = 0; i < MAX_MINERS; i++) nextKnock[i] = now + 60 + i * 110;
      wasBusy = busy;
      const newest = spots.filter((s) => s.kind === "collect").sort((a, b) => b.h - a.h)[0];
      const targetCart = newest ? carts.get(newest.h) : undefined;
      const findT = findAt ? now - findAt : -1;
      const finding = findT >= 0 && findT < FIND_MS;
      if (!finding) findAt = 0;
      for (let i = 0; i < miners.length; i++) {
        nextKnock[i] ??= now + 60 + i * 110;
        // No knocking while the gem is in the air: everyone watches it.
        if (busy && targetCart && now >= nextKnock[i]! && !(finding && findT < GEM_LAND + CHEER_MS)) {
          knockAt[i] = now;
          nextKnock[i] = now + 620 + ((i * 397) % 900);
          chips.push({ x0: miners[i]!.x - 6, y0: miners[i]!.y - 10, t0: now + 120, to: newest!.h });
        }
      }

      const hits: Hit[] = [];
      if (hash) {
        drawSeam(ctx, L, ink, seamAt, span);
        hits.push({ kind: "seam", x: 0, y: L.seam.y - 3, w, hh: L.seam.h + 6 });
      }
      // A new block: a stone drops into the right end of the seam.
      const stoneU = (now - stoneAt) / STONE_MS;
      if (hash && stoneU >= 0 && stoneU < 1) {
        const sx = w - 6;
        const sy = -4 + (L.seam.y + 3 + 4) * Math.min(1, (stoneU / 0.7) ** 2);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(sx, Math.round(sy), 3, 3);
        if (stoneU > 0.7) {
          ctx.globalAlpha = 1 - (stoneU - 0.7) / 0.3;
          ctx.fillStyle = ink.washStrong;
          ctx.fillRect(sx - 3, L.seam.y - 2, 2, 1);
          ctx.fillRect(sx + 4, L.seam.y - 2, 2, 1);
          ctx.globalAlpha = 1;
        }
      }
      // The next find waits under the seam; during a find the gem itself is drawn instead.
      if (hash && text.next && !finding) {
        const box = drawGhost(ctx, L, ink, text.next, L.small ? 1.5 : 2);
        hits.push({ kind: "next", ...box });
      }
      drawRock(ctx, L, ink);
      drawIdle(ctx, L, ink, idleN);
      for (const [kind, seg, color] of [
        ["collect", L.collect, ink.gold],
        ["check", L.check, ink.violet],
      ] as const) {
        let top = 0;
        for (const c of carts.values()) if (c.kind === kind) top = Math.max(top, c.lift);
        for (let i = 1; i * L.lane <= top + L.lane * 0.5; i++) drawSiding(ctx, L, ink, seg, color, i * L.lane);
      }
      drawTrack(ctx, L, ink, text);
      if (data) drawCoins(ctx, L, ink, data.payoutN, (now - coinPopAt) / 420);

      // Carts, back tracks first, then their labels; each label in its stretch's colour. In a stretch
      // with one round the label sits over its cart. In a shared one every round carries a flag: a
      // pole planted in its ore with the text beside it, the lead lowest with its facts, the newer
      // ones above it with the height alone (the tip has the rest).
      const LINE = L.font.line;
      // `round` is the round's height (null for the payout heap); `stretch` colours the pole.
      type Label = { round: number | null; x: number; w: number; h: number; bottom: number; pole?: number; lines: [string, string]; style: LabelStyle; color: string; stretch: string };
      const want: Label[] = [];
      const bodies: Box[] = [];
      const drawn = [...carts.values()].sort((a, b) => b.lift - a.lift || a.x - b.x);
      for (const c of drawn) {
        const s = spots.find((x) => x.h === c.h);
        const bump = now - c.bumpAt < 200 ? Math.sin(((now - c.bumpAt) / 200) * Math.PI) : 0;
        const color = c.kind === "collect" ? ink.gold : c.kind === "check" ? ink.violet : ink.green;
        drawCart(ctx, L, ink, c.x, color, s?.miners ?? 0, bump, c.alpha, c.lift);
        const top = L.ground - c.lift - 4 - L.cartBody;
        bodies.push({ l: c.x - L.cartHw, r: c.x + L.cartHw, top, bottom: L.ground - c.lift });
        if (!s) continue;
        const lane = lanes.get(s.h);
        const collect = s.kind === "collect";
        const style: LabelStyle = !collect ? "plain" : lane?.shared && !lane.lead ? "compact" : "strong";
        const lines: [string, string] = !collect ? [text.checkLeft(s), ""] : style === "compact" ? [text.round(s, L.small)[0], ""] : text.round(s, L.small);
        want.push({
          round: s.h,
          x: c.x,
          w: labelWidth(ctx, L, ink, lines, style),
          h: (lines[1] ? 2 : 1) * LINE,
          bottom: top - (L.small ? 7 : 11),
          pole: lane?.shared ? top + (L.small ? 2 : Math.round(L.cartHw * 0.14)) : undefined,
          lines,
          style,
          color: collect ? ink.text : ink.violet,
          stretch: color,
        });
      }
      // Payout label joins the same placement.
      if (data) {
        const px = (L.payout.a + L.payout.b) / 2;
        const rx = L.small ? 4 : 5.4;
        const lines: [string, string] = [text.payout, ""];
        const bottom = L.ground - 8 - Math.ceil(Math.min(21, data.payoutN) / 6) * rx - 5;
        want.push({ round: null, x: px, w: labelWidth(ctx, L, ink, lines, "plain"), h: LINE, bottom, lines, style: "plain", color: ink.green, stretch: ink.green });
      }
      const placed = placeLabels(want, L.quarry + 2, w - 2, bodies);
      for (const lb of placed) {
        const last = lb.bottom - 3;
        const first = lb.lines[1] ? last - LINE : last;
        if (lb.pole != null) {
          // The pole, from the ore up to the text's first line, with a knob on top.
          const capTop = first - Math.round((lb.style === "strong" ? L.font.strong : L.font.small) * 0.72);
          ctx.fillStyle = lb.stretch;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(Math.round(lb.x) - 0.5, capTop + 2, 1, lb.pole - capTop - 2);
          ctx.globalAlpha = 1;
          ctx.fillRect(Math.round(lb.x) - 1.5, capTop, 3, 3);
        }
        ctx.textAlign = lb.side === 1 ? "left" : lb.side === -1 ? "right" : "center";
        const tx = lb.side === 1 ? lb.x + FLAG_GAP : lb.side === -1 ? lb.x - FLAG_GAP : (lb.l + lb.r) / 2;
        ctx.fillStyle = lb.color;
        ctx.font = labelFont(L, ink, lb.style);
        if (lb.style === "compact") ctx.globalAlpha = 0.82;
        ctx.fillText(lb.lines[0], tx, first);
        ctx.globalAlpha = 1;
        if (lb.lines[1]) {
          ctx.fillStyle = ink.muted;
          ctx.font = `${L.font.small}px ${ink.sans}`;
          ctx.fillText(lb.lines[1], tx, last);
        }
        if (lb.round != null) hits.push({ kind: "cart", h: lb.round, x: lb.l - 2, y: lb.top - 2, w: lb.r - lb.l + 4, hh: lb.bottom - lb.top + 4 });
      }
      ctx.textAlign = "left";
      // Carts under the pointer: the front track wins where carts overlap.
      for (const c of [...drawn].reverse()) {
        if (c.leaving) continue;
        const top = L.ground - c.lift - 4 - L.cartBody;
        hits.push({ kind: "cart", h: c.h, x: c.x - L.cartHw - 3, y: top - 4, w: 2 * L.cartHw + 6, hh: L.cartBody + 9 });
      }
      if (data) hits.push({ kind: "pay", x: L.payout.a, y: L.ground - 56, w: L.payout.b - L.payout.a, hh: 62 });

      // Miners: back row first. Each knock leans a miner into the rock; a find makes them hop.
      const size = 26 * L.minerScale;
      const order2 = miners.map((m, i) => ({ m, i })).sort((a, b) => Number(b.m.back) - Number(a.m.back));
      for (const { m, i } of order2) {
        const since = now - (knockAt[i] ?? -1e9);
        const pick = since >= 0 && since < KNOCK_MS ? Math.sin((since / KNOCK_MS) * Math.PI) : 0;
        const pop = introAt && !reduce ? easeOut((now - introAt - i * 70) / 300) : 1;
        if (pop <= 0) continue;
        const cheerT = finding ? findT - GEM_LAND - i * 45 : -1;
        const cheer = cheerT >= 0 && cheerT < CHEER_MS;
        const watch = finding && findT < GEM_LAND;
        drawPixel(ctx, {
          x: m.x,
          y: m.y,
          scale: L.minerScale * (0.4 + 0.6 * pop),
          color: ink.miner,
          mood: cheer ? "happy" : watch ? "look" : pick > 0.02 ? "work" : "idle",
          now,
          face: cheer || watch ? 1 : -1,
          pick: cheer ? 0 : pick,
          reduce: reduce || !busy,
          id: `lithos-m${i}`,
        });
      }
      if (miners.length) {
        const xs = miners.map((m) => m.x);
        const ys = miners.map((m) => m.y);
        hits.push({
          kind: "miners",
          x: Math.min(...xs) - size,
          y: Math.min(...ys) - size - 4,
          w: Math.max(...xs) - Math.min(...xs) + 2 * size,
          hh: Math.max(...ys) - Math.min(...ys) + size + 8,
        });
      }

      // NISP chips in flight, landing in the round's cart.
      const chipPx = L.small ? 3 : 4;
      for (let j = chips.length - 1; j >= 0; j--) {
        const ch = chips[j]!;
        const cart = carts.get(ch.to);
        const u = (now - ch.t0) / CHIP_MS;
        if (!cart || u > 1) {
          if (cart && u > 1) cart.bumpAt = now;
          chips.splice(j, 1);
          continue;
        }
        if (u < 0) continue;
        const x1 = cart.x;
        const y1 = L.ground - cart.lift - 4 - L.cartBody - 2;
        const x = ch.x0 + (x1 - ch.x0) * u;
        const y = ch.y0 + (y1 - ch.y0) * u - 30 * 4 * u * (1 - u);
        ctx.fillStyle = ink.gold;
        ctx.fillRect(x - chipPx / 2, y - chipPx / 2, chipPx, chipPx);
      }

      // The find: the gem glints in the seam, falls into the new round's cart, the cart takes it,
      // sparks fly, the Lithos mark rises over the cart and the miners hop.
      if (finding && hash) {
        const cart = carts.get(findH) ?? targetCart;
        const gu = L.small ? 1.5 : 2;
        // The gem is the one that hung under the seam: it fills with gold and drops.
        const g = ghostAt(L);
        const sx = g.x;
        const sy = g.y;
        const tx = cart?.x ?? L.collect.a + L.cartHw;
        const ty = L.ground - (cart?.lift ?? 0) - 4 - L.cartBody - 4;
        if (findT < GEM_GLINT) {
          const gl = findT / GEM_GLINT;
          ctx.fillStyle = GOLD_HI;
          const r = 3 + gl * 10;
          ctx.globalAlpha = 1 - gl * 0.6;
          ctx.fillRect(sx - r, sy, 2, 1);
          ctx.fillRect(sx + r - 1, sy, 2, 1);
          ctx.fillRect(sx, sy - r, 1, 2);
          ctx.fillRect(sx, sy + r - 1, 1, 2);
          ctx.globalAlpha = 1;
          gemOutline(ctx, ink.gold, sx, sy, gu);
          ctx.globalAlpha = gl;
          drawGem(ctx, ink, sx, sy, gu);
          ctx.globalAlpha = 1;
        } else if (findT < GEM_LAND) {
          const u = (findT - GEM_GLINT) / GEM_FALL;
          const ex = 1 - (1 - u) ** 2;
          const x = sx + (tx - sx) * ex;
          const y = sy + (ty - sy) * u * u;
          for (let t = 1; t <= 3; t++) {
            const v = Math.max(0, u - t * 0.05);
            ctx.globalAlpha = 0.5 - t * 0.13;
            ctx.fillStyle = ink.gold;
            ctx.fillRect(sx + (tx - sx) * (1 - (1 - v) ** 2) - 1, sy + (ty - sy) * v * v - 1, 2, 2);
          }
          ctx.globalAlpha = 1;
          drawGem(ctx, ink, x, y, gu);
        } else {
          if (!landed) {
            landed = true;
            if (cart) cart.bumpAt = now;
          }
          const t2 = findT - GEM_LAND;
          const su = Math.min(1, t2 / 760);
          if (su < 1) {
            // Sparks fly out of the cart.
            const sp = gu + 2;
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2 + 0.26;
              const d = 6 + easeOut(su) * (L.small ? 24 : 38) * (i % 2 ? 0.75 : 1);
              ctx.globalAlpha = 1 - su * su;
              ctx.fillStyle = i % 3 === 0 ? ink.gold : GOLD_HI;
              ctx.fillRect(Math.round(tx + Math.cos(a) * d), Math.round(ty - 6 + Math.sin(a) * d * 0.7), sp, sp);
            }
            ctx.globalAlpha = 1;
          }
          // The gem stays on the round's ore, the find it brought.
          ctx.globalAlpha = Math.min(1, Math.max(0, (FIND_MS - GEM_LAND - t2) / 420));
          drawGem(ctx, ink, tx, ty - 3 * gu + 2, gu);
          ctx.globalAlpha = 1;
          if (markOk) {
            // The Lithos mark rises over the round, above any label stacked over this cart.
            const size = L.small ? 20 : 28;
            const grow = easeOut(t2 / 240);
            const fade = Math.min(1, Math.max(0, (FIND_MS - GEM_LAND - t2) / 420));
            const s = size * grow;
            let top = ty - 8;
            for (const lb of placed) {
              if (lb.l < tx + size / 2 + 4 && lb.r > tx - size / 2 - 4) top = Math.min(top, lb.top - 4);
            }
            const y = Math.max(L.seam.y + L.seam.h + 4, top - 6 - s - 4 * grow);
            ctx.globalAlpha = fade;
            ctx.drawImage(mark, tx - s / 2, y, s, s);
            ctx.globalAlpha = 1;
          }
        }
      }
      hitsRef.current = hits;

      const knocking = miners.some((_, i) => now - (knockAt[i] ?? -1e9) < KNOCK_MS);
      const active = busy || moving || chips.length > 0 || knocking || now - coinPopAt < 450 || (stoneU >= 0 && stoneU < 1) || finding;
      if (active) settleUntil = now + 500;
      if (visible && (active || now < settleUntil)) raf = requestAnimationFrame(paint);
    };

    const wake = () => {
      if (dead || raf || !visible) return;
      ink = readInks(canvas);
      last = performance.now();
      raf = requestAnimationFrame(paint);
    };
    wakeRef.current = wake;
    const stop = watchOnScreen(canvas, (on) => {
      visible = on;
      if (on) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => wake());
    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    const onInk = () => wake();
    window.addEventListener(INK_EVENT, onInk);
    void document.fonts?.ready.then(() => wake());
    wake();
    return () => {
      dead = true;
      stop();
      ro?.disconnect();
      window.removeEventListener(INK_EVENT, onInk);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduceTick]);

  // New data or a new block: one more frame (and the burst it starts).
  useEffect(() => {
    wakeRef.current("data");
  }, [data, tip, text]);

  const pick = (ev: { clientX: number; clientY: number }): Hit | null => {
    const canvas = host.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    return hitsRef.current.find((hh) => x >= hh.x && x <= hh.x + hh.w && y >= hh.y && y <= hh.y + hh.hh) ?? null;
  };

  return (
    <canvas
      ref={host}
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label={label}
      onPointerEnter={(ev) => {
        if (ev.pointerType === "touch") return;
        hoverRef.current = true;
        wakeRef.current();
      }}
      onPointerMove={(ev) => {
        if (ev.pointerType === "touch") return;
        const hit = pick(ev);
        const canvas = host.current;
        const content = hit ? tipFn.current(hit) : null;
        if (!hit || !canvas || !content) {
          floatTip.hide();
          return;
        }
        const r = canvas.getBoundingClientRect();
        const rect = { left: r.left + hit.x, top: r.top + hit.y, width: hit.w, height: hit.hh };
        floatTip.show(rect, content);
      }}
      onPointerLeave={(ev) => {
        if (ev.pointerType === "touch") return;
        hoverRef.current = false;
        floatTip.hide();
      }}
    />
  );
}

function Fact({ children, ev, hint, className }: { children: ReactNode; ev: "decoded" | "heuristic" | "chain"; hint?: string; className?: string }) {
  return (
    <Tip content={hint}>
      <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
        {children}
        <EvidenceDot kind={ev} />
      </span>
    </Tip>
  );
}

/** The tile's tag in the Lithos mark's violet, black ink (≈ 8.6 : 1), like the other home tiles. */
const LITHOS_TAG = { "--tag": "var(--k-nft, #c19fe9)", "--tag-ink": "#0e0e0e", "--mark": "var(--k-nft, #c19fe9)" } as CSSProperties;

export function HomeLithos({ data, tipHeight, enter = 0 }: { data: LithosHome | null; tipHeight: number | null; enter?: number }) {
  const { t, tn, locale } = useI18n();
  const now = useNow(60_000);
  const hash = data?.hash ?? null;
  const hs = splitHashrate(hash?.hs);
  const days = hash ? formatWindowDays(hash.to - hash.from, locale) : "";
  const share = hash && hash.netN > 0 ? formatShare((hash.n / hash.netN) * 100, locale) : null;
  const tip = tipHeight ?? data?.tip.height ?? null;
  // Mean time between Lithos finds over the window. Finds are random: an average, not a countdown.
  const meanFind = hash && hash.n >= 2 && hash.to > hash.from ? (hash.to - hash.from) / hash.n : null;

  const text = useMemo<SceneText>(
    () => ({
      collect: t("homeLithos.stageCollectShort"),
      check: t("lithosH.stageCheckShort"),
      pay: t("lithosH.stagePay"),
      period: tn("lithosH.hashBlocks", LITHOS_HOLDING_PERIOD, formatInt(LITHOS_HOLDING_PERIOD, locale)),
      next: meanFind != null ? t("homeLithos.next").replace("{t}", formatSpan(meanFind, locale, true)) : null,
      round: (c, small) => [
        formatInt(c.h, locale),
        small
          ? `${ergText(c.bank, locale)} ERG`
          : `${t("lithosH.roundMiners").replace("{n}", formatInt(c.miners, locale))} · ${ergText(c.bank, locale)} ERG`,
      ],
      checkLeft: (c) => t("lithosH.toPayoutShort").replace("{list}", formatInt(c.left, locale)),
      payout: data ? `${formatInt(data.payoutN, locale)} · ${ergText(data.payoutNano, locale)} ERG` : "",
    }),
    [t, tn, locale, data, meanFind]
  );

  const seamHint =
    hash && data?.seam
      ? t(data.seam.approx ? "homeLithos.seamHintApprox" : "homeLithos.seamHint")
          .replace("{n}", formatInt(hash.n, locale))
          .replace("{net}", formatInt(hash.netN, locale))
          .replace("{days}", days)
      : null;

  const tipFor = (hit: Hit): ReactNode => {
    if (!data) return null;
    if (hit.kind === "next") {
      if (!hash || meanFind == null) return null;
      return (
        <>
          <TipHead chip={t("trust.evidence.heuristic.short")} ink="var(--k-rent, #d99b2b)">
            {text.next}
          </TipHead>
          <p className="m-0 max-w-[280px] text-[12px] leading-[1.35] text-[var(--muted)]">
            {t("homeLithos.nextTip").replace("{days}", days).replace("{n}", formatInt(hash.n, locale))}
          </p>
        </>
      );
    }
    if (hit.kind === "seam") {
      if (!hash || !seamHint) return null;
      return (
        <>
          <TipHead chip={t("homeLithos.seamChip")} ink="var(--c-block)">
            {t("homeLithos.seamLithos").replace("{n}", formatInt(hash.n, locale)).replace("{share}", share ?? "—")}
          </TipHead>
          <p className="m-0 max-w-[280px] text-[12px] leading-[1.35] text-[var(--muted)]">{seamHint}</p>
        </>
      );
    }
    if (hit.kind === "pay") {
      return (
        <>
          <TipHead chip={t("lithosH.stagePay")} ink="var(--up)">
            {tn("homeLithos.payoutTip", data.payoutN, formatInt(data.payoutN, locale))}
          </TipHead>
          <TipRows>
            <TipRow label={t("homeLithos.rowLeft")}>{ergText(data.payoutNano, locale)} ERG</TipRow>
          </TipRows>
        </>
      );
    }
    if (hit.kind === "miners") {
      const r = data.holding[0];
      return (
        <>
          <TipHead chip={t("homeLithos.minersChip")} ink="var(--brand-new)">
            {t("homeLithos.minersTip")
              .replace("{n}", formatInt(data.miners.round ?? r?.miners ?? 0, locale))
              .replace("{h}", r ? formatInt(r.h, locale) : "—")}
          </TipHead>
          {data.miners.registry != null ? (
            <TipRows>
              <TipRow label={t("homeLithos.rowRegistry")}>{formatInt(data.miners.registry, locale)}</TipRow>
            </TipRows>
          ) : null}
        </>
      );
    }
    const spot = sceneCarts(data.holding, data.evaluation, tip ?? data.tip.height).find((c) => c.h === hit.h);
    if (!spot) return null;
    const collect = spot.kind === "collect";
    return (
      <>
        <TipHead chip={collect ? t("homeLithos.stageCollectChip") : t("lithosH.stageCheckShort")} ink={collect ? "var(--c-block)" : "var(--k-nft)"}>
          {t("homeLithos.roundTip").replace("{h}", formatInt(spot.h, locale))}
        </TipHead>
        <TipRows>
          <TipRow label={t("homeLithos.rowMiners")}>{formatInt(spot.miners, locale)}</TipRow>
          <TipRow label={t("homeLithos.rowBank")}>{ergText(spot.bank, locale)} ERG</TipRow>
          <TipRow label={collect ? t("homeLithos.rowCollectLeft") : t("homeLithos.rowPayoutIn")}>
            {spot.left > 0
              ? `${tn("lithosH.hashBlocks", spot.left, formatInt(spot.left, locale))} · ≈ ${formatSpan(blocksToMs(spot.left), locale, true)}`
              : t("lithosH.awaiting")}
          </TipRow>
        </TipRows>
      </>
    );
  };

  const lastAgo = data?.last ? formatSpan(Math.max(0, now - data.last.ts), locale) : null;

  return (
    <section
      className="home-tile-enter home-meet-right min-w-0 max-lg:order-5 lg:h-full"
      style={{ "--enter": enter } as CSSProperties}
    >
      <Link
        prefetch={false}
        href="/lithos"
        aria-label={t("homeLithos.aria")}
        className="mod group flex h-full min-h-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 text-[var(--text)] no-underline sm:px-5"
        style={LITHOS_TAG}
      >
        <div className="flex h-[22px] shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
              {t("homeLithos.title")}
            </h2>
            <span className="truncate text-[12px] leading-none text-[var(--muted-2)]">{t("homeLithos.tagline")}</span>
          </div>
          {hs ? (
            <Tip content={t("lithosH.hashHint")}>
              <p className="m-0 flex shrink-0 items-baseline gap-1 whitespace-nowrap leading-none">
                <span className="text-[22px] font-semibold tabular-nums tracking-tight">
                  <ReelText text={hs.value} />
                </span>
                <span className="text-[12px] text-[var(--muted)]">{hs.unit}</span>
                {hash ? (
                  <span className="text-[11px] text-[var(--muted-2)]">±{formatInt(Math.round(hash.err * 100), locale)}%</span>
                ) : null}
                <EvidenceDot kind="heuristic" className="ml-0.5 self-center" />
              </p>
            </Tip>
          ) : null}
        </div>

        {hash ? (
          <div className="mt-2.5 flex shrink-0 items-center justify-between gap-2 font-mono text-[10.5px] leading-none text-[var(--muted-2)]">
            <span className="truncate">
              {tn("homeLithos.seamNet", hash.netN, formatInt(hash.netN, locale)).replace("{days}", days)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-2">
              <Tip content={seamHint ?? undefined}>
                <span className="inline-flex items-center gap-1.5 text-[var(--c-block,#ebcb71)]">
                  {t("homeLithos.seamLithos").replace("{n}", formatInt(hash.n, locale)).replace("{share}", share ?? "—")}
                  <EvidenceDot kind="decoded" />
                </span>
              </Tip>
              <EvidenceBadge kind="decoded" compact className="max-sm:hidden" />
            </span>
          </div>
        ) : null}

        <div className="relative mt-1 h-[214px] min-h-0 shrink-0 lg:h-auto lg:min-h-[200px] lg:flex-1">
          <LithosScene data={data} tip={tip} text={text} label={t("homeLithos.aria")} tipFor={tipFor} />
        </div>

        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[1.25] text-[var(--muted)]">
          {data ? (
            <>
              {data.miners.round != null ? (
                <Fact ev="decoded" hint={t("lithosH.minersHint")}>
                  {t("homeLithos.miners")
                    .replace("{n}", formatInt(data.miners.round, locale))
                    .replace("{total}", data.miners.registry != null ? formatInt(data.miners.registry, locale) : "—")}
                </Fact>
              ) : null}
              <Fact ev="decoded">
                {t("homeLithos.blocks")
                  .replace("{d1}", formatInt(data.blocks.d1, locale))
                  .replace("{d7}", formatInt(data.blocks.d7, locale))}
              </Fact>
              {lastAgo ? (
                <Fact ev="decoded" className="max-sm:hidden">
                  <span suppressHydrationWarning>{t("homeLithos.last").replace("{t}", lastAgo)}</span>
                </Fact>
              ) : null}
            </>
          ) : (
            <span>{t("homeLithos.quiet")}</span>
          )}
          <span className="ml-auto whitespace-nowrap text-[13px] text-[var(--muted)] group-hover:text-[var(--text)]">
            {t("homeLithos.open")} →
          </span>
        </div>
      </Link>
    </section>
  );
}

export default HomeLithos;

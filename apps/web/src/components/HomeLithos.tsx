"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LithosHome } from "@ergoscan/shared";
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
  cartX,
  coinSpots,
  idleSpots,
  minerSpots,
  sceneCarts,
  sceneLayout,
  stackLabels,
  type CartSpot,
  type SceneLayout,
} from "@/lib/lithos-home-scene";

/**
 * Home «Lithos»: how the pool works, drawn with the live numbers. The round's miners (little
 * «Пиксели») knock NISP chips off the quarry into the round's cart; carts roll along NISP
 * collection, the fraud-proof check and payout at the real progress of each round at the chain
 * tip; registered miners outside the round doze on the back ledge. Above it, the network seam:
 * every Ergo block of the hashrate window, the Lithos ones in gold.
 *
 * Frames only when something happens: the first look, a new block or round, a hover. Off screen
 * and on a hidden tab nothing is drawn; under reduced motion every change is one still frame.
 */

const MAX_MINERS = 16;
const MAX_IDLE = 28;
const KNOCK_MS = 260;
const CHIP_MS = 560;
const INTRO_MS = 1500;
const BLOCK_BURST_MS = 1300;
const ROUND_BURST_MS = 2400;

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
    sans: `${v("--font-sans", "")}${v("--font-sans", "") ? ", " : ""}ui-sans-serif, system-ui, sans-serif`,
    mono: `${v("--font-mono", "")}${v("--font-mono", "") ? ", " : ""}ui-monospace, monospace`,
  };
}

type Cart = {
  h: number;
  kind: CartSpot["kind"] | "pay";
  x: number;
  tx: number;
  /** Lithos mark falls onto a new round's cart from this time. 0: no mark. */
  dropAt: number;
  bumpAt: number;
  alpha: number;
  leaving: boolean;
};

type Chip = { x0: number; y0: number; t0: number; to: number };

type Hit = { kind: "cart" | "pay" | "miners"; h?: number; x: number; y: number; w: number; hh: number };

/** Labels that the canvas draws, already in the page language. */
export type SceneText = {
  collect: string;
  collectShort: string;
  check: string;
  checkShort: string;
  pay: string;
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

function drawRock(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks) {
  const { steps, cliff, cliffTop, ground, quarry, backEnd } = L;
  // Back ledge: the dozing miners sit on it.
  ctx.fillStyle = ink.wash;
  ctx.fillRect(0, cliffTop, backEnd, ground - cliffTop);
  ctx.fillStyle = ink.washStrong;
  ctx.fillRect(0, cliffTop, backEnd, 2);
  // Front rock with the steps cut into it.
  const path = new Path2D();
  path.moveTo(0, cliffTop + 10);
  path.lineTo(cliff, cliffTop + 10);
  path.lineTo(cliff, steps[0]!.top);
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]!;
    path.lineTo(s.x1, s.top);
    path.lineTo(s.x1, k + 1 < steps.length ? steps[k + 1]!.top : ground);
  }
  path.lineTo(quarry, ground);
  path.lineTo(0, ground);
  path.closePath();
  ctx.fillStyle = ink.washMid;
  ctx.fill(path);
  // Stone courses: grout lines inside the rock.
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = ink.module;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const course = L.small ? 9 : 11;
  for (let y = ground - course, row = 0; y > cliffTop; y -= course, row++) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(quarry, y + 0.5);
    for (let x = (row % 2) * 9 + 4; x < quarry; x += 18) {
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + course);
    }
  }
  ctx.stroke();
  ctx.restore();
  // Lit tops of the steps and the face.
  ctx.fillStyle = ink.washStrong;
  ctx.fillRect(0, cliffTop + 10, cliff, 2);
  for (const s of steps) ctx.fillRect(s.x0, s.top, s.x1 - s.x0, 2);
  // A few gold stones in the face: Lithos is a stone.
  ctx.fillStyle = ink.gold;
  const flecks: [number, number][] = [
    [0.35, 0.3],
    [0.6, 0.62],
    [0.18, 0.78],
  ];
  for (const [fx, fy] of flecks) {
    const x = Math.round(fx * cliff * 1.8);
    const y = Math.round(cliffTop + 14 + fy * (ground - cliffTop - 18));
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

function drawTrack(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, text: SceneText) {
  const y = L.ground;
  ctx.fillStyle = ink.washMid;
  for (let x = L.collect.a + 2; x < L.payout.b; x += 9) ctx.fillRect(x, y + 1, 4, 3);
  const segs: [typeof L.collect, string, string][] = [
    [L.collect, ink.gold, L.small ? text.collectShort : text.collect],
    [L.check, ink.violet, L.small ? text.checkShort : text.check],
    [L.payout, ink.green, text.pay],
  ];
  ctx.font = `${L.small ? 10 : 10.5}px ${ink.sans}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const [s, c, label] of segs) {
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(s.a + 1.5, y - 1, s.b - s.a - 3, 2.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink.muted;
    ctx.fillText(fitText(ctx, label, s.b - s.a - 6), s.a + 3, y + 17);
  }
}

function drawCart(
  ctx: CanvasRenderingContext2D,
  L: SceneLayout,
  ink: Inks,
  x: number,
  color: string,
  chips: number,
  bump: number,
  alpha: number
) {
  const hw = L.cartHw;
  const body = L.cartBody;
  const y = L.ground - 4 - bump * 2;
  const d = L.small ? 4 : Math.round(hw * 0.27);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Wheels.
  ctx.fillStyle = "#121116";
  ctx.strokeStyle = ink.washStrong;
  ctx.lineWidth = 1;
  for (const wx of [x - hw * 0.55, x + hw * 0.55]) {
    ctx.beginPath();
    ctx.arc(wx, L.ground - 2.5, L.small ? 2.4 : hw * 0.16, 0, Math.PI * 2);
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
  ctx.fillStyle = ink.gold;
  const n = Math.min(12, chips);
  const c = L.small ? 3 : hw * 0.19;
  for (let i = 0; i < n; i++) {
    const row = i < 5 ? 0 : i < 9 ? 1 : i < 11 ? 2 : 3;
    const inRow = row === 0 ? 5 : row === 1 ? 4 : row === 2 ? 2 : 1;
    const idx = i - (row === 0 ? 0 : row === 1 ? 5 : row === 2 ? 9 : 11);
    const cx = x + (idx - (inRow - 1) / 2) * (c + 1.2);
    const cy = top + d * 0.5 - row * (c - 0.6) - 1;
    ctx.fillRect(cx - c / 2, cy - c / 2, c, c);
  }
  ctx.restore();
}

/** Width of a cart or payout label, measured in the fonts it is drawn with (the first line is bold mono only on the collect cart). */
function labelWidth(ctx: CanvasRenderingContext2D, L: SceneLayout, ink: Inks, lines: [string, string], strong: boolean): number {
  const sans = `${L.small ? 10 : 10.5}px ${ink.sans}`;
  ctx.save();
  ctx.font = strong ? `600 ${L.small ? 10.5 : 11}px ${ink.mono}` : sans;
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
  const rx = L.small ? 3.6 : 4.4;
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
  const s = L.small ? 6 : 7;
  ctx.save();
  for (const p of idleSpots(L, n)) {
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = ink.miner;
    ctx.fillRect(p.x, p.y - s, s, s);
    // Shut eyes.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#121116";
    ctx.fillRect(p.x + 1, p.y - s * 0.55, s * 0.28, 1);
    ctx.fillRect(p.x + s * 0.58, p.y - s * 0.55, s * 0.28, 1);
  }
  ctx.restore();
}

function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
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
    let prevTip: number | null = null;
    let prevPayout: number | null = null;
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
      const roundN = Math.min(MAX_MINERS, data?.miners.round ?? data?.holding[0]?.miners ?? 0);
      const registry = data?.miners.registry ?? null;
      const idleN = data ? Math.min(MAX_IDLE, Math.max(0, (registry ?? roundN) - roundN)) : 6;
      const miners = minerSpots(L, roundN);

      // Events: the first look, a new block, a new round, a new payout.
      const firstData = !primed && data != null;
      if (firstData) {
        primed = true;
        prevTip = tipH;
        prevPayout = data.payoutN;
        if (!reduce) {
          introAt = now;
          busyUntil = now + INTRO_MS;
        }
      } else if (data) {
        if (prevTip != null && tipH > prevTip && !reduce) busyUntil = Math.max(busyUntil, now + BLOCK_BURST_MS);
        prevTip = tipH;
        if (prevPayout != null && data.payoutN > prevPayout && !reduce) coinPopAt = now;
        prevPayout = data.payoutN;
      }

      // Carts follow their rounds. A round that left the check stretch rolls into payout and fades.
      const k = reduce ? 1 : 1 - Math.exp(-dt / 0.32);
      const seen = new Set<number>();
      for (const s of spots) {
        seen.add(s.h);
        const tx = cartX(L, s);
        const c = carts.get(s.h);
        if (!c) {
          // A round we have not seen: on the first look every cart rolls in; later only a new round does.
          const isNewRound = !firstData && s.kind === "collect";
          carts.set(s.h, {
            h: s.h,
            kind: s.kind,
            x: reduce ? tx : firstData ? L.collect.a - 24 : isNewRound ? L.collect.a + L.cartHw : tx,
            tx,
            dropAt: isNewRound && !reduce ? now + 260 : 0,
            bumpAt: -1e9,
            alpha: 1,
            leaving: false,
          });
          if (isNewRound && !reduce) busyUntil = Math.max(busyUntil, now + ROUND_BURST_MS);
        } else {
          c.kind = s.kind;
          c.tx = tx;
          c.leaving = false;
        }
      }
      for (const c of carts.values()) {
        if (seen.has(c.h)) continue;
        if (!c.leaving) {
          c.leaving = true;
          c.kind = "pay";
          c.tx = (L.payout.a + L.payout.b) / 2;
          if (!reduce) coinPopAt = now + 500;
        }
      }
      let moving = false;
      for (const c of [...carts.values()]) {
        c.x += (c.tx - c.x) * k;
        if (Math.abs(c.tx - c.x) < 0.3) c.x = c.tx;
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
      const target = spots.find((s) => s.kind === "collect");
      const targetCart = target ? carts.get(target.h) : undefined;
      for (let i = 0; i < miners.length; i++) {
        nextKnock[i] ??= now + 60 + i * 110;
        if (busy && targetCart && now >= nextKnock[i]!) {
          knockAt[i] = now;
          nextKnock[i] = now + 620 + ((i * 397) % 900);
          chips.push({ x0: miners[i]!.x - 6, y0: miners[i]!.y - 10, t0: now + 120, to: target!.h });
        }
      }

      drawRock(ctx, L, ink);
      drawIdle(ctx, L, ink, idleN);
      drawTrack(ctx, L, ink, text);
      if (data) drawCoins(ctx, L, ink, data.payoutN, (now - coinPopAt) / 420);

      // Carts and their labels.
      const hits: Hit[] = [];
      // Label boxes: x is clamped into the track first, y is the bottom of the box (last baseline + descent).
      const LINE = 12.5;
      const labels: { x: number; w: number; y: number; h: number; lines: [string, string]; strong: boolean }[] = [];
      const label = (x: number, base: number, lines: [string, string], strong: boolean) => {
        const wTxt = labelWidth(ctx, L, ink, lines, strong);
        const half = wTxt / 2;
        const cx = Math.min(w - 2 - half, Math.max(L.quarry + 2 + half, x));
        labels.push({ x: cx, w: wTxt, y: base + 3, h: (lines[1] ? 2 : 1) * LINE, lines, strong });
      };
      ctx.font = `600 ${L.small ? 10.5 : 11}px ${ink.mono}`;
      const order = [...carts.values()].sort((a, b) => a.x - b.x);
      for (const c of order) {
        const s = spots.find((x) => x.h === c.h);
        const bump = now - c.bumpAt < 200 ? Math.sin(((now - c.bumpAt) / 200) * Math.PI) : 0;
        const color = c.kind === "collect" ? ink.gold : c.kind === "check" ? ink.violet : ink.green;
        drawCart(ctx, L, ink, c.x, color, s?.miners ?? 0, bump, c.alpha);
        if (c.dropAt > 0 && markOk) {
          const u = (now - c.dropAt) / 420;
          if (u >= 0) {
            const size = L.small ? 13 : 16;
            const fall = (1 - easeOut(u)) * 46;
            const topY = L.ground - 4 - L.cartBody - size - 2 - fall;
            ctx.globalAlpha = u < 2.4 ? 1 : Math.max(0, 1 - (u - 2.4) * 2);
            ctx.drawImage(mark, c.x - size / 2, topY, size, size);
            ctx.globalAlpha = 1;
            if (u > 2.9) c.dropAt = 0;
            else moving = true;
          } else moving = true;
        }
        if (!s) continue;
        const lines: [string, string] = s.kind === "collect" ? text.round(s, L.small) : [text.checkLeft(s), ""];
        label(c.x, L.ground - 6 - L.cartBody - 8, lines, s.kind === "collect");
        hits.push({ kind: "cart", h: s.h, x: c.x - L.cartHw - 4, y: L.ground - L.cartBody - 40, w: 2 * L.cartHw + 8, hh: L.cartBody + 44 });
      }
      // Payout label joins the same stacking.
      if (data) {
        const px = (L.payout.a + L.payout.b) / 2;
        label(px, L.ground - 6 - Math.ceil(Math.min(21, data.payoutN) / 6) * 4.5 - 10, [text.payout, ""], false);
        hits.push({ kind: "pay", x: L.payout.a, y: L.ground - 50, w: L.payout.b - L.payout.a, hh: 56 });
      }
      const stacked = stackLabels(labels);
      for (const lb of stacked) {
        const lineH = LINE;
        const baseY = lb.y - 3 - lb.lift - (lb.lines[1] ? lineH : 0);
        const x = lb.x;
        ctx.textAlign = "center";
        ctx.fillStyle = lb.strong ? ink.text : ink.muted;
        ctx.font = lb.strong ? `600 ${L.small ? 10.5 : 11}px ${ink.mono}` : `${L.small ? 10 : 10.5}px ${ink.sans}`;
        ctx.fillText(lb.lines[0], x, baseY);
        if (lb.lines[1]) {
          ctx.fillStyle = ink.muted;
          ctx.font = `${L.small ? 10 : 10.5}px ${ink.sans}`;
          ctx.fillText(lb.lines[1], x, baseY + lineH);
        }
      }
      ctx.textAlign = "left";

      // Miners: back row first. Each knock leans a miner into the rock.
      const size = 26 * L.minerScale;
      const order2 = miners.map((m, i) => ({ m, i })).sort((a, b) => Number(b.m.back) - Number(a.m.back));
      for (const { m, i } of order2) {
        const since = now - (knockAt[i] ?? -1e9);
        const pick = since >= 0 && since < KNOCK_MS ? Math.sin((since / KNOCK_MS) * Math.PI) : 0;
        const pop = introAt && !reduce ? easeOut((now - introAt - i * 70) / 300) : 1;
        if (pop <= 0) continue;
        drawPixel(ctx, {
          x: m.x,
          y: m.y,
          scale: L.minerScale * (0.4 + 0.6 * pop),
          color: ink.miner,
          mood: pick > 0.02 ? "work" : "idle",
          now,
          face: -1,
          pick,
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
        const y1 = L.ground - 4 - L.cartBody - 2;
        const x = ch.x0 + (x1 - ch.x0) * u;
        const y = ch.y0 + (y1 - ch.y0) * u - 30 * 4 * u * (1 - u);
        ctx.fillStyle = ink.gold;
        ctx.fillRect(x - 1.8, y - 1.8, 3.6, 3.6);
      }
      hitsRef.current = hits;

      const knocking = miners.some((_, i) => now - (knockAt[i] ?? -1e9) < KNOCK_MS);
      const active = busy || moving || chips.length > 0 || knocking || now - coinPopAt < 450;
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

export function HomeLithos({ data, tipHeight, enter = 0 }: { data: LithosHome | null; tipHeight: number | null; enter?: number }) {
  const { t, tn, locale } = useI18n();
  const now = useNow(60_000);
  const hash = data?.hash ?? null;
  const hs = splitHashrate(hash?.hs);
  const days = hash ? formatWindowDays(hash.to - hash.from, locale) : "";
  const share = hash && hash.netN > 0 ? formatShare((hash.n / hash.netN) * 100, locale) : null;
  const tip = tipHeight ?? data?.tip.height ?? null;

  const text = useMemo<SceneText>(
    () => ({
      collect: t("homeLithos.stageCollect"),
      collectShort: t("homeLithos.stageCollectShort"),
      check: t("homeLithos.stageCheck"),
      checkShort: t("lithosH.stageCheckShort"),
      pay: t("lithosH.stagePay"),
      round: (c, small) => [
        formatInt(c.h, locale),
        small
          ? `${ergText(c.bank, locale)} ERG`
          : `${t("lithosH.roundMiners").replace("{n}", formatInt(c.miners, locale))} · ${ergText(c.bank, locale)} ERG`,
      ],
      checkLeft: (c) => t("lithosH.toPayoutShort").replace("{list}", formatInt(c.left, locale)),
      payout: data ? `${formatInt(data.payoutN, locale)} · ${ergText(data.payoutNano, locale)} ERG` : "",
    }),
    [t, locale, data]
  );

  const tipFor = (hit: Hit): ReactNode => {
    if (!data) return null;
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

  const seam = data?.seam ?? null;
  const span = hash ? Math.max(1, (hash.to - hash.from) / 60_000) : 1;
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

        {hash && seam ? (
          <Tip
            content={t(seam.approx ? "homeLithos.seamHintApprox" : "homeLithos.seamHint")
              .replace("{n}", formatInt(hash.n, locale))
              .replace("{net}", formatInt(hash.netN, locale))
              .replace("{days}", days)}
          >
            <div className="mt-2.5 shrink-0">
              <svg
                className="block h-[10px] w-full overflow-visible"
                viewBox="0 0 1000 10"
                preserveAspectRatio="none"
                aria-hidden
              >
                <rect x="0" y="2" width="1000" height="6" rx="3" fill="var(--wash-mid)" />
                {seam.at.map((m, i) => {
                  const x = Math.min(999, Math.max(1, (m / span) * 1000));
                  return (
                    <line
                      key={`${m}-${i}`}
                      x1={x}
                      x2={x}
                      y1="0"
                      y2="10"
                      stroke="var(--c-block, #ebcb71)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>
              <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10.5px] leading-none text-[var(--muted-2)]">
                <span className="truncate">
                  {tn("homeLithos.seamNet", hash.netN, formatInt(hash.netN, locale)).replace("{days}", days)}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--c-block,#ebcb71)]">
                  {t("homeLithos.seamLithos").replace("{n}", formatInt(hash.n, locale)).replace("{share}", share ?? "—")}
                  <EvidenceDot kind="decoded" />
                </span>
              </div>
            </div>
          </Tip>
        ) : null}

        <div className="relative mt-2 h-[192px] min-h-0 shrink-0 lg:h-auto lg:min-h-[180px] lg:flex-1">
          <LithosScene data={data} tip={tip} text={text} label={t("homeLithos.aria")} tipFor={tipFor} />
          {data ? (
            <span className="pointer-events-none absolute right-0 top-0">
              <EvidenceBadge kind="decoded" compact />
            </span>
          ) : null}
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

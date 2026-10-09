"use client";

/**
 * Mix pit (block / tx aside): quiet cluster, same sphere stack as the home well.
 * Seal well (`well`): balls wait, then arc to the left edge and dissolve. Own canvas 2D.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { formatErgPrecise, shortId } from "@/lib/format";
import { txChipCaption } from "@/lib/tx-lock";
import { usePageSync, useStreamMempool } from "@/lib/page-sync";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import {
  FLASH_MS,
  MAX_BALLS,
  MORE_ID,
  assignPackRadii,
  attractorOf,
  beginSeal,
  birthScale,
  ensureIncludedBodies,
  fallingIntoMouth,
  mergeWellSeeds,
  visibleCount,
  makeWellBody,
  markMissing,
  pickWellSeeds,
  pokeWell,
  pourSeedsOf,
  sealExit,
  sealProgress,
  seedRate,
  stepWell,
  sweepDead,
  type PourSeed,
  type WellBody,
  type WellScale,
  type WellSeed,
} from "@/lib/seal-well";

export type TxBallSeed = {
  id: string;
  size: number;
  color: string;
  fee?: number;
  feeRate?: number;
  category?: string;
  action?: string | null;
  platform?: string | null;
  firstSeen?: number;
  /** Omit → `/tx/:id`. `null` → no navigation (ERG / fee mix). */
  href?: string | null;
  title?: string;
  kind?: "circle" | "hex";
  value?: number | null;
};

type MixBody = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  born: number;
  href: string | null;
  title: string;
  kind: "circle" | "hex";
};

const MIX_MAX = 48;
const MIX_REST = 0.35;
/** Home well: balls stop at the tile floor; their contact shadow may paint past it. */
const HOME_SHADOW_BLEED = 14;

/** Viewport point → canvas pixels. The opening flight scales the painted box; the well stays in layout size. */
function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth || rect.width || 1;
  const h = canvas.clientHeight || rect.height || 1;
  const rw = rect.width || w;
  const rh = rect.height || h;
  return {
    x: ((clientX - rect.left) * w) / rw,
    y: ((clientY - rect.top) * h) / rh,
  };
}

function unit(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function radiiFor(n: number, sizes: number[], area: number, minSide: number): number[] {
  if (n === 0) return [];
  const fill = n <= 3 ? 0.44 : n <= 8 ? 0.36 : n <= 16 ? 0.3 : 0.26;
  const maxR = Math.min(
    minSide * (n <= 3 ? 0.38 : n <= 8 ? 0.28 : 0.22),
    n <= 3 ? 28 : n <= 8 ? 20 : n <= 16 ? 14 : 11
  );
  const minR = n <= 3 ? 10 : n <= 8 ? 6.5 : 4.5;
  const weights = sizes.map((s) => Math.max(80, s));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const target = Math.max(64, area * fill);
  const k = Math.sqrt(target / (Math.PI * sumW));
  let rs = weights.map((w) => Math.min(maxR, Math.max(minR, k * Math.sqrt(w))));
  const packed = rs.reduce((a, r) => a + Math.PI * r * r, 0);
  if (packed > target) {
    const s = Math.sqrt(target / packed);
    rs = rs.map((r) => Math.max(minR * 0.8, r * s));
  }
  return rs;
}

function mixCollide(a: MixBody, b: MixBody) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = a.r + b.r;
  if (dist >= min) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = min - dist;
  const ma = a.r * a.r;
  const mb = b.r * b.r;
  const sum = ma + mb;
  a.x -= nx * overlap * (mb / sum);
  a.y -= ny * overlap * (mb / sum);
  b.x += nx * overlap * (ma / sum);
  b.y += ny * overlap * (ma / sum);
  const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rv > 0) return;
  const j = (-(1 + MIX_REST) * rv) / (1 / ma + 1 / mb);
  a.vx += (j / ma) * nx;
  a.vy += (j / ma) * ny;
  b.vx -= (j / mb) * nx;
  b.vy -= (j / mb) * ny;
}

function mixWalls(b: MixBody, w: number, h: number) {
  const p = 2;
  if (b.x < b.r + p) {
    b.x = b.r + p;
    if (b.vx < 0) b.vx *= 0.25;
  } else if (b.x > w - b.r - p) {
    b.x = w - b.r - p;
    if (b.vx > 0) b.vx *= 0.25;
  }
  if (b.y < b.r + p) {
    b.y = b.r + p;
    if (b.vy < 0) b.vy *= 0.25;
  } else if (b.y > h - b.r - p) {
    b.y = h - b.r - p;
    if (b.vy > 0) b.vy *= 0.25;
  }
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function paintMix(ctx: CanvasRenderingContext2D, bodies: MixBody[], hover: string | null, now: number) {
  const ordered = bodies.slice().sort((a, b) => a.y - b.y);
  for (const b of ordered) {
    const age = Math.min(1, (now - b.born) / 400);
    const hoverOn = hover === b.id;
    const r = b.r * (hoverOn ? 1.12 : 1);
    const alpha = 0.55 + age * 0.4;
    paintBallShadow(ctx, b.x, b.y + r * 0.82, r * 0.72, r * 0.72, 0.22 * alpha);
    paintSphere(
      ctx,
      b.x,
      b.y,
      r,
      b.color,
      alpha,
      hoverOn ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)",
      b.kind === "hex" ? "hex" : "circle"
    );
  }
}

function hexRgb(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shadeHex(color: string, mix: number, toward: number): string {
  const rgb = hexRgb(color);
  if (!rgb) return color;
  const ch = rgb.map((c) => Math.round(c + (toward - c) * mix));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function parcelInk(color: string): string {
  const rgb = hexRgb(color);
  if (!rgb) return "#f7f3ea";
  const y = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return y > 170 ? "#1c1917" : "#f7f3ea";
}

function paintBallShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.8, rx), Math.max(0.6, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  rim: string,
  kind: "circle" | "hex" = "circle"
) {
  if (alpha <= 0 || r < 0.35) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(-r * 0.2, -r * 0.22, r * 0.2, 0, r * 0.05, r);
  g.addColorStop(0, shadeHex(color, 0.16, 255));
  g.addColorStop(0.62, color);
  g.addColorStop(1, shadeHex(color, 0.22, 16));
  ctx.fillStyle = g;
  if (kind === "hex") hexPath(ctx, 0, 0, r);
  else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, r * 0.06);
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.restore();
}

function flightLift(u: number, h: number): number {
  return Math.sin(Math.PI * u) * Math.min(12, h * 0.14);
}

function flightAt(b: WellBody, h: number, u: number) {
  const exit = sealExit(h);
  return {
    x: b.sealX0 + (exit.x - b.sealX0) * u,
    y: b.sealY0 + (exit.y - b.sealY0) * u - flightLift(u, h),
  };
}

function paintIdleBall(ctx: CanvasRenderingContext2D, b: WellBody, r: number, hoverOn: boolean) {
  const alpha = Math.max(0, b.alpha);
  paintBallShadow(ctx, b.x, b.y + r * 0.82, r * 0.72, r * 0.72, 0.22 * alpha);
  paintSphere(
    ctx,
    b.x,
    b.y,
    r,
    b.color,
    alpha,
    hoverOn ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)"
  );
  if (b.more) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = parcelInk(b.color);
    ctx.font = `600 ${Math.max(8, Math.round(r * 0.85))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.title.replace(/^\+/, "+"), b.x, b.y + 0.4);
    ctx.restore();
  }
}

function paintDeparting(
  ctx: CanvasRenderingContext2D,
  b: WellBody,
  h: number,
  now: number,
  hoverOn: boolean
) {
  const u = sealProgress(b, now);
  if (u <= 0) {
    paintIdleBall(ctx, b, Math.max(0.35, b.r), hoverOn);
    return;
  }
  const lift = flightLift(u, h);
  const drawR = Math.max(0.35, b.r0);
  const alpha = Math.max(0, b.alpha);
  for (let i = 3; i >= 1; i--) {
    const tu = u - i * 0.07;
    if (tu <= 0.02) continue;
    const p = flightAt(b, h, tu);
    paintSphere(ctx, p.x, p.y, drawR, b.color, alpha * 0.16, "rgba(255,255,255,0.2)");
  }
  paintBallShadow(ctx, b.x, b.y + lift + drawR * 0.82, drawR * 0.62, drawR * 0.62, 0.2 * alpha * (1 - u * 0.45));
  paintSphere(
    ctx,
    b.x,
    b.y,
    drawR,
    b.color,
    alpha,
    hoverOn ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)"
  );
}

function paintWell(
  ctx: CanvasRenderingContext2D,
  bodies: WellBody[],
  hover: string | null,
  now: number,
  _w: number,
  h: number,
  _flashUntil: number,
  _empty: boolean,
  _scale: WellScale
) {
  const idle: WellBody[] = [];
  const departing: WellBody[] = [];
  for (const b of bodies) {
    if (fallingIntoMouth(b, now)) departing.push(b);
    else idle.push(b);
  }
  idle.sort((a, b) => a.y - b.y);
  for (const b of idle) {
    const hoverOn = hover === b.id;
    const grow = b.more || b.dying !== "none" ? 1 : birthScale(now - b.born);
    paintIdleBall(ctx, b, Math.max(0.35, b.r * grow * (hoverOn ? 1.12 : 1)), hoverOn);
  }
  for (const b of departing) paintDeparting(ctx, b, h, now, hover === b.id);
  ctx.globalAlpha = 1;
}

function seedHref(s: TxBallSeed): string | null {
  if (s.href === null) return null;
  if (s.href) return s.href;
  return `/tx/${s.id}`;
}

function seedMeta(s: TxBallSeed): Pick<MixBody, "href" | "title" | "kind"> {
  return {
    href: seedHref(s),
    title: s.title || shortId(s.id, 8),
    kind: s.kind ?? "circle",
  };
}

function asWellSeed(s: TxBallSeed): WellSeed {
  return {
    id: s.id,
    size: s.size,
    fee: s.fee,
    feeRate: s.feeRate,
    color: s.color,
    category: s.category,
    action: s.action,
    platform: s.platform,
    firstSeen: s.firstSeen,
    href: seedHref(s),
    title: s.title || shortId(s.id, 8),
    value: s.value,
  };
}

function seedFromBody(b: WellBody): WellSeed {
  return {
    id: b.id,
    size: b.size,
    fee: b.fee,
    feeRate: b.feeRate,
    color: b.color,
    category: b.category,
    action: b.action,
    platform: b.platform,
    href: b.href,
    title: b.title,
    value: b.value,
  };
}

/** Wait for block.sealed — tip often lands seconds before txIds. */
const SEAL_HOLD_MS = 16_000;

type WellTip = {
  id: string;
  hash: string;
  cat: string;
  color: string;
  amount: string;
  more?: boolean;
  title?: string;
};

function tipHash(id: string): string {
  if (!id || id.length <= 16) return id;
  return `${id.slice(0, 8)}..${id.slice(-6)}`;
}

function catLabelOf(
  t: (k: string) => string,
  category: string,
  action?: string | null,
  platform?: string | null
): string {
  return txChipCaption(category, platform, action, t);
}

const TIP_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

export function TxBallPit({
  txs,
  ariaLabel,
  well = false,
  scale = "home",
  emptyHref,
  moreTitle,
  onDyingCount,
  onSealStart,
  onSealPour,
  onSealArrive,
}: {
  txs: TxBallSeed[];
  ariaLabel: string;
  well?: boolean;
  scale?: WellScale;
  emptyHref?: string;
  moreTitle?: (n: number) => string;
  onDyingCount?: (n: number) => void;
  onSealStart?: () => void;
  onSealPour?: (seeds: PourSeed[]) => void;
  /** A sealed ball just disappeared into the mouth. */
  onSealArrive?: (hit: { id: string; color: string; n: number; total: number }) => void;
}) {
  const router = useRouter();
  const t = useT();
  const { locale } = useI18n();
  const reduceTip = useReducedMotion();
  const { tip } = usePageSync();
  const { seal } = useStreamMempool();
  const [wellTip, setWellTip] = useState<WellTip | null>(null);
  const [tipReady, setTipReady] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipElRef = useRef<HTMLDivElement>(null);
  const wellTipRef = useRef<WellTip | null>(null);
  wellTipRef.current = wellTip;
  const mixRef = useRef<MixBody[]>([]);
  const wellRef = useRef<WellBody[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const shadowBleedRef = useRef(0);
  const hoverRef = useRef<string | null>(null);
  const txsRef = useRef(txs);
  txsRef.current = txs;
  const routerRef = useRef(router);
  routerRef.current = router;
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const sealRef = useRef(seal);
  sealRef.current = seal;
  const seenTip = useRef<string | null>(null);
  const seenSeal = useRef<string | null>(null);
  const includedRef = useRef<Set<string>>(new Set());
  const departedRef = useRef<Map<string, WellSeed>>(new Map());
  const sealUntil = useRef(0);
  const holdUntil = useRef(0);
  const flashUntil = useRef(0);
  const dyingRef = useRef(0);
  const onDyingRef = useRef(onDyingCount);
  onDyingRef.current = onDyingCount;
  const onSealStartRef = useRef(onSealStart);
  onSealStartRef.current = onSealStart;
  const onSealPourRef = useRef(onSealPour);
  onSealPourRef.current = onSealPour;
  const onSealArriveRef = useRef(onSealArrive);
  onSealArriveRef.current = onSealArrive;
  const sealedArrived = useRef(new Set<string>());
  const pourSeedsRef = useRef<PourSeed[]>([]);
  const sealFlying = useRef(false);
  const moreTitleRef = useRef(moreTitle);
  moreTitleRef.current = moreTitle;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const wellOn = useRef(well);
  wellOn.current = well;
  const emptyHrefRef = useRef(emptyHref);
  emptyHrefRef.current = emptyHref;
  const kickRef = useRef(() => {});
  const tRef = useRef(t);
  tRef.current = t;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const setWellTipRef = useRef(setWellTip);
  setWellTipRef.current = setWellTip;

  const placeTip = (b: { x: number; y: number; r: number }) => {
    const el = tipElRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = canvas.clientWidth || rect.width || 1;
    const h = canvas.clientHeight || rect.height || 1;
    const sx = (rect.width || w) / w;
    const sy = (rect.height || h) / h;
    const x = rect.left + b.x * sx;
    const y = rect.top + b.y * sy;
    const rr = b.r * sy;
    const top = y - rr - 10;
    const flip = top < 56;
    el.style.left = `${x}px`;
    el.style.top = `${flip ? y + rr + 10 : top}px`;
    const anchor = el.firstElementChild as HTMLElement | null;
    if (anchor) {
      anchor.style.transform = flip ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    }
    el.style.visibility = "visible";
  };

  useEffect(() => {
    setTipReady(true);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;

    let raf = 0;
    let last = performance.now();
    let visible = true;
    let reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReduce = () => {
      reduce = media.matches;
    };

    const reportDying = () => {
      if (!wellOn.current) return;
      const n = visibleCount(wellRef.current);
      if (n === dyingRef.current) return;
      dyingRef.current = n;
      onDyingRef.current?.(n);
    };

    const reportArrived = (now: number) => {
      const total = pourSeedsRef.current.length;
      if (!total) return;
      for (const b of wellRef.current) {
        if (b.more || b.dying !== "seal") continue;
        if (sealProgress(b, now) < 1) continue;
        if (sealedArrived.current.has(b.id)) continue;
        sealedArrived.current.add(b.id);
        onSealArriveRef.current?.({
          id: b.id,
          color: b.color,
          n: sealedArrived.current.size,
          total,
        });
      }
    };

    const reportPour = () => {
      if (!sealFlying.current) return;
      if (wellRef.current.some((b) => b.dying === "seal")) return;
      sealFlying.current = false;
      onSealPourRef.current?.(pourSeedsRef.current);
    };

    const hitMix = (cx: number, cy: number): MixBody | null => {
      const { x, y } = canvasPoint(canvas, cx, cy);
      let best: MixBody | null = null;
      let bestD = Infinity;
      for (const b of mixRef.current) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d <= b.r + 4 && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      return best;
    };

    const hitWell = (cx: number, cy: number): WellBody | null => {
      const { x, y } = canvasPoint(canvas, cx, cy);
      let best: WellBody | null = null;
      let bestD = Infinity;
      for (const b of wellRef.current) {
        if (b.dying === "seal" || b.dying === "fade") continue;
        const grow = b.more || b.dying !== "none" ? 1 : birthScale(performance.now() - b.born);
        const d = Math.hypot(x - b.x, y - b.y);
        if (d <= b.r * grow + 4 && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      return best;
    };

    const syncMix = (relayout: boolean) => {
      const { w, h } = sizeRef.current;
      if (w < 8 || h < 8) return;
      const seeds = txsRef.current.slice(0, MIX_MAX);
      const live = new Set(seeds.map((s) => s.id));
      const prev = mixRef.current;
      const byId = new Map(prev.filter((b) => live.has(b.id)).map((b) => [b.id, b]));
      const rs = radiiFor(
        seeds.length,
        seeds.map((s) => s.size),
        w * h,
        Math.min(w, h)
      );
      const now = performance.now();
      mixRef.current = seeds.map((s, i) => {
        const old = byId.get(s.id);
        const r = rs[i] ?? 6;
        const meta = seedMeta(s);
        if (old && !relayout) {
          old.r = r;
          old.color = s.color;
          Object.assign(old, meta);
          return old;
        }
        if (old) {
          old.r = r;
          old.color = s.color;
          Object.assign(old, meta);
          old.x = Math.min(w - r - 2, Math.max(r + 2, old.x));
          old.y = Math.min(h - r - 2, Math.max(r + 2, old.y));
          return old;
        }
        const speed = 16 + unit(s.id, 9) * 14;
        const ang = unit(s.id, 3) * Math.PI * 2;
        return {
          id: s.id,
          x: r + 2 + unit(s.id, 1) * Math.max(1, w - 2 * r - 4),
          y: r + 2 + unit(s.id, 2) * Math.max(1, h - 2 * r - 4),
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          r,
          color: s.color,
          born: now,
          ...meta,
        };
      });
    };

    const syncWell = (relayout: boolean) => {
      const { w, h } = sizeRef.current;
      if (w < 8 || h < 8) return;
      const now = performance.now();
      const mouth = attractorOf(w, h);
      const raw = txsRef.current.map(asWellSeed);
      const rated = raw.map((s) => ({ ...s, feeRate: seedRate(s) }));
      const liveIds = new Set(rated.map((s) => s.id));
      for (const s of rated) departedRef.current.delete(s.id);
      for (const b of wellRef.current) {
        if (b.more || liveIds.has(b.id)) continue;
        if (!departedRef.current.has(b.id)) departedRef.current.set(b.id, seedFromBody(b));
      }
      const tip = tipRef.current;
      const tipKey = tip ? `${tip.height}:${tip.headerId}` : null;
      if (tipKey && seenTip.current === null) seenTip.current = tipKey;
      const tipGrew = Boolean(tipKey && seenTip.current && seenTip.current !== tipKey);
      if (tipKey) seenTip.current = tipKey;
      if (tipGrew) holdUntil.current = Math.max(holdUntil.current, now + SEAL_HOLD_MS);
      const ev = sealRef.current;
      const sealKey =
        ev && Array.isArray(ev.txIds) && ev.txIds.length ? `${ev.height}:${ev.blockId}` : null;
      if (sealKey && seenSeal.current !== sealKey) {
        seenSeal.current = sealKey;
        sealedArrived.current = new Set();
        const included = new Set(ev!.txIds);
        includedRef.current = included;
        const pool = mergeWellSeeds(rated, [...departedRef.current.values()], included);
        ensureIncludedBodies(wellRef.current, included, pool, w, h, scaleRef.current, now);
        beginSeal(wellRef.current, now, included, mouth);
        pourSeedsRef.current = pourSeedsOf(wellRef.current);
        onSealStartRef.current?.();
        onSealPourRef.current?.(pourSeedsRef.current);
        const last = pourSeedsRef.current.reduce((m, s) => Math.max(m, s.delayMs), 0);
        sealUntil.current = now + Math.max(2600, last + 500);
        holdUntil.current = Math.max(holdUntil.current, sealUntil.current);
        flashUntil.current = now + FLASH_MS;
      }
      const included = includedRef.current;
      const holding = now < holdUntil.current;
      const sealing = now < sealUntil.current;
      const pool = included.size
        ? mergeWellSeeds(rated, [...departedRef.current.values()], included)
        : rated;
      const { shown, more } = pickWellSeeds(pool, MAX_BALLS, included.size ? included : undefined);
      const live = new Set(shown.map((s) => s.id));
      const alive = new Set(liveIds);
      for (const id of included) alive.add(id);
      if (included.size) {
        markMissing(wellRef.current, alive, "seal", now, included, mouth);
      } else if (!holding) {
        markMissing(wellRef.current, live, "fade", now);
      }
      if (!holding && !sealing) {
        includedRef.current = new Set();
        for (const id of [...departedRef.current.keys()]) {
          if (!liveIds.has(id)) departedRef.current.delete(id);
        }
      }
      const prev = new Map(wellRef.current.map((b) => [b.id, b]));
      const next: WellBody[] = [];
      for (const s of shown) {
        const old = prev.get(s.id);
        next.push(
          makeWellBody(s, w, h, scaleRef.current, now, {
            old,
            relayout,
            title: s.title,
            href: s.href ?? `/tx/${s.id}`,
          })
        );
      }
      if (more > 0) {
        const label = moreTitleRef.current?.(more) ?? `+${more}`;
        const old = prev.get(MORE_ID);
        next.push(
          makeWellBody(
            {
              id: MORE_ID,
              size: 160,
              feeRate: 0,
              color: "#94A3B8",
              title: label,
              href: "/mempool",
            },
            w,
            h,
            scaleRef.current,
            now,
            { more: true, old, title: label, href: "/mempool", relayout }
          )
        );
      }
      for (const b of wellRef.current) {
        if (next.some((n) => n.id === b.id)) continue;
        if (b.dying !== "none" || holding || included.has(b.id)) next.push(b);
      }
      // Count the mouth before sweep. The next frame never sees a finished seal ball.
      reportArrived(now);
      wellRef.current = sweepDead(next, now);
      if (relayout) assignPackRadii(wellRef.current, w, h, scaleRef.current);
      reportDying();
      reportPour();
    };

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      const bleed = wellOn.current && scaleRef.current === "home" ? HOME_SHADOW_BLEED : 0;
      shadowBleedRef.current = bleed;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor((h + bleed) * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h + bleed}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
      if (wellOn.current) syncWell(true);
      else syncMix(true);
      kick();
    };

    const stepMix = (dt: number) => {
      const { w, h } = sizeRef.current;
      const bodies = mixRef.current;
      const n = bodies.length;
      for (const b of bodies) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 56) {
          const s = 56 / sp;
          b.vx *= s;
          b.vy *= s;
        }
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) mixCollide(bodies[i], bodies[j]);
        }
      }
      for (const b of bodies) mixWalls(b, w, h);
    };

    const draw = (now: number) => {
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h + shadowBleedRef.current);
      if (wellOn.current) {
        paintWell(
          ctx,
          wellRef.current,
          hoverRef.current,
          now,
          w,
          h,
          flashUntil.current,
          wellRef.current.length === 0,
          scaleRef.current
        );
      } else {
        paintMix(ctx, mixRef.current, hoverRef.current, now);
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      if (!reduce) {
        if (wellOn.current) {
          syncWell(false);
          stepWell(
            wellRef.current,
            sizeRef.current.w,
            sizeRef.current.h,
            dt,
            now,
            scaleRef.current
          );
          reportArrived(now);
          wellRef.current = sweepDead(wellRef.current, now);
          reportDying();
          reportPour();
        } else {
          stepMix(dt);
        }
      } else if (wellOn.current) {
        syncWell(false);
        assignPackRadii(
          wellRef.current,
          sizeRef.current.w,
          sizeRef.current.h,
          scaleRef.current
        );
        reportDying();
        reportPour();
      }
      draw(now);
      const hid = hoverRef.current;
      if (hid && wellOn.current) {
        const hb = wellRef.current.find((b) => b.id === hid);
        if (hb) placeTip(hb);
      }
      raf = visible && !reduce ? requestAnimationFrame(tick) : 0;
    };

    const kick = () => {
      if (raf || reduce || !visible) {
        if (wellOn.current) syncWell(false);
        else syncMix(false);
        draw(performance.now());
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const onVisDoc = () => {
      visible = document.visibilityState === "visible";
      if (visible) kick();
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting && document.visibilityState === "visible";
        if (visible) kick();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0 }
    );
    io.observe(host);
    document.addEventListener("visibilitychange", onVisDoc);
    const onReduce = () => {
      syncReduce();
      if (reduce && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      kick();
    };
    media.addEventListener("change", onReduce);
    const ro = new ResizeObserver(() => layout());
    ro.observe(host);
    layout();

    const showWellTip = (b: WellBody | null) => {
      if (!b) {
        if (wellTipRef.current) setWellTipRef.current(null);
        return;
      }
      const nextCat = b.more ? "" : catLabelOf(tRef.current, b.category, b.action, b.platform);
      if (wellTipRef.current?.id === b.id && wellTipRef.current.cat === nextCat) {
        placeTip(b);
        return;
      }
      if (b.more) {
        setWellTipRef.current({
          id: b.id,
          hash: "",
          cat: "",
          color: b.color,
          amount: "",
          more: true,
          title: b.title,
        });
        placeTip(b);
        return;
      }
      const tr = tRef.current;
      setWellTipRef.current({
        id: b.id,
        hash: tipHash(b.id),
        cat: catLabelOf(tr, b.category, b.action, b.platform),
        color: b.color,
        amount: formatErgPrecise(b.value, localeRef.current),
      });
      placeTip(b);
    };

    const onMove = (e: PointerEvent) => {
      if (wellOn.current) {
        const b = hitWell(e.clientX, e.clientY);
        hoverRef.current = b?.id ?? null;
        canvas.style.cursor = b ? "pointer" : emptyHrefRef.current ? "pointer" : "default";
        showWellTip(b);
        return;
      }
      const b = hitMix(e.clientX, e.clientY);
      hoverRef.current = b?.id ?? null;
      canvas.style.cursor = b && b.href ? "pointer" : "default";
    };
    const onLeave = () => {
      hoverRef.current = null;
      canvas.style.cursor = "default";
      if (wellOn.current) setWellTipRef.current(null);
    };
    let poked: { href: string; at: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (!wellOn.current || reduce || e.button !== 0) return;
      const b = hitWell(e.clientX, e.clientY);
      if (!b || b.more) return;
      if (b.href) poked = { href: b.href, at: performance.now() };
      const at = canvasPoint(canvas, e.clientX, e.clientY);
      pokeWell(b, at.x, at.y, performance.now(), wellRef.current);
    };
    const onClick = (e: MouseEvent) => {
      if (wellOn.current) {
        // The second click of a double-click belongs to dblclick, even if the poke already moved the ball.
        if (e.detail > 1) return;
        const b = hitWell(e.clientX, e.clientY);
        if (b?.more && b.href) {
          e.preventDefault();
          routerRef.current.push(b.href);
          return;
        }
        if (b) {
          if (reduce && b.href) {
            e.preventDefault();
            routerRef.current.push(b.href);
          }
          return;
        }
        if (poked && performance.now() - poked.at < 500) return;
        const href = emptyHrefRef.current;
        if (!href) return;
        e.preventDefault();
        routerRef.current.push(href);
        return;
      }
      const b = hitMix(e.clientX, e.clientY);
      if (!b?.href) return;
      e.preventDefault();
      routerRef.current.push(b.href);
    };
    const onDblClick = (e: MouseEvent) => {
      if (!wellOn.current) return;
      const b = hitWell(e.clientX, e.clientY);
      const fresh = poked && performance.now() - poked.at < 600 ? poked.href : null;
      const href = b && !b.more && b.href ? b.href : fresh;
      if (!href || href === "/mempool") return;
      e.preventDefault();
      routerRef.current.push(href);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDblClick);
    kickRef.current = kick;

    kick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisDoc);
      media.removeEventListener("change", onReduce);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  useEffect(() => {
    kickRef.current();
    const { w, h } = sizeRef.current;
    if (w < 8 || h < 8) return;
    if (well) return;
    const seeds = txs.slice(0, MIX_MAX);
    const live = new Set(seeds.map((s) => s.id));
    const prev = mixRef.current;
    const byId = new Map(prev.filter((b) => live.has(b.id)).map((b) => [b.id, b]));
    const rs = radiiFor(
      seeds.length,
      seeds.map((s) => s.size),
      w * h,
      Math.min(w, h)
    );
    const now = performance.now();
    mixRef.current = seeds.map((s, i) => {
      const old = byId.get(s.id);
      const r = rs[i] ?? 6;
      const meta = seedMeta(s);
      if (old) {
        old.r = r;
        old.color = s.color;
        Object.assign(old, meta);
        return old;
      }
      const speed = 16 + unit(s.id, 9) * 14;
      const ang = unit(s.id, 3) * Math.PI * 2;
      return {
        id: s.id,
        x: r + 2 + unit(s.id, 1) * Math.max(1, w - 2 * r - 4),
        y: r + 2 + unit(s.id, 2) * Math.max(1, h - 2 * r - 4),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        r,
        color: s.color,
        born: now,
        ...meta,
      };
    });
  }, [txs, well]);

  useLayoutEffect(() => {
    if (!wellTip) return;
    const b = wellRef.current.find((x) => x.id === wellTip.id);
    if (b) placeTip(b);
  }, [wellTip]);

  return (
    <div ref={hostRef} className="absolute inset-0 min-h-0 min-w-0">
      <canvas
        ref={canvasRef}
        className="block h-full w-full select-none"
        aria-label={ariaLabel}
        role="img"
      />
      {tipReady
        ? createPortal(
            <AnimatePresence>
              {wellTip ? (
                <div
                  ref={tipElRef}
                  className="pointer-events-none fixed z-[100]"
                  style={{ visibility: "hidden" }}
                  role="tooltip"
                >
                  <div style={{ transform: "translate(-50%, -100%)" }}>
                    <motion.div
                      key={wellTip.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: reduceTip ? 0 : 0.42, ease: TIP_EASE }}
                    >
                      <div className="rounded-[16px] border border-[var(--border)] bg-[var(--module)] px-3 py-2 shadow-[var(--float-shadow)]">
                        {wellTip.more ? (
                          <p className="text-[12px] font-medium leading-none text-[var(--text)]">{wellTip.title}</p>
                        ) : (
                          <>
                            <p className="font-mono text-[12px] leading-none tracking-tight text-[var(--text)]">
                              {wellTip.hash}
                            </p>
                            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] leading-none text-[var(--muted)]">
                              <span
                                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: wellTip.color }}
                              />
                              {wellTip.cat}
                            </p>
                            <p className="mt-1.5 text-[12px] font-medium tabular-nums leading-none text-[var(--up)]">
                              {wellTip.amount}
                            </p>
                          </>
                        )}
                      </div>
                    </motion.div>
                  </div>
                </div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
}

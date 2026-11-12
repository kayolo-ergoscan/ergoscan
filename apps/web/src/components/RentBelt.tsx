"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { rentToneInk } from "@/lib/rent-miner-patrol";
import { drawPixel, pixelColor, type PixelMood } from "./pixel";
import type { RentTapeRow } from "@ergoscan/shared";

/**
 * Crates sit still. «Пиксель» (in the box colour) hops up to each one slowly,
 * knocks on it with a focused squint, the lid opens, and he looks up curious
 * as the rent due rises out of the box.
 */
const WALK_PX = 28;
const WORK_MS = 2600;
type Hit = { address: string; x: number; y: number };
type Slot = { x: number; y: number; depth: number };

type Stop = { x: number; y: number };

function routeAround(from: Stop, fromSlot: Slot | null, toSlot: Slot, w: number, h: number, slots: Slot[]): Stop[] {
  const ys = [...new Set(slots.map((s) => s.y))].sort((a, b) => a - b);
  const back = ys[0] ?? h * 0.4;
  const front = ys[ys.length - 1] ?? h * 0.72;
  const laneY = (slotY: number) =>
    Math.abs(slotY - back) <= Math.abs(slotY - front)
      ? Math.max(22, back - 36)
      : Math.min(h - 18, front + 32);
  const beside = (s: Slot): Stop => ({ x: s.x - 28, y: s.y + 2 });
  const to = beside(toSlot);
  const fromLane = fromSlot ? laneY(fromSlot.y) : laneY(toSlot.y);
  const toLane = laneY(toSlot.y);
  const pts: Stop[] = [{ x: from.x, y: fromLane }];
  if (Math.abs(fromLane - toLane) > 8) {
    const margin = from.x > w * 0.5 ? w - 16 : 16;
    pts.push({ x: margin, y: fromLane });
    pts.push({ x: margin, y: toLane });
  }
  pts.push({ x: to.x, y: toLane });
  pts.push(to);
  return pts;
}

/** Three pick strikes in the first part of the visit, then the pick rests. */
function knocks(u: number): number {
  if (u >= 0.42) return 0;
  const local = ((u / 0.42) * 3) % 1;
  return Math.sin(local * Math.PI);
}

function lidOpen(u: number): number {
  if (u < 0.34) return 0;
  if (u < 0.5) return (u - 0.34) / 0.16;
  if (u < 0.88) return 1;
  return Math.max(0, 1 - (u - 0.88) / 0.12);
}

function purseMotion(u: number): { y: number; a: number } | null {
  if (u < 0.4) return null;
  const t = Math.min(1, (u - 0.4) / 0.3);
  const ease = 1 - (1 - t) ** 3;
  const fade = u > 0.9 ? Math.max(0, 1 - (u - 0.9) / 0.1) : 1;
  const drift = u > 0.7 ? Math.sin((u - 0.7) * 7) * 1.1 : 0;
  return { y: -ease * 28 - drift, a: Math.min(1, t * 1.35) * fade };
}

function slotsOf(n: number, w: number, h: number): Slot[] {
  if (n <= 0) return [];
  const rows = n > 7 ? 2 : 1;
  const front = Math.ceil(n / rows);
  const back = n - front;
  const counts = rows === 1 ? [n] : [back, front];
  const ys = rows === 1 ? [h * 0.62] : [h * 0.4, h * 0.74];
  const out: Slot[] = [];
  for (let r = 0; r < counts.length; r++) {
    const count = counts[r] ?? 0;
    const y = ys[r] ?? h * 0.6;
    const depth = rows === 1 ? 1 : r === 0 ? 0.86 : 1;
    for (let k = 0; k < count; k++) {
      const x = 28 + ((k + 0.5) / count) * (w - 56);
      out.push({ x, y, depth });
    }
  }
  return out;
}

export function RentBelt({
  rows,
  reduce,
  hover,
  onHover,
  onLead,
  formatAmount,
}: {
  rows: RentTapeRow[];
  reduce: boolean;
  hover: string | null;
  onHover: (address: string | null) => void;
  onLead: (address: string | null) => void;
  formatAmount?: (nano: string) => string;
}) {
  const host = useRef<HTMLCanvasElement>(null);
  const rowsRef = useRef(rows);
  const hoverRef = useRef(hover);
  const onHoverRef = useRef(onHover);
  const onLeadRef = useRef(onLead);
  const formatRef = useRef(formatAmount);
  rowsRef.current = rows;
  hoverRef.current = hover;
  onHoverRef.current = onHover;
  onLeadRef.current = onLead;
  formatRef.current = formatAmount;
  const router = useRouter();
  const hits = useRef<Hit[]>([]);

  useEffect(() => {
    const canvas = host.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let rx = 40;
    let ry = 80;
    let seq: number[] = [];
    let si = 0;
    let mode: "go" | "check" = "go";
    let path: Stop[] = [];
    let leg = 0;
    let routed = -1;
    let struck = "";
    let swingFrom = 0;
    let lastLead: string | null = null;
    let roll = 0;
    let face = 1;
    let ink = "";
    let inkAt = -1e9;

    const paint = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const parent = canvas.parentElement;
      const w = Math.max(1, parent?.clientWidth ?? 320);
      const h = Math.max(1, parent?.clientHeight ?? 180);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const list = rowsRef.current;
      const slots = slotsOf(list.length, w, h);
      const nanos = list.map((r) => r.rentNano);
      if (list.length && seq.length !== list.length) {
        seq = list.map((_, i) => i);
        si = 0;
        routed = -1;
        mode = "go";
      }
      const idx = seq[si] ?? 0;
      const cur = list[idx];
      const slot = slots[idx];
      let pickSwing = 0;
      let hopT = 0;
      if (cur && slot && !reduce) {
        if (mode === "go") {
          if (routed !== idx) {
            const prevI = seq[(si - 1 + seq.length) % seq.length] ?? 0;
            const prev = si === 0 && routed < 0 ? null : (slots[prevI] ?? null);
            path = routeAround({ x: rx, y: ry }, prev, slot, w, h, slots);
            leg = 0;
            routed = idx;
          }
          const goal = path[leg];
          if (!goal) {
            mode = "check";
            struck = cur.address;
            swingFrom = now;
            face = 1;
          } else {
            const dx = goal.x - rx;
            const dy = goal.y - ry;
            const dist = Math.hypot(dx, dy);
            const step = Math.min(dist, (dist < 36 ? 16 : WALK_PX) * dt);
            if (dist > 2.5) {
              if (Math.abs(dx) > 1) face = dx > 0 ? 1 : -1;
              rx += (dx / dist) * step;
              ry += (dy / dist) * step;
              roll += step;
            } else if (leg < path.length - 1) {
              leg += 1;
            } else {
              mode = "check";
              struck = cur.address;
              swingFrom = now;
              face = 1;
            }
          }
        } else {
          hopT = Math.min(1, (now - swingFrom) / WORK_MS);
          pickSwing = knocks(hopT);
          if (hopT >= 1) {
            mode = "go";
            si = (si + 1) % Math.max(1, seq.length);
            routed = -1;
            hopT = 0;
          }
        }
      } else if (cur && slot && reduce) {
        rx = slot.x - 30;
        ry = slot.y + 4;
      }

      const drawn: Hit[] = [];
      const order = list
        .map((row, i) => ({ row, slot: slots[i]! }))
        .sort((a, b) => a.slot.y - b.slot.y);
      for (const item of order) {
        const checking = mode === "check" && item.row.address === struck;
        const lid = checking ? lidOpen(hopT) : 0;
        const ink = rentToneInk(item.row.rentNano, nanos);
        drawDock(ctx, item.slot.x, item.slot.y, item.slot.depth);
        drawCrate(ctx, item.slot.x, item.slot.y, ink, item.row.boxCount, item.slot.depth, 0, lid);
        drawn.push({ address: item.row.address, x: item.slot.x, y: item.slot.y - 10 });
      }
      hits.current = drawn;

      const performing = reduce ? (cur?.address ?? null) : mode === "check" ? struck : null;
      const next = hoverRef.current ?? performing;
      if (next !== lastLead) {
        lastLead = next;
        onLeadRef.current(next);
      }
      if (cur) {
        if (now - inkAt > 1000) {
          ink = pixelColor("box");
          inkAt = now;
        }
        const open = mode === "check" ? lidOpen(hopT) : 0;
        const mood: PixelMood = mode !== "check" ? "idle" : open > 0.2 ? "curious" : "work";
        drawPixel(ctx, {
          x: rx,
          y: ry + 16,
          pick: pickSwing,
          roll,
          face,
          scale: 0.82,
          color: ink,
          mood,
          now,
          gaze: open > 0.2 ? { x: face * 0.6, y: -0.9 * open } : null,
          reduce,
        });
      }
      if (mode === "check" && struck) {
        const open = list.find((row) => row.address === struck);
        const at = slots[list.findIndex((row) => row.address === struck)];
        const label = open ? (formatRef.current?.(open.rentNano) ?? "") : "";
        if (open && at && label) drawPurse(ctx, at.x, at.y, rentToneInk(open.rentNano, nanos), hopT, label);
      }
      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const pick = (ev: { clientX: number; clientY: number }) => {
    const canvas = host.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    let best: Hit | null = null;
    let dd = 20 * 20;
    for (const h of hits.current) {
      const d = (h.x - x) ** 2 + (h.y - y) ** 2;
      if (d < dd) {
        dd = d;
        best = h;
      }
    }
    return best;
  };

  return (
    <canvas
      ref={host}
      className="h-full w-full"
      onPointerMove={(ev) => onHover(pick(ev)?.address ?? null)}
      onPointerLeave={() => onHover(null)}
      onClick={(ev: ReactMouseEvent<HTMLCanvasElement>) => {
        const hit = pick(ev);
        if (hit) router.push(`/address/${encodeURIComponent(hit.address)}`);
      }}
    />
  );
}

function drawDock(ctx: CanvasRenderingContext2D, x: number, y: number, depth: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(depth, depth * 0.62);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 6, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.roundRect(-15, -2, 30, 8, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(-15, -2, 30, 1.5);
  ctx.restore();
}

function drawCrate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ink: string,
  boxes: number,
  depth: number,
  hop: number,
  lid: number
) {
  const layers = boxes >= 4 ? 3 : boxes >= 2 ? 2 : 1;
  const lift = hop * 14;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(depth, depth);
  ctx.fillStyle = `rgba(0,0,0,${0.32 * (1 - hop * 0.55)})`;
  ctx.beginPath();
  ctx.ellipse(0, 4, 11 * (1 - hop * 0.28), 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(0, -14 - lift);
  ctx.scale(1 + hop * 0.04, 1 - hop * 0.06);
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(2, 8);
  ctx.lineTo(14, 0);
  ctx.lineTo(14, 12);
  ctx.lineTo(2, 20);
  ctx.closePath();
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-12, 2);
  ctx.lineTo(2, 8);
  ctx.lineTo(2, 20);
  ctx.lineTo(-12, 14);
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.globalAlpha = 0.65;
  for (let i = 0; i < layers; i++) {
    const yy = 9 + i * 2.2;
    ctx.beginPath();
    ctx.moveTo(-9, yy);
    ctx.lineTo(0.5, yy + 1.3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(-6, -2);
  ctx.rotate(-lid * 1.15);
  ctx.translate(6, 2);
  ctx.beginPath();
  ctx.moveTo(-12, 2);
  ctx.lineTo(0, -6);
  ctx.lineTo(14, 0);
  ctx.lineTo(2, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawPurse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ink: string,
  u: number,
  label: string
) {
  const motion = purseMotion(u);
  if (!motion || motion.a <= 0.02) return;
  ctx.save();
  ctx.translate(x, y - 18);
  ctx.fillStyle = ink;
  for (let i = 0; i < 5; i++) {
    const t = (u - (0.4 + i * 0.04)) / 0.48;
    if (t <= 0 || t >= 1) continue;
    ctx.globalAlpha = (1 - t) * motion.a * 0.9;
    ctx.fillRect((i - 2) * 5.5 - 1, -8 - t * 20, 2.2, 2.2);
  }
  ctx.globalAlpha = motion.a;
  ctx.translate(0, motion.y);
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const wide = ctx.measureText(label).width;
  if (wide > 78) ctx.scale(78 / wide, 78 / wide);
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(16,12,10,0.5)";
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = "#ff8a65";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}


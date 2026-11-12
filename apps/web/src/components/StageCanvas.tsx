"use client";

/**
 * StageCanvas — clean-slate visualization (unused in nav).
 * No characters, no legacy loom/balls. Data-driven canvas only.
 *
 * Contract (do not break):
 * - threads from mempool (BallProps / LoomThread)
 * - onSelect → TxDrawer
 * - seal climax from gateway
 * - click hit-test
 * - 60fps rAF, responsive DPR
 */

import { useCallback, useEffect, useRef } from "react";
import type { BallProps, SealEvent } from "@ergoscan/shared";
import { canvasDpr, watchOnScreen } from "@/lib/canvas-run";

const BG = "#0a1018";
const CYAN = "#22D3EE";
const WHITE = "#E0F2FE";

interface Node {
  id: string;
  data: BallProps;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  born: number;
}

export function StageCanvas({
  threads,
  onSelect,
  seal = null,
  tipHeight = null,
}: {
  threads: BallProps[];
  onSelect: (t: BallProps) => void;
  seal?: SealEvent | null;
  tipHeight?: number | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef(new Map<string, Node>());
  const hoverIdRef = useRef<string | null>(null);
  const sealPulseRef = useRef(0);
  const lastSealHRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const layoutRef = useRef({ w: 800, h: 480 });
  const tipRef = useRef(tipHeight);
  tipRef.current = tipHeight;

  useEffect(() => {
    if (!seal) return;
    if (lastSealHRef.current === seal.height) return;
    lastSealHRef.current = seal.height;
    sealPulseRef.current = 1;
  }, [seal]);

  useEffect(() => {
    const map = nodesRef.current;
    const live = new Set(threads.map((t) => t.id));
    const { w, h } = layoutRef.current;

    for (const t of threads) {
      let n = map.get(t.id);
      if (!n) {
        n = {
          id: t.id,
          data: t,
          x: w * (0.15 + Math.random() * 0.7),
          y: h * (0.2 + Math.random() * 0.55),
          vx: (Math.random() - 0.5) * 12,
          vy: (Math.random() - 0.5) * 10,
          r: Math.max(5, Math.min(18, t.r * 0.55)),
          born: performance.now(),
        };
        map.set(t.id, n);
      } else {
        n.data = t;
        n.r = Math.max(5, Math.min(18, t.r * 0.55));
      }
    }
    for (const id of [...map.keys()]) {
      if (!live.has(id)) map.delete(id);
    }
  }, [threads]);

  const layout = useCallback(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const rect = host.getBoundingClientRect();
    const dpr = canvasDpr();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(360, Math.floor(rect.height || 480));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    layoutRef.current = { w, h };
  }, []);

  useEffect(() => {
    layout();
    const ro = new ResizeObserver(() => layout());
    if (hostRef.current) ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, [layout]);

  useEffect(() => {
    let raf = 0;
    /** Off screen (<10 % visible) or a hidden tab: no frames. */
    let on = true;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = on ? requestAnimationFrame(tick) : 0;
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = on ? requestAnimationFrame(tick) : 0;
        return;
      }

      const { w, h } = layoutRef.current;
      if (sealPulseRef.current > 0) sealPulseRef.current -= dt * 0.7;

      for (const n of nodesRef.current.values()) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < n.r + 16) {
          n.x = n.r + 16;
          n.vx *= -0.8;
        }
        if (n.x > w - n.r - 16) {
          n.x = w - n.r - 16;
          n.vx *= -0.8;
        }
        if (n.y < n.r + 48) {
          n.y = n.r + 48;
          n.vy *= -0.8;
        }
        if (n.y > h - n.r - 40) {
          n.y = h - n.r - 40;
          n.vy *= -0.8;
        }
        n.vx *= 0.995;
        n.vy *= 0.995;
        n.vx += Math.sin(now * 0.001 + n.x * 0.01) * 2 * dt;
        n.vy += Math.cos(now * 0.0012 + n.y * 0.01) * 2 * dt;
      }

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(34,211,238,0.04)";
      ctx.lineWidth = 1;
      const g = 48;
      for (let x = 0; x < w; x += g) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += g) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(103,232,249,0.9)";
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("STAGE · clean slate", 20, 28);
      ctx.fillStyle = "rgba(100,116,139,0.95)";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      const tip = tipRef.current;
      ctx.fillText(
        `${nodesRef.current.size} mempool · tip ${tip ?? "—"} · click a node → Tx drawer`,
        20,
        46
      );

      for (const n of nodesRef.current.values()) {
        const hover = hoverIdRef.current === n.id;
        const age = Math.min(1, (now - n.born) / 400);
        ctx.save();
        ctx.globalAlpha = 0.55 + age * 0.45;
        if (hover || n.data.isYours) {
          ctx.shadowColor = n.data.color;
          ctx.shadowBlur = 16;
        }
        ctx.fillStyle = n.data.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (hover ? 1.15 : 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.arc(n.x - n.r * 0.2, n.y - n.r * 0.2, n.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (sealPulseRef.current > 0) {
        const a = sealPulseRef.current;
        ctx.save();
        ctx.globalAlpha = a * 0.35;
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 1;
        const step = 20;
        for (let x = 0; x < w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.fillStyle = CYAN;
        ctx.globalAlpha = a * 0.08;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      ctx.fillStyle = "rgba(100,116,139,0.8)";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(
        "Sigma Boy / Loom / BallStage removed · rebuild from zero",
        20,
        h - 16
      );

      raf = on ? requestAnimationFrame(tick) : 0;
    };

    const host = hostRef.current;
    const stop = host
      ? watchOnScreen(host, (visible) => {
          on = visible;
          if (!on) {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
          } else if (!raf) {
            last = performance.now();
            raf = requestAnimationFrame(tick);
          }
        })
      : ((raf = requestAnimationFrame(tick)), () => {});
    return () => {
      stop();
      cancelAnimationFrame(raf);
    };
  }, []);

  const hitTest = useCallback((clientX: number, clientY: number): BallProps | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current.values()) {
      const d = Math.hypot(x - n.x, y - n.y);
      if (d <= n.r + 6 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best?.data ?? null;
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden rounded-3xl border border-[var(--border)]"
      style={{ height: "min(68vh, 600px)", minHeight: 400, background: BG }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onMouseMove={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          hoverIdRef.current = hit?.id ?? null;
          if (canvasRef.current) {
            canvasRef.current.style.cursor = hit ? "pointer" : "default";
          }
        }}
        onClick={(e) => {
          const hit = hitTest(e.clientX, e.clientY);
          if (hit) onSelectRef.current(hit);
        }}
      />
    </div>
  );
}

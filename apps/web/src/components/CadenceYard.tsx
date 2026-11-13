"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFloatTip, type TipRect } from "@/components/Tip";
import { drawPixel, pixelColor, type PixelMood } from "./pixel";
import { lookEdge, lookInk } from "@/lib/look";
import { canvasDpr, watchOnScreen } from "@/lib/canvas-run";
import { onKayolo } from "@/lib/kayolo/events";

/**
 * Live-block tape drawn on a canvas, same family as the rent yard.
 * Crates stand on plates. Height is the block's transaction weight.
 * «Пиксель» (in the block colour) stays at the right and watches the block that
 * is still growing: a new block makes him hop with ^ ^ eyes and follow it in,
 * a busy one surprises him, a tx landing gets a knock, and when no block has
 * come for a long while (or no data at all) he dozes off. A rare height (Kayolo E20, the 10k
 * steps) gets one more beat after the usual cheer: eyes on that crate, then a hop.
 */

export type CadenceYardBlock = {
  id: string;
  height: number;
  weight: number;
  ink: string;
  /** 1 when the block is settled. Lower while transactions are still arriving. */
  frac: number;
  /** Mined with Lithos. The mark falls after the crate has landed. */
  lithos?: boolean;
};

type Ghost = {
  id: string;
  ink: string;
  weight: number;
  frac: number;
  x: number;
  hopUntil: number;
  leaving: boolean;
  lithos: boolean;
  /** When the Lithos mark starts its fall. 0 until the crate has landed. */
  logoAt: number;
};

/** Square mark. Stays under the tile title even on the tallest crate at the top of a hop. */
const LOGO = 18;
const LOGO_GAP = 3;
const LOGO_FALL = 320;
const LOGO_DROP = 36;
/** Extra lift above the crate at the peak of a hop, so the crate tosses the mark. */
const LOGO_TOSS = 10;

type Hit = { id: string; x: number; top: number; bot: number };

const SLOTS = 8;
/** No new block for this long: the node or the chain is behind, he dozes. Ergo aims at 2 min. */
const STALE_MS = 8 * 60_000;
/** No data at all after this long: dozing too. */
const NO_DATA_MS = 2500;
/** A 39-tx block fills the track. That is the busy size the row is drawn against. */
const BUSY_TX = 39;
/** At or under this, nobody on screen is a full block. Don't stretch them to the ceiling. */
const QUIET_TX = 4;
const BODY_MIN = 14;
const BODY_SPAN = 40;
/** E20 on home: count(1) to the rare crate, then hopHappy (design/brand/kayolo-life.md §8.3). */
const RARE_LOOK_MS = 300;
const RARE_HAPPY_MS = 1300;
/** A rare height that has not shown up on the tape by then still gets its beat, on the newest crate. */
const RARE_CRATE_WAIT_MS = 4000;
const RARE_TTL_MS = 60_000;

/**
 * Quiet rows stay the height they would have beside a busy block.
 * Each extra tx still adds a step, so 1 and 4 are not the same slab.
 * A busier block on screen becomes the ceiling again.
 */
function crateBody(weight: number, peak: number): number {
  const w = Math.max(1, weight);
  const beside = BODY_MIN + (w / BUSY_TX) * BODY_SPAN;
  if (peak > QUIET_TX) return BODY_MIN + (w / peak) * BODY_SPAN;
  return beside + (w - 1) * 2.4;
}

export function CadenceYard({
  blocks,
  reduce,
  colorsReady,
  label,
  onHover,
  tip,
}: {
  blocks: CadenceYardBlock[];
  reduce: boolean;
  colorsReady: boolean;
  label: string;
  onHover: (id: string | null) => void;
  /** The shared hover tip for a crate. A phone's first tap shows it, the second opens the block. */
  tip?: (id: string) => ReactNode;
}) {
  const host = useRef<HTMLCanvasElement>(null);
  const crateTip = useFloatTip({ within: () => host.current });
  const tipRef = useRef(tip);
  tipRef.current = tip;
  /** Crate whose tip is up. */
  const tipId = useRef<string | null>(null);
  const followRef = useRef<() => void>(() => {});
  /** Touch: was the last press a finger, and did it land on the crate whose tip is up. */
  const touch = useRef({ down: false, open: false });
  const blocksRef = useRef(blocks);
  const onHoverRef = useRef(onHover);
  const colorsReadyRef = useRef(colorsReady);
  blocksRef.current = blocks;
  onHoverRef.current = onHover;
  colorsReadyRef.current = colorsReady;
  const hits = useRef<Hit[]>([]);
  const router = useRouter();

  useEffect(() => {
    const canvas = host.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    /** Off screen (<10 % visible) or a hidden tab: no frames. */
    let on = true;
    let last = performance.now();
    const ghosts = new Map<string, Ghost>();
    const mark = new Image();
    let markOk = false;
    mark.onload = () => {
      markOk = true;
    };
    mark.src = "/lithos-mark.png";
    let primed = false;
    let pickSwing = 0;
    let roll = 0;
    const mountAt = performance.now();
    let lastNewestId: string | null = null;
    let lastNewAt = mountAt;
    let cheerUntil = 0;
    let cheerBig = false;
    let ink = "";
    let inkAt = -1e9;
    let swingUntil = 0;
    let waveTick = -1;
    let waveId: string | null = null;
    let phase: "wait" | "intro" | "live" = "wait";
    let introStart = 0;
    let liveAt = 0;
    /** A rare height was announced; its beat waits for the crate and for the usual cheer. */
    let rareCall: { height: number; at: number } | null = null;
    let rareAt = 0;
    let rareId: string | null = null;

    const paint = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const parent = canvas.parentElement;
      const w = Math.max(1, parent?.clientWidth ?? 320);
      const h = Math.max(1, parent?.clientHeight ?? 84);
      const dpr = canvasDpr();
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const list = blocksRef.current;
      const ground = h - 10;
      const robotX = w - 34;
      const slotW = Math.max(28, (robotX - 36) / SLOTS);
      if (phase === "wait" && colorsReadyRef.current && list.length) {
        phase = reduce ? "live" : "intro";
        introStart = now;
      }
      if (now - inkAt > 1000) {
        ink = pixelColor("block");
        inkAt = now;
      }
      if (phase === "wait") {
        hits.current = [];
        if (now - mountAt > NO_DATA_MS) {
          drawPixel(ctx, { x: robotX, y: ground, scale: 1, color: ink, mood: "sleepy", now, face: -1, reduce });
        }
        raf = on ? requestAnimationFrame(paint) : 0;
        return;
      }
      const introT = phase === "intro" ? now - introStart : 0;
      const driveU = 1 - Math.exp(-introT / 120);
      if (phase === "intro" && driveU > 0.98 && introT > 900) {
        phase = "live";
        liveAt = now;
      }
      const live = new Set(list.map((b) => b.id));
      const k = reduce ? 1 : 1 - Math.exp(-dt / 0.16);

      for (const g of ghosts.values()) {
        if (!live.has(g.id)) g.leaving = true;
      }
      list.forEach((b, i) => {
        const slot = SLOTS - 1 - (list.length - 1 - i);
        const target = 16 + (slot + 0.5) * slotW;
        const prev = ghosts.get(b.id);
        const grew = prev ? b.frac > prev.frac + 1e-4 : false;
        const placing = phase !== "live";
        const x = placing || !primed || reduce ? target : (prev?.x ?? w + 28);
        const nextX = !placing && prev && !reduce ? prev.x + (target - prev.x) * k : x;
        let logoAt = prev?.logoAt ?? 0;
        if (b.lithos && phase === "live" && logoAt === 0 && (reduce || Math.abs(nextX - target) < 8)) {
          logoAt = reduce ? now - LOGO_FALL : liveAt && now - liveAt < 40 ? liveAt + 180 + i * 60 : now + 160;
        }
        ghosts.set(b.id, {
          id: b.id,
          ink: b.ink,
          weight: b.weight,
          frac: b.frac,
          x: nextX,
          hopUntil: grew ? now + 420 : (prev?.hopUntil ?? 0),
          leaving: false,
          lithos: b.lithos === true,
          logoAt,
        });
        if (grew) swingUntil = now + 420;
      });
      for (const g of [...ghosts.values()]) {
        if (!g.leaving) continue;
        if (reduce) {
          ghosts.delete(g.id);
          continue;
        }
        g.x += (-52 - g.x) * k;
        if (g.x < -40) ghosts.delete(g.id);
      }
      primed = true;

      const settled: string[] = [];
      if (!reduce && phase === "live") {
        list.forEach((b, i) => {
          if (b.frac < 1) return;
          const g = ghosts.get(b.id);
          if (!g || g.leaving) return;
          const slot = SLOTS - 1 - (list.length - 1 - i);
          const target = 16 + (slot + 0.5) * slotW;
          if (Math.abs(g.x - target) > 8) return;
          settled.push(b.id);
        });
        const tick = Math.floor(now / 1500);
        if (tick !== waveTick) {
          waveTick = tick;
          waveId = settled.length ? settled[tick % settled.length]! : null;
        }
        const waving = waveId ? ghosts.get(waveId) : undefined;
        if (!waving || waving.leaving) waveId = null;
      }
      const waveT = waveTick < 0 ? 1500 : now - waveTick * 1500;

      const drawn: Hit[] = [];
      const marks: { x: number; peak: number; extra: number }[] = [];
      const order = [...ghosts.values()].sort((a, b) => a.x - b.x);
      const peak = Math.max(1, ...order.map((g) => g.weight));
      for (const g of order) {
        const full = crateBody(g.weight, peak);
        const body = g.frac >= 1 ? full : Math.max(5, full * g.frac);
        const grewHop = !reduce && now < g.hopUntil ? Math.sin(((g.hopUntil - now) / 420) * Math.PI) : 0;
        const waveHop =
          g.id === waveId && waveT >= 0 && waveT < 420 ? Math.sin((waveT / 420) * Math.PI) : 0;
        const hop = phase === "live" ? Math.max(grewHop, waveHop) : 0;
        let fallPx = 0;
        if (phase === "intro") {
          const span = robotX + 40;
          const ratio = Math.min(0.97, Math.max(0, (g.x + 40) / span));
          const pass = -120 * Math.log(1 - ratio);
          const ft = introT - pass;
          if (ft < 0) continue;
          const u = Math.min(1, ft / 320);
          const ease = 1 - (1 - u) ** 3;
          fallPx = (1 - ease) * (body + 30);
        }
        drawBlock(ctx, g.x, ground, body, g.ink, hop, fallPx, g.frac < 1);
        const logoExtra = fallPx > 1 ? null : lithosMarkExtra(g, now, hop);
        if (logoExtra != null) {
          marks.push({
            x: g.x,
            peak: ground - (hop * 10 + fallPx) - 4 - body,
            extra: logoExtra,
          });
        }
        drawn.push({
          id: g.id,
          x: g.x,
          top: ground - body - 16 - hop * 10 - fallPx - (logoExtra == null ? 0 : LOGO + LOGO_GAP + logoExtra),
          bot: ground + 6,
        });
      }
      hits.current = drawn;
      followRef.current();

      const newest = list[list.length - 1];
      if (newest && newest.id !== lastNewestId) {
        // A new block: cheer, or gasp at a busy one. Not for the first paint.
        if (lastNewestId !== null && phase === "live") {
          cheerUntil = now + 1600;
          cheerBig = newest.weight >= BUSY_TX;
        }
        lastNewestId = newest.id;
        lastNewAt = now;
      }
      if (rareCall && now - rareCall.at > RARE_TTL_MS) rareCall = null;
      if (rareCall && phase === "live") {
        const height = rareCall.height;
        const crate = list.find((b) => b.height === height);
        if (crate || now - rareCall.at > RARE_CRATE_WAIT_MS) {
          rareAt = Math.max(now, cheerUntil);
          rareId = crate?.id ?? newest?.id ?? null;
          rareCall = null;
        }
      }
      pickSwing = newest && !reduce && now < swingUntil ? Math.sin(((swingUntil - now) / 420) * Math.PI) : 0;
      const driveX = -40 + (robotX + 40) * Math.min(1, driveU);
      const rx = phase === "intro" ? driveX : robotX;
      if (phase === "intro") roll += dt * 42;
      if (newest) {
        let mood: PixelMood = "idle";
        let gaze: { x: number; y: number } | null = null;
        if (now < cheerUntil) {
          mood = cheerBig ? "surprised" : "happy";
          // Eyes follow the new crate as it slides in to its plate.
          const g = ghosts.get(newest.id);
          if (g) gaze = { x: Math.max(-1.3, Math.min(1.3, (g.x - rx) / 40)), y: 0.15 };
        } else if (rareAt && now >= rareAt && now < rareAt + RARE_LOOK_MS + RARE_HAPPY_MS) {
          // The rare crate: a look at it, then a hop (the hop comes with the switch to happy).
          mood = now < rareAt + RARE_LOOK_MS ? "look" : "happy";
          const g = rareId ? ghosts.get(rareId) : undefined;
          if (g) gaze = { x: Math.max(-1.3, Math.min(1.3, (g.x - rx) / 40)), y: 0.15 };
        } else if (now - lastNewAt > STALE_MS) {
          mood = "sleepy";
        } else if (pickSwing > 0.05) {
          mood = "work";
        }
        drawPixel(ctx, {
          x: rx,
          y: ground,
          scale: 1,
          color: ink,
          mood,
          now,
          face: -1,
          look: mood === "idle" ? 0.7 : 0,
          gaze,
          pick: pickSwing,
          roll,
          reduce,
        });
      }
      if (markOk) {
        for (const m of marks) drawLithosMark(ctx, mark, m.x, m.peak, m.extra);
      }

      raf = on ? requestAnimationFrame(paint) : 0;
    };

    const stop = watchOnScreen(canvas, (visible) => {
      on = visible;
      if (!on) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(paint);
      }
    });
    const offRare = onKayolo((ev) => {
      if (ev.k !== "chain:rare") return;
      rareCall = { height: ev.height, at: performance.now() };
    });
    return () => {
      stop();
      offRare();
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const pick = (ev: { clientX: number; clientY: number }) => {
    const canvas = host.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    let best: Hit | null = null;
    let bestD = 36;
    for (const hit of hits.current) {
      if (y < hit.top || y > hit.bot) continue;
      const d = Math.abs(hit.x - x);
      if (d < bestD) {
        best = hit;
        bestD = d;
      }
    }
    return best?.id ?? null;
  };

  /** A crate's box on the screen, from the last painted frame. */
  const crateRect = (id: string): TipRect | null => {
    const canvas = host.current;
    const hit = hits.current.find((h) => h.id === id);
    if (!canvas || !hit) return null;
    const r = canvas.getBoundingClientRect();
    return { left: r.left + hit.x - 33, top: r.top + hit.top, width: 66, height: Math.max(8, hit.bot - hit.top) };
  };

  const showTip = (id: string | null, tapped = false) => {
    const make = tipRef.current;
    const rect = id ? crateRect(id) : null;
    if (!id || !make || !rect) {
      tipId.current = null;
      crateTip.hide();
      return;
    }
    if (tipId.current === id && crateTip.isOpen()) {
      crateTip.move(rect);
      return;
    }
    tipId.current = id;
    crateTip.show(rect, make(id), { tapped });
  };

  followRef.current = () => {
    const id = tipId.current;
    if (!id) return;
    if (!crateTip.isOpen()) {
      tipId.current = null;
      return;
    }
    const rect = crateRect(id);
    if (rect) crateTip.move(rect);
    else showTip(null);
  };

  return (
    <canvas
      ref={host}
      className="h-full w-full"
      role="img"
      aria-label={label}
      onPointerMove={(ev) => {
        if (ev.pointerType === "touch") return;
        const id = pick(ev);
        ev.currentTarget.style.cursor = id ? "pointer" : "default";
        onHoverRef.current(id);
        showTip(id);
      }}
      onPointerLeave={(ev) => {
        if (ev.pointerType === "touch") return;
        ev.currentTarget.style.cursor = "default";
        onHoverRef.current(null);
        showTip(null);
      }}
      onPointerDown={(ev) => {
        const down = ev.pointerType === "touch";
        const id = down ? pick(ev) : null;
        touch.current = { down, open: Boolean(down && id && tipId.current === id && crateTip.isOpen()) };
        if (!down || touch.current.open) return;
        onHoverRef.current(id);
        showTip(id, true);
      }}
      onClick={(ev: ReactMouseEvent<HTMLCanvasElement>) => {
        const id = pick(ev);
        if (!id) return;
        if (tipRef.current && touch.current.down && !touch.current.open) return;
        router.push(`/block/${encodeURIComponent(id)}`);
      }}
    />
  );
}

/** Pixels the mark still has to fall. Null until its crate has landed and the fall has started. */
function lithosMarkExtra(g: Ghost, now: number, hop: number): number | null {
  if (!g.lithos || g.logoAt <= 0 || now < g.logoAt) return null;
  const u = Math.min(1, (now - g.logoAt) / LOGO_FALL);
  const ease = 1 - (1 - u) ** 3;
  return (1 - ease) * LOGO_DROP + hop * LOGO_TOSS;
}

function drawLithosMark(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  peak: number,
  extra: number
) {
  const y = peak - LOGO_GAP - LOGO - extra;
  ctx.drawImage(img, x - LOGO / 2, y, LOGO, LOGO);
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  body: number,
  ink: string,
  hop: number,
  fallPx: number,
  growing: boolean
) {
  ink = lookInk(ink);
  const edge = lookEdge();
  const lift = hop * 10 + fallPx;
  const air = Math.min(1, lift / 22);
  const hw = 33;
  const depth = 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = `rgba(0,0,0,${0.26 * (1 - air * 0.72)})`;
  ctx.beginPath();
  ctx.ellipse(0, 4, 28 * (1 + air * 0.42), 2.4 * (1 - air * 0.2), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x, y - lift);
  const top = -4 - body;
  const bot = -3;
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.15;
  ctx.strokeStyle = edge ?? "rgba(255,255,255,0.72)";
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-hw, bot - depth * 0.25);
  ctx.lineTo(0, bot);
  ctx.lineTo(0, top + depth);
  ctx.lineTo(-hw, top + depth * 0.35);
  ctx.closePath();
  ctx.globalAlpha = 0.94;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, bot);
  ctx.lineTo(hw, bot - depth * 0.3);
  ctx.lineTo(hw, top + depth * 0.45);
  ctx.lineTo(0, top + depth);
  ctx.closePath();
  ctx.globalAlpha = 0.52;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-hw, top + depth * 0.35);
  ctx.lineTo(0, top);
  ctx.lineTo(hw, top + depth * 0.45);
  ctx.lineTo(0, top + depth);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (growing) {
    ctx.strokeStyle = edge ?? "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = edge ?? "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const slats = Math.max(1, Math.min(4, Math.round(body / 12)));
  for (let i = 0; i < slats; i++) {
    const yy = bot - 5 - i * 7;
    if (yy <= top + depth + 3) break;
    ctx.moveTo(-hw + 2, yy);
    ctx.lineTo(-1, yy + 1);
  }
  ctx.stroke();
  ctx.restore();
}


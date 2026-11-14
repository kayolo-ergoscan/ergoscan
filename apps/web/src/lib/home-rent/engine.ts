/**
 * Draws the harbour and the reef on demand. Frames run only while a moment plays (rent collected
 * in a new block, a new epoch) and only while the cards are on screen and the tab is visible; at
 * rest nothing is drawn and no frame is asked for. A change (data, hover, size, ink) is one frame.
 * Under reduced motion a moment is its final frame, shown for the moment's length, then the rest.
 */
import { ERGO_HEADER_EPOCH_LEN } from "@ergoscan/shared";
import { canvasDpr, watchOnScreen } from "@/lib/canvas-run";
import { INK_EVENT } from "@/lib/skin-ink";
import { readInks } from "@/lib/home-city/common";
import { harbourPalette, type HarbourPalette } from "./palette";
import {
  CLAIM_MS,
  EPOCH_MS,
  paintHarbour,
  paintReef,
  type HarbourBoat,
  type HarbourHit,
  type HarbourLook,
  type HarbourMoment,
  type HarbourWords,
  type ReefLane,
} from "./scene";

export type HarbourData = {
  boats: readonly HarbourBoat[];
  epochBoxes: number | null;
  /** The chain tip the page knows: a new header epoch starts at a multiple of 1024. */
  height: number | null;
  lanes: readonly ReefLane[];
  /** Reef lane height, px (the DOM rows use the same). */
  pitch: number;
};

export type HarbourText = HarbourWords & {
  /** The plate for rent collected in a block: [«+3.83 ERG · 36 boxes», «block 1 916 412»]. */
  claim: (c: { height: number; boxes: number; rentNano: string | null }) => [string, string];
  /** The plate for a new epoch: [«epoch 1 872», «3 120 boxes turn 4 in it»]. */
  epoch: (epoch: number, boxes: number | null) => [string, string];
};

type Canvas = { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number };
type Playing = { m: HarbourMoment; start: number; total: number };

/** A new epoch waits this long for the snapshot that refills its count; then it passes quietly. */
const EPOCH_WAIT_MS = 15 * 60_000;
/** Phone layout of the harbour: the cards stack below this width (Tailwind `sm`). */
const PHONE_MQ = "(max-width: 639px)";

export const epochOf = (height: number) => Math.floor(height / ERGO_HEADER_EPOCH_LEN);

export class HarbourEngine {
  private rent: Canvas;
  private reef: Canvas | null;
  private data: HarbourData = { boats: [], epochBoxes: null, height: null, lanes: [], pitch: 26 };
  private text: HarbourText;
  private reduce: boolean;
  private pal: HarbourPalette;
  private look: HarbourLook;
  private phone = false;
  private on = true;
  private dead = false;
  private raf = 0;
  private playing: Playing | null = null;
  private lastClaim = 0;
  private epochSeen: number | null = null;
  private pending: { epoch: number; at: number; before: number | null } | null = null;
  private hover: { rent: string | null; reef: string | null } = { rent: null, reef: null };
  private dirtyReef = true;
  private hits: HarbourHit[] = [];
  private boxes = new Map<Element, { w: number; h: number }>();
  private stops: (() => void)[] = [];
  /** Under reduced motion: the one timer that ends the moment's final frame. */
  private reduceTimer = 0;
  /** Frames asked for, for tests and the perf probe. */
  frames = 0;

  constructor(o: { rent: HTMLCanvasElement; reef: HTMLCanvasElement | null; host: HTMLElement; reduce: boolean; text: HarbourText }) {
    const c2 = (el: HTMLCanvasElement): Canvas => ({ el, ctx: el.getContext("2d")!, w: 0, h: 0 });
    this.rent = c2(o.rent);
    this.reef = o.reef ? c2(o.reef) : null;
    this.reduce = o.reduce;
    this.text = o.text;
    this.pal = harbourPalette();
    this.look = this.readLook();
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_MQ) : null;
    this.phone = !!mq?.matches;
    if (mq && typeof mq.addEventListener === "function") {
      const onMq = () => {
        this.phone = mq.matches;
        this.dirtyReef = true;
        this.kick();
      };
      mq.addEventListener("change", onMq);
      this.stops.push(() => mq.removeEventListener("change", onMq));
    }
    this.stops.push(
      watchOnScreen(o.host, (visible) => {
        this.on = visible;
        if (!visible) {
          if (this.raf) cancelAnimationFrame(this.raf);
          this.raf = 0;
          // Out of sight mid-moment: it ends; the cards show the rest when they come back.
          this.playing = null;
        } else {
          this.dirtyReef = true;
          this.kick();
        }
      })
    );
    if (typeof ResizeObserver !== "undefined") {
      // Sizes come from the observer: a frame never reads layout.
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) this.boxes.set(e.target, { w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
        this.dirtyReef = true;
        this.kick();
      });
      ro.observe(o.rent.parentElement ?? o.rent);
      if (o.reef) ro.observe(o.reef.parentElement ?? o.reef);
      this.stops.push(() => ro.disconnect());
    }
    const onInk = () => {
      this.pal = harbourPalette();
      this.look = this.readLook();
      this.dirtyReef = true;
      this.kick();
    };
    window.addEventListener(INK_EVENT, onInk);
    this.stops.push(() => window.removeEventListener(INK_EVENT, onInk));
  }

  /** Text and fonts from the canvas itself: under the light ink the scene tokens sit on `canvas[data-scene]`. */
  private readLook(): HarbourLook {
    const i = readInks(this.rent.el);
    return { sans: i.sans, mono: i.mono, label: i.muted2 };
  }

  destroy() {
    this.dead = true;
    this.on = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const s of this.stops) s();
    this.stops = [];
    this.clearReduceTimer();
    this.playing = null;
  }

  private clearReduceTimer() {
    if (this.reduceTimer) window.clearTimeout(this.reduceTimer);
    this.reduceTimer = 0;
  }

  setReduce(reduce: boolean) {
    if (reduce === this.reduce) return;
    this.reduce = reduce;
    this.playing = null;
    this.clearReduceTimer();
    this.kick();
  }

  setText(text: HarbourText) {
    this.text = text;
    this.kick();
  }

  setHover(kind: "rent" | "reef", id: string | null) {
    if (this.hover[kind] === id) return;
    this.hover[kind] = id;
    if (kind === "reef") this.dirtyReef = true;
    this.kick();
  }

  setData(d: HarbourData) {
    const prev = this.data;
    this.data = d;
    if (prev.lanes !== d.lanes || prev.pitch !== d.pitch) this.dirtyReef = true;
    // A new header epoch: its lights come on once the snapshot has refilled its count.
    if (d.height != null && d.height > 0) {
      const ep = epochOf(d.height);
      if (this.epochSeen == null) this.epochSeen = ep;
      else if (ep > this.epochSeen) {
        this.epochSeen = ep;
        this.pending = { epoch: ep, at: Date.now(), before: prev.epochBoxes };
      }
    }
    const p = this.pending;
    if (p) {
      if (Date.now() - p.at > EPOCH_WAIT_MS) this.pending = null;
      else if (d.epochBoxes != null && (p.before == null || d.epochBoxes > p.before)) {
        this.pending = null;
        this.play({ kind: "epoch", ms: 0, lines: this.text.epoch(p.epoch, d.epochBoxes) }, EPOCH_MS);
        return;
      }
    }
    this.kick();
  }

  /** Rent collected in a new block: the tug, the coins, the plate. Once per height. */
  claim(c: { height: number; boxes: number; rentNano: string | null }) {
    if (!(c.height > this.lastClaim) || !(c.boxes > 0)) return;
    this.lastClaim = c.height;
    this.play({ kind: "claim", ms: 0, boxes: c.boxes, lines: this.text.claim(c) }, CLAIM_MS);
  }

  /** The moment plays only where someone can see it; a hidden one is simply skipped. */
  private play(m: HarbourMoment, total: number) {
    if (this.dead || !this.on) return;
    this.playing = { m, start: performance.now(), total };
    if (this.reduce) {
      // Its final frame for as long as it would run, then the harbour at rest (two paints, no frames between).
      // A newer moment replaces the older one's timer: one at most, whatever the block rate.
      const shown = this.playing;
      this.clearReduceTimer();
      this.reduceTimer = window.setTimeout(() => {
        this.reduceTimer = 0;
        if (this.playing === shown) this.playing = null;
        this.kick();
      }, total);
    }
    this.kick();
  }

  isPlaying(): boolean {
    return this.playing != null;
  }

  hit(x: number, y: number): HarbourHit | null {
    let best: HarbourHit | null = null;
    for (const h of this.hits) {
      if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue;
      // Boats over the lights and the lighthouse: the smallest box wins.
      if (!best || (h.x1 - h.x0) * (h.y1 - h.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) best = h;
    }
    return best;
  }

  kick() {
    if (this.dead || !this.on || this.raf) return;
    this.raf = requestAnimationFrame((t) => this.paint(t));
    this.frames += 1;
  }

  private size(c: Canvas): boolean {
    const parent = c.el.parentElement;
    const box = parent ? this.boxes.get(parent) : undefined;
    const w = Math.max(1, box?.w ?? Math.round(parent?.clientWidth ?? 320));
    const h = Math.max(1, box?.h ?? Math.round(parent?.clientHeight ?? 200));
    const dpr = canvasDpr();
    if (c.el.width !== Math.floor(w * dpr) || c.el.height !== Math.floor(h * dpr)) {
      c.el.width = Math.floor(w * dpr);
      c.el.height = Math.floor(h * dpr);
      c.el.style.width = `${w}px`;
      c.el.style.height = `${h}px`;
    }
    c.w = w;
    c.h = h;
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return w > 8 && h > 8;
  }

  private paint(now: number) {
    this.raf = 0;
    if (this.dead || !this.on) return;
    try {
      let m: HarbourMoment | null = null;
      const p = this.playing;
      if (p) {
        const ms = this.reduce ? (p.m.kind === "claim" ? 2600 : 1600) : now - p.start;
        if (!this.reduce && ms >= p.total) this.playing = null;
        else m = { ...p.m, ms } as HarbourMoment;
      }
      if (this.size(this.rent)) {
        const scene = { boats: this.data.boats, epochBoxes: this.data.epochBoxes, phone: this.phone, hover: this.hover.rent };
        this.hits = paintHarbour(this.rent.ctx, this.rent.w, this.rent.h, scene, m, this.pal, this.text, this.look);
      }
      if (this.reef && this.dirtyReef) {
        this.dirtyReef = false;
        if (this.size(this.reef)) {
          paintReef(this.reef.ctx, this.reef.w, this.reef.h, this.data.lanes, this.data.pitch, this.hover.reef, this.phone, this.pal);
        }
      }
      if (m && !this.reduce) this.kick();
    } catch (e) {
      // One bad frame must not take the home page with it: no moment, the last picture stays.
      this.playing = null;
      console.warn("[home-rent] frame", e);
    }
  }
}

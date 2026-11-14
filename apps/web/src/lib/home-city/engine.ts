/**
 * Draws the city, the yard and the seal's cable on demand. Frames run only while something moves
 * (the seal's moment, a crate lowered into the yard, Kayolo's rare-height beat, his face settling
 * after a change) and only while the cards are on screen and the tab is visible; at rest nothing is
 * drawn and no frame is asked for. Under reduced motion every change is drawn once, as its final frame.
 */
import { canvasDpr, watchOnScreen } from "@/lib/canvas-run";
import { pixelSettling } from "@/components/pixel";
import { readInks, sealPlan, type CityBlock, type Fees, type Frame, type Inks, type Scene, type YardTx } from "./common";
import { cityGeo, cityTarget, citySiteRest, drawCity, type CityHit, type KayoloCue } from "./city";
import { KAYOLO_ID, drawKayolo, kayoloScale } from "./kayolo";
import { arrivedAt, momentPlays, queueSeal, sealMatch, sealStoreys, sealTargets, sealYard, waitingShown } from "./moment";
import { cableAt, drawCrateFlight, drawYard, drawYardCable, flightSize, yardCable, yardRest, type YardHit, type YardText } from "./yard";

/** No new block for this long: the chain or the node is behind, he dozes. Ergo aims at 2 min. */
export const STALE_MS = 8 * 60_000;
/** No data at all after this long: dozing at the site. */
const NO_DATA_MS = 2500;
/** A new block without its seal (the tip came first) waits this long for the seal's tx list. */
const SEAL_LIST_WAIT_MS = 8_000;
/** A crate lowered into the yard. */
const ADD_MS = 420;
/** More new txs than this at once (a snapshot, a reconnect): they just stand there. */
const ADD_BURST = 12;
/** E20 on home: a look at the rare tower, then a happy hop (design/brand/kayolo-life.md §8.3). */
const RARE_LOOK_MS = 300;
const RARE_HAPPY_MS = 1300;
const RARE_HOP_MS = 420;
const RARE_WAIT_MS = 4000;
/** A tx that left the yard this recently still leaves it on the crane if the seal names it. */
const GONE_MS = 20_000;
/** Frames after the last change while his face eases (a blink or a mood already under way). */
const SETTLE_MS = 1200;

export type SealIn = {
  blockId: string;
  height: number;
  timestamp: number;
  txIds: readonly string[];
  txCount: number;
  size: number;
  /** Sealed before this view existed (a page opened mid-block): the new street, no moment. */
  quiet?: boolean;
};

export type EngineData = {
  /** The whole tape, newest first, with each block's read when it is there. */
  blocks: CityBlock[];
  mem: { count: number; txs: YardTx[] };
  fees: Fees | null;
  avgBlockMs: number;
  /** A held new block may wait for its seal only while the stream is up. */
  streamLive: boolean;
};

export type EngineCallbacks = {
  /** Storeys standing on the site while a seal plays; null when it is over. */
  onBuilt: (b: { id: string; height: number; built: number; ts: number } | null) => void;
  /** The yard's count while crates still wait to be lifted; null when it is the stream's again. */
  onWaiting: (n: number | null) => void;
  /** The newest height the street shows. */
  onCommit: (height: number | null) => void;
  /** The count on the wrapped pallet as drawn at rest (0 when there is none). */
  onWrap?: (n: number) => void;
};

type Moment = {
  key: string;
  t0: number;
  seal: SealIn;
  ids: string[];
  targets: number[];
  memBefore: { count: number; txs: YardTx[] };
  /** The street before the new block. */
  street: CityBlock[];
  end: number;
  /** Built once per data change, not per frame: the scene the yard and the street stand in, the
   * new tower with its storeys, the crates by id and the ids still in the stream. */
  memFor?: Scene;
  memScene?: Scene;
  blockFor?: CityBlock | null;
  block?: CityBlock;
  kinds?: string[];
  byId: Map<string, YardTx>;
  streamFor?: readonly YardTx[];
  inStream?: Set<string>;
};

type Canvas = { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number };

export class CityEngine {
  hits: { city: CityHit[]; yard: YardHit[] } = { city: [], yard: [] };
  private city: Canvas;
  private yard: Canvas;
  private fly: Canvas;
  private host: HTMLElement;
  private text: YardText & { tag: (n: number) => string };
  private cb: EngineCallbacks;
  private data: EngineData = { blocks: [], mem: { count: 0, txs: [] }, fees: null, avgBlockMs: 120_000, streamLive: false };
  private scene: Scene | null = null;
  private committed: number | null = null;
  private moment: Moment | null = null;
  /** Seals that came while a moment played, in arrival order: each plays (or just stands) in turn. */
  private queue: SealIn[] = [];
  private sealKeys = new Set<string>();
  private adds = new Map<string, number>();
  private seenTx = new Set<string>();
  private memPrimed = false;
  private hover: { city: string | null; yard: string | null } = { city: null, yard: null };
  private reduce: boolean;
  private on = true;
  private raf = 0;
  private inks: Inks;
  private mark: HTMLImageElement | null = null;
  private markOk = false;
  private mountAt = performance.now();
  private settleUntil = 0;
  private rare: { height: number; at: number; start: number | null } | null = null;
  private timers: number[] = [];
  private holdTimer = 0;
  private rareTimer = 0;
  private staleTimer = 0;
  private blinkTail = 0;
  private gone = new Map<string, { tx: YardTx; at: number }>();
  private boxes = new Map<Element, { w: number; h: number }>();
  private rects: { host: DOMRect; city: DOMRect; yard: DOMRect } | null = null;
  private stops: (() => void)[] = [];
  private lastBuilt = -2;
  private lastWaiting: number | null = -1;
  private lastWrap = -1;
  private fed = false;
  private dead = false;
  private warned = false;

  constructor(o: { city: HTMLCanvasElement; yard: HTMLCanvasElement; fly: HTMLCanvasElement; host: HTMLElement; reduce: boolean; text: YardText & { tag: (n: number) => string }; cb: EngineCallbacks }) {
    const c2 = (el: HTMLCanvasElement): Canvas => ({ el, ctx: el.getContext("2d")!, w: 0, h: 0 });
    this.city = c2(o.city);
    this.yard = c2(o.yard);
    this.fly = c2(o.fly);
    this.host = o.host;
    this.reduce = o.reduce;
    this.text = o.text;
    this.cb = o.cb;
    this.inks = readInks(document.documentElement);
    if (typeof Image !== "undefined") {
      const img = new Image();
      img.onload = () => {
        if (this.dead) return;
        this.markOk = true;
        this.kick();
      };
      img.src = "/lithos-mark.png";
      this.mark = img;
    }
    this.stops.push(
      watchOnScreen(o.host, (visible) => {
        this.on = visible;
        if (!visible) {
          if (this.raf) cancelAnimationFrame(this.raf);
          this.raf = 0;
          // Out of sight mid-moment: it ends; the cards show the final state when they come back.
          if (this.moment) this.finishMoment();
          this.adds.clear();
          this.rare = null;
        } else this.kick();
      })
    );
    if (typeof ResizeObserver !== "undefined") {
      // Sizes come from the observer, so a frame never reads layout (no forced reflow while the
      // headers change); the overlay's offsets are measured once per seal and again after a resize.
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) this.boxes.set(e.target, { w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
        this.rects = null;
        this.kick();
      });
      ro.observe(o.city.parentElement ?? o.city);
      ro.observe(o.yard.parentElement ?? o.yard);
      ro.observe(o.host);
      this.stops.push(() => ro.disconnect());
    }
    const onInk = () => {
      this.inks = readInks(document.documentElement);
      this.kick();
    };
    window.addEventListener("ergoscan-ink", onInk);
    this.stops.push(() => window.removeEventListener("ergoscan-ink", onInk));
    // No data at all: he dozes at the site after a short while (one frame).
    this.later(NO_DATA_MS + 20, () => this.kick());
  }

  destroy() {
    this.dead = true;
    this.on = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const s of this.stops) s();
    this.stops = [];
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.rareTimer);
    window.clearTimeout(this.staleTimer);
    window.clearTimeout(this.blinkTail);
    if (this.mark) this.mark.onload = null;
    this.moment = null;
    this.queue = [];
  }

  setReduce(reduce: boolean) {
    if (reduce === this.reduce) return;
    this.reduce = reduce;
    if (reduce && this.moment) this.finishMoment();
    this.adds.clear();
    this.kick();
  }

  setText(text: YardText & { tag: (n: number) => string }) {
    this.text = text;
    this.kick();
  }

  setHover(kind: "city" | "yard", id: string | null) {
    if (this.hover[kind] === id) return;
    this.hover[kind] = id;
    this.kick(true);
  }

  /** The same street, yard and levels as now (a parent re-render, a chart scrub): nothing to draw. */
  private same(d: EngineData): boolean {
    const a = this.data;
    if (a.streamLive !== d.streamLive || a.avgBlockMs !== d.avgBlockMs || a.mem.count !== d.mem.count) return false;
    if ((a.fees?.normal ?? null) !== (d.fees?.normal ?? null) || (a.fees?.turbo ?? null) !== (d.fees?.turbo ?? null)) return false;
    if (a.blocks.length !== d.blocks.length || a.mem.txs.length !== d.mem.txs.length) return false;
    for (let i = 0; i < d.blocks.length; i++) {
      const x = a.blocks[i]!;
      const y = d.blocks[i]!;
      if (x === y) continue;
      if (x.id !== y.id || x.height !== y.height || x.ts !== y.ts || x.txCount !== y.txCount || x.size !== y.size || x.seenAt !== y.seenAt) return false;
      if (x.flag !== y.flag || x.lithos !== y.lithos || x.txs !== y.txs) return false;
    }
    for (let i = 0; i < d.mem.txs.length; i++) {
      const x = a.mem.txs[i]!;
      const y = d.mem.txs[i]!;
      if (x === y) continue;
      if (x.id !== y.id || x.size !== y.size || x.fee !== y.fee || x.feeRate !== y.feeRate || x.color !== y.color || x.category !== y.category || x.firstSeen !== y.firstSeen) return false;
    }
    return true;
  }

  setData(d: EngineData) {
    if (this.dead) return;
    if (this.fed && this.same(d)) return;
    this.fed = true;
    const prevTop = this.data.blocks[0]?.height ?? null;
    // Txs that just left the yard, kept a while: a seal in the same update takes them from here.
    const at = performance.now();
    const ids = new Set(d.mem.txs.map((t) => t.id));
    for (const t of this.data.mem.txs) if (!ids.has(t.id)) this.gone.set(t.id, { tx: t, at });
    for (const [id, g] of this.gone) if (ids.has(id) || at - g.at > GONE_MS) this.gone.delete(id);
    this.data = d;
    this.scene = null;
    const top = d.blocks[0]?.height ?? null;
    if (this.committed == null && top != null) {
      this.committed = top;
      this.cb.onCommit(top);
    } else if (top != null && this.committed != null && top > this.committed && top !== prevTop) this.holdNewer();
    // New crates are lowered in (only real arrivals: not the first load, not a burst).
    const now = performance.now();
    const fresh: string[] = [];
    for (const t of d.mem.txs) if (!this.seenTx.has(t.id)) fresh.push(t.id);
    if (this.memPrimed && !this.reduce && this.on && fresh.length > 0 && fresh.length <= ADD_BURST) for (const id of fresh) this.adds.set(id, now);
    this.seenTx = new Set(d.mem.txs.map((t) => t.id));
    if (d.mem.txs.length || d.mem.count === 0) this.memPrimed = true;
    this.armStale();
    this.kick(true);
  }

  /**
   * A block above the street that came without its seal so far: it waits for the seal's list, but
   * never longer than 8 s. An old block (the tab was away, the stream missed its seal) has no seal
   * coming: it just stands. During a moment it waits for the moment's end (finishMoment asks again).
   */
  private holdNewer() {
    const top = this.data.blocks[0]?.height ?? null;
    if (top == null || this.committed == null || top <= this.committed || this.moment) return;
    const recent = Date.now() - arrivedAt(this.data.blocks[0]) < SEAL_LIST_WAIT_MS * 4;
    if (!this.data.streamLive || this.reduce || !this.on || !recent) {
      this.commit(top);
      return;
    }
    window.clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      const t = this.data.blocks[0]?.height ?? null;
      if (t != null && !this.moment && (this.committed == null || t > this.committed)) this.commit(t);
    }, SEAL_LIST_WAIT_MS);
  }

  /**
   * `block.sealed`: play the moment if it can be seen, else just show the new street. A seal that
   * comes while a moment plays waits for it to end (two blocks in one breath both play, in order).
   */
  seal(s: SealIn) {
    if (this.dead) return;
    const key = `${s.height}:${s.blockId}`;
    if (this.sealKeys.has(key)) return;
    this.sealKeys.add(key);
    if (this.sealKeys.size > 32) this.sealKeys = new Set([...this.sealKeys].slice(-16));
    window.clearTimeout(this.holdTimer);
    if (this.moment) {
      const q = queueSeal(this.queue, s);
      this.queue = q.queue;
      for (const d of q.dropped) this.commit(d.height);
      this.lendYard(this.moment, s);
      return;
    }
    this.play(s);
  }

  /**
   * The waiting block's txs that already left the stream stay in the yard while the moment before it
   * plays: its crates must not blink out and come back when its own moment starts. Only before the
   * first crate leaves: a yard laid out again under a crate in the air would move its start.
   */
  private lendYard(m: Moment, s: SealIn) {
    const now = performance.now();
    if (now - m.t0 >= sealPlan(m.ids.length).depart(0)) return;
    const gone = new Map<string, YardTx>();
    for (const [id, g] of this.gone) if (now - g.at <= GONE_MS) gone.set(id, g.tx);
    const mem = sealYard(m.memBefore, gone, s.txIds);
    if (mem.txs.length === m.memBefore.txs.length) return;
    m.memBefore = mem;
    for (const t of mem.txs) if (!m.byId.has(t.id)) m.byId.set(t.id, t);
    m.memScene = undefined;
    this.kick(true);
  }

  private play(s: SealIn) {
    const visible = this.on && document.visibilityState === "visible";
    const newest = this.committed;
    if (s.quiet || !momentPlays({ reduce: this.reduce, visible, height: s.height, newest })) {
      this.commit(Math.max(s.height, this.committed ?? s.height));
      return;
    }
    const now = performance.now();
    const gone = new Map<string, YardTx>();
    for (const [id, g] of this.gone) if (now - g.at <= GONE_MS) gone.set(id, g.tx);
    const memBefore = sealYard(this.data.mem, gone, s.txIds);
    const ids = sealMatch(s.txIds, memBefore.txs);
    const street = this.data.blocks.filter((b) => b.height < s.height && (this.committed == null || b.height <= this.committed));
    this.moment = {
      key: `${s.height}:${s.blockId}`,
      t0: performance.now(),
      seal: s,
      ids,
      targets: sealTargets(s.txIds, ids),
      memBefore,
      street,
      end: sealPlan(ids.length).end,
      byId: new Map(memBefore.txs.map((t) => [t.id, t])),
    };
    this.adds.clear();
    this.lastBuilt = -2;
    this.rects = null;
    this.kick(true);
  }

  /** Kayolo E20: a rare height was announced. */
  rareHeight(height: number) {
    if (this.dead || this.reduce || !this.on) return;
    this.rare = { height, at: performance.now(), start: null };
    // The rare tower may not stand yet: the beat starts when it does (a data change), or after 4 s.
    window.clearTimeout(this.rareTimer);
    this.rareTimer = window.setTimeout(() => this.kick(), RARE_WAIT_MS + 20);
    this.kick(true);
  }

  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (!this.dead) fn();
    }, ms);
    this.timers.push(id);
  }

  private commit(height: number) {
    if (this.committed != null && height <= this.committed) return;
    this.committed = height;
    // The street is cut at the committed height: the cached scene no longer holds.
    this.scene = null;
    this.cb.onCommit(height);
    this.kick(true);
  }

  private finishMoment() {
    const m = this.moment;
    if (!m) return;
    this.moment = null;
    this.commit(Math.max(m.seal.height, this.committed ?? m.seal.height));
    this.cb.onBuilt(null);
    this.cb.onWaiting(null);
    this.lastBuilt = -2;
    this.lastWaiting = -1;
    this.settleUntil = performance.now() + SETTLE_MS;
    if (this.fly.w || this.fly.h) {
      this.fly.el.width = 0;
      this.fly.el.height = 0;
      this.fly.w = 0;
      this.rects = null;
      this.fly.h = 0;
    }
    // The next waiting seal plays now (or, out of sight or under reduced motion, just stands).
    while (!this.moment && this.queue.length) this.play(this.queue.shift()!);
    // A newer block that came during the moment without its own seal: its hold starts now.
    if (!this.moment) this.holdNewer();
  }

  /** Sleepy once the newest block is 8 min old: one frame then, no clock running. */
  private armStale() {
    window.clearTimeout(this.staleTimer);
    const ts = arrivedAt(this.data.blocks[0]);
    if (!ts) return;
    const due = ts + STALE_MS - Date.now();
    if (due > 0 && due < 24 * 3600_000) this.staleTimer = window.setTimeout(() => this.kick(true), due + 50);
  }

  /** Ask for one frame (and its face settling after a change). */
  kick(settle = false) {
    if (this.dead) return;
    if (settle) this.settleUntil = Math.max(this.settleUntil, performance.now() + SETTLE_MS);
    if (!this.on || this.raf) return;
    this.raf = requestAnimationFrame((t) => this.paint(t));
  }

  private size(c: Canvas): boolean {
    const parent = c.el.parentElement;
    const box = parent ? this.boxes.get(parent) : undefined;
    const w = Math.max(1, box?.w ?? Math.round(parent?.clientWidth ?? 320));
    const h = Math.max(1, box?.h ?? Math.round(parent?.clientHeight ?? 116));
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
    c.ctx.clearRect(0, 0, w, h);
    return w > 8 && h > 8;
  }

  private sceneNow(): Scene {
    if (!this.scene) {
      const street = this.committed == null ? this.data.blocks : this.data.blocks.filter((b) => b.height <= this.committed!);
      this.scene = { blocks: street, mem: this.data.mem, fees: this.data.fees, now: Date.now(), avgBlockMs: this.data.avgBlockMs };
    }
    return this.scene;
  }

  private paint(now: number): void {
    // One chain only: a kick made while this frame runs (a commit at a moment's end) is folded in.
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.dead || !this.on) return;
    try {
      this.frameAt(now);
    } catch (e) {
      // One bad frame must not take the home page with it: drop what moves, keep the last picture.
      if (!this.warned) {
        this.warned = true;
        console.warn("[home-city] frame", e);
      }
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.abandon();
    }
  }

  /** After a failed frame: no moment, no crates in the air, the street as the data has it. */
  private abandon() {
    const m = this.moment;
    const waiting = this.queue;
    this.moment = null;
    this.queue = [];
    this.adds.clear();
    this.rare = null;
    this.settleUntil = 0;
    try {
      if (m) {
        const h = Math.max(m.seal.height, ...waiting.map((q) => q.height), this.committed ?? m.seal.height);
        if (this.committed == null || h > this.committed) {
          this.committed = h;
          this.scene = null;
          this.cb.onCommit(h);
        }
        this.cb.onBuilt(null);
        this.cb.onWaiting(null);
      }
      this.fly.el.width = 0;
      this.fly.el.height = 0;
      this.fly.w = 0;
      this.fly.h = 0;
    } catch {
      /* nothing more to drop */
    }
  }

  private frameAt(now: number): void {
    const m0 = this.moment;
    if (m0 && now - m0.t0 >= m0.end) this.finishMoment();
    const m = this.moment;
    const ms = m ? now - m.t0 : 0;
    const base = this.sceneNow();
    // During a seal the yard holds what waited when the block came, the street what stood before it.
    let memScene: Scene = base;
    let sealBlock: CityBlock | null = null;
    let kinds: string[] = [];
    if (m) {
      if (m.memFor !== base || !m.memScene) {
        m.memFor = base;
        m.memScene = { ...base, mem: m.memBefore, blocks: m.street };
      }
      memScene = m.memScene;
      const read = this.data.blocks.find((b) => b.id === m.seal.blockId) ?? null;
      if (!m.block || m.blockFor !== read) {
        m.blockFor = read;
        const st = sealStoreys(m.seal.txIds, m.memBefore.txs, read?.txs ?? null);
        m.kinds = st.kinds;
        m.block = {
          id: m.seal.blockId,
          height: m.seal.height,
          ts: m.seal.timestamp > 1e12 ? m.seal.timestamp : m.seal.timestamp * 1000,
          // A partial seal has no tx list: the read (when it lands) gives the count and the storeys.
          txCount: m.seal.txCount || m.seal.txIds.length || read?.txCount || st.txs.length,
          size: m.seal.size || read?.size || 0,
          flag: read?.flag ?? null,
          lithos: read?.lithos === true,
          txs: st.txs,
        };
      }
      sealBlock = m.block;
      kinds = m.kinds ?? [];
    }
    const cityScene: Scene = memScene;
    for (const [id, at] of this.adds) if (now - at > ADD_MS) this.adds.delete(id);
    const frame: Frame = {
      seal: m && sealBlock ? { ms, block: sealBlock, ids: m.ids } : null,
      add: this.adds.size ? new Map([...this.adds].map(([id, at]) => [id, now - at])) : null,
      hover: null,
      reduce: this.reduce,
      now,
    };
    const inks = this.inks;
    // City.
    let rareActive = false;
    if (this.size(this.city)) {
      const cue = this.cue(now, cityScene);
      rareActive = cue.rare;
      const out = drawCity(this.city.ctx, this.city.w, this.city.h, cityScene, { ...frame, hover: this.hover.city }, inks, {
        lithosMark: this.markOk ? this.mark : null,
        tag: this.text.tag,
        cue: cue.cue,
        kinds,
      });
      this.hits.city = out.hits;
      let pose = out.kayolo;
      if (!pose && !cityScene.blocks.length && !m && now - this.mountAt > NO_DATA_MS) {
        const r = citySiteRest(this.city.w, this.city.h);
        pose = { x: r.x, y: r.y, mood: "sleepy", face: -1, gaze: null };
      }
      if (pose) drawKayolo(this.city.ctx, pose, { now, color: inks.kayolo, scale: kayoloScale(this.city.w), reduce: this.reduce });
      if (m && sealBlock && out.built != null && out.built !== this.lastBuilt) {
        this.lastBuilt = out.built;
        this.cb.onBuilt({ id: sealBlock.id, height: sealBlock.height, built: out.built, ts: sealBlock.ts });
      }
    }
    // Yard.
    if (this.size(this.yard)) {
      this.hits.yard = drawYard(this.yard.ctx, this.yard.w, this.yard.h, memScene, { ...frame, hover: this.hover.yard }, inks, this.text);
      if (!m) {
        let wrap = 0;
        for (const h of this.hits.yard) if (h.id == null) wrap = h.n ?? 0;
        if (wrap !== this.lastWrap) {
          this.lastWrap = wrap;
          this.cb.onWrap?.(wrap);
        }
      }
    }
    if (m && sealBlock) {
      if (m.streamFor !== this.data.mem.txs || !m.inStream) {
        m.streamFor = this.data.mem.txs;
        m.inStream = new Set(this.data.mem.txs.map((t) => t.id));
      }
      const waiting = waitingShown({ streamCount: this.data.mem.count, ids: m.ids, ms, inStream: m.inStream });
      if (waiting !== this.lastWaiting) {
        this.lastWaiting = waiting;
        this.cb.onWaiting(waiting);
      }
      this.paintFlights(m, ms, memScene, sealBlock);
    }
    const easing = now < this.settleUntil && pixelSettling(this.city.ctx, KAYOLO_ID);
    // Under reduced motion a change gets its final frame only; if that frame caught a blink, one more
    // frame once it is over, so his eyes never stay half shut.
    const settling = easing && !this.reduce;
    if (easing && this.reduce && !this.blinkTail) {
      this.blinkTail = window.setTimeout(() => {
        this.blinkTail = 0;
        this.kick();
      }, 220);
    }
    const more = !!this.moment || this.adds.size > 0 || rareActive || settling;
    if (more && this.on && !this.raf) this.raf = requestAnimationFrame((t) => this.paint(t));
  }

  /** The cable and the crates on it, on the overlay that lives only for the seal. */
  private paintFlights(m: Moment, ms: number, memScene: Scene, block: CityBlock) {
    // An empty block lifts nothing: no overlay at all.
    if (!m.ids.length) return;
    if (!this.rects) this.rects = { host: this.host.getBoundingClientRect(), city: this.city.el.getBoundingClientRect(), yard: this.yard.el.getBoundingClientRect() };
    const { host: hr, city: cr, yard: yr } = this.rects;
    const fly = this.fly;
    const dpr = canvasDpr();
    const w = Math.max(1, Math.round(hr.width));
    const h = Math.max(1, Math.round(hr.height));
    if (fly.el.width !== Math.floor(w * dpr) || fly.el.height !== Math.floor(h * dpr)) {
      fly.el.width = Math.floor(w * dpr);
      fly.el.height = Math.floor(h * dpr);
      fly.el.style.width = `${w}px`;
      fly.el.style.height = `${h}px`;
    }
    fly.w = w;
    fly.h = h;
    fly.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fly.ctx.clearRect(0, 0, w, h);
    const box = (r: DOMRect) => ({ left: r.left - hr.left, top: r.top - hr.top, bottom: r.bottom - hr.top });
    const small = this.city.w < 420;
    const cable = yardCable(box(cr), this.city.w, box(yr), this.yard.w, small);
    const plan = sealPlan(m.ids.length);
    const t0 = plan.depart(0);
    const t1 = plan.depart(m.ids.length - 1) + plan.fly;
    const a = Math.min(Math.max(0, Math.min(1, (ms - t0 + 120) / 160)), Math.max(0, Math.min(1, (t1 + 160 - ms) / 160)));
    drawYardCable(fly.ctx, cable, a, this.inks.day);
    m.ids.forEach((id, k) => {
      const u = (ms - plan.depart(k)) / plan.fly;
      if (u <= 0 || u >= 1) return;
      const tx = m.byId.get(id);
      const from = yardRest(this.yard.w, this.yard.h, memScene, id);
      if (!tx || !from) return;
      const to = cityTarget(this.city.w, this.city.h, memScene, block, m.targets[k] ?? 0);
      const route = cable.route({ x: yr.left - hr.left + from.x, y: yr.top - hr.top + from.y }, { x: cr.left - hr.left + to.x, y: cr.top - hr.top + to.y });
      const p = cableAt(route, u);
      drawCrateFlight(fly.ctx, p.x, p.y, tx.color, p.rope, small, this.inks.day, flightSize(from.w, small, u));
    });
  }

  /** What Kayolo does at rest: a rare-height beat, a look at a hovered tower, dozing, or calm. */
  private cue(now: number, scene: Scene): { cue: KayoloCue; rare: boolean } {
    const r = this.rare;
    if (r && !this.moment) {
      if (r.start == null) {
        const there = scene.blocks.some((b) => b.height === r.height);
        if (there || now - r.at > RARE_WAIT_MS) r.start = now;
      }
      if (r.start != null) {
        const t = now - r.start;
        const tower = scene.blocks.find((b) => b.height === r.height) ?? scene.blocks[0];
        if (t < RARE_LOOK_MS) return { cue: { mood: "look", at: tower?.id ?? null, hop: 0 }, rare: true };
        if (t < RARE_LOOK_MS + RARE_HAPPY_MS) {
          const hop = t - RARE_LOOK_MS < RARE_HOP_MS ? (t - RARE_LOOK_MS) / RARE_HOP_MS : 0;
          return { cue: { mood: "happy", at: tower?.id ?? null, hop }, rare: true };
        }
        this.rare = null;
        this.settleUntil = now + SETTLE_MS;
      }
    }
    if (this.hover.city) return { cue: { mood: "look", at: this.hover.city, hop: 0 }, rare: false };
    const ts = arrivedAt(scene.blocks[0]);
    if (ts && Date.now() - ts > STALE_MS) return { cue: { mood: "sleepy", at: null, hop: 0 }, rare: false };
    return { cue: { mood: "idle", at: null, hop: 0 }, rare: false };
  }

  /** Test hook: the street's geometry as it is drawn now. */
  geo() {
    return cityGeo(this.city.w, this.city.h, this.sceneNow().blocks);
  }
}

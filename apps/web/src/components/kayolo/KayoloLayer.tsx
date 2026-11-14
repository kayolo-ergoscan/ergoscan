"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  adoptPixelState,
  drawPixel,
  pixelColor,
  pixelInkForPath,
  pixelSettling,
  pixelState,
  pixelWake,
  type PixelMood,
  type PixelPose,
} from "@/components/pixel";
import { INK_EVENT } from "@/lib/skin-ink";
import { onKayolo, say, takeEarly, type BodyWhere, type KayoloEvent } from "@/lib/kayolo/events";
import {
  arrivalOf,
  bodyOwner,
  currentMode,
  endIntro,
  introPendingNow,
  onChoice,
  onSlotPlace,
  setKeeper,
  setOwner,
  slotPlace,
  type Keeper,
} from "@/lib/kayolo/body";
import { createScheduler, levelAt, levelEdges, type Level, type Prio } from "@/lib/kayolo/scheduler";
import { makeAct, pokeAct, step, type Act, type ActName, type PoseDelta, type Vec } from "@/lib/kayolo/acts";
import { gazeTo, nookPoint, pageKind, parkPoint, tipPoint, titleRect, wideLayout } from "@/lib/kayolo/anchors";
import { chainNow, type NetState } from "@/lib/kayolo/chain-sense";
import { react, type Aim as Anchor, type Reaction } from "@/lib/kayolo/reactions";
import { startNavSense } from "@/lib/kayolo/nav-sense";
import { locKey } from "@/lib/route-nav";
import { pageMemory, readHome, welcomeFor, type Mode, type Welcome } from "@/lib/kayolo/memory";
import { COARSE_QUERY, REDUCE_QUERY, WIDE_QUERY } from "@/lib/kayolo/motion";
import * as K from "@/lib/kayolo/thresholds";

/**
 * Kayolo's engine (design/brand/kayolo-life.md §2, §8.3, §9.1, §9.4, §9.10), loaded after idle. It
 * holds the body whenever the header scout has parked it (M1, §9.8): in his window at home (the
 * niche on the desktop, the window in the pill on the phone), and in a fixed layer at the Addresses
 * door or a note. There he lives:
 * calm → reads → dozes → sleeps after 3 min without input, and wakes with «noticed»; he answers
 * every block by the §8.3 matrix and is poked from his window. One rAF and one timer at most; a frame
 * only while something has to change (an act, a blink, a level edge); none in the frozen sleep.
 *
 * Э3 «Отвечает на всё» (§6.2, §7): copies, hearts, tabs, sorts, filters, pages, rows, the search
 * (the palette edge), sheets, the Tip, the rail and the language each get an answer — a gesture, or
 * only the eyes when such answers come too often; the arrival act and a recolour by a blink; he
 * pushes the door while a page is slow; Back/Forward, the same URL and a link opened aside; the whole
 * poke ladder; night and the morning stretch. None of it takes a click: the layer never takes
 * pointer events, and the edge station is just a picture above the palette's backdrop.
 *
 * Э4 «Вся цепь» (§2.4, §8.3, §8.4): every chain sensor and every page:* goes through the reaction
 * matrix (lib/kayolo/reactions.ts) into the scheduler; a page:* about a height takes that block's
 * own reaction (held ≤ 5 s when the page said it re-reads). The faces that last — offline, the feed
 * lost, the site behind, the chain waiting or stalled, a tx still in the mempool — are backgrounds:
 * a face, not motion (the think sway runs its first 2 s, then holds still), shown in A0–A2.
 */

/** Body canvas: 56×64 CSS px, ground point at (28, 58). */
const W = 56;
const H = 64;
const GX = 28;
const GY = 58;
const HAND_EASE_MS = 400;
const FADE_MS = 150;
/** «Спрятан» → back: the seed grows into him (§4.6). */
const GROW_MS = 420;
/** «С возвращением» waits for the first pause (§5). */
const WELCOME_PAUSE_MS = 1200;
/** Eyes on the content at home (§2.6: gy +0.4). */
const CONTENT_LIFT = -1.8;

type Hold = { where: BodyWhere; x: number; y: number; face: 1 | -1 };
type Walk = { fromX: number; toX: number; y: number; fromY?: number; at: number; ms: number; roll0: number; arc?: number };
type Running = { act: Act; at: number; key: string; prio: Prio; flip: boolean };
type Bg = { kind: "offline" | "down" | "behind" | "stall" | "wait" | "pool"; at: number };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const SHADOW: Record<BodyWhere, { a: number; rx: number; ry: number }> = {
  nook: { a: 0.2, rx: 12, ry: 2.1 },
  park: { a: 0.2, rx: 12, ry: 2.1 },
  door: { a: 0.16, rx: 11, ry: 2 },
  note: { a: 0.18, rx: 12, ry: 2.1 },
  edge: { a: 0.14, rx: 11, ry: 2 },
};

/** Links and rows worth a look when the pointer rests on them (§2.6 №2). */
const MEANINGFUL =
  'a[href^="/tx/"],a[href^="/address/"],a[href^="/block/"],a[href^="/token/"],a[href^="/box/"],.feed-row,.nav-rail a,[data-kayolo-key]';

type Aim = Vec | null;

/** Э4 anchors (§9.5): the page's `data-kayolo` names, then the rail row of the section. */
const ANCHOR_SEL: Partial<Record<Anchor, string>> = {
  confirmations: '[data-kayolo="confirmations"]',
  pending: '[data-kayolo="pending"], [data-kayolo="balance"]',
  balance: '[data-kayolo="balance"]',
  "rent-beacon": '[data-kayolo="rent-beacon"], .addr-fact-balance .kpi-tile-mark',
  "pool-count": '[data-kayolo="pool-count"]',
  fee: '[data-kayolo="fee-p50"], [data-kayolo="fee-tile"]',
  "oracle-price": '[data-kayolo="oracle-price"]',
  price: '[data-scout="price"]',
  next: '[data-kayolo="next"], [data-dir="fwd"]',
  reward: '[data-kayolo="reward"]',
  "block-link": '[data-kayolo="block-link"]',
  indexer: '[data-kayolo="indexer"]',
  search: '[data-scout="search"]',
  tail: ".page-tail",
  row: "main .feed-row",
};
/** Tried in order when the anchor itself has no box: on the phone the tile's mark is hidden. */
const ANCHOR_NEXT: Partial<Record<Anchor, string[]>> = { "rent-beacon": ['[data-kayolo-note="rent"]', ".addr-fact-balance"] };
const ANCHOR_RAIL: Partial<Record<Anchor, string>> = { confirmations: "/blocks", "pool-count": "/mempool", fee: "/mempool" };

/** Centre of an element even off screen (the eyes then look toward that edge), or null without a box. */
function rawCenter(el: Element | null | undefined): Vec | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The point an Э4 anchor names: on screen first, else off screen, else its rail row (§9.5 fallbacks). */
function anchorPoint(a: Anchor, el?: Element | null): Vec | null {
  if (a === "tip") return tipPoint();
  if (a === "title") {
    const t = titleRect();
    return t ? { x: t.left + t.width / 2, y: t.top + t.height / 2 } : null;
  }
  if (a === "el") return rawCenter(el);
  const sel = ANCHOR_SEL[a];
  if (sel) {
    let off: Vec | null = null;
    for (const s of [sel, ...(ANCHOR_NEXT[a] ?? [])]) {
      for (const node of document.querySelectorAll(s)) {
        const c = centerOf(node);
        if (c) return c;
        off ??= rawCenter(node);
      }
    }
    if (off) return off;
  }
  const rail = ANCHOR_RAIL[a];
  if (rail) {
    const row = shown(`.nav-rail a[href="${rail}"], nav a[href="${rail}"]`);
    if (row) return centerOf(row);
  }
  return a === "confirmations" ? tipPoint() : null;
}

const RENT_SEEN_KEY = "kayolo.rent";

/** E23 plays once per address in a tab's session (§8.2). */
function rentSeen(address: string, mark: boolean): boolean {
  try {
    const raw = window.sessionStorage.getItem(RENT_SEEN_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (list.includes(address)) return true;
    if (mark) window.sessionStorage.setItem(RENT_SEEN_KEY, JSON.stringify([...list, address].slice(-20)));
  } catch {
    /* blocked storage: this load remembers it in the engine */
  }
  return false;
}

/** Centre of an element on screen (read once, when an answer starts), or null if it is not shown. */
function centerOf(el: Element | null | undefined): Vec | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return null;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The first visible element for a selector. */
function shown(sel: string): Element | null {
  for (const el of document.querySelectorAll(sel)) if (centerOf(el)) return el;
  return null;
}

/** E23's beacon on screen: the tile's mark, else the rent line, else the tile (§6.6). */
function rentBeaconShown(): Element | null {
  for (const s of [ANCHOR_SEL["rent-beacon"] as string, ...(ANCHOR_NEXT["rent-beacon"] ?? [])]) {
    const el = shown(s);
    if (el) return el;
  }
  return null;
}

/** The night (23:00–05:59 local, §2.3). */
function nightHour(): boolean {
  const h = new Date().getHours();
  return h >= K.NIGHT_FROM_H || h < K.NIGHT_TO_H;
}

const HOP_MOODS: ReadonlySet<PixelMood> = new Set<PixelMood>(["happy", "surprised"]);

function createEngine(layerBody: HTMLElement, layerCanvas: HTMLCanvasElement) {
  let path = window.location.pathname;
  let hold: Hold | null = null;
  let drawnOn: HTMLCanvasElement | null = null;
  let color = pixelColor(pixelInkForPath(path));
  let handed: { pose: Partial<PixelPose>; at: number } | null = null;
  let reduceSys = window.matchMedia(REDUCE_QUERY).matches;
  let mode: Mode = currentMode();
  const sched = createScheduler(performance.now());
  sched.mode(mode);
  let running: Running | null = null;
  let after: ActName | null = null;
  let pokeQueued: ActName | null = null;
  let pokeN = 0;
  let pokeAt = -1e9;
  /** A block or a rare height woke him from sleep: he is alert from here (input is not reset). */
  let wokeAt = -Infinity;
  let gaze: Vec | null = null;
  let gazeUntil = 0;
  let gazeAt = -1e9;
  let gazePt: Vec | null = null;
  let shy = false;
  let lastMove: Vec | null = null;
  let walk: Walk | null = null;
  /** The seed grows back into him (from «Спрятан»). */
  let grow: number | null = null;
  /** «С возвращением», once per load (§5). */
  let welcome: Welcome = welcomeFor(pageMemory().lastBefore(), Date.now());
  /** The introduction runs (§5): input cuts it short. */
  let introRun = false;
  /** Phone: a plate docked under the pill; he sits lower and does not hop (§3.2). */
  let docked = false;
  let dockRaf = 0;
  let fade: { at: number; from: Vec; to: Hold } | null = null;
  let roll = 0;
  let raf = 0;
  let paintedAt = -Infinity;
  let timer = 0;
  let timerAt = Infinity;
  let hidden = document.visibilityState === "hidden";
  let hiddenAt = 0;
  let hiddenSince = 0;
  let boxAt = { x: NaN, y: NaN };
  let dead = false;
  /* ---- Э3 ---- */
  /** Night (§2.3), read at most once a minute. */
  let night = nightHour();
  let nightAt = performance.now();
  sched.night(night);
  /** The morning stretch is due (once a day, 06:00–10:59, §2.3). */
  let morning = pageMemory().morningDue();
  /** «С возвращением» waits for the stretch to play first. */
  let welcomeAfter = 0;
  /** The eyes on something that means something (a hover, focus, the Tip, a sheet, the caret): T0. */
  let eyes: { to: Vec; until: number; from: string } | null = null;
  let eyesAt = -1e9;
  /** The colour changes while the eyes are shut (§7.1). */
  let recolor: { at: number; to: string } | null = null;
  /** A route is pending (§7.1): think, then he pushes the door. */
  let navWait: { at: number; shrugged: boolean } | null = null;
  /** An in-page wait (the first pack of an address tab): think, eyes on the tabs. */
  let pageWait: { at: number; to: Aim } | null = null;
  /** The last link click, for the lean, a HopNav side step and «уже здесь». */
  let lastClick: { kind: "go" | "here" | "aside"; el: Element | null; hop?: -1 | 1; at: number } | null = null;
  /** A history step just happened: the arrival that follows is a look back (§7.2). */
  let popNext: { dir: -1 | 1; seen: boolean; at: number; to: string } | null = null;
  /** The answer after a wake-up, with its anchors. */
  let afterAim: [Aim, Aim] | null = null;
  /** Offers that look at a page anchor when they play (the arrival beat, Э4 reactions). */
  const offerAim = new Map<string, () => Aim>();
  /** Э4: the second anchor and count(k) of an offer, read when it plays. */
  const offerMeta = new Map<string, { aim2?: () => Aim; n?: number }>();
  let afterN: number | undefined;
  /* ---- Э4: backgrounds (§2.4) and what waits on the page (§8.4) ---- */
  const c0 = chainNow();
  const t0 = performance.now();
  let net: { state: NetState; at: number; gaze: Aim } = { state: c0.net, at: t0, gaze: null };
  let waitBg: { level: 0 | 1 | 2 | 3; at: number } = { level: c0.wait, at: t0 };
  let behind = { on: c0.behind.on, at: t0, knockAt: c0.behind.on ? t0 + K.BEHIND_KNOCK_MIN_MS : Infinity, knocks: 0 };
  /** /tx in the mempool: a still think face; the eyes on the «mempool» field the first 2 s (≤ 3 a visit). */
  let poolThink: { at: number; gaze: Aim } | null = null;
  let poolLooks = 0;
  /** Blocks whose page re-reads for them: each reaction waits ≤ 5 s for its page:* (§2.8); ≤ 3, oldest out. */
  let held: { r: Reaction; ev: KayoloEvent; until: number }[] = [];
  /** page:* that came while the scout had the body: offered once he has it, within their TTL; ≤ 3, one per offer key. */
  let deferred: { r: Reaction; ev: KayoloEvent; at: number }[] = [];
  /** E12: this block drained the pool; its act ends with a breath out. */
  let drainedH: number | null = null;
  const confirmedTx = new Set<string>();
  const pendAt = new Map<string, number>();
  let feeSpikeAt = -1e9;
  let surgeAt = -1e9;
  /** E23 waits for the beacon to be on screen (he never scrolls the page). */
  let rentWait: { r: Reaction; ev: KayoloEvent; at: number } | null = null;
  let rentCheckAt: number | null = null;

  let hiddenHeight: number | null = null;
  /** The last block reaction that played (two blocks < 20 s apart: the second is a nod, §8.4). */
  let blockPlayedAt = -1e9;
  /** Answers by kind: the last gesture, for «a gesture at most every N s, else the eyes». */
  const answeredAt = new Map<string, number>();
  /** Tab or filter: watch the page for its data (think on a skeleton, then a nod; empty → tilt). */
  let awaitData: { kind: "tab" | "filter"; el: Element | null; next: number; until: number; thinking: boolean } | null = null;
  /** No matches in the palette: sniff 600 ms after the last key, once per query. */
  let missDue: { at: number; q: string; el: Element | null } | null = null;
  let missQ = "";
  let caretAt = -1e9;
  let caretPt: Vec | null = null;
  /** The palette or sheets are open (sheets stack, so a count): busy (§2.8), eyes on it. */
  let paletteOpen = false;
  let sheetOpen = 0;
  /** A hovered thing waiting out its 300 ms. */
  let hoverCand: { el: Element; at: number } | null = null;
  let hoverAt = -1e9;
  let focusAt = -1e9;
  let tapAt = -1e9;
  let lastPress: { el: Element; at: number } | null = null;
  const nav = startNavSense();
  const layerRoot = layerBody.parentElement;

  /** Quiet motion: «Тихий», or the system asks for less and «Живой» was not chosen (§10). */
  const actReduce = () => mode === "calm" || (reduceSys && mode !== "live");
  const pixelReduce = () => reduceSys && mode !== "live";
  const phone = () => !wideLayout();

  /** The canvas in the window of the layout that is on (desktop niche or phone pill). */
  const slotCanvas = () =>
    slotPlace()?.el?.querySelector<HTMLCanvasElement>("canvas.kayolo-canvas") ??
    document.querySelector<HTMLCanvasElement>(".kayolo-slot canvas.kayolo-canvas");

  /** Where the body is drawn now: his window at home, the layer on a path or away. */
  const canvasFor = (h: Hold): HTMLCanvasElement | null => {
    const cv = h.where === "nook" && !walk && !fade ? (slotCanvas() ?? layerCanvas) : layerCanvas;
    // The perf script's «hidden» run cuts the canvas loose: then he is simply not drawn.
    return cv.parentElement ? cv : null;
  };

  const ctxOf = (cv: HTMLCanvasElement) => cv.getContext("2d");

  const size = (cv: HTMLCanvasElement) => {
    const dpr = Math.min(window.matchMedia(COARSE_QUERY).matches ? 1.5 : 2, window.devicePixelRatio || 1);
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return dpr;
  };

  const clear = (cv: HTMLCanvasElement | null) => {
    if (!cv) return;
    const ctx = ctxOf(cv);
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
  };

  /** The same face moves from canvas to canvas (§9.7): no jump at the switch. */
  const switchTo = (cv: HTMLCanvasElement) => {
    if (drawnOn === cv) return;
    const from = drawnOn ? ctxOf(drawnOn) : null;
    const st = from ? pixelState(from, "main") : null;
    clear(drawnOn);
    const to = ctxOf(cv);
    if (to && st) adoptPixelState(to, "main", st);
    drawnOn = cv;
  };

  const placeLayer = (x: number, y: number) => {
    const lx = Math.round((x - GX) * 2) / 2;
    const ly = Math.round((y - GY) * 2) / 2;
    if (lx === boxAt.x && ly === boxAt.y) return;
    boxAt = { x: lx, y: ly };
    layerBody.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
  };

  const bodyAt = (): Vec | null => {
    if (!hold) return null;
    if (hold.where === "nook" && !walk) {
      const s = slotPlace();
      return s ? { x: s.x, y: s.y - 11 } : null;
    }
    return { x: hold.x, y: hold.y - 11 };
  };

  const homeHold = (): Hold | null => {
    const s = slotPlace();
    if (s) return { where: "nook", x: s.x, y: s.y, face: s.face };
    if (phone()) {
      // No window in the pill (yet): the old park past the search word.
      const p = parkPoint();
      return p ? { where: "park", x: p.x, y: p.y, face: p.face } : null;
    }
    const n = nookPoint(readHome(local) ?? "r");
    return n ? { where: "nook", x: n.x, y: n.y, face: n.face } : null;
  };

  /* ---------------- the level and the resting pose ---------------- */

  const since = (now: number) => Math.min(sched.sinceInput(now), now - wokeAt);

  /** Night or day, re-read at most once a minute (only while frames run). */
  const nightNow = (now: number) => {
    if (now - nightAt >= 60_000) {
      nightAt = now;
      const on = nightHour();
      if (on !== night) {
        night = on;
        sched.night(on);
      }
    }
    return night;
  };

  const levelNow = (now: number): { lv: Level; inLv: number } => {
    if (mode === "asleep") return { lv: 4, inLv: Infinity };
    const nt = nightNow(now);
    const edges = levelEdges(nt);
    const s = since(now);
    let lv = levelAt(s, nt);
    const dense = pageKind(path) === "d";
    const a2 = dense ? Math.min(20_000, edges[1]) : edges[1];
    if (dense && lv < 2 && s >= a2) lv = 2;
    const edge = [0, edges[0], a2, edges[2], edges[3]][lv];
    return { lv, inLv: s - edge };
  };

  /** The eyes on a meaningful target, while it lasts (it wins over the cursor, §2.6). */
  const eyesNow = (now: number): Vec | null => (eyes && now < eyes.until ? eyes.to : null);

  /** The wait faces (§7.1, §7.3): they replace the rest pose while a page is coming. */
  const waitPose = (now: number, face: 1 | -1): Partial<PixelPose> | null => {
    // «Спит», «Спрятан»: no wait is shown (the eyes stay shut, nothing paints on).
    if (mode !== "live" && mode !== "calm") return null;
    if (navWait) {
      const t = now - navWait.at;
      if (t >= K.DOOR_SIT_MS) {
        // He sits down to wait, sleepy lids.
        return { mood: "idle", doze: 0.5, squash: actReduce() ? 0 : -0.06, eyeLift: CONTENT_LIFT, glances: false, breath: 0 };
      }
      const pose: Partial<PixelPose> = { mood: "think", wobble: 1, eyeLift: CONTENT_LIFT };
      if (t >= K.DOOR_SHRUG_MS && t < K.DOOR_SHRUG_MS + 700) {
        // Still nothing: a look at the person (the shrug itself is an act).
        pose.gaze = { x: -face * 0.3, y: -0.05 };
        return pose;
      }
      if (t >= K.DOOR_AFTER_MS) {
        // He pushes the door: a knock on the title frame every 700 ms (RM: a blink instead).
        const ph = (t - K.DOOR_AFTER_MS) % K.DOOR_KNOCK_MS;
        const k = ph < 70 ? ph / 70 : ph < 160 ? 1 - (ph - 70) / 90 : 0;
        if (actReduce()) pose.eyeScale = 1 - 0.9 * k;
        else pose.pick = k;
      }
      return pose;
    }
    if (pageWait) {
      return { mood: "think", wobble: now - pageWait.at < 2000 ? 1 : 0, gaze: pageWait.to, eyeLift: CONTENT_LIFT };
    }
    if (awaitData?.thinking) return { mood: "think", wobble: 0, gaze: eyesNow(now), eyeLift: CONTENT_LIFT };
    return null;
  };

  /** A2: the eyes read the content, 4 sweeps of 2.4 s with pauses. */
  const SWEEP = 2400;
  const SWEEP_GAP = 2200;
  const reading = (inLv: number) => {
    const pass = Math.floor(inLv / (SWEEP + SWEEP_GAP));
    if (pass >= 4) return { look: 0, moving: false, next: Infinity };
    const tt = inLv - pass * (SWEEP + SWEEP_GAP);
    if (tt < SWEEP) return { look: -1.2 + 2.4 * smooth(tt / SWEEP), moving: true, next: 0 };
    return { look: 1.2, moving: false, next: (pass + 1) * (SWEEP + SWEEP_GAP) - inLv };
  };

  /**
   * The background on now (§2.4, by importance), shown in A0–A2: offline, the feed down, the site
   * behind, the chain stalled or waiting, a tx still in the mempool (/tx).
   */
  const bgNow = (): Bg | null => {
    if (mode !== "live" && mode !== "calm") return null;
    if (net.state === "offline") return { kind: "offline", at: net.at };
    if (net.state === "down") return { kind: "down", at: net.at };
    if (behind.on) return { kind: "behind", at: behind.at };
    if (waitBg.level >= 3) return { kind: "stall", at: waitBg.at };
    if (waitBg.level === 2) return { kind: "wait", at: waitBg.at };
    if (poolThink) return { kind: "pool", at: poolThink.at };
    return null;
  };
  /** Only the think faces sway, and only their first 2 s; then the face is still and blinks (§2.4, §9.7). */
  const bgSways = (bg: Bg, now: number) =>
    (bg.kind === "behind" || bg.kind === "wait" || bg.kind === "pool") && !pixelReduce() && now - bg.at < K.BACK_WOBBLE_MS;
  const bgPose = (bg: Bg, now: number): Partial<PixelPose> => {
    const sway = bgSways(bg, now) ? 1 : 0;
    const e = eyesNow(now);
    switch (bg.kind) {
      case "offline":
      case "down": {
        // «Ждёт»: sits down, eyes apart, looks down (the feed: at the title); after 60 s he dozes.
        const sit: Partial<PixelPose> = { mood: "idle", eyesApart: 0.18, squash: actReduce() ? 0 : -0.06, glances: false, breath: 0, blinkGap: 1.6 };
        if (bg.kind === "down" && now - bg.at >= K.DOWN_DOZE_MS) return { ...sit, doze: 0.5 };
        if (bg.kind === "down") return { ...sit, gaze: e ?? net.gaze ?? { x: 0, y: -0.3 }, eyeLift: CONTENT_LIFT };
        return { ...sit, gaze: e ?? { x: 0, y: 0.4 } };
      }
      case "stall":
        // Dozes without tears until a block, still, as in A3.
        return { mood: "sleepy", doze: 0.55, nod: 0, breath: 0, zzz: false, glances: false };
      case "pool":
        return { mood: "think", wobble: sway, eyeLift: CONTENT_LIFT, gaze: e ?? (poolThink && now - bg.at < 2000 ? poolThink.gaze : null) };
      default:
        // The site behind, the chain waiting: a still think (never sad).
        return { mood: "think", wobble: sway, eyeLift: CONTENT_LIFT, gaze: e };
    }
  };

  const restPose = (now: number, face: 1 | -1): Partial<PixelPose> => {
    const wait = waitPose(now, face);
    if (wait) return wait;
    const { lv, inLv } = levelNow(now);
    const bg = lv <= 2 ? bgNow() : null;
    if (bg) return bgPose(bg, now);
    if (lv === 0) {
      return {
        mood: "idle",
        eyeLift: CONTENT_LIFT,
        gaze: eyesNow(now) ?? (now < gazeUntil ? gaze : null),
        head: shy ? -0.2 : 0,
      };
    }
    if (lv === 1) {
      const e = eyesNow(now);
      return e ? { mood: "idle", eyeLift: CONTENT_LIFT, gaze: e } : { mood: "idle", eyeLift: CONTENT_LIFT, glanceGap: 1.6, glanceRange: 0.86 };
    }
    if (lv === 2) {
      const r = reading(inLv);
      return { mood: "work", glances: false, look: face * r.look, eyeLift: -1 };
    }
    if (lv === 3) {
      return { mood: "sleepy", doze: 0.55 * smooth(inLv / 1200), nod: inLv < 4200 ? 1 : 0, breath: 0, zzz: false, glances: false };
    }
    const zzz = inLv < K.ZZZ_MS && mode !== "asleep";
    return { mood: "sleepy", doze: 0.92, nod: 0, breath: zzz ? 1 : 0, zzz: zzz ? true : "one", glances: false };
  };

  /* ---------------- acts ---------------- */

  const targetFor = (name: ActName): Vec | null => {
    const body = bodyAt();
    if (!body) return null;
    if (name === "poke1" || name === "notice" || name === "pleased" || name === "pet" || name === "wakeUp") return null;
    if (name === "intro" || name === "welcome3") {
      const t = document.querySelector('header [data-scout="title"]')?.getBoundingClientRect();
      if (t && t.width > 2) return gazeTo(body, { x: t.left + t.width / 2, y: t.top + t.height / 2 });
    }
    const tip = tipPoint();
    return tip ? gazeTo(body, tip) : null;
  };

  /** `aim` overrides the act's default anchor (undefined keeps it); `aim2` is its second anchor. */
  const startAct = (name: ActName, now: number, key: string, prio: Prio, aim?: Aim, aim2?: Aim, n?: number) => {
    if (!hold) return;
    const target = aim !== undefined ? aim : targetFor(name);
    const act = makeAct(name, { reduce: actReduce(), target, target2: aim2 ?? null, rest: { x: 0, y: 0 }, face: hold.face, n, rnd: Math.random });
    running = { act, at: now, key, prio, flip: true };
  };

  /** Screen-space gaze from his body toward a point. */
  const aimAt = (pt: Vec | null): Aim => {
    const b = bodyAt();
    return b && pt ? gazeTo(b, pt) : null;
  };
  const aimEl = (el: Element | null | undefined): Aim => aimAt(centerOf(el));
  const titleAim = (): Aim => {
    const r = titleRect();
    return r ? aimAt({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : null;
  };

  /** He answers only where he lives in the layer, awake and not hidden («Тихий» answers quietly). */
  const answering = () => !!hold && !introRun && (mode === "live" || mode === "calm") && !hidden;

  /** Only the eyes (T0): a look at `to` for `ms`. */
  const look = (to: Aim, ms: number, now: number, from = "look") => {
    if (!to || !answering()) return;
    eyes = { to, until: now + ms, from };
    eyesAt = now;
    frame();
  };

  /**
   * A person's action answered (P2, §2.8): the act at once, never cut by the budget. The same kind
   * again within `gap` gets only the eyes; so does anything while a poke or the wake-up plays (the
   * answer then follows the wake-up).
   */
  const answer = (kind: string, name: ActName, gap: number, now: number, aim: Aim, aim2: Aim = null) => {
    if (!answering()) return;
    const last = answeredAt.get(kind) ?? -1e9;
    if (now - last < gap) {
      look(aim, 700, now, kind);
      return;
    }
    if (running?.key === "wake") {
      after = name;
      afterAim = [aim, aim2];
      answeredAt.set(kind, now);
      return;
    }
    if (running && running.prio <= 1) {
      look(aim, 700, now, kind);
      return;
    }
    answeredAt.set(kind, now);
    sched.done();
    sched.offer({ key: kind, prio: 2, ttlMs: 1000, ladder: [step(name)] }, now);
    if (!sched.next(now)) {
      look(aim, 700, now, kind);
      return;
    }
    after = null;
    eyes = null;
    startAct(name, now, kind, 2, aim, aim2);
    frame();
  };

  /** A person's action (a poke, a notice): at once, through the attention window. */
  const human = (name: ActName, now: number, key: string) => {
    sched.offer({ key, prio: 1, ttlMs: 1000, ladder: [step(name)] }, now);
    const p = sched.next(now);
    if (p) startAct(name, now, key, 1);
  };

  const wakeFrom = (lv: Level, now: number) => {
    if (lv < 2) return;
    const name: ActName = lv === 2 ? "wakeSmall" : lv === 3 ? "wakeDoze" : "wakeSleep";
    // A person woke him (P2): the scheduler knows the act, so a block meanwhile is dropped (§2.8).
    sched.done();
    sched.offer({ key: "wake", prio: 2, ttlMs: 1000, ladder: [step(name)] }, now);
    sched.next(now);
    after = null;
    startAct(name, now, "wake", 2);
  };

  /** The introduction is over: the tour may follow (only if it ran to the end). */
  const finishIntro = (whole: boolean) => {
    if (!introRun) return;
    introRun = false;
    endIntro();
    say({ k: "kayolo:intro-done", tour: whole });
  };

  const startIntro = (now: number) => {
    introRun = true;
    sched.offer({ key: "intro", prio: 2, ttlMs: 1000, ladder: [step("intro")] }, now);
    sched.next(now);
    startAct("intro", now, "intro", 2);
  };

  /** Pull what the scheduler lets him do now. */
  const pump = (now: number) => {
    if (running && now - running.at >= running.act.ms) {
      if (running.act.name === "intro") finishIntro(true);
      running = null;
      if (after) {
        const next = after;
        const aims = afterAim;
        const n = afterN;
        after = null;
        afterAim = null;
        afterN = undefined;
        startAct(next, now, "after", 4, aims ? aims[0] : undefined, aims ? aims[1] : undefined, n);
      }
    }
    if (pokeQueued && (!running || (running.key === "poke" && now - running.at >= K.POKE_NEXT_AT * running.act.ms))) {
      const name = pokeQueued;
      pokeQueued = null;
      human(name, now, "poke");
    }
    // An open palette or sheet keeps him busy (§2.8): spontaneous acts wait, the eyes stay on it.
    if (paletteOpen || sheetOpen) sched.busy(now + 1000);
    pumpE3(now);
    pumpE4(now);
    const settled = hold && !running && !introRun && bodyOwner() === "kayolo" && sched.sinceInput(now) >= WELCOME_PAUSE_MS;
    // The very first visit has the introduction instead.
    if (morning && introPendingNow()) morning = false;
    if (morning && settled && (mode === "live" || mode === "calm")) {
      // The first visit of the morning: a stretch, once a day (§2.3); «welcome back» after it.
      morning = false;
      pageMemory().noteMorning();
      welcomeAfter = now + 400 + K.MERGE_MS + 900;
      sched.offer({ key: "morning", prio: 4, ttlMs: 8000, ladder: [step("stretch"), step("blink2")] }, now);
    }
    if (welcome !== "none" && settled && !morning && now >= welcomeAfter) {
      const name: ActName = welcome === "notice" ? "welcome1" : welcome === "hop" ? "welcome2" : "welcome3";
      welcome = "none";
      sched.offer({ key: "welcome", prio: 4, ttlMs: 8000, ladder: [step(name), step("welcome1")] }, now);
    }
    const play = running ? null : sched.next(now);
    if (play && hold) {
      // A block offered before the door opened plays at the door as a glance too (13.11 №9).
      const name: ActName = navWait && /^h\d/.test(play.key) ? "glance" : (play.step.act as ActName);
      const aim = offerAim.get(play.key);
      offerAim.delete(play.key);
      const meta = offerMeta.get(play.key);
      offerMeta.delete(play.key);
      const a2 = meta?.aim2 ? meta.aim2() : undefined;
      if (play.wake) {
        wokeAt = now;
        // Awake now for the scheduler too: the next block reads A0, not A4 (no second "wake").
        sched.inputAt(now);
        startAct("wake", now, play.key, play.prio);
        after = name;
        afterAim = aim ? [aim(), a2 ?? null] : null;
        afterN = meta?.n;
      } else {
        startAct(name, now, play.key, play.prio, aim ? aim() : undefined, a2, meta?.n);
        // E12: the block that drained the pool ends with a breath out (§8.4).
        if (drainedH != null && play.key === `h${drainedH}` && !after) after = "relief";
      }
      if (drainedH != null && play.key === `h${drainedH}`) drainedH = null;
      if (/^h\d/.test(play.key)) blockPlayedAt = now;
    }
  };

  /** Э4 follow-ups: a held block that nobody absorbed, the site-behind knocks. */
  const pumpE4 = (now: number) => {
    if (held.length && held.some((h) => now >= h.until)) {
      // The page did not say its page:* in time: the block reacts as usual (§2.8).
      const due = held.filter((h) => now >= h.until);
      held = held.filter((h) => now < h.until);
      if (hold) for (const h of due) offerR(h.r, now);
    }
    if (behind.on && behind.knocks < K.BEHIND_KNOCKS && now >= behind.knockAt && hold && !running) {
      behind.knockAt = now + K.BEHIND_KNOCK_MIN_MS + Math.random() * (K.BEHIND_KNOCK_MAX_MS - K.BEHIND_KNOCK_MIN_MS);
      const ind = shown('[data-kayolo="indexer"]');
      if (ind && levelNow(now).lv < 3 && (mode === "live" || mode === "calm")) {
        // Never sad: two knocks on the indicator, ≤ 3 a visit (§2.4).
        behind.knocks += 1;
        offerAim.set("behind", () => aimEl(ind));
        sched.offer({ key: "behind", prio: 4, ttlMs: 4000, ladder: [step("knock2"), step("glance")] }, now);
      }
    }
  };

  /** Э3 follow-ups that wait for the page: the door's shrug, data after a tab or filter, a miss, a hover. */
  const pumpE3 = (now: number) => {
    if (navWait && !navWait.shrugged && now - navWait.at >= K.DOOR_SHRUG_MS && hold) {
      navWait.shrugged = true;
      if (!running || running.prio > 1) startAct("shrugBig", now, "door", 2, null);
    }
    if (awaitData && now >= awaitData.next) {
      const busy = !!document.querySelector('main [aria-busy="true"], main .feed-skeleton, main [data-skeleton]');
      if (busy && now < awaitData.until) {
        // A skeleton: he thinks until the data comes (§6.2).
        if (!awaitData.thinking) {
          awaitData.thinking = true;
          frame();
        }
        awaitData.next = now + 400;
      } else {
        const a = awaitData;
        awaitData = null;
        if (a.kind === "tab") {
          if (a.thinking && !busy) answer("tab-data", "nod", 0, now, null);
          else frame();
        } else {
          const plate = a.el?.closest("section, .feed-plate, .feed-board") ?? document.querySelector("main");
          const empty = !!(plate ?? document).querySelector?.(".feed-empty");
          if (empty) answer("filter", "tilt", 0, now, aimEl(a.el));
          else answer("filter", "nodGlance", 0, now, aimEl(plate?.querySelector(".feed-row") ?? a.el));
        }
      }
    }
    if (missDue && now >= missDue.at) {
      const m = missDue;
      missDue = null;
      if (paletteOpen && m.q !== missQ) {
        missQ = m.q;
        answer("search-miss", "sniff", 0, now, aimEl(m.el));
      }
    }
    if (beatDue != null && now >= beatDue) {
      // The page's beat: a look at its key figure, if it has one (the figures come in Э6).
      beatDue = null;
      const key = shown("[data-kayolo-key]");
      if (key && hold) {
        offerAim.set("beat", () => aimEl(key));
        sched.offer({ key: "beat", prio: 3, ttlMs: 3000, ladder: [step("glance")] }, now);
      }
    }
    if (hoverCand && now - hoverCand.at >= K.HOVER_MS) {
      const c = hoverCand;
      hoverCand = null;
      if (now - hoverAt >= K.HOVER_GAP_MS && !running && levelNow(now).lv === 0 && c.el.matches(":hover")) {
        hoverAt = now;
        look(aimEl(c.el), K.HOVER_HOLD_MS, now, "hover");
      }
    }
  };

  const poseAt = (now: number, face: 1 | -1, ctx: CanvasRenderingContext2D): PixelPose => {
    const rest = restPose(now, face);
    const pose: PixelPose = { x: GX, y: GY, ...rest };
    if (handed) {
      const k = 1 - smooth((now - handed.at) / HAND_EASE_MS);
      if (k <= 0) handed = null;
      else {
        const h = handed.pose;
        pose.look = (pose.look ?? 0) * (1 - k) + (h.look ?? 0) * k;
        pose.head = (pose.head ?? 0) * (1 - k) + (h.head ?? 0) * k;
        pose.pick = (h.pick ?? 0) * k;
        pose.eyeLift = (pose.eyeLift ?? 0) * (1 - k) + (h.eyeLift ?? 0) * k;
        pose.eyeScale = 1 + ((h.eyeScale ?? 1) - 1) * k;
        pose.pupil = h.pupil;
        pose.pupilOrbit = (h.pupilOrbit ?? 0) * k;
        pose.eyesApart = (h.eyesApart ?? 0) * k;
      }
    }
    let flip = false;
    if (running) {
      const d: PoseDelta = running.act.at(now - running.at);
      if (d.mood) {
        let m = d.mood;
        // A hop comes with the switch to happy or surprised: from the same face, step out of it first.
        if (running.flip && HOP_MOODS.has(m) && pixelState(ctx, "main")?.mood === m) m = "pleased";
        pose.mood = m;
      }
      running.flip = false;
      if (d.gaze !== undefined) pose.gaze = d.gaze;
      if (d.head != null) pose.head = (pose.head ?? 0) + d.head;
      if (d.pick != null) pose.pick = d.pick;
      if (d.eyeScale != null) pose.eyeScale = d.eyeScale;
      if (d.eyeLift != null) pose.eyeLift = (pose.eyeLift ?? 0) + d.eyeLift;
      if (d.squash != null) pose.squash = d.squash;
      if (d.wink != null) pose.wink = d.wink;
      if (d.doze !== undefined) pose.doze = d.doze;
      if (d.zzz !== undefined) pose.zzz = d.zzz;
      if (d.pupilOrbit != null) {
        pose.pupil = d.pupil;
        pose.pupilOrbit = d.pupilOrbit;
      }
      if (d.hopMax != null) pose.hopMax = d.hopMax;
      if (d.shift) pose.x = GX + clamp(d.shift, -8, 8);
      flip = !!d.flip;
      if (d.mood && d.mood !== "sleepy") {
        pose.doze = d.doze;
        pose.nod = 0;
      }
    }
    pose.face = flip ? -face : face;
    return pose;
  };

  /* ---------------- frames ---------------- */

  const nextDue = (now: number, ctx: CanvasRenderingContext2D | null): number => {
    if (!hold || hidden) return Infinity;
    if (grow != null) return now;
    if (mode === "hidden") return Infinity;
    let due = sched.nextDue(now);
    if (running || after || pokeQueued || walk || fade || recolor) return now;
    if (handed) return now;
    if (mode === "asleep") {
      // The eyes finish closing, then not a frame more (§4.6). No timer (a scheduler edge, a gaze,
      // the reading edge) may paint either: any paint would start the next idle blink. The choice
      // itself paints once (refreshMode → frame); waking goes through refreshMode too.
      return ctx && pixelSettling(ctx, "main") ? pixelWake(ctx, "main") : Infinity;
    }
    if (navWait && now - navWait.at < K.DOOR_SIT_MS) {
      const t = now - navWait.at;
      if (pixelReduce()) {
        // A still body (reduced motion): the think face is painted once; then the shrug, then the sit.
        due = Math.min(due, navWait.at + (navWait.shrugged ? K.DOOR_SIT_MS : K.DOOR_SHRUG_MS));
      } else {
        // Pushing the door: every frame of a knock, 20 fps between them (the think face sways).
        if (t >= K.DOOR_AFTER_MS && (t - K.DOOR_AFTER_MS) % K.DOOR_KNOCK_MS < 180) return now;
        return Math.max(now, paintedAt + 1000 / K.GAZE_FPS);
      }
    }
    // An in-page wait: the think face sways 2 s at 20 fps, then holds still (no frames however long).
    if (pageWait && now - pageWait.at < 2000) {
      if (!pixelReduce()) return Math.max(now, paintedAt + 1000 / K.GAZE_FPS);
      due = Math.min(due, pageWait.at + 2000);
    }
    if (gaze) due = Math.min(due, gazeUntil);
    if (eyes) due = Math.min(due, eyes.until);
    for (const h of held) due = Math.min(due, h.until);
    if (awaitData) due = Math.min(due, awaitData.next);
    if (missDue) due = Math.min(due, missDue.at);
    if (hoverCand) due = Math.min(due, hoverCand.at + K.HOVER_MS);
    if (beatDue != null) due = Math.min(due, beatDue);
    const quietFor = sched.sinceInput(now);
    if ((welcome !== "none" || morning) && quietFor < WELCOME_PAUSE_MS) due = Math.min(due, now + WELCOME_PAUSE_MS - quietFor);
    if (welcome !== "none" && now < welcomeAfter) due = Math.min(due, welcomeAfter);
    // Dense pages start reading at 20 s, before the scheduler's own A2 edge (§2.2).
    if (pageKind(path) === "d" && since(now) < 20_000) due = Math.min(due, now + 20_000 - since(now));
    const { lv, inLv } = levelNow(now);
    if (behind.on && behind.knocks < K.BEHIND_KNOCKS && lv < 3) due = Math.min(due, behind.knockAt);
    const bg = lv <= 2 ? bgNow() : null;
    if (bg) {
      // A background is a face: it sways its first 2 s at 20 fps, then holds still (blinks only).
      if (bgSways(bg, now)) return Math.max(now, paintedAt + 1000 / K.GAZE_FPS);
      if (paintedAt < bg.at + K.BACK_WOBBLE_MS) due = Math.min(due, bg.at + K.BACK_WOBBLE_MS);
      if (bg.kind === "down" && now < bg.at + K.DOWN_DOZE_MS) due = Math.min(due, bg.at + K.DOWN_DOZE_MS);
      if (ctx) due = Math.min(due, pixelWake(ctx, "main"));
      return lv >= 2 ? Math.max(due, paintedAt + 1000 / K.REST_FPS) : due;
    }
    // Paced frames count from the last painted one, not from now: a timer that wakes early must
    // land on a frame, not push the frame forward again. Reading and dozing (A2–A3) are drawn at
    // 20 fps: ≤ 300 frames a minute (§9.10). The face eases by time, so the sweeps, blinks and the
    // sleepy nod keep their speed.
    const slow = paintedAt + 1000 / K.REST_FPS;
    if (lv === 2) {
      const r = reading(inLv);
      if (r.moving) return Math.max(paintedAt + 1000 / K.GAZE_FPS, slow);
      due = Math.min(due, now + r.next);
    } else if (lv === 3 && inLv < 4200) return slow;
    else if (lv === 4) {
      if (inLv < K.ZZZ_MS) return paintedAt + 1000 / K.ZZZ_FPS;
      if (inLv < K.ZZZ_MS + 500) return paintedAt + 100;
      return due;
    }
    if (ctx) due = Math.min(due, pixelWake(ctx, "main"));
    return lv >= 2 ? Math.max(due, slow) : due;
  };

  const frame = () => {
    if (!raf && !dead && !hidden) raf = requestAnimationFrame(paint);
  };

  const schedule = (due: number, now: number) => {
    if (!Number.isFinite(due)) return;
    if (due - now <= 34) {
      frame();
      return;
    }
    if (timer && timerAt <= due) return;
    if (timer) window.clearTimeout(timer);
    timerAt = due;
    timer = window.setTimeout(() => {
      timer = 0;
      timerAt = Infinity;
      tick();
    }, Math.max(0, due - now - 16));
  };

  /** A timer fired: paint if something is due, else wait for the new due time. */
  const tick = () => {
    if (dead || hidden || !hold) return;
    const now = performance.now();
    const ctx = drawnOn ? ctxOf(drawnOn) : null;
    const due = nextDue(now, ctx);
    if (due - now <= 34) frame();
    else schedule(due, now);
  };

  const kick = () => {
    if (!hold || hidden) return;
    const now = performance.now();
    pump(now);
    schedule(nextDue(now, drawnOn ? ctxOf(drawnOn) : null), now);
  };

  function paint(now: number) {
    raf = 0;
    if (dead || !hold || hidden) return;
    paintedAt = now;
    pump(now);
    let x = hold.x;
    let y = hold.y;
    let face = hold.face;
    let alpha = 1;
    if (walk) {
      const u = Math.min(1, (now - walk.at) / walk.ms);
      x = walk.fromX + (walk.toX - walk.fromX) * smooth(u);
      y = walk.fromY == null ? walk.y : walk.fromY + (walk.y - walk.fromY) * smooth(u);
      // A jump (to the palette edge and back) flies an arc and does not shuffle.
      if (walk.arc) y -= walk.arc * Math.sin(Math.PI * u);
      else roll = walk.roll0 + Math.abs(x - walk.fromX) * 0.55;
      face = walk.toX >= walk.fromX ? 1 : -1;
      if (u >= 1) walk = null;
    } else if (hold.where === "nook") {
      const s = slotPlace();
      if (s) {
        x = s.x;
        y = s.y;
      }
    }
    if (fade) {
      const u = (now - fade.at) / FADE_MS;
      if (u < 1) {
        alpha = 1 - smooth(u);
        x = fade.from.x;
        y = fade.from.y;
      } else {
        hold = fade.to;
        x = hold.x;
        y = hold.y;
        face = hold.face;
        alpha = smooth(u - 1);
        if (u >= 2) fade = null;
      }
    }
    const cv = canvasFor(hold);
    if (!cv) return;
    // Above the palette (z 75) while he is at its edge or jumping there; never takes a pointer.
    layerRoot?.classList.toggle("is-over", hold.where === "edge" || !!walk?.arc);
    switchTo(cv);
    if (cv === layerCanvas) placeLayer(x, y);
    const dpr = size(cv);
    const ctx = ctxOf(cv);
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === "hidden") {
      // «Спрятан»: a seed of his colour, no eyes, no frames.
      ctx.fillStyle = color;
      ctx.fillRect(GX - 4, GY - 8, 8, 8);
      return;
    }
    if (grow != null) {
      // Back from «Спрятан»: the seed grows into his square, then the eyes open (420 ms).
      const u = (now - grow) / GROW_MS;
      if (u < 1) {
        const side = 8 + (22.36 - 8) * smooth(u);
        ctx.fillStyle = color;
        ctx.fillRect(GX - side / 2, GY - side, side, side);
        frame();
        return;
      }
      grow = null;
    }
    const sh = SHADOW[hold.where];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(0,0,0,${sh.a})`;
    ctx.beginPath();
    ctx.ellipse(GX, GY + 1, sh.rx, sh.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (recolor) {
      // The recolour blink: the colour changes while the eyes are shut.
      const u = (now - recolor.at) / K.RECOLOR_MS;
      if (u >= 0.5) color = recolor.to;
      if (u >= 1) recolor = null;
    }
    const pose = poseAt(now, face, ctx);
    if (recolor) pose.eyeScale = (pose.eyeScale ?? 1) * (1 - 0.92 * Math.sin(Math.PI * clamp((now - recolor.at) / K.RECOLOR_MS, 0, 1)));
    if (gaze && now >= gazeUntil) {
      gaze = null;
      gazePt = null;
    }
    if (eyes && now >= eyes.until) eyes = null;
    const calmHop: Partial<PixelPose> = actReduce() || docked ? { hopScale: 0 } : phone() ? { ...K.PHONE_HOP } : {};
    if (pose.hopMax != null) calmHop.hopMax = Math.min(calmHop.hopMax ?? Infinity, pose.hopMax);
    if (docked && !actReduce()) pose.squash = (pose.squash ?? 0) - 0.06;
    drawPixel(ctx, {
      ...pose,
      ...calmHop,
      x: pose.x,
      y: GY,
      blinkGap: Math.max(pose.blinkGap ?? 1, night ? K.NIGHT_BLINK_GAP : 1),
      scale: K.BODY_SCALE,
      color,
      now,
      roll,
      alpha,
      reduce: pixelReduce(),
      id: "main",
    });
    schedule(nextDue(now, ctx), now);
  }

  /* ---------------- the hand-over (§9.8 M1) ---------------- */

  const drop = () => {
    clear(drawnOn);
    clear(slotCanvas());
    drawnOn = null;
    hold = null;
    if (recolor) color = recolor.to;
    recolor = null;
    eyes = null;
    layerRoot?.classList.remove("is-over");
    running = null;
    after = null;
    walk = null;
    fade = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (timer) window.clearTimeout(timer);
    timer = 0;
    timerAt = Infinity;
  };

  const usable = () => mode !== "off" && path !== "/";

  /** Nobody draws him (no tour, reduced motion, back from home): he is simply at home. */
  const takeHome = () => {
    if (dead || hold || bodyOwner() !== "none" || !usable()) return;
    const h = homeHold();
    if (!h) return;
    const probe = canvasFor(h);
    if (!probe) return;
    hold = h;
    setOwner("kayolo");
    say({ k: "kayolo:took", where: h.where });
    const now = performance.now();
    // The very first visit: he wakes up in his window and meets the person before the tour (§5).
    if (introPendingNow() && arrivalOf(path)?.intro && mode === "live") startIntro(now);
    takeDeferred(now);
    paint(now);
  };

  const keeper: Keeper = {
    take(p) {
      if (dead || !usable()) return false;
      const h: Hold = { where: p.where, x: p.x, y: p.y, face: p.face };
      const cv = canvasFor(h);
      if (!cv) return false;
      drop();
      hold = h;
      recolor = null;
      if (p.color) color = p.color;
      handed = p.pose ? { pose: p.pose, at: performance.now() } : null;
      const ctx = ctxOf(cv);
      if (ctx && p.state) adoptPixelState(ctx, "main", p.state);
      drawnOn = cv;
      if (h.where === "nook") {
        // His window stands where the scout parked him (on the phone a few px higher, in the pill).
        const s = slotPlace();
        if (s && (Math.abs(s.x - p.x) > 1.5 || Math.abs(s.y - p.y) > 0.5)) {
          const ms = Math.max(Math.abs(s.y - p.y) > 0.5 ? 220 : 0, (Math.abs(s.x - p.x) / K.STEP_PX_S) * 1000);
          walk = { fromX: p.x, toX: s.x, y: s.y, fromY: p.y, at: performance.now(), ms, roll0: roll };
          switchTo(layerCanvas);
        }
      }
      // handoff() sets the owner only after this returns: the deferred reaction is his already.
      takeDeferred(performance.now(), true);
      paint(performance.now());
      return true;
    },
    move(p) {
      if (!hold || hold.where === "nook") return;
      hold.x = p.x;
      hold.y = p.y;
      if (p.face) hold.face = p.face;
      if (drawnOn === layerCanvas && !walk && !fade) placeLayer(p.x, p.y);
    },
    give() {
      if (!hold) return null;
      const now = performance.now();
      const ctx = drawnOn ? ctxOf(drawnOn) : null;
      const state = ctx ? pixelState(ctx, "main") : null;
      let x = hold.x;
      let y = hold.y;
      if (hold.where === "nook") {
        const s = slotPlace();
        if (s) {
          x = s.x;
          y = s.y;
        }
      }
      if (walk) {
        const u = Math.min(1, (now - walk.at) / walk.ms);
        x = walk.fromX + (walk.toX - walk.fromX) * smooth(u);
        if (walk.fromY != null) y = walk.fromY + (walk.y - walk.fromY) * smooth(u);
      }
      if (introRun) finishIntro(false);
      const out = { x, y, face: hold.face, where: hold.where, state, color };
      drop();
      return out;
    },
    where() {
      return hold?.where ?? null;
    },
    home() {
      if (!hold) return;
      const h = homeHold();
      if (!h) {
        drop();
        setOwner("none");
        return;
      }
      if (h.where === hold.where && Math.abs(h.x - hold.x) < 2 && Math.abs(h.y - hold.y) < 2) return;
      running = null;
      after = null;
      let from: Vec = { x: hold.x, y: hold.y };
      let gone = false;
      if (hold.where === "nook") {
        // The window he leaves; after a layout change it is hidden (a zero rect): no fade-out there.
        const el = drawnOn?.closest(".kayolo-slot");
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0) from = { x: r.left + r.width / 2, y: r.bottom - 6 };
        else gone = true;
      }
      const now = performance.now();
      fade = { at: gone ? now - FADE_MS : now, from, to: h };
      frame();
    },
  };

  /* ---------------- what he answers ---------------- */

  /* ---- Э4: the chain and the page (§8.3, §8.4) ---- */

  /** Where an Э4 anchor is, as a gaze from his body (off screen: toward that edge). */
  const aimFor = (a: Anchor, id?: string, el?: Element | null): Aim => {
    if (a === "row" && id) {
      const row = document.querySelector(`[data-kayolo-id="${CSS.escape(id)}"]`);
      if (row) return aimAt(rawCenter(row));
    }
    return aimAt(anchorPoint(a, el));
  };

  const ctxNow = (now: number) => ({ path, door: !!navWait, behind: behind.on, quick: now - blockPlayedAt < K.T2_GAP_MS });

  /** A reaction goes to the scheduler; its anchors are read when it plays. */
  const offerR = (r: Reaction, now: number, el?: Element | null) => {
    const key = r.offer.key;
    const a = r.aim;
    const a2 = r.aim2;
    if (a) offerAim.set(key, () => aimFor(a, r.id, el));
    if (a2 || r.n != null) offerMeta.set(key, { aim2: a2 ? () => aimFor(a2, r.id, el) : undefined, n: r.n });
    sched.offer(r.offer, now);
  };

  const heightOf = (ev: KayoloEvent): number | null => (ev.k === "chain:block" ? ev.height : ev.k === "chain:catchup" ? ev.to : null);

  /** A page:* about this height takes the block's own reaction (§2.8), held or waiting. */
  const absorbHeight = (h: number | undefined, now: number) => {
    if (h == null) return;
    held = held.filter((x) => heightOf(x.ev) !== h);
    const key = `h${h}`;
    if (sched.absorb((k) => k === key, now)) {
      offerAim.delete(key);
      offerMeta.delete(key);
    }
  };

  const onChain = (ev: KayoloEvent, now: number) => {
    switch (ev.k) {
      case "chain:block":
      case "chain:catchup": {
        if (!K.KAYOLO_CHAIN || !hold) return;
        const r = react(ev, ctxNow(now));
        if (!r) return;
        // The page on screen re-reads for this block: wait ≤ 5 s for its page:* (§2.8, §8.4).
        if (ev.hold) held = [...held, { r, ev, until: now + K.HOLD_MS }].slice(-K.QUEUE_MAX);
        else offerR(r, now);
        return;
      }
      case "chain:drain": {
        // E12 joins the block's own act: a breath out at its end.
        const key = `h${ev.height}`;
        if (running?.key === key) {
          if (!after) after = "relief";
        } else if (sched.waiting(key) || held.some((h) => heightOf(h.ev) === ev.height)) drainedH = ev.height;
        return;
      }
      case "chain:tip-wait":
        waitBg = { level: ev.level, at: now };
        if (hold) {
          const r = react(ev, ctxNow(now));
          if (r) offerR(r, now);
          frame();
        }
        return;
      case "chain:pool": {
        if (!hold) return;
        const r = react(ev, ctxNow(now));
        if (!r) return;
        surgeAt = now;
        // Fees + surge: one surge act with a look at the fees; both limits count (§8.4).
        if (sched.waiting("fee") || now - feeSpikeAt < 3000) {
          sched.absorb((k) => k === "fee", now);
          offerAim.delete("fee");
          r.aim2 = "fee";
        }
        offerR(r, now);
        return;
      }
      case "chain:fee": {
        if (!hold) return;
        const r = react(ev, ctxNow(now));
        if (!r) return;
        if (ev.state === "spike") {
          feeSpikeAt = now;
          if (sched.waiting("pool")) {
            offerMeta.set("pool", { ...offerMeta.get("pool"), aim2: () => aimFor("fee") });
            return;
          }
          if (now - surgeAt < 3000) return;
        }
        offerR(r, now);
        return;
      }
      case "chain:tx-topic":
      case "price:move": {
        if (!hold) return;
        const r = react(ev, ctxNow(now));
        if (r) offerR(r, now);
        return;
      }
      case "net:state": {
        const gaze = ev.state === "down" ? titleAim() : null;
        if (ev.state !== net.state) net = { state: ev.state, at: now, gaze };
        if (hold) {
          const r = react(ev, ctxNow(now));
          if (r) offerR(r, now);
          frame();
        }
        return;
      }
      case "site:behind":
        if (ev.on !== behind.on) {
          behind = { on: ev.on, at: now, knockAt: ev.on ? now + K.BEHIND_KNOCK_MIN_MS : Infinity, knocks: behind.knocks };
          frame();
        }
        return;
      default:
        return;
    }
  };

  /** What the page on screen learned (page:*): its data, its own reaction (§8.3). */
  const onPage = (ev: KayoloEvent, now: number) => {
    switch (ev.k) {
      case "page:think": {
        if (!ev.on) {
          if (poolThink) {
            poolThink = null;
            frame();
          }
          return;
        }
        if (poolThink) return;
        // In the mempool: a still think; the eyes on the field ≤ 3 a visit and not in A2+ (§6.4).
        const eyesOn = poolLooks < K.POOL_LOOKS && levelNow(now).lv < 2;
        if (eyesOn) poolLooks += 1;
        poolThink = { at: now, gaze: eyesOn ? aimEl(ev.el) : null };
        frame();
        return;
      }
      case "page:tx-confirmed":
        if (confirmedTx.has(ev.txId)) return;
        confirmedTx.add(ev.txId);
        poolThink = null;
        break;
      case "page:addr-pending": {
        if (ev.count > 0) {
          // T1 once in 30 s for an address (§6.6); meanwhile only the eyes.
          const last = pendAt.get(ev.address) ?? -1e9;
          if (now - last < K.PENDING_GAP_MS) {
            look(aimFor("pending"), 700, now, "pending");
            return;
          }
          pendAt.set(ev.address, now);
        }
        break;
      }
      case "page:rent":
        if (rentSeen(ev.address, false)) return;
        break;
      default:
        break;
    }
    const r = react(ev, ctxNow(now));
    if (!r) return;
    absorbHeight(r.height, now);
    placeR(r, ev, now);
  };

  const placeR = (r: Reaction, ev: KayoloEvent, now: number, taking = false) => {
    const el = "el" in ev ? ev.el : null;
    if (!hold || (!taking && bodyOwner() !== "kayolo")) {
      // The scout has the body (the tour, the door walk): it waits for him within its TTL.
      deferred = [...deferred.filter((d) => d.r.offer.key !== r.offer.key), { r, ev, at: now }].slice(-K.QUEUE_MAX);
      return;
    }
    if (ev.k === "page:rent") {
      // E23: once a card a session, and only with the beacon on screen; he never scrolls the page.
      if (!rentBeaconShown()) {
        rentWait = { r, ev, at: now };
        // The tile may still be landing: one more look in 1.2 s; after that only a scroll brings it.
        window.setTimeout(() => {
          if (!dead) checkRent(performance.now());
        }, 1200);
        return;
      }
      rentSeen(ev.address, true);
    }
    offerR(r, now, el);
  };

  /** The reactions that waited for him (the scout had the body), in order, with the TTL each has left. */
  const takeDeferred = (now: number, taking = false) => {
    const ds = deferred;
    deferred = [];
    for (const d of ds) {
      const left = d.r.offer.ttlMs - (now - d.at);
      if (left < 600) continue;
      placeR({ ...d.r, offer: { ...d.r.offer, ttlMs: left } }, d.ev, now, taking);
    }
  };

  /** E23 waited for the beacon: it is on screen now (the person scrolled to it). */
  const checkRent = (now: number) => {
    if (!rentWait || !hold || !rentBeaconShown()) return;
    const w = rentWait;
    rentWait = null;
    if (w.ev.k === "page:rent") rentSeen(w.ev.address, true);
    offerR(w.r, now);
    kick();
  };

  const onPoke = (now: number) => {
    const gap = now - pokeAt;
    pokeAt = now;
    if (gap >= K.POKE_RESET_MS) pokeN = 1;
    else if (gap <= K.POKE_CHAIN_MS) pokeN += 1;
    else pokeN = Math.max(1, pokeN);
    const name: ActName = pokeAct(pokeN);
    pageMemory().poke();
    if (running && (running.key === "wake" || (running.key === "poke" && now - running.at < K.POKE_NEXT_AT * running.act.ms))) {
      pokeQueued = name;
      return;
    }
    after = null;
    human(name, now, "poke");
  };

  const offBus = onKayolo((ev) => {
    if (dead) return;
    const now = performance.now();
    if (ev.k.startsWith("chain:") && ev.k !== "chain:rare") {
      if (!K.KAYOLO_CHAIN) return;
      onChain(ev, now);
    } else if (ev.k === "net:state" || ev.k === "site:behind" || ev.k === "price:move") {
      onChain(ev, now);
    } else if (ev.k.startsWith("page:")) {
      if (!K.KAYOLO_CHAIN) return;
      onPage(ev, now);
    } else if (ev.k === "chain:rare") {
      if (!hold) return;
      sched.offer({ key: `r${ev.height}`, prio: 4, ttlMs: K.TTL_RARE, ladder: (["rare", "nod", "glance"] as ActName[]).map(step), wakes: true, stir: step("stir") }, now);
    } else if (ev.k === "ui:poke") {
      if (!hold) return;
      // A click is input too: from a doze he wakes first, then the poke.
      onPoke(now);
    } else if (ev.k === "ui:notice") {
      if (!hold || !ev.on || running) return;
      human("notice", now, "notice");
    } else if (ev.k === "ui:pet") {
      if (!hold || mode === "asleep" || mode === "hidden") return;
      pageMemory().pet();
      if (running?.key === "wake") after = "pet";
      else {
        after = null;
        human("pet", now, "pet");
      }
    } else {
      onUi(ev, now);
      return;
    }
    kick();
  });

  /* ---------------- Э3: answers to the page (§6.2) and to transitions (§7) ---------------- */

  /** Where a copy came from: the focused control, else what was pressed last (Safari does not focus buttons). */
  const pressedEl = (el: Element | null | undefined, now: number): Element | null => {
    if (el && el !== document.body && el !== document.documentElement) return el;
    return lastPress && now - lastPress.at < 2000 ? lastPress.el : null;
  };

  /** Recolour (§7.1): the same colour — nothing; another — a 240 ms blink, the colour changes inside it. */
  const recolorTo = (to: string, now: number) => {
    if ((recolor ? recolor.to : color) === to) return;
    if (!hold || hidden || mode === "asleep" || mode === "hidden" || !drawnOn) {
      recolor = null;
      color = to;
      if (hold) frame();
      return;
    }
    recolor = { at: now, to };
    frame();
  };

  /** The first and last list rows on screen near a control (for the eyes running a list). */
  const rowsNear = (el: Element | null | undefined): [Vec | null, Vec | null] => {
    const scope = el?.closest("section, .feed-board, .feed-plate")?.parentElement ?? document.querySelector("main");
    let first: Vec | null = null;
    let last: Vec | null = null;
    let n = 0;
    for (const row of scope?.querySelectorAll(".feed-row") ?? []) {
      if (++n > 60) break;
      const c = centerOf(row);
      if (!c) {
        if (first) break;
        continue;
      }
      first ??= c;
      last = c;
    }
    const at = centerOf(el);
    return [first ?? (at ? { x: at.x, y: at.y + 60 } : null), last ?? (at ? { x: at.x, y: at.y + 300 } : null)];
  };

  const tabbed = (el: Element | null | undefined, now: number) => {
    const c = centerOf(el);
    // A look at the tab, then down into its panel; a skeleton there — think, the data — a nod.
    answer("tab", "tabLook", 0, now, aimAt(c), c ? aimAt({ x: c.x, y: c.y + 160 }) : null);
    // Asleep, «Тихий» parked or the intro: nothing waits for the data (no stale nod on waking).
    if (answering()) awaitData = { kind: "tab", el: el ?? null, next: now + 500, until: now + 6000, thinking: false };
  };

  /** The palette edge (§3.3): left of the field outside the panel, only from 1280 px and clear of the rail. */
  const edgePoint = (field: Element | null | undefined): Vec | null => {
    if (!(field instanceof HTMLElement) || window.innerWidth < K.EDGE_MIN_W || !wideLayout()) return null;
    const panel = field.closest<HTMLElement>(".search-panel");
    const row = panel?.querySelector<HTMLElement>(".search-panel-inner > div");
    if (!panel || !row) return null;
    // Layout boxes, not rects: the panel is still easing in (a transform); this is where it lands.
    const x = panel.offsetLeft - 30;
    const y = panel.offsetTop + row.offsetTop + row.offsetHeight / 2 + 11;
    const rail = document.querySelector(".nav-rail")?.getBoundingClientRect();
    if (rail && rail.width > 0 && x - 14 < rail.right + 6) return null;
    return { x, y };
  };

  /** Where the body stands now (mid-walk too), as a ground point. */
  const standAt = (now: number): Vec | null => {
    if (!hold) return null;
    if (walk) {
      const u = Math.min(1, (now - walk.at) / walk.ms);
      const x = walk.fromX + (walk.toX - walk.fromX) * smooth(u);
      const y = walk.fromY == null ? walk.y : walk.fromY + (walk.y - walk.fromY) * smooth(u);
      return { x, y };
    }
    if (hold.where === "nook") {
      const s = slotPlace();
      if (s) return { x: s.x, y: s.y };
    }
    return { x: hold.x, y: hold.y };
  };

  /** Search opened on a wide screen in «Живой»: a jump to the edge (≤ 400 ms, §3.5). */
  const toEdge = (field: Element | null | undefined, now: number): boolean => {
    if (!hold || hold.where !== "nook" || fade || mode !== "live" || actReduce()) return false;
    const p = edgePoint(field);
    const from = standAt(now);
    if (!p || !from) return false;
    hold = { where: "edge", x: p.x, y: p.y, face: 1 };
    walk = { fromX: from.x, toX: p.x, fromY: from.y, y: p.y, at: now, ms: K.EDGE_JUMP_MS, roll0: roll, arc: 18 };
    frame();
    return true;
  };

  /** The search closed: back home the same way (Esc or a pick alike; the arrival then follows). */
  const fromEdge = (now: number) => {
    if (!hold || hold.where !== "edge") return;
    const h = homeHold();
    const from = standAt(now);
    if (!h || !from) {
      drop();
      setOwner("none");
      return;
    }
    hold = h;
    walk = { fromX: from.x, toX: h.x, fromY: from.y, y: h.y, at: now, ms: K.EDGE_JUMP_MS, roll0: roll, arc: 18 };
    frame();
  };

  let meas: CanvasRenderingContext2D | null = null;
  let caretFont = "";
  /** Typing in the palette: the eyes follow the caret (a move ≥ 12 px or a 150 ms pause, §6.2). */
  const caret = (field: Element | null | undefined, now: number) => {
    missDue = null;
    if (!(field instanceof HTMLInputElement) || !answering()) return;
    const r = field.getBoundingClientRect();
    if (!caretFont) {
      const cs = getComputedStyle(field);
      caretFont = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    }
    meas ??= document.createElement("canvas").getContext("2d");
    let w = 0;
    if (meas) {
      meas.font = caretFont;
      w = meas.measureText(field.value.slice(0, field.selectionStart ?? field.value.length)).width;
    }
    const pt = { x: Math.min(r.right - 2, r.left + w - field.scrollLeft), y: r.top + r.height / 2 };
    if (caretPt && Math.abs(pt.x - caretPt.x) < K.CARET_PX && now - caretAt < K.CARET_PAUSE_MS) return;
    caretPt = pt;
    caretAt = now;
    look(aimAt(pt), Infinity, now, "caret");
  };

  const searchOpen = (field: Element | null | undefined, now: number) => {
    paletteOpen = true;
    missQ = "";
    caretPt = null;
    caretFont = "";
    if (!answering()) return;
    if (toEdge(field, now)) return;
    // 1024–1279, «Тихий», the phone: he stays home and looks at the field.
    look(aimEl(field), Infinity, now, "palette");
  };

  const searchClose = (now: number) => {
    paletteOpen = false;
    missDue = null;
    if (eyes && (eyes.from === "palette" || eyes.from === "caret")) eyes = null;
    if (hold?.where === "edge") fromEdge(now);
    else if (hold) frame();
  };

  /** Arrival (§7.1, §7.2), 2 rAF after the path changed: the act by how he came. */
  let beatDue: number | null = null;
  const arrival = (pop: { dir: -1 | 1; seen: boolean } | null, hop: -1 | 1 | undefined) => {
    if (dead || !answering() || bodyOwner() !== "kayolo") return;
    const now = performance.now();
    if (pop) {
      // Back / Forward: facing that way 300 ms, then «I was here»; a page seen before has no beat.
      answer("arrive", "lookBack", 0, now, { x: pop.dir * 0.9, y: -0.05 }, titleAim());
      if (pop.seen) return;
    } else if (hop) {
      // HopNav: a little step to that side; the colour is the same.
      answer("arrive", "sidestep", 0, now, { x: hop, y: 0 });
      return;
    } else answer("arrive", "arrive", 0, now, titleAim(), titleAim());
    beatDue = now + K.ARRIVE_BEAT_MS;
    kick();
  };

  const onUi = (ev: KayoloEvent, now: number) => {
    switch (ev.k) {
      case "ui:copy":
      case "ui:copy-fail":
        answer("copy", ev.k === "ui:copy" ? "nodGlance" : "shrugBig", K.COPY_GAP_MS, now, aimEl(pressedEl(ev.el, now)));
        return;
      case "ui:fav-on":
        answer("fav", "hug", K.FAV_GAP_MS, now, aimEl(ev.el), aimEl(shown('.nav-rail a[href="/favorites"]')));
        return;
      case "ui:fav-off":
        answer("fav", "nod", K.FAV_GAP_MS, now, aimEl(ev.el));
        return;
      case "ui:tab":
        tabbed(ev.el, now);
        return;
      case "ui:sort": {
        const [first, last] = rowsNear(ev.el);
        const [a, b] = ev.dir === "asc" ? [last, first] : [first, last];
        answer("sort", "runList", 0, now, aimAt(a), aimAt(b));
        return;
      }
      case "ui:filter": {
        const el = pressedEl(ev.el, now);
        look(aimEl(el), 600, now, "filter");
        if (!answering()) return;
        awaitData = { kind: "filter", el, next: now + 700, until: now + 6000, thinking: false };
        kick();
        return;
      }
      case "ui:page":
        if (ev.step === "more") {
          // «Показать ещё»: a look at the new rows coming in above the button.
          const c = centerOf(ev.el);
          look(c ? aimAt({ x: c.x, y: c.y - 80 }) : null, 900, now, "page");
        } else answer("page", "knock", K.PAGE_GAP_MS, now, aimEl(ev.el));
        return;
      case "ui:expand":
        if (ev.open) answer("expand", "nod", K.ANSWER_GAP_MS, now, aimEl(ev.el));
        else look(aimEl(ev.el), 500, now, "expand");
        return;
      case "ui:search-open":
        searchOpen(ev.el, now);
        return;
      case "ui:search-type":
        caret(ev.el, now);
        return;
      case "ui:search-hits": {
        missDue = null;
        const r = ev.el?.getBoundingClientRect();
        if (!r || r.height < 4) return;
        const x = r.left + Math.min(120, r.width / 3);
        answer("search-hits", "readList", 0, now, aimAt({ x, y: r.top + 12 }), aimAt({ x, y: Math.min(r.bottom, r.top + 240) - 12 }));
        return;
      }
      case "ui:search-miss":
        // Sniff 600 ms after the last key, once per query (§6.2).
        missDue = { at: now + 600, q: ev.q, el: ev.el ?? null };
        kick();
        return;
      case "ui:search-paste":
        answer("search-paste", ev.ok ? "nod" : "shrugBig", 0, now, aimEl(ev.el));
        return;
      case "ui:search-close":
        searchClose(now);
        return;
      case "ui:sheet-open":
        sheetOpen += 1;
        // He stays home under the scrim, eyes on the sheet (§3.5).
        look(aimAt({ x: window.innerWidth / 2, y: window.innerHeight - 160 }), Infinity, now, "sheet");
        return;
      case "ui:sheet-close":
        sheetOpen = Math.max(0, sheetOpen - 1);
        if (!sheetOpen && eyes?.from === "sheet") {
          eyes = null;
          frame();
        }
        return;
      case "ui:tip-open": {
        if (!answering() || now - eyesAt < K.FOCUS_GAP_MS) return;
        const el = ev.el ?? null;
        // His own Tip is under him: the eyes go down to it (§2.6).
        if (el?.closest(".kayolo-slot")) {
          look({ x: 0, y: 0.9 }, Infinity, now, "tip");
          return;
        }
        const c = el ? centerOf(el) : ev.rect ? { x: ev.rect.left + ev.rect.width / 2, y: ev.rect.top + ev.rect.height / 2 } : null;
        look(aimAt(c), K.HOVER_HOLD_MS, now, "tip");
        return;
      }
      case "ui:tip-close":
        if (eyes?.from === "tip") {
          eyes = null;
          frame();
        }
        return;
      case "ui:wait":
        // Only while he answers: asleep he must not wake into a think face (and freeze in it).
        pageWait = ev.on && answering() ? { at: now, to: aimEl(shown(".seg-paper, .detail-tabs")) } : null;
        if (hold) kick();
        return;
      case "nav:start":
        if (!answering()) return;
        if (!navWait) {
          navWait = { at: now, shrugged: false };
          // A lean toward the link that was clicked, if it is on screen (§7.1).
          const el = lastClick?.kind === "go" && now - lastClick.at < 600 ? lastClick.el : null;
          const aim = aimEl(el);
          if (aim && running?.key === "rail-press" && !after) {
            // The rail row's knock first (in time with the press), the lean right after it.
            after = "lean";
            afterAim = [aim, null];
          } else if (aim) answer("nav", "lean", 0, now, aim);
        }
        kick();
        return;
      case "nav:end":
        if (!navWait) return;
        navWait = null;
        // 15 s and the page has not come: one tear, and he stays on the old page.
        if (!ev.ok) answer("nav-kill", "tear", 0, now, null);
        if (hold) frame();
        return;
      case "nav:click":
        lastClick = { kind: ev.kind, el: ev.el ?? null, hop: ev.hop, at: now };
        if (ev.kind === "here") answer("here", "here", K.ANSWER_GAP_MS, now, titleAim());
        else if (ev.kind === "aside") answer("aside", "aside", 0, now, aimEl(ev.el));
        return;
      case "nav:pop":
        popNext = { dir: ev.dir, seen: ev.seen, at: now, to: ev.to };
        return;
    }
  };

  /* ---------------- Э3: what the page does not tell the bus (delegated, passive) ---------------- */

  const onPress = (e: PointerEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || dead) return;
    const now = performance.now();
    lastPress = { el: t, at: now };
    if (t.closest(".kayolo-slot, .kayolo-panel")) return;
    const rail = e.button === 0 ? t.closest(".nav-rail a, .nav-rail button") : null;
    if (rail && !rail.classList.contains("rail-toggle")) {
      // A rail row: a knock in time with the press (§6.2).
      answer("rail-press", "knock", K.ANSWER_GAP_MS, now, aimEl(rail));
    } else if (e.pointerType === "touch" && phone() && now - tapAt >= K.TAP_GAP_MS) {
      // A tap on the phone: the tap goes to its control, the eyes to the point for 1.5 s (§4.4).
      tapAt = now;
      look(aimAt({ x: e.clientX, y: e.clientY }), K.TAP_HOLD_MS, now, "tap");
    }
  };

  const onDocClick = (e: MouseEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || dead || t.closest(".kayolo-slot, .kayolo-panel")) return;
    const now = performance.now();
    const toggle = t.closest(".rail-toggle");
    if (toggle) {
      // The rail folds (§3.5): a start, eyes on the rail, then on the button.
      answer("rail", "railJolt", K.ANSWER_GAP_MS, now, aimEl(shown(".nav-rail")), aimEl(toggle));
      return;
    }
    const branch = t.closest(".nav-rail [aria-expanded]");
    if (branch) {
      // A branch opened (eyes down) or closed (eyes up), read once React has applied it.
      requestAnimationFrame(() => {
        const c = centerOf(branch);
        const open = branch.getAttribute("aria-expanded") === "true";
        look(c ? aimAt({ x: c.x, y: c.y + (open ? 90 : -60) }) : null, 700, performance.now(), "rail");
      });
      return;
    }
    // A tab of this page (a hash or a button); a seg link to another URL (HopNav sits in a seg bar too)
    // is a transition: the lean and the arrival answer it.
    const tab = t.closest('.seg-paper a[href^="#"], .seg-paper button, [role="tab"]');
    if (tab) tabbed(tab, now);
  };

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === "touch" || dead || !hold || phone()) return;
    const t = e.target instanceof Element ? e.target.closest(MEANINGFUL) : null;
    if (!t || t === hoverCand?.el || t.closest(".kayolo-slot")) return;
    hoverCand = { el: t, at: performance.now() };
    kick();
  };

  const onFocus = (e: FocusEvent) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || dead || editable(t) || t.closest(".kayolo-slot, .kayolo-panel")) return;
    const now = performance.now();
    if (now - focusAt < K.FOCUS_GAP_MS) return;
    let keyboard = false;
    try {
      keyboard = t.matches(":focus-visible");
    } catch {
      keyboard = false;
    }
    if (!keyboard) return;
    focusAt = now;
    // Focus on anything: a look at it, if it is on screen (§4.5).
    look(aimEl(t), K.HOVER_HOLD_MS, now, "focus");
  };

  const onCopy = () => {
    if (dead) return;
    const now = performance.now();
    const node = document.getSelection()?.anchorNode ?? null;
    const el = node ? (node instanceof Element ? node : node.parentElement) : null;
    answer("copy", "nodGlance", K.COPY_GAP_MS, now, aimEl(el));
  };

  const onPaletteKey = (e: KeyboardEvent) => {
    if (!paletteOpen || dead || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    // ↑↓ in the palette: the eyes on the active row.
    requestAnimationFrame(() => {
      const opt = document.querySelector('[role="listbox"] [role="option"][aria-selected="true"]');
      look(aimEl(opt), Infinity, performance.now(), "caret");
    });
  };

  let lang = document.documentElement.lang;
  const langObs = new MutationObserver(() => {
    const l = document.documentElement.lang;
    if (l === lang) return;
    lang = l;
    const now = performance.now();
    // A person's choice (on /settings), not the dictionary arriving on load: a long blink (§6.2).
    if (sched.sinceInput(now) > 3000) return;
    answer("locale", "blinkLong", 0, now, null);
  });
  langObs.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  document.addEventListener("pointerdown", onPress, { passive: true, capture: true });
  document.addEventListener("click", onDocClick, { passive: true });
  document.addEventListener("pointerover", onOver, { passive: true });
  document.addEventListener("focusin", onFocus, { passive: true });
  document.addEventListener("copy", onCopy, { passive: true });
  document.addEventListener("keydown", onPaletteKey, { passive: true });

  /** A resize or a zoom with the palette open: the edge moves with the panel, or he goes home. */
  const onEdgeResize = () => {
    if (dead || hold?.where !== "edge") return;
    const now = performance.now();
    const p = edgePoint(document.querySelector(".search-panel input"));
    if (!p) {
      fromEdge(now);
      return;
    }
    walk = null;
    hold = { ...hold, x: p.x, y: p.y };
    frame();
  };
  window.addEventListener("resize", onEdgeResize, { passive: true });

  /* ---------------- input (§2.2) ---------------- */

  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

  const onInput = (e: Event) => {
    if (dead) return;
    const now = performance.now();
    if (e.type === "pointermove") {
      const pe = e as PointerEvent;
      const pt = { x: pe.clientX, y: pe.clientY };
      follow(pt, now, pe.pointerType);
      if (lastMove && Math.hypot(pt.x - lastMove.x, pt.y - lastMove.y) < K.MOVE_MIN_PX) return;
      lastMove = pt;
    } else if (e.type === "scroll" || e.type === "wheel") sched.busy(now + K.SCROLL_BUSY_MS);
    else if (e.type === "pointerdown" || e.type === "touchstart") sched.busy(now + K.PRESS_BUSY_MS);
    else if (e.type === "keydown" && editable(e.target)) sched.busy(now + K.TYPE_BUSY_MS);
    const was = levelNow(now).lv;
    sched.input(now);
    wokeAt = -Infinity;
    if (introRun && e.type !== "focusin") {
      // Any input cuts the introduction short (§5): he is simply awake, no tour.
      running = null;
      finishIntro(false);
      kick();
    }
    if (!hold || mode === "asleep" || mode === "hidden") return;
    if (was >= 2 && !(running && running.key === "wake")) {
      wakeFrom(was, now);
      kick();
    }
  };

  /** A0: the eyes jump after the pointer within 240 px, at most 20 frames a second (§2.6). */
  const follow = (pt: Vec, now: number, kind: string) => {
    if (!hold || kind === "touch" || phone() || running || reduceSys || eyesNow(now)) return;
    if (levelNow(now).lv !== 0) return;
    const b = bodyAt();
    if (!b) return;
    const d = Math.hypot(pt.x - b.x, pt.y - b.y);
    const wasShy = shy;
    shy = d < K.SHY_PX;
    if (d > K.GAZE_RADIUS) {
      if (gaze && gazeUntil > now) {
        gazeUntil = now;
        frame();
      }
      if (wasShy !== shy) frame();
      return;
    }
    gazeUntil = now + 300;
    if ((!gazePt || Math.hypot(pt.x - gazePt.x, pt.y - gazePt.y) > K.GAZE_JUMP_PX) && now - gazeAt >= 1000 / K.GAZE_FPS) {
      gaze = gazeTo(b, pt);
      gazePt = pt;
      gazeAt = now;
      frame();
    } else if (wasShy !== shy) frame();
    else schedule(gazeUntil, now);
  };

  const inputs = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "focusin"] as const;
  for (const n of inputs) window.addEventListener(n, onInput, { passive: true, capture: true });
  let parkRaf = 0;
  /** Phone: a plate docked under the pill (square corners) — he sits down, no hops (§3.2). */
  const checkDock = () => {
    dockRaf = 0;
    if (dead) return;
    const now = !wideLayout() && !!document.querySelector('.feed-plate[data-stuck="dock"]');
    if (now !== docked) {
      docked = now;
      if (hold) frame();
    }
  };
  const onScroll = (e: Event) => {
    onInput(e);
    if (rentWait && rentCheckAt == null) {
      rentCheckAt = performance.now();
      window.setTimeout(() => {
        rentCheckAt = null;
        if (!dead) checkRent(performance.now());
      }, 400);
    }
    if (!dockRaf) dockRaf = requestAnimationFrame(checkDock);
    // The phone park rides the sticky pill: follow it while the page scrolls, once per frame
    // (capture also sees inner scrollers; parkPoint reads layout).
    if (hold?.where === "park" && !fade && !walk && !parkRaf) {
      parkRaf = requestAnimationFrame(() => {
        parkRaf = 0;
        if (dead || hold?.where !== "park" || fade || walk) return;
        const p = parkPoint();
        if (p) keeper.move({ x: p.x, y: p.y });
      });
    }
  };
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });

  const onVis = () => {
    const now = performance.now();
    if (document.visibilityState === "hidden") {
      hidden = true;
      hiddenAt = now;
      hiddenHeight = chainNow().height;
      hiddenSince = sched.sinceInput(now);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      timerAt = Infinity;
      return;
    }
    hidden = false;
    if (now - hiddenAt >= K.AWAY_WAKE_MS) {
      const was = levelAt(hiddenSince + (now - hiddenAt), nightNow(now));
      sched.input(now);
      if (hold) {
        wakeFrom(Math.max(2, was) as Level, now);
        // Blocks came while he was away: he counts them (k ≤ 3) and nods (§2.2); on block pages a hop.
        const h = chainNow().height;
        const k = h != null && hiddenHeight != null ? h - hiddenHeight : 0;
        if (k >= 1 && running?.key === "wake" && K.KAYOLO_CHAIN && !chainNow().mock) {
          after = pageKind(path) === "b" ? "catchUp" : "countNod";
          afterAim = [aimAt(tipPoint()), null];
          afterN = Math.min(K.COUNT_MAX, k);
        }
      }
    } else sched.inputAt(now - hiddenSince);
    frame();
  };
  document.addEventListener("visibilitychange", onVis);

  /** The skin's ink changed (or a query rewrote the URL): a blink only if the colour really changed (§6.2). */
  const onInk = () => {
    if (path === "/") return;
    recolorTo(pixelColor(pixelInkForPath(path)), performance.now());
  };
  window.addEventListener(INK_EVENT, onInk);

  /** A choice changed (his panel, /settings, another tab, the system motion setting). */
  const refreshMode = () => {
    reduceSys = window.matchMedia(REDUCE_QUERY).matches;
    const was = mode;
    mode = currentMode();
    sched.mode(mode);
    if (!usable()) {
      if (hold) {
        drop();
        setOwner("none");
      }
      return;
    }
    if (!hold) {
      requestAnimationFrame(takeHome);
      return;
    }
    if (was === mode) {
      frame();
      return;
    }
    const now = performance.now();
    if (mode === "asleep" || mode === "hidden") {
      // Asleep or hidden: no act runs on, nothing waits.
      running = null;
      after = null;
      pokeQueued = null;
      grow = null;
      navWait = null;
      pageWait = null;
      awaitData = null;
      eyes = null;
      if (recolor) color = recolor.to;
      recolor = null;
      if (introRun) finishIntro(false);
      if (hold.where === "edge") keeper.home();
    } else if (was === "hidden") {
      sched.input(now);
      wokeAt = -Infinity;
      grow = now;
    } else if (was === "asleep") {
      // Woken by a person (a click, the panel, Enter): 900 ms, then awake (§4.6).
      sched.input(now);
      wokeAt = -Infinity;
      sched.done();
      sched.offer({ key: "wake", prio: 2, ttlMs: 1000, ladder: [step("wakeUp")] }, now);
      sched.next(now);
      after = null;
      startAct("wakeUp", now, "wake", 2);
    }
    frame();
  };
  const offChoice = onChoice(refreshMode);
  const wide = window.matchMedia(WIDE_QUERY);
  const onWide = () => {
    // Crossing 1024 px: the one «teleport» is a fade to the home of the new layout (§3.4).
    if (hold) requestAnimationFrame(() => keeper.home());
  };
  wide.addEventListener("change", onWide);

  const offSlot = onSlotPlace((p, was) => {
    if (!hold) {
      // A window came up (the other layout's, after crossing 1024 px): he moves in if nobody has him.
      if (p && bodyOwner() === "none") requestAnimationFrame(takeHome);
      return;
    }
    if (hold.where !== "nook" || fade) return;
    if (!p) {
      drop();
      setOwner("none");
      return;
    }
    const now = performance.now();
    const phoneEl = (s: typeof p) => !!s?.el?.classList.contains("is-phone");
    if (was && phoneEl(p) !== phoneEl(was)) {
      // The other layout's window (crossing 1024 px): the one «teleport», a fade (§3.4).
      keeper.home();
      return;
    }
    if (was && Math.abs(p.x - was.x) > 60) {
      // A new home (/settings) or a far title edge: a fade, he does not walk under the title.
      fade = { at: now, from: { x: was.x, y: was.y }, to: { where: "nook", x: p.x, y: p.y, face: p.face } };
      frame();
      return;
    }
    if (was && Math.abs(p.x - was.x) >= 1 && !actReduce() && mode === "live" && !hidden) {
      // A new title edge: a step over, ≤ 60 px at 140 px/s (§3.1).
      const fromX = walk ? walk.fromX + (walk.toX - walk.fromX) * smooth((now - walk.at) / walk.ms) : was.x;
      walk = { fromX, toX: p.x, y: p.y, at: now, ms: Math.max(120, (Math.abs(p.x - fromX) / K.STEP_PX_S) * 1000), roll0: roll };
      paint(now);
      return;
    }
    if (!walk) frame();
  });

  return {
    keeper,
    arrive(next: string) {
      const prev = path;
      path = next;
      const now = performance.now();
      sched.busy(now + K.NAV_BUSY_MS);
      navWait = null;
      awaitData = null;
      beatDue = null;
      // Э4: what waited on the old page goes; the backgrounds of the chain stay (they are the site's).
      if (prev !== next) {
        poolThink = null;
        poolLooks = 0;
        held = [];
        deferred = [];
        rentWait = null;
        behind.knocks = 0;
        if (behind.on) behind.knockAt = now + K.BEHIND_KNOCK_MIN_MS;
      }
      const hop = lastClick?.kind === "go" && now - lastClick.at < 5000 ? lastClick.hop : undefined;
      // One click, one arrival: a later push by the router (a pick in the palette) is not a hop.
      lastClick = null;
      if (next === "/") {
        recolor = null;
        color = pixelColor(pixelInkForPath(next));
        if (hold) {
          drop();
          setOwner("none");
        }
        return;
      }
      // A new colour comes with a blink (§7.1); the scout's own body keeps its colour until he has it.
      recolorTo(pixelColor(pixelInkForPath(next)), now);
      if (hold) frame();
      // After the scout has decided for this page: nobody has him, so he is just at home.
      requestAnimationFrame(takeHome);
      // The arrival act, 2 rAF after the path changed: the new title is on screen (§7.1), and a
      // Back/Forward has been heard (Next re-renders inside its own popstate listener, before ours).
      if (prev !== next) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (dead) return;
            const t = performance.now();
            const key = locKey(window.location.pathname, window.location.search);
            // Only a pop that landed here: a sheet closing pops its own entry first (§7.2).
            const pop = popNext && t - popNext.at < 2000 && popNext.to === key ? popNext : null;
            popNext = null;
            nav.note(key);
            arrival(pop, hop);
          })
        );
      }
    },
    start() {
      // What the page said while he was loading (§9.4) counts from when it was said.
      const early = takeEarly();
      if (K.KAYOLO_CHAIN) for (const e of early) onPage(e.ev, e.at);
      requestAnimationFrame(takeHome);
    },
    stop() {
      dead = true;
      offBus();
      offSlot();
      for (const n of inputs) window.removeEventListener(n, onInput, { capture: true });
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (parkRaf) cancelAnimationFrame(parkRaf);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(INK_EVENT, onInk);
      nav.stop();
      langObs.disconnect();
      document.removeEventListener("pointerdown", onPress, { capture: true });
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("keydown", onPaletteKey);
      window.removeEventListener("resize", onEdgeResize);
      offChoice();
      if (dockRaf) cancelAnimationFrame(dockRaf);
      wide.removeEventListener("change", onWide);
      const had = hold != null;
      drop();
      if (had) setOwner("none");
    },
    debug() {
      const now = performance.now();
      return {
        hold,
        level: levelNow(now).lv,
        running: running?.act.name ?? null,
        log: sched.log.slice(-20),
        mode,
        docked,
        night,
        eyes: eyes ? { from: eyes.from, to: eyes.to } : null,
        wait: navWait ? Math.round(now - navWait.at) : pageWait ? "page" : null,
        color,
        over: !!layerRoot?.classList.contains("is-over"),
        bg: bgNow()?.kind ?? null,
        held: held.length ? held.map((h) => heightOf(h.ev)) : null,
        deferred: deferred.length ? deferred.map((d) => d.r.offer.key) : null,
        rentWait: rentWait?.r.offer.key ?? null,
        net: net.state,
        behind: behind.on,
        waitLevel: waitBg.level,
      };
    },
  };
}

type Engine = ReturnType<typeof createEngine>;

export default function KayoloLayer() {
  const path = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    const canvas = canvasRef.current;
    if (!host || !body || !canvas || !K.KAYOLO_LAYER) return;
    let engine: Engine;
    try {
      engine = createEngine(body, canvas);
    } catch (e) {
      console.warn("[kayolo] engine", e);
      return;
    }
    engineRef.current = engine;
    setKeeper(engine.keeper);
    (window as Window & { __kayolo?: () => unknown }).__kayolo = engine.debug;
    engine.start();
    return () => {
      setKeeper(null);
      engine.stop();
      engineRef.current = null;
    };
  }, [host]);

  useEffect(() => {
    engineRef.current?.arrive(path);
  }, [path]);

  if (!host) return null;
  return createPortal(
    <div className="kayolo-layer" aria-hidden>
      <div ref={bodyRef} className="kayolo-body">
        <canvas ref={canvasRef} className="kayolo-canvas" width={0} height={0} />
      </div>
    </div>,
    host
  );
}

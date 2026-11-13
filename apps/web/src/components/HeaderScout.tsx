"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { addressIdOf, addressReturnGate, askWaitsForSlip, isAddressHome, rentScratch, SCOUT_CUES_EN, SCOUT_CUES_RU, scoutBeats, type ScoutBeat } from "@/lib/header-scout";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { lookupScoutRent } from "@/lib/scout-rent";
import { INK_EVENT } from "@/lib/skin-ink";
import { REDUCE_QUERY, useMediaTick, WIDE_QUERY } from "@/lib/kayolo/motion";
import { onKayolo, type BodyWhere } from "@/lib/kayolo/events";
import {
  arrive,
  bodyOwner,
  currentMode,
  handoff,
  hasKeeper,
  kayoloHolds,
  moveBody,
  onKeeper,
  reclaim,
  sendHome,
  setOwner,
  type BodyPose,
} from "@/lib/kayolo/body";
import { nookPoint } from "@/lib/kayolo/anchors";
import { readHome } from "@/lib/kayolo/memory";
import { KAYOLO_LAYER } from "@/lib/kayolo/thresholds";
import {
  adoptPixelState,
  drawPixel,
  pixelColor,
  pixelInkForPath,
  pixelState,
  pixelWake,
  type PixelMood,
  type PixelPose,
} from "./pixel";

/**
 * «Пиксель» (components/pixel.ts), in the page's entity colour.
 * One pass on every page except home, at half the first speed.
 * Before a word he ducks flat and looks up at the letters, slips under, pops
 * back up, then turns to face the figure and knocks on it. He parks past the
 * longest search word and stays there, blinking and looking around.
 *
 * Address pages are the door. A click turns him around: he climbs the gutter,
 * ducks before the search, slips under that word, then runs this same pass
 * from the title onward.
 * A click while he is on the toolbar stops him into a question. Under a word
 * he finishes that slip first.
 *
 * On an address card that is already on the home rent tape, he rises onto the
 * column header, rolls to the balance tile, and scratches the clock with the pick.
 *
 * Kayolo Э1b (design/brand/kayolo-life.md §7.1, §9.8 M1): the pass runs only when a tour is due
 * (first show in a session, or the first entry to a section today, at most once per 10 min). On the
 * desktop it ends in Kayolo's niche right of the title. Parked (the niche, the phone park, the door,
 * a note), the scout hands the body to Kayolo and draws nothing; it takes the body back only to move.
 */

const SPEED = 140;
const SCALE = 0.86;
const HOP = 9;
const CROUCH = 3;
const BYE_MS = 820;
const DUCK_MS = 640;
const RISE_HOME_MS = 700;
const SLIP_SPEED = 108;
const FALL_MS = 760;
const SQUAT_MS = 680;
const RISE_MS = 760;
const PRICE_MS = 1520;
const MCAP_MS = 1800;
const READ_MS = 2480;
const PEEK_MS = 640;
const ASK_MS = 1960;

type Box = { left: number; right: number; top: number; bottom: number };

type World = {
  title: Box | null;
  price: Box | null;
  mcap: Box | null;
  priceBlock: Box | null;
  mcapBlock: Box | null;
  gap: number | null;
  searchEnd: number | null;
  w: number;
};

function spot(root: HTMLElement, name: string): Box | null {
  const host = root.getBoundingClientRect();
  const nodes = root.querySelectorAll<HTMLElement>(`[data-scout="${name}"]`);
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    return {
      left: r.left - host.left,
      right: r.right - host.left,
      top: r.top - host.top,
      bottom: r.bottom - host.top,
    };
  }
  return null;
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function smooth(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

let cueWidth = 0;
let cueFont = "";
/** He already came down. The next address in this visit does not replay the drop. */
let perchedOnAddresses = false;
/** He was sent back up. Address pages keep him in the header until he leaves. */
let returnedToHeader = false;
/** The toolbar pass after that return already finished. Later address pages keep the park. */
let addressPassed = false;
/** This card already got the rent scratch. A remount does not replay it. */
let rentTold = "";
/** Last place he was drawn, in viewport pixels. The next errand starts there. */
let scoutPose: { x: number; y: number; face: 1 | -1; roll: number } | null = null;

type AddressDoor = { x: number; y: number; pebbleX: number; pebbleY: number };

function addressDoor(): AddressDoor | null {
  const row = document.querySelector<HTMLElement>('.nav-rail [data-scout="addresses"]');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  if (r.width < 8 || r.height < 8 || r.bottom < 8) return null;
  const rail = row.closest(".nav-rail")?.getBoundingClientRect();
  const railRight = rail?.right ?? r.right;
  return {
    x: railRight + 28,
    y: r.top + r.height * 0.78,
    pebbleX: r.right - 22,
    pebbleY: r.top + r.height * 0.5,
  };
}

function emptyNote(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".addr-page [data-fav-note]");
}

function emptyStand(note: HTMLElement) {
  const rect = note.getBoundingClientRect();
  return { x: rect.left - 34, y: rect.bottom - 2, rect };
}

/** Eyes lift only while the drive crosses a word in the header. */
function eyesUnderHeader(header: HTMLElement, px: number, py: number) {
  const bar = header.getBoundingClientRect();
  if (py < bar.top - 8 || py > bar.bottom + 10) return false;
  for (const el of header.querySelectorAll<HTMLElement>("[data-scout]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (px > r.left - 16 && px < r.right + 16) return true;
  }
  return false;
}

let inkAt = 0;
let inkPath = "";
let inkColor = "";

/** Page entity colour, re-read once a second (the ink can change under him). */
function scoutColor(now: number) {
  const path = window.location.pathname;
  if (path !== inkPath || now - inkAt > 1000) {
    inkPath = path;
    inkAt = now;
    inkColor = pixelColor(pixelInkForPath(path));
  }
  return inkColor;
}

/** What his eyes do on each beat of the walk. */
function scoutMood(beat: string | undefined): PixelMood {
  if (!beat) return "idle";
  if (beat === "ask" || beat === "fall" || beat === "drop" || beat === "note-drop") return "surprised";
  if (beat === "read" || beat === "carve" || beat === "note-write" || beat === "write") return "work";
  // §12.6: the price and the market cap are looked at with interest, never with joy.
  if (beat === "price" || beat === "mcap") return "curious";
  if (beat === "bye" || beat === "retreat") return "happy";
  // An empty list on the address page: he goes over and peeks at it.
  if (beat === "peek" || beat === "nest" || beat === "watch" || beat === "note-live") return "curious";
  if (beat === "note-drive") return "look";
  if (beat.startsWith("under") || beat.startsWith("squat") || beat === "duck" || beat === "slip") return "look";
  return "idle";
}

/**
 * Kayolo E20 (a rare height, Э0): on pages other than home he hops once, happy, where he is parked.
 * Mid-pass the call waits for the park, at most a minute (design/brand/kayolo-life.md §8.3).
 */
const CHEER_MS = 1300;
const RARE_TTL_MS = 60_000;
let rareCalledAt = -1e9;
let cheerUntil = 0;

/** Parked: play a waiting rare-height cheer. The hop itself comes with the switch to happy. */
function cheerAtRest() {
  const t = performance.now();
  if (t - rareCalledAt > RARE_TTL_MS) return;
  rareCalledAt = -1e9;
  cheerUntil = t + CHEER_MS;
}

/** «Пиксель» in the header. The mood follows the beat unless the caller names one; he blinks on his own. */
function drawScout(ctx: CanvasRenderingContext2D, pose: Omit<PixelPose, "color" | "now">) {
  const now = performance.now();
  drawPixel(ctx, {
    ...pose,
    mood: now < cheerUntil ? "happy" : (pose.mood ?? scoutMood(ctx.canvas.dataset.scoutBeat)),
    color: scoutColor(now),
    now,
  });
}

function setBeat(canvas: HTMLCanvasElement, beat: string) {
  if (canvas.dataset.scoutBeat !== beat) canvas.dataset.scoutBeat = beat;
}

/* ---------------- M1 (§9.8): one body, handed over at rest ---------------- */

/** Parked: Kayolo takes the body at this point, with this face. True: draw nothing from now on. */
function giveBody(
  ctx: CanvasRenderingContext2D,
  where: BodyWhere,
  x: number,
  y: number,
  face: number,
  pose: Partial<PixelPose>
): boolean {
  if (!KAYOLO_LAYER) return false;
  return handoff({ x, y, face: face < 0 ? -1 : 1, where, pose, state: pixelState(ctx, "main"), color: scoutColor(performance.now()) });
}

/** About to draw: take the body back if Kayolo has it (his face comes along) and own it. */
function takeBody(ctx: CanvasRenderingContext2D | null): BodyPose | null {
  if (!KAYOLO_LAYER) return null;
  const p = reclaim();
  if (p?.state && ctx) adoptPixelState(ctx, "main", p.state);
  setOwner("scout");
  return p;
}

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Kayolo's niche in viewport px (desktop), or null. */
function nookNow() {
  return nookPoint(readHome(local) ?? "r");
}

/** The tour already ran for this arrival: a locale change does not replay it. */
let tourRanFor = "";

/** A parked pose keeps drawing this long (the face eases, a glance lands), then the loop sleeps. */
const SETTLE_MS = 900;
/** Parked past the search word he looks around once: one full sweep of the old seek glance. */
const SEEK_LOOK_MS = Math.round(2 * Math.PI * 880);

type Loop = { again: () => void; stop: () => void };

/** One rAF at a time. At rest a pose stops asking for frames; events ask again. */
function frameLoop(paint: (now: number) => void): Loop {
  let raf = 0;
  let dead = false;
  const run = (now: number) => {
    raf = 0;
    if (!dead) paint(now);
  };
  return {
    again() {
      if (!dead && !raf) raf = requestAnimationFrame(run);
    },
    stop() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/** Parked long enough and his face is still: the frame just drawn can stay on the canvas. */
function settled(ctx: CanvasRenderingContext2D, now: number, since: number) {
  cheerAtRest();
  return now - Math.max(since, cheerUntil) >= SETTLE_MS && pixelWake(ctx) > performance.now();
}

/**
 * Wakes a sleeping loop on what can change a parked pose: the bar or the window resized, the ink,
 * the tab came back; when asked, scroll and a note line that appears, changes or goes.
 */
function wakeOn(
  root: HTMLElement,
  wake: () => void,
  opt: { scroll?: () => boolean; note?: () => HTMLElement | null } = {}
): () => void {
  const onVis = () => {
    if (document.visibilityState === "visible") wake();
  };
  const onInk = () => {
    inkAt = -1e9;
    wake();
  };
  const onScroll = () => {
    if (opt.scroll?.()) wake();
  };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => wake());
  ro?.observe(root);
  window.addEventListener("resize", wake);
  window.addEventListener(INK_EVENT, onInk);
  document.addEventListener("visibilitychange", onVis);
  if (opt.scroll) window.addEventListener("scroll", onScroll, { passive: true });
  let mo: MutationObserver | null = null;
  const find = opt.note;
  if (find && typeof MutationObserver !== "undefined") {
    let el = find();
    let line = el?.getAttribute("data-fav-note") ?? null;
    mo = new MutationObserver(() => {
      const next = find();
      const text = next?.getAttribute("data-fav-note") ?? null;
      if (next === el && text === line) return;
      el = next;
      line = text;
      wake();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-fav-note"] });
  }
  return () => {
    ro?.disconnect();
    mo?.disconnect();
    window.removeEventListener("resize", wake);
    window.removeEventListener(INK_EVENT, onInk);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("scroll", onScroll);
  };
}

/**
 * The note line reads by default (`--scratch: 1`). He hides it only as he sets off to write it on
 * screen, so without him (no JS, reduced motion, a hidden tab) the line is simply there.
 */
function claimNote(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.bottom > 0 && r.top < window.innerHeight) el.style.setProperty("--scratch", "0");
}

function releaseNotes() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-fav-note]")) el.style.removeProperty("--scratch");
}

type PerchPhase =
  | "fall"
  | "settle"
  | "home"
  | "shelf"
  | "along"
  | "mount"
  | "carve"
  | "watch"
  | "bye"
  | "climb"
  | "duck"
  | "slip"
  | "rise"
  | "nest"
  | "note-drive"
  | "note-drop"
  | "note-write"
  | "note-live"
  | "note-rise"
  | "note-roll";

type RentNote = { due: boolean; lines: [string, string, string] };

const CARVE_LINE_MS = 680;

const HIT_W = 52;
const HIT_H = 56;
const CLICKABLE =
  'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[contenteditable="true"]';

/** A link or control under any part of his button: then the click belongs to it. */
function clickableUnder(hit: HTMLElement, left: number, top: number): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const fx of [0.06, 0.35, 0.65, 0.94]) {
    for (const fy of [0.06, 0.35, 0.65, 0.94]) {
      const px = left + HIT_W * fx;
      const py = top + HIT_H * fy;
      if (px < 0 || py < 0 || px >= vw || py >= vh) continue;
      const under = document.elementsFromPoint(px, py).find((el) => el !== hit);
      if (under?.closest(CLICKABLE)) return true;
    }
  }
  return false;
}

type HitMemo = { on: boolean; label: string; left: number; top: number; open: boolean; at: number };
const hitMemo = new WeakMap<HTMLButtonElement, HitMemo>();

/**
 * His 52×56 button follows him and stays in the Tab order, but over the search, the price or any
 * link it lets clicks through (pointer-events: none). The DOM is written only when something changed.
 */
function placeHit(
  hit: HTMLButtonElement | null,
  on: boolean,
  x: number,
  floor: number,
  label?: string
) {
  if (!hit) return;
  let m = hitMemo.get(hit);
  if (!m) {
    m = { on: !on, label: "", left: NaN, top: NaN, open: false, at: -1e9 };
    hitMemo.set(hit, m);
  }
  if (m.on !== on) {
    m.on = on;
    hit.tabIndex = on ? 0 : -1;
    hit.setAttribute("aria-hidden", on ? "false" : "true");
  }
  if (!on) {
    if (m.open || hit.style.pointerEvents !== "none") hit.style.pointerEvents = "none";
    m.open = false;
    m.left = NaN;
    return;
  }
  if (label && label !== m.label) {
    m.label = label;
    hit.setAttribute("aria-label", label);
  }
  const left = x - HIT_W / 2;
  const top = floor - 48;
  const now = performance.now();
  if (Math.abs(left - m.left) >= 2 || Math.abs(top - m.top) >= 2 || now - m.at > 500 || Number.isNaN(m.left)) {
    const open = !clickableUnder(hit, left, top);
    m.at = now;
    if (open !== m.open || hit.style.pointerEvents === "") hit.style.pointerEvents = open ? "auto" : "none";
    m.open = open;
  }
  if (left !== m.left) hit.style.left = `${left}px`;
  if (top !== m.top) hit.style.top = `${top}px`;
  m.left = left;
  m.top = top;
}

/** Drop along the rail and sit by Addresses. A click turns him back to the header. */
function measureRentLane(): { cols: DOMRect; bal: DOMRect } | null {
  const cols = document.querySelector<HTMLElement>(".addr-head.addr-history");
  const bal = document.querySelector<HTMLElement>(".addr-fact-balance");
  if (!cols || !bal) return null;
  const c = cols.getBoundingClientRect();
  const b = bal.getBoundingClientRect();
  if (c.width < 8 || c.height < 8 || b.width < 8 || b.height < 8) return null;
  return { cols: c, bal: b };
}

/** Treads on the balance tile, body clear of the wallet mark. He writes to the left of it. */
function rentStand(bal: DOMRect): { x: number; y: number } {
  const mark = document.querySelector<HTMLElement>(".addr-fact-balance .kpi-tile-mark");
  const box = mark?.getBoundingClientRect();
  const y = bal.bottom - 6;
  if (box && box.width >= 8 && box.left > bal.left + 48) {
    return { x: box.left - 32, y };
  }
  return { x: bal.right - 72, y };
}

function drawRentNote(
  ctx: CanvasRenderingContext2D,
  bal: DOMRect,
  robotX: number,
  lines: [string, string, string],
  shown: [number, number, number],
  alpha: number,
  due: boolean
) {
  if (alpha < 0.02) return;
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  const family = `${mono || "ui-monospace"}, ui-monospace, monospace`;
  const sizes = [11, 10, 15];
  const weights = [600, 500, 700];
  const colors = ["#f0c14a", "#f0c14a", due ? "#ff8a65" : "#f0c14a"];
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  const widths = lines.map((line, i) => {
    ctx.font = `${weights[i]} ${sizes[i]}px ${family}`;
    return ctx.measureText(line).width;
  });
  const gap = 2;
  const blockH = sizes[0] + gap + sizes[1] + gap + sizes[2];
  const x0 = bal.left + 16;
  const limit = Math.max(x0 + 24, robotX - 30);
  let y = bal.bottom - 8 - blockH;
  for (let i = 0; i < 3; i++) {
    const show = shown[i];
    if (show > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 2, y - 1, Math.max(4, Math.min(widths[i], limit - x0) * show + 3), sizes[i] + 4);
      ctx.clip();
      ctx.font = `${weights[i]} ${sizes[i]}px ${family}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#3a2a14";
      ctx.strokeText(lines[i], x0, y);
      ctx.fillStyle = colors[i];
      ctx.fillText(lines[i], x0, y);
      ctx.restore();
    }
    y += sizes[i] + gap;
  }
  ctx.restore();
}

function runAddressPerch(
  canvas: HTMLCanvasElement,
  hit: HTMLButtonElement | null,
  leaveRef: { current: boolean },
  homeLabel: string,
  onArrived: (viewportX: number) => void,
  rent: {
    addressId: string | null;
    blocks: { current: number | null | undefined };
    scratch: (blocks: number) => RentNote;
  },
  wakeRef: { current: () => void }
) {
  const header = canvas.parentElement;
  if (!header) return () => {};
  const prev = canvas.getAttribute("style");
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.zIndex = "30";

  let dead = false;
  let handed = false;
  let last = 0;
  let wokeAt = 0;
  let beatAt = 0;
  let ready = false;
  let x = 0;
  let y = -30;
  let roll = 0;
  let apart = 0;
  let pick = 0;
  let pebble = 0;
  let faceHome = -1;
  let climbMs = 1100;
  let segFromX = 0;
  let segFromY = 0;
  let aim: { x: number; y: number } | null = null;
  let phase: PerchPhase = returnedToHeader ? "nest" : perchedOnAddresses ? "home" : "fall";
  let note: RentNote | null = null;
  let leaveQueued = false;
  let noteA = 0;
  let writtenEmpty = "";
  let near = false;
  /** Kayolo holds the body at the door or by a note: the scout draws only the pebble and the note. */
  let held = false;
  let owned = false;
  const offKeeper = onKeeper(() => wake());
  const onMove = (e: PointerEvent) => {
    aim = { x: e.clientX, y: e.clientY };
    if (held) return;
    // Parked, his eyes follow a pointer within 160 px: wake for it, and once more as it leaves.
    const close = Math.hypot(e.clientX - x, e.clientY - y) < 220;
    if (close || near) wake();
    near = close;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  const paint = (now: number) => {
    if (dead) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (w < 8 || h < 8) {
      loop.again();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const door = addressDoor();
    if (!door) {
      placeHit(hit, false, 0, 0);
      loop.again();
      return;
    }
    if (!ready) {
      if (phase === "nest") {
        const g = searchSlip(header);
        if (!g) {
          loop.again();
          return;
        }
        faceHome = g.slips ? -1 : 1;
        x = g.slips ? g.parkX : g.approachX;
        y = g.floorY;
        pebble = 1;
      }
      beatAt = phase === "nest" ? now - 500 : now;
      last = now;
      ready = true;
      if (phase === "home") {
        x = door.x;
        y = door.y;
        apart = 0;
        pick = 0.16;
        pebble = 1;
      }
      // Another address page: Kayolo is already at the door, he stays there.
      if (KAYOLO_LAYER && phase === "home" && kayoloHolds() === "door") {
        held = true;
        owned = true;
      }
    }
    if (!owned) {
      owned = true;
      takeBody(ctx);
    }
    const dt = Math.min(34, now - last);
    last = now;
    const delivering =
      phase === "shelf" || phase === "along" || phase === "mount" || phase === "carve";
    if (leaveRef.current && (phase === "home" || phase === "watch")) {
      leaveRef.current = false;
      returnedToHeader = true;
      phase = "bye";
      beatAt = now;
    } else if (leaveRef.current && delivering) {
      leaveRef.current = false;
      leaveQueued = true;
    } else if (!delivering && phase !== "home" && phase !== "watch") {
      leaveRef.current = false;
    }

    let head = 0;
    let look = 0.9;
    let eye = 0.12;
    let lift = 0;
    let crouch = 0;
    let faceN = -1;
    let pupil = now * 0.0016;
    let orbit = 0.35;

    if (phase === "fall") {
      const u = Math.min(1, (now - beatAt) / 1280);
      const k = smooth(u);
      x = door.x;
      y = -28 + (door.y + 28) * k;
      roll += (dt / 16) * (1 - k) * 1.5;
      look = 0.35;
      if (u >= 1) {
        y = door.y;
        phase = "settle";
        beatAt = now;
      }
    } else if (phase === "settle") {
      const u = Math.min(1, (now - beatAt) / 920);
      const k = smooth(u);
      x += (door.x - x) * 0.2;
      y += (door.y - y) * 0.2;
      apart = 0;
      pick = 0.16 * k;
      pebble = smooth(Math.max(0, (u - 0.28) / 0.72));
      look = 0.45 + 0.7 * k;
      head = look * 0.12;
      if (u < 0.22) lift = Math.sin((u / 0.22) * Math.PI) * 3.5;
      if (u >= 1) {
        perchedOnAddresses = true;
        phase = "home";
        beatAt = now;
      }
    } else if (phase === "home") {
      const cue = rent.blocks.current;
      const lane =
        rent.addressId && rentTold !== rent.addressId && cue != null ? measureRentLane() : null;
      // He never scrolls the page: a lane off screen waits until the person scrolls to it.
      const inView = lane != null && lane.cols.top <= window.innerHeight - 72 && lane.cols.bottom >= 96;
      if (lane && inView && rent.addressId && cue != null) {
        rentTold = rent.addressId;
        note = rent.scratch(cue);
        noteA = 0;
        phase = "shelf";
        beatAt = now;
        segFromX = x;
        segFromY = y;
      } else if (emptyNote()) {
        writtenEmpty = "";
        claimNote(emptyNote()!);
        phase = "note-drive";
        beatAt = now;
        segFromX = x;
        segFromY = y;
      } else {
        x += (door.x - x) * 0.14;
        y += (door.y - y) * 0.14;
        apart = 0;
        pick = 0.14 + Math.sin(now / 1400) * 0.03;
        pebble = 1;
        look = 1.05 + Math.sin(now / 1600) * 0.16;
        head = Math.sin(now / 1600) * 0.05;
        eye = 0.1 + Math.sin(now / 2100) * 0.04;
        lift = Math.sin(now / 1800) * 0.6;
        if (aim) {
          const dx = aim.x - x;
          const dy = aim.y - (y - 16);
          const dist = Math.hypot(dx, dy);
          if (dist < 120) {
            const pull = 1 - dist / 120;
            look = look * (1 - pull) + clamp(-dx / 18, -1.45, 1.45) * pull;
            pick = 0.14 + pull * 0.1;
          }
        }
      }
    } else if (phase === "shelf") {
      const lane = measureRentLane();
      const destX = door.x;
      const destY = lane ? lane.cols.top - 2 : segFromY;
      const ms = clamp(Math.hypot(destX - segFromX, destY - segFromY) * 4.2, 640, 1200);
      const u = Math.min(1, (now - beatAt) / ms);
      const k = smooth(u);
      const nx = segFromX + (destX - segFromX) * k;
      const ny = segFromY + (destY - segFromY) * k;
      roll += Math.hypot(nx - x, ny - y) * 0.45;
      x = nx;
      y = ny;
      faceN = 1;
      apart = Math.sin(k * Math.PI);
      look = 0.25;
      pebble = 1;
      if (u >= 1) {
        x = destX;
        y = destY;
        phase = "along";
        beatAt = now;
        segFromX = x;
        segFromY = y;
      }
    } else if (phase === "along") {
      const lane = measureRentLane();
      const stand = lane ? rentStand(lane.bal) : null;
      const destX = stand ? stand.x : segFromX;
      const destY = lane ? lane.cols.top - 2 : y;
      const d = destX - x;
      const step = Math.sign(d) * Math.min(Math.abs(d), (112 * dt) / 1000);
      x += step;
      y += (destY - y) * 0.35;
      roll += Math.abs(step) * 0.55;
      faceN = d < -0.5 ? -1 : 1;
      apart = 0;
      look = 0.15;
      pupil = Math.PI / 2;
      orbit = 0.85;
      pebble = 1;
      if (Math.abs(d) < 1.5) {
        x = destX;
        phase = "mount";
        beatAt = now;
        segFromX = x;
        segFromY = y;
      }
    } else if (phase === "mount") {
      const lane = measureRentLane();
      const stand = lane ? rentStand(lane.bal) : null;
      const destX = stand ? stand.x : segFromX;
      const destY = stand ? stand.y : segFromY;
      const u = Math.min(1, (now - beatAt) / 820);
      const k = smooth(u);
      const nx = segFromX + (destX - segFromX) * k;
      const ny = segFromY + (destY - segFromY) * k;
      roll += Math.hypot(nx - x, ny - y) * 0.4;
      x = nx;
      y = ny;
      const turn = smooth(clamp((u - 0.45) / 0.4, 0, 1));
      faceN = 1 - 2 * turn;
      apart = Math.sin(k * Math.PI) * 0.35;
      look = 0.4 + turn * 0.8;
      pebble = 1;
      if (u >= 1) {
        x = destX;
        y = destY;
        faceN = -1;
        phase = "carve";
        beatAt = now;
      }
    } else if (phase === "carve") {
      const lane = measureRentLane();
      if (lane) {
        const stand = rentStand(lane.bal);
        x += (stand.x - x) * 0.2;
        y += (stand.y - y) * 0.2;
      }
      const elapsed = now - beatAt;
      const idx = Math.min(2, Math.floor(elapsed / CARVE_LINE_MS));
      const u = Math.min(1, (elapsed - idx * CARVE_LINE_MS) / CARVE_LINE_MS);
      const strike = Math.sin(Math.min(1, u) * Math.PI);
      faceN = -1;
      apart = 0;
      pick = 0.12 + strike * 0.92;
      look = 1.15;
      head = 0.18;
      eye = 0.9 + strike * 0.15;
      pebble = 1;
      noteA = 1;
      if (elapsed >= CARVE_LINE_MS * 3) {
        phase = "watch";
        beatAt = now;
        pick = 0.2;
      }
    } else if (phase === "watch") {
      const lineEl = emptyNote();
      if (lineEl && !leaveQueued) {
        writtenEmpty = "";
        claimNote(lineEl);
        phase = "note-drive";
        beatAt = now;
        segFromX = x;
        segFromY = y;
      } else {
      const lane = measureRentLane();
      if (lane) {
        const stand = rentStand(lane.bal);
        x += (stand.x - x) * 0.14;
        y += (stand.y - y) * 0.14;
      }
      faceN = -1;
      apart = 0;
      pick = 0.18 + Math.sin(now / 900) * 0.05;
      look = 1.2;
      head = 0.16;
      eye = 1.05;
      pebble = 1;
      noteA = 1;
      if (leaveQueued && now - beatAt > 1100) {
        leaveQueued = false;
        returnedToHeader = true;
        phase = "bye";
        beatAt = now;
      }
      }
    } else if (phase === "note-drive") {
      const lineEl = emptyNote();
      if (!lineEl) {
        phase = "note-rise";
        beatAt = now;
        segFromY = y;
      } else {
        const stand = emptyStand(lineEl);
        const d = stand.x - x;
        faceN = d >= 0 ? 1 : -1;
        const step = Math.sign(d) * Math.min(Math.abs(d), (220 * dt) / 1000);
        x += step;
        y = segFromY;
        roll += Math.abs(step) * 0.55;
        apart += ((eyesUnderHeader(header, x, y) ? 1 : 0) - apart) * 0.22;
        look = apart > 0.4 ? 0.12 : 0.35;
        pick = 0.08;
        pebble = 0.35;
        if (Math.abs(d) < 1.5) {
          x = stand.x;
          apart = 0;
          if (Math.abs(stand.y - y) < 2) {
            y = stand.y;
            faceN = 1;
            writtenEmpty = lineEl.getAttribute("data-fav-note") ?? "";
            lineEl.style.setProperty("--scratch", "0");
            phase = "note-write";
            beatAt = now;
          } else {
            phase = "note-drop";
            beatAt = now;
            segFromY = y;
          }
        }
      }
    } else if (phase === "note-drop") {
      const lineEl = emptyNote();
      if (!lineEl) {
        phase = "note-rise";
        beatAt = now;
        segFromY = y;
      } else {
        const stand = emptyStand(lineEl);
        const u = Math.min(1, (now - beatAt) / 460);
        const k = smooth(u);
        x = stand.x;
        y = segFromY + (stand.y - segFromY) * k;
        faceN = 1;
        apart += (0 - apart) * 0.2;
        look = 0.2;
        pupil = Math.PI / 2;
        orbit = 0.9;
        roll += (dt / 16) * (1 - k) * 1.4;
        pick = 0.08;
        pebble = 0.3;
        if (u >= 1) {
          y = stand.y;
          apart = 0;
          faceN = 1;
          writtenEmpty = lineEl.getAttribute("data-fav-note") ?? "";
          lineEl.style.setProperty("--scratch", "0");
          phase = "note-write";
          beatAt = now;
        }
      }
    } else if (phase === "note-write") {
      const lineEl = emptyNote();
      if (!lineEl) {
        phase = "note-rise";
        beatAt = now;
        segFromY = y;
      } else {
        const stand = emptyStand(lineEl);
        const WRITE = 760;
        const u = Math.min(1, (now - beatAt) / WRITE);
        const scratch = smooth(u);
        lineEl.style.setProperty("--scratch", scratch.toFixed(3));
        const tip = stand.rect.left - 34 + stand.rect.width * scratch * 0.18;
        const nx = x + (tip - x) * 0.2;
        roll += Math.abs(nx - x) * 0.5;
        x = nx;
        y += (stand.y - y) * 0.25;
        faceN = 1;
        apart = 0;
        const stroke = Math.sin(Math.min(1, u) * Math.PI * 2);
        pick = 0.14 + Math.abs(stroke) * 0.9;
        look = 1.05;
        head = 0.12 + Math.abs(stroke) * 0.08;
        eye = 0.55 + Math.abs(stroke) * 0.35;
        pebble = 0.2;
        if (u >= 1) {
          lineEl.style.setProperty("--scratch", "1");
          phase = "note-live";
          beatAt = now;
          pick = 0.16;
        }
      }
    } else if (phase === "note-live") {
      const lineEl = emptyNote();
      if (!lineEl) {
        phase = "note-rise";
        beatAt = now;
        segFromY = y;
      } else {
        const stand = emptyStand(lineEl);
        const line = lineEl.getAttribute("data-fav-note") ?? "";
        x += (stand.x - x) * 0.08;
        y += (stand.y + Math.sin(now / 900) * 0.7 - y) * 0.2;
        faceN = 1;
        apart = 0;
        const blink = (now - beatAt) % 2600;
        eye = blink < 90 ? 0.15 : 0.22;
        look = 0.85 + Math.sin(now / 1700) * 0.28;
        head = 0.1 + Math.sin(now / 1700) * 0.05;
        pick = 0.14 + Math.sin(now / 1100) * 0.05;
        pebble = 0.25;
        if (aim && Math.hypot(aim.x - x, aim.y - (y - 18)) < 160) {
          const pull = 1 - Math.hypot(aim.x - x, aim.y - y) / 160;
          look = clamp((aim.x - x) / 20, -1.2, 1.4);
          eye = 0.22 + pull * 0.4;
          pick = 0.14 + pull * 0.12;
        }
        if (line !== writtenEmpty) {
          writtenEmpty = line;
          lineEl.style.setProperty("--scratch", "0");
          phase = "note-write";
          beatAt = now;
        }
      }
    } else if (phase === "note-rise") {
      const back = addressDoor() ?? door;
      if (emptyNote()) {
        claimNote(emptyNote()!);
        phase = "note-drive";
        beatAt = now;
        segFromY = y;
      } else {
        const u = Math.min(1, (now - beatAt) / 460);
        const k = smooth(u);
        y = segFromY + (back.y - segFromY) * k;
        faceN = -1;
        apart += (0 - apart) * 0.2;
        look = -0.15;
        pupil = -Math.PI / 2;
        orbit = 0.7;
        roll += (dt / 16) * (1 - k) * 1.2;
        pick = 0.08;
        pebble = 0.4;
        if (u >= 1) {
          y = back.y;
          phase = "note-roll";
          beatAt = now;
        }
      }
    } else if (phase === "note-roll") {
      const back = addressDoor() ?? door;
      if (emptyNote()) {
        claimNote(emptyNote()!);
        phase = "note-drive";
        beatAt = now;
        segFromY = y;
      } else {
        const d = back.x - x;
        faceN = d >= 0 ? 1 : -1;
        const step = Math.sign(d) * Math.min(Math.abs(d), (220 * dt) / 1000);
        x += step;
        y = back.y;
        roll += Math.abs(step) * 0.55;
        apart += ((eyesUnderHeader(header, x, y) ? 1 : 0) - apart) * 0.22;
        look = apart > 0.4 ? 0.12 : 0.3;
        pick = 0.08;
        pebble = 0.45;
        if (Math.abs(d) < 1.5) {
          x = back.x;
          apart = 0;
          phase = "home";
          beatAt = now;
        }
      }
    } else if (phase === "bye") {
      const u = Math.min(1, (now - beatAt) / BYE_MS);
      if (note) noteA = 1 - smooth(u);
      x += (door.x - x) * 0.22;
      y += (door.y - y) * 0.22;
      apart = 0;
      pick = 0.16 * (1 - smooth(Math.min(1, u / 0.35)));
      pebble = 1;
      if (u < 0.28) {
        lift = Math.sin((u / 0.28) * Math.PI) * 5;
        head = -0.32 * Math.sin((u / 0.28) * Math.PI);
        faceN = -1;
        look = 1.1;
      } else {
        const turn = smooth(clamp((u - 0.28) / 0.46, 0, 1));
        faceN = -1 + 2 * turn;
        look = 0.35 * (1 - turn);
        lift = Math.sin(turn * Math.PI) * 3.2;
        roll += (dt / 16) * 0.28;
      }
      if (u >= 1) {
        faceN = 1;
        phase = "climb";
        beatAt = now;
        segFromX = x;
        segFromY = y;
        const g0 = searchSlip(header);
        const tx = g0?.approachX ?? x;
        const ty = g0?.floorY ?? y;
        climbMs = clamp(Math.hypot(tx - x, ty - y) * 3.8, 900, 1400);
      }
    } else if (phase === "climb") {
      const gate = searchSlip(header);
      const u = Math.min(1, (now - beatAt) / climbMs);
      const k = smooth(u);
      const destX = gate?.approachX ?? segFromX;
      const destY = gate?.floorY ?? segFromY;
      const nx = segFromX + (destX - segFromX) * k + Math.sin(k * Math.PI) * 6;
      const ny = segFromY + (destY - segFromY) * k;
      roll += Math.hypot(nx - x, ny - y) * 0.45;
      x = nx;
      y = ny;
      faceN = 1;
      apart = 0;
      look = 0.2;
      if (u > 0.84) lift = Math.sin(((u - 0.84) / 0.16) * Math.PI) * 2.2;
      if (u >= 1) {
        x = destX;
        y = destY;
        phase = "duck";
        beatAt = now;
      }
    } else if (phase === "duck") {
      const u = Math.min(1, (now - beatAt) / DUCK_MS);
      const press = u > 0.62 ? Math.sin(((Math.min(1, u) - 0.62) / 0.38) * Math.PI) * 0.08 : 0;
      apart = Math.min(1, smooth(u) + press);
      crouch = CROUCH * smooth(u);
      faceN = 1;
      look = 0.15;
      const gate = searchSlip(header);
      if (gate) {
        x += (gate.approachX - x) * 0.2;
        y += (gate.floorY - y) * 0.2;
      }
      if (u >= 1) {
        beatAt = now;
        if (gate?.slips) {
          phase = "slip";
          faceHome = -1;
        } else {
          phase = "rise";
          faceHome = 1;
        }
      }
    } else if (phase === "slip") {
      const gate = searchSlip(header);
      faceN = 1;
      apart = 1;
      crouch = CROUCH;
      look = 0.1;
      if (!gate?.slips) {
        phase = "rise";
        beatAt = now;
        faceHome = 1;
      } else {
        const speed = x < gate.wordRight - 6 ? SLIP_SPEED : 156;
        const d = gate.parkX - x;
        const step = Math.sign(d) * Math.min(Math.abs(d), (speed * dt) / 1000);
        x += step;
        roll += Math.abs(step) * 0.55;
        y += (gate.floorY - y) * 0.35;
        if (Math.abs(gate.parkX - x) < 1.5) {
          x = gate.parkX;
          phase = "rise";
          beatAt = now;
          faceHome = -1;
        }
      }
    } else if (phase === "rise") {
      const u = Math.min(1, (now - beatAt) / RISE_HOME_MS);
      apart = 1 - smooth(u);
      crouch = CROUCH * (1 - smooth(u));
      const gate = searchSlip(header);
      const spot = faceHome === -1 ? gate?.parkX : gate?.approachX;
      if (gate && spot != null) {
        x += (spot - x) * 0.22;
        y += (gate.floorY - y) * 0.22;
      }
      if (faceHome === -1) {
        const turn = smooth(clamp((u - 0.4) / 0.42, 0, 1));
        faceN = 1 - 2 * turn;
        look = 0.7 * turn;
      } else {
        faceN = 1;
        look = 0.45;
      }
      if (u >= 1 && !handed) {
        handed = true;
        dead = true;
        loop.stop();
        unwake();
        offKeeper();
        window.removeEventListener("pointermove", onMove);
        restorePerchCanvas();
        onArrived(x);
        return;
      }
    } else {
      const gate = searchSlip(header);
      const spot = faceHome === -1 ? gate?.parkX : gate?.approachX;
      if (gate && spot != null) {
        x += (spot - x) * 0.14;
        y += (gate.floorY - y) * 0.14;
      }
      faceN = faceHome;
      apart = 0;
      pebble = 1;
      const wake = smooth(Math.min(1, (now - beatAt) / 420));
      eye = 0.95 * wake;
      look = Math.sin(now / 880) * 1.55 * wake;
      head = look * 0.18;
      pupil = now * 0.004;
      orbit = 0.55;
    }

    setBeat(canvas, phase);
    const restingHere = phase === "home" || phase === "watch" || phase === "note-live";
    if (held && !restingHere) {
      // He has to move (a click at the door, a note to write): the body comes back in this frame.
      held = false;
      takeBody(ctx);
    }
    if (held) {
      // Kayolo has him: the resting point may have moved (a resize, a scroll by the note).
      if (phase === "note-live") {
        const n = emptyNote();
        if (n) {
          const st = emptyStand(n);
          x = st.x;
          y = st.y;
        }
      } else if (phase === "home") {
        x = door.x;
        y = door.y;
      }
      moveBody({ x, y });
    }
    const floor = y - lift + crouch;
    const air = Math.min(1, lift / 4);
    const landed = phase === "fall" ? clamp(1 - (door.y - y) / Math.max(door.y, 1), 0.15, 1) : 1;
    if (!held) {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${0.16 * landed * (1 - air * 0.5)})`;
      ctx.beginPath();
      ctx.ellipse(x, floor + 1, 11, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (note && noteA > 0.02) {
      const lane = measureRentLane();
      if (lane) {
        const elapsed = phase === "carve" ? now - beatAt : CARVE_LINE_MS * 3;
        const idx = Math.min(2, Math.floor(elapsed / CARVE_LINE_MS));
        const u = Math.min(1, (elapsed - idx * CARVE_LINE_MS) / CARVE_LINE_MS);
        const shown: [number, number, number] = [
          idx > 0 ? 1 : idx === 0 ? smooth(u) : 0,
          idx > 1 ? 1 : idx === 1 ? smooth(u) : 0,
          idx > 2 ? 1 : idx === 2 ? smooth(u) : 0,
        ];
        if (phase !== "carve") {
          shown[0] = 1;
          shown[1] = 1;
          shown[2] = 1;
        }
        drawRentNote(ctx, lane.bal, x, note.lines, shown, noteA, note.due);
      }
    }

    const seek = phase === "nest";
    scoutPose = { x, y: floor, face: faceN > 0 ? 1 : -1, roll };
    const bodyPose = {
      head,
      look: clamp(look, -2.1, 2.1),
      pick,
      eyesApart: apart,
      eyeLift: seek ? eye * 2.2 : eye * 1.4,
      eyeScale:
        seek || phase === "carve" || phase === "watch" || phase === "note-write" || phase === "note-live"
          ? 1 + eye * 0.34
          : 1 + eye * 0.2,
      pupil,
      pupilOrbit: orbit,
    };
    if (!held) {
      drawScout(ctx, {
        ...bodyPose,
        x: clamp(x, 12, w - 12),
        y: floor,
        roll,
        face: faceN,
        scale: SCALE,
      });
    }
    const rentLabel = note ? note.lines.join(", ") : homeLabel;
    const rentHit =
      phase === "home" ||
      phase === "watch" ||
      phase === "shelf" ||
      phase === "along" ||
      phase === "mount" ||
      phase === "carve";
    placeHit(hit, rentHit, x, y, phase === "home" ? homeLabel : rentLabel);

    if (pebble > 0.02) {
      const accent = getComputedStyle(header).getPropertyValue("--accent").trim() || "#3ca2ff";
      ctx.save();
      ctx.globalAlpha = clamp(pebble, 0, 1) * 0.95;
      ctx.translate(door.pebbleX, door.pebbleY);
      ctx.fillStyle = "#f0c14a";
      ctx.strokeStyle = "#3a2a14";
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0.2, 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // At the door, watching, or by a written note: once still, no more frames until an event.
    const resting = phase === "home" || phase === "watch" || phase === "note-live" || phase === "nest";
    if (held) return;
    const blinking = phase === "note-live" && (now - beatAt) % 2600 < 90;
    if (resting && !blinking && settled(ctx, now, Math.max(beatAt, wokeAt))) {
      // Still: Kayolo lives in him from here (M1). This frame is drawn again without the body.
      if (restingHere && giveBody(ctx, phase === "note-live" ? "note" : "door", x, floor, faceN, bodyPose)) {
        held = true;
        paint(now);
      }
      return;
    }
    loop.again();
  };

  const restorePerchCanvas = () => {
    canvas.width = 0;
    canvas.height = 0;
    if (prev == null) canvas.removeAttribute("style");
    else canvas.setAttribute("style", prev);
  };

  const loop = frameLoop(paint);
  const wake = () => {
    wokeAt = performance.now();
    loop.again();
  };
  wakeRef.current = wake;
  const unwake = wakeOn(header, wake, { scroll: () => true, note: emptyNote });
  loop.again();
  return () => {
    dead = true;
    loop.stop();
    unwake();
    offKeeper();
    window.removeEventListener("pointermove", onMove);
    if (handed) return;
    releaseNotes();
    placeHit(hit, false, 0, 0);
    restorePerchCanvas();
  };
}

function searchEnd(root: HTMLElement): number | null {
  const host = root.getBoundingClientRect();
  const nodes = root.querySelectorAll<HTMLElement>('[data-scout="search"]');
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const text = el.querySelector("span");
    const icon = el.querySelector("svg");
    const cs = getComputedStyle(text ?? el);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`;
    if (font !== cueFont) {
      const meas = document.createElement("canvas").getContext("2d");
      if (!meas) return r.right - host.left + 8;
      meas.font = font;
      cueFont = font;
      cueWidth = 0;
      for (const word of [...SCOUT_CUES_EN, ...SCOUT_CUES_RU]) {
        cueWidth = Math.max(cueWidth, meas.measureText(word).width);
      }
    }
    const iconRight = icon ? icon.getBoundingClientRect().right - host.left : r.left - host.left + 18;
    return iconRight + 12 + cueWidth + 40;
  }
  return null;
}

function searchSlip(header: HTMLElement) {
  const search = header.querySelector<HTMLElement>('[data-scout="search"]');
  if (!search) return null;
  const s = search.getBoundingClientRect();
  if (s.width < 8 || s.height < 8) return null;
  const span = search.querySelector("span");
  const spanBox = span?.getBoundingClientRect();
  const word = spanBox && spanBox.width > 2 ? spanBox : s;
  const host = header.getBoundingClientRect();
  const title = header.querySelector<HTMLElement>('[data-scout="title"]');
  const localEnd = searchEnd(header);
  const gate = addressReturnGate({
    searchLeft: s.left,
    wordLeft: word.left,
    wordRight: word.right,
    reservedPark: host.left + (localEnd ?? word.right - host.left + 36),
    titleLeft: title?.getBoundingClientRect().left ?? host.right - 16,
  });
  return { ...gate, floorY: host.top + header.clientHeight - 6, wordRight: word.right };
}

function world(root: HTMLElement): World {
  const title = spot(root, "title");
  const price = spot(root, "price");
  const mcap = spot(root, "mcap");
  const priceBlock = union(spot(root, "price-label"), price);
  const mcapBlock = union(spot(root, "mcap-label"), mcap);
  const gap =
    price && mcapBlock ? (price.right + mcapBlock.left) / 2 : null;
  return {
    title,
    price,
    mcap,
    priceBlock,
    mcapBlock,
    gap,
    searchEnd: searchEnd(root),
    w: root.clientWidth,
  };
}

function rightOf(box: Box, w: number) {
  return clamp(box.right + 46, 20, w - 18);
}

function leftOf(box: Box) {
  return box.left - 40;
}

/** Where an under-pass should finish. Null when the beat is not travel. */
function travelTo(beat: ScoutBeat, g: World): number | null {
  const priceIn = g.priceBlock ? leftOf(g.priceBlock) : g.w * 0.72;
  const priceOut = g.gap ?? (g.priceBlock ? rightOf(g.priceBlock, g.w) : g.w - 24);
  const mcapOut = g.mcapBlock ? rightOf(g.mcapBlock, g.w) : g.w - 24;
  const titleIn = g.title ? leftOf(g.title) : 40;
  const titleOut = g.title ? rightOf(g.title, g.w) : g.w * 0.5;
  if (beat === "to-price") return priceIn;
  if (beat === "under-title") return titleOut;
  if (beat === "under-price") return priceOut;
  if (beat === "under-mcap") return mcapOut;
  if (beat === "under-mcap-back") return g.gap ?? priceOut;
  if (beat === "under-price-back") return priceIn;
  if (beat === "to-title-back") return titleOut;
  if (beat === "under-title-back") return titleIn;
  if (beat === "to-search") {
    const end = g.searchEnd ?? 80;
    const beforeTitle = g.title ? g.title.left - 48 : g.w - 16;
    return clamp(Math.min(end, beforeTitle), 20, g.w - 16);
  }
  return null;
}

function beatMs(beat: ScoutBeat) {
  if (beat === "fall") return FALL_MS;
  if (beat.startsWith("squat")) return SQUAT_MS;
  if (beat.startsWith("rise") || beat === "peek") return beat === "peek" ? PEEK_MS : RISE_MS;
  if (beat === "price") return PRICE_MS;
  if (beat === "mcap") return MCAP_MS;
  if (beat === "read") return READ_MS;
  return 0;
}

/**
 * start: the first show in a session, with the fall. after-fall: on the floor at x (the address
 * return). seek: parked by the search (Э1a). nook: a later tour from where he is (x), first walking
 * to the title. walk-home: no tour, but he was mid-pass: he walks home from x. rest: no tour, he is
 * at home already (Kayolo draws him; the phone keeps the scout's button at the park).
 */
type PassFrom = "start" | "after-fall" | "seek" | "nook" | "walk-home" | "rest";

/** The toolbar pass. A click stops him into a question, unless he is still under a word. */
function runHeaderPass(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  hit: HTMLButtonElement | null,
  pokeRef: { current: boolean },
  askLabel: string,
  start: { from: PassFrom; x?: number; markDone?: boolean },
  wakeRef: { current: () => void },
  /** Address pages: an empty tokens, NFTs or boxes line can appear and wake him. */
  watchNotes = false,
  /** Kayolo's window is on (desktop): the tour ends in his niche. homeRef: «call him home». */
  kayolo: { nook: boolean; homeRef: { current: boolean } } = { nook: false, homeRef: { current: false } }
) {
  const nook = kayolo.nook;
  const lastBeat: ScoutBeat = nook ? "home" : "seek";
  const wide = window.matchMedia(WIDE_QUERY).matches;
  /** Phone hops: ×0.8, never above 6 px (§2.7). */
  const hopPx = wide ? HOP : Math.min(HOP * 0.8, 6);
  /** Kayolo holds the body (or will, at rest): nothing is drawn. */
  let held = false;
  let owned = false;
  let restAt = -1;
  let approachTo: number | null = null;
  let dead = false;
  let wokeAt = 0;
  let last = 0;
  let beatI = 0;
  let beatAt = 0;
  let ready = false;
  let x = start.x ?? 24;
  let face: 1 | -1 = 1;
  let roll = 0;
  let apart = 0;
  let lineA = 0;
  let lineTo = 0;
  let asking = false;
  let askAt = 0;
  let askQueued = false;
  let approaching = false;
  let askApart = 0;
  let askFace: 1 | -1 = -1;
  let elapsed = 0;
  let aim: { x: number; y: number } | null = null;
  let emptyDrive: {
    mode: "cross" | "drop" | "write" | "live" | "rise" | "roll";
    beatAt: number;
    fromY: number;
    written: string;
    x: number;
    y: number;
    roll: number;
    face: 1 | -1;
  } | null = null;
  let emptyCanvas: string | null = null;
  const beats: ScoutBeat[] = [];
  const onMove = (e: PointerEvent) => {
    aim = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  const offKeeper = onKeeper(() => wake());

  /** Home in header coordinates: the niche (desktop) or the park past the search word (phone). */
  const homeX = (g: World) => {
    if (nook) {
      const n = nookNow();
      if (n) return n.x - root.getBoundingClientRect().left;
      return g.title ? g.title.right + 25 : g.w * 0.5;
    }
    return travelTo("to-search", g) ?? g.searchEnd ?? 80;
  };

  const paint = (now: number) => {
    if (dead) return;
    if (held) {
      // At rest Kayolo has him. A click on the phone park, or a note to write, needs the body back.
      const takeBack = pokeRef.current || (watchNotes && emptyNote() != null);
      if (!takeBack) {
        if (!nook) {
          const g = world(root);
          x = homeX(g);
          const box = root.getBoundingClientRect();
          const floorY = box.top + root.clientHeight - 6;
          if (kayoloHolds() === "park") moveBody({ x: box.left + x, y: floorY });
          placeHit(hit, true, box.left + x, floorY, askLabel);
        }
        return;
      }
      held = false;
      const p = takeBody(canvas.getContext("2d"));
      if (p) {
        x = p.x - root.getBoundingClientRect().left;
        face = p.face;
      }
      wokeAt = now;
      beatAt = now - SEEK_LOOK_MS;
      restAt = -1;
    }
    const lineElNow = emptyNote();
    if (lineElNow || emptyDrive) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (emptyCanvas == null) emptyCanvas = canvas.getAttribute("style");
      canvas.style.position = "fixed";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.right = "auto";
      canvas.style.bottom = "auto";
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      canvas.style.zIndex = "30";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        loop.again();
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      if (!owned) {
        owned = true;
        takeBody(ctx);
      }
      if (!ready) {
        const g0 = world(root);
        beats.push(...scoutBeats(!!g0.title, !!g0.mcap));
        ready = true;
        beatAt = now;
        last = now;
      }
      const dt = Math.min(34, now - (last || now));
      last = now;
      if (!emptyDrive) {
        const box = root.getBoundingClientRect();
        const startX = scoutPose?.x ?? box.left + x;
        const startY = scoutPose?.y ?? box.bottom - 6;
        emptyDrive = {
          mode: "cross",
          beatAt: now,
          fromY: startY,
          written: "",
          x: startX,
          y: startY,
          roll: scoutPose?.roll ?? roll,
          face: scoutPose?.face ?? face,
        };
        if (lineElNow) claimNote(lineElNow);
      }
      const drive = emptyDrive;
      const lineEl = emptyNote();
      let head = 0;
      let look = 0.4;
      let pick = 0.12;
      let eye = 0.2;
      let eyeScale = 1;
      let pupil = now * 0.0014;
      let orbit = 0.3;
      let apartN = 0;
      const park = () => {
        const box = root.getBoundingClientRect();
        return { x: box.left + clamp(x, 20, Math.max(20, root.clientWidth - 20)), y: box.bottom - 6 };
      };
      if (drive.mode === "cross") {
        if (!lineEl) {
          drive.mode = "rise";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const stand = emptyStand(lineEl);
          const d = stand.x - drive.x;
          drive.face = d >= 0 ? 1 : -1;
          const step = Math.sign(d) * Math.min(Math.abs(d), (220 * dt) / 1000);
          drive.x += step;
          drive.y = drive.fromY;
          drive.roll += Math.abs(step) * 0.55;
          apartN = eyesUnderHeader(root, drive.x, drive.y) ? 1 : 0;
          look = apartN ? 0.12 : 0.35;
          pick = 0.08;
          if (Math.abs(d) < 1.5) {
            drive.x = stand.x;
            if (Math.abs(stand.y - drive.y) < 2) {
              drive.y = stand.y;
              drive.face = 1;
              drive.written = lineEl.getAttribute("data-fav-note") ?? "";
              lineEl.style.setProperty("--scratch", "0");
              drive.mode = "write";
              drive.beatAt = now;
            } else {
              drive.mode = "drop";
              drive.beatAt = now;
              drive.fromY = drive.y;
            }
          }
        }
      } else if (drive.mode === "drop") {
        if (!lineEl) {
          drive.mode = "rise";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const stand = emptyStand(lineEl);
          const u = Math.min(1, (now - drive.beatAt) / 460);
          const k = smooth(u);
          drive.x = stand.x;
          drive.y = drive.fromY + (stand.y - drive.fromY) * k;
          drive.face = 1;
          apartN = 0;
          look = 0.2;
          pupil = Math.PI / 2;
          orbit = 0.9;
          drive.roll += (dt / 16) * (1 - k) * 1.4;
          pick = 0.08;
          if (u >= 1) {
            drive.y = stand.y;
            drive.face = 1;
            drive.written = lineEl.getAttribute("data-fav-note") ?? "";
            lineEl.style.setProperty("--scratch", "0");
            drive.mode = "write";
            drive.beatAt = now;
          }
        }
      } else if (drive.mode === "write") {
        if (!lineEl) {
          drive.mode = "rise";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const stand = emptyStand(lineEl);
          const u = Math.min(1, (now - drive.beatAt) / 760);
          const scratch = smooth(u);
          lineEl.style.setProperty("--scratch", scratch.toFixed(3));
          const tip = stand.rect.left - 34 + stand.rect.width * scratch * 0.18;
          const nx = drive.x + (tip - drive.x) * 0.2;
          drive.roll += Math.abs(nx - drive.x) * 0.5;
          drive.x = nx;
          drive.y += (stand.y - drive.y) * 0.25;
          drive.face = 1;
          const stroke = Math.sin(Math.min(1, u) * Math.PI * 2);
          pick = 0.14 + Math.abs(stroke) * 0.9;
          look = 1.05;
          head = 0.12 + Math.abs(stroke) * 0.08;
          eye = 0.55 + Math.abs(stroke) * 0.35;
          if (u >= 1) {
            lineEl.style.setProperty("--scratch", "1");
            drive.mode = "live";
            drive.beatAt = now;
          }
        }
      } else if (drive.mode === "live") {
        if (!lineEl) {
          drive.mode = "rise";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const stand = emptyStand(lineEl);
          const line = lineEl.getAttribute("data-fav-note") ?? "";
          drive.x += (stand.x - drive.x) * 0.08;
          drive.y += (stand.y + Math.sin(now / 900) * 0.7 - drive.y) * 0.2;
          drive.face = 1;
          const blink = (now - drive.beatAt) % 2600;
          eyeScale = blink < 90 ? 1 - Math.sin((blink / 90) * Math.PI) * 0.86 : 1;
          look = 0.85 + Math.sin(now / 1700) * 0.28;
          head = 0.1;
          pick = 0.14 + Math.sin(now / 1100) * 0.05;
          eye = 0.22;
          if (line !== drive.written) {
            drive.written = line;
            lineEl.style.setProperty("--scratch", "0");
            drive.mode = "write";
            drive.beatAt = now;
          }
        }
      } else if (drive.mode === "rise") {
        const home = park();
        if (lineEl) {
          claimNote(lineEl);
          drive.mode = "cross";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const u = Math.min(1, (now - drive.beatAt) / 460);
          const k = smooth(u);
          drive.y = drive.fromY + (home.y - drive.fromY) * k;
          drive.face = -1;
          look = -0.15;
          pupil = -Math.PI / 2;
          orbit = 0.7;
          drive.roll += (dt / 16) * (1 - k) * 1.2;
          pick = 0.08;
          if (u >= 1) {
            drive.y = home.y;
            drive.mode = "roll";
            drive.beatAt = now;
          }
        }
      } else {
        const home = park();
        if (lineEl) {
          claimNote(lineEl);
          drive.mode = "cross";
          drive.beatAt = now;
          drive.fromY = drive.y;
        } else {
          const d = home.x - drive.x;
          drive.face = d >= 0 ? 1 : -1;
          const step = Math.sign(d) * Math.min(Math.abs(d), (220 * dt) / 1000);
          drive.x += step;
          drive.y = home.y;
          drive.roll += Math.abs(step) * 0.55;
          apartN = eyesUnderHeader(root, drive.x, drive.y) ? 1 : 0;
          look = apartN ? 0.12 : 0.3;
          pick = 0.08;
          if (Math.abs(d) < 1.5) {
            const box = root.getBoundingClientRect();
            x = clamp(drive.x - box.left, 20, Math.max(20, root.clientWidth - 20));
            roll = drive.roll;
            face = drive.face;
            emptyDrive = null;
            if (emptyCanvas == null) canvas.removeAttribute("style");
            else canvas.setAttribute("style", emptyCanvas);
            emptyCanvas = null;
            loop.again();
            return;
          }
        }
      }
      if (emptyDrive) {
        scoutPose = { x: drive.x, y: drive.y, face: drive.face, roll: drive.roll };
        drawScout(ctx, {
          x: clamp(drive.x, 16, vw - 16),
          y: drive.y,
          head,
          look: clamp(look, -2.1, 2.1),
          pick,
          roll: drive.roll,
          face: drive.face,
          scale: SCALE,
          eyesApart: apartN,
          eyeLift: eye * 2.2,
          eyeScale,
          pupil,
          pupilOrbit: orbit,
          // An empty address: he comes over for a curious look; writing the note is work.
          mood: emptyDrive.mode === "write" ? "work" : emptyDrive.mode === "drop" ? "surprised" : "curious",
        });
      }
      // By the written line: once still, no frames until scroll, a change of the line or a resize.
      const blink = drive.mode === "live" && (now - drive.beatAt) % 2600 < 90;
      if (emptyDrive && drive.mode === "live" && !blink && settled(ctx, now, Math.max(drive.beatAt, wokeAt))) return;
      loop.again();
      return;
    }
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w < 8 || h < 8) {
      loop.again();
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const g = world(root);
    g.w = w;
    const floor = h - 6;
    if (!ready) {
      beats.push(...scoutBeats(!!g.title, !!g.mcap, nook));
      const from = start.from;
      if (from === "seek" || from === "rest") {
        beatI = beats.length - 1;
        x = homeX(g);
        // At rest Kayolo draws him; until the layer has loaded the phone scout keeps drawing him.
        if (from === "rest" && (nook || hasKeeper())) {
          held = true;
          owned = true;
        }
      } else if (from === "after-fall") {
        beatI = 1;
        const land = start.x ?? (g.title ? leftOf(g.title) : g.searchEnd ?? 56);
        x = clamp(land, 20, w - 20);
        const titleIn = g.title ? leftOf(g.title) : x;
        approaching = !!g.title && x < titleIn - 8;
        if (approaching) approachTo = titleIn;
      } else if (from === "nook" || from === "walk-home") {
        x = clamp(start.x ?? homeX(g), 20, w - 20);
        if (from === "walk-home") beatI = beats.indexOf(nook ? "to-home" : "to-search");
        else if (nook && g.title) {
          // A later tour: from where he is to the title's edge, then the read and on to the price.
          beatI = beats.indexOf("read");
          approachTo = rightOf(g.title, w);
          approaching = Math.abs(approachTo - x) > 1.5;
        } else beatI = 1;
      } else {
        const land = g.title ? leftOf(g.title) : g.searchEnd ?? 56;
        x = clamp(land, 20, w - 20);
      }
      beatI = Math.max(0, beatI);
      beatAt = now;
      last = now;
      ready = true;
      if (held) {
        if (!nook) {
          const box = root.getBoundingClientRect();
          placeHit(hit, true, box.left + x, box.top + floor, askLabel);
        } else placeHit(hit, false, 0, 0);
        return;
      }
    }
    if (!owned) {
      owned = true;
      const p = takeBody(ctx);
      // From Kayolo's place, not from the old one.
      if (p && (p.where === "nook" || p.where === "park") && (start.from === "nook" || start.from === "walk-home")) {
        x = clamp(p.x - root.getBoundingClientRect().left, 20, w - 20);
        if (approachTo != null) approaching = Math.abs(approachTo - x) > 1.5;
      }
    }

    const dt = Math.min(34, now - last);
    last = now;
    // «Call him home» from his window during the tour: he finishes a slip, then walks home.
    if (kayolo.homeRef.current && nook) {
      const cur = beats[beatI] ?? lastBeat;
      if (cur === "to-home" || cur === "home") kayolo.homeRef.current = false;
      else if (!cur.startsWith("under") && !cur.startsWith("squat") && cur !== "fall" && !asking) {
        kayolo.homeRef.current = false;
        beatI = beats.indexOf("to-home");
        beatAt = now;
        lineA = 0;
        approaching = false;
      }
    }
    const beat = beats[beatI] ?? lastBeat;
    const u = beatMs(beat) > 0 ? (now - beatAt) / beatMs(beat) : 1;
    if (start.markDone && beat === lastBeat) addressPassed = true;

    const beginAsk = () => {
      asking = true;
      askAt = now;
      askApart = apart;
      askFace = face;
      elapsed = Math.max(0, now - beatAt);
    };
    const endAsk = () => {
      asking = false;
      if (beats[beatI]?.startsWith("under")) {
        beatI += 1;
        beatAt = now;
        if (beats[beatI]?.startsWith("rise")) {
          beatI += 1;
          beatAt = now;
        }
        return;
      }
      beatAt = now - elapsed;
    };

    if (pokeRef.current && !asking) {
      pokeRef.current = false;
      if (askWaitsForSlip(beat) || beat === "fall") askQueued = true;
      else beginAsk();
    } else if (pokeRef.current && asking) {
      pokeRef.current = false;
      askAt = now;
    }

    const host = root.getBoundingClientRect();
    const follow = (spriteY: number) => {
      placeHit(hit, true, host.left + x, host.top + spriteY, askLabel);
    };

    if (approaching && !asking) {
      const dest = approachTo ?? (g.title ? leftOf(g.title) : x);
      const d = dest - x;
      face = d >= 0 ? 1 : -1;
      const step = Math.sign(d) * Math.min(Math.abs(d), (SPEED * dt) / 1000);
      x += step;
      roll += Math.abs(step) * 0.55;
      apart = 0;
      if (Math.abs(dest - x) < 1.5) {
        x = dest;
        approaching = false;
        beatAt = now;
      }
      setBeat(canvas, "to-title");
      draw(ctx, root, g, x, floor, floor, 0, face, roll, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      follow(floor);
      loop.again();
      return;
    }

    if (asking) {
      const au = Math.min(1, (now - askAt) / ASK_MS);
      const down = 1 - smooth(Math.min(1, au / 0.2));
      apart = askApart * down;
      const pop = smooth(clamp((au - 0.12) / 0.26, 0, 1));
      const eye = pop * 1.2;
      const head = 0.52 * pop;
      const pick = Math.sin(Math.min(1, au / 0.48) * Math.PI) * 0.9;
      const lift = au > 0.1 && au < 0.38 ? Math.sin(((au - 0.1) / 0.28) * Math.PI) * 4.2 : 0;
      if (aim) {
        const dx = aim.x - (host.left + x);
        face = dx >= 8 ? 1 : dx <= -8 ? -1 : askFace;
      } else face = askFace;
      const look = 0.2 + Math.sin(now / 380) * 0.3 * pop;
      setBeat(canvas, "ask");
      if (au >= 1) endAsk();
      draw(ctx, root, g, x, floor - lift, floor, lift, face, roll, apart, head, look, pick, eye, -Math.PI / 2, 1.05 * pop, 0, 0);
      follow(floor - lift);
      loop.again();
      return;
    }

    setBeat(canvas, beat);
    let head = 0;
    let look = 0;
    let pick = 0;
    let eye = 0;
    let pupil = 0;
    let orbit = 0;
    let lift = 0;
    if (beat !== "read") lineA = 0;

    const go = (target: number, speed: number) => {
      const d = target - x;
      face = d >= 0 ? 1 : -1;
      const step = Math.sign(d) * Math.min(Math.abs(d), (speed * dt) / 1000);
      x += step;
      roll += Math.abs(step) * 0.55;
      if (Math.abs(target - x) < 1.5) {
        if (askQueued && beat.startsWith("under")) {
          askQueued = false;
          x = target;
          beginAsk();
          return;
        }
        beatI += 1;
        beatAt = now;
      }
    };

    if (beat === "fall") {
      const k = 1 - (1 - Math.min(1, u)) ** 3;
      const y = 2 + (floor - 2) * k;
      if (u >= 1) {
        if (askQueued) {
          askQueued = false;
          beginAsk();
        } else {
          beatI += 1;
          beatAt = now;
        }
      }
      if (asking) {
        loop.again();
        return;
      }
      draw(ctx, root, g, x, y, floor, 0, face, roll, 0, 0, 0, 0, 0, 0, 0, lineA, lineTo);
      follow(y);
      loop.again();
      return;
    }

    if (beat.startsWith("squat")) {
      face = beat.endsWith("-back") ? -1 : 1;
      const press = u > 0.62 ? Math.sin(((Math.min(1, u) - 0.62) / 0.38) * Math.PI) * 0.08 : 0;
      apart = Math.min(1, smooth(u) + press);
      if (u >= 1) {
        apart = 1;
        beatI += 1;
        beatAt = now;
      }
    } else if (beat.startsWith("under") || beat.startsWith("to-")) {
      const moving = beat.startsWith("under");
      apart = moving ? 1 : 0;
      const target = beat === "to-home" ? homeX(g) : travelTo(beat, g);
      if (target == null) {
        beatI += 1;
        beatAt = now;
      } else go(target, SPEED);
    } else if (beat.startsWith("rise")) {
      apart = 1 - smooth(Math.min(1, u));
      const towardPassed = beat === "rise-title" || beat === "rise-gap" || beat === "rise-mcap";
      if (towardPassed && u > 0.58) face = -1;
      if (u >= 1) {
        apart = 0;
        beatI += 1;
        beatAt = now;
      }
    } else if (beat === "peek") {
      apart = 0;
      face = -1;
      look = Math.sin(u * Math.PI) * 0.8;
      head = look * 0.2;
      if (u >= 1) {
        beatI += 1;
        beatAt = now;
      }
    } else if (beat === "price") {
      apart = 0;
      face = -1;
      const hopU = Math.min(1, u / 0.62);
      lift = hopU < 1 ? Math.sin(hopU * Math.PI) * hopPx : 0;
      if (u > 0.12 && u < 0.5) pick = Math.sin(((u - 0.12) / 0.38) * Math.PI);
      if (u > 0.42 && u < 0.92) head = Math.sin(((u - 0.42) / 0.5) * Math.PI * 5) * 0.4;
      if (!g.mcap && u > 0.55) {
        eye = Math.sin(((u - 0.55) / 0.45) * Math.PI);
        orbit = eye * 1.4;
        pupil = now * 0.008;
      }
      if (u >= 1) {
        beatI += 1;
        beatAt = now;
      }
    } else if (beat === "mcap") {
      apart = 0;
      face = -1;
      const hopU = Math.min(1, u / 0.4);
      lift = hopU < 1 ? Math.sin(hopU * Math.PI) * hopPx : 0;
      eye = Math.sin(Math.min(1, u) * Math.PI);
      orbit = eye * 1.5;
      pupil = now * 0.01;
      if (u >= 1) {
        beatI += 1;
        beatAt = now;
      }
    } else if (beat === "read" && g.title) {
      apart = 0;
      face = -1;
      x = rightOf(g.title, w);
      const drawU = Math.min(1, u / 0.68);
      look = 0.2 + drawU * 1.6;
      head = 0.08 + drawU * 0.14;
      pick = 0.4 + drawU * 0.45;
      lineTo = g.title.left + (g.title.right - g.title.left) * drawU;
      lineA = u < 0.78 ? 1 : Math.max(0, 1 - (u - 0.78) / 0.22);
      if (u > 0.72) {
        const e = Math.sin(((Math.min(1, u) - 0.72) / 0.28) * Math.PI);
        eye = e;
        head = 0.16 + e * 0.2;
        pick = 0.7 * (1 - e);
      }
      if (u >= 1) {
        beatI += 1;
        beatAt = now;
      }
    } else if (beat === "home") {
      // In the niche: face the page, eyes down on it, and settle. Kayolo takes him from here.
      apart = 0;
      face = -1;
      x += (homeX(g) - x) * 0.3;
      if (restAt < 0) restAt = now;
    } else {
      // Parked past the search word: one look around, then he settles and the loop sleeps.
      const s = now - beatAt;
      const calm = smooth((s - SEEK_LOOK_MS + 700) / 700);
      apart = 0;
      face = -1;
      eye = 0.95 - 0.55 * calm;
      look = s < SEEK_LOOK_MS ? Math.sin(s / 880) * 1.55 : 0;
      head = look * 0.18;
      pupil = Math.min(s, SEEK_LOOK_MS) * 0.004;
      orbit = 0.55 * (1 - calm);
    }

    if (asking) {
      loop.again();
      return;
    }

    const spriteY = floor - lift;
    const box = root.getBoundingClientRect();
    scoutPose = { x: box.left + x, y: box.top + spriteY, face, roll };
    draw(ctx, root, g, x, spriteY, floor, lift, face, roll, apart, head, look, pick, eye, pupil, orbit, lineA, lineTo);
    // In the niche the slot is his button; the moving one goes (M1).
    if (beat === "home") placeHit(hit, false, 0, 0);
    else follow(spriteY);
    const parked = (beat === "seek" || beat === "home") && !askQueued;
    const since = beat === "home" ? Math.max(restAt, wokeAt) : Math.max(beatAt + SEEK_LOOK_MS, wokeAt);
    if (parked && settled(ctx, now, since)) {
      if (beat === "seek") {
        // The phone park: he looks around, then Kayolo takes him 1.6 s later (§9.8).
        if (restAt < 0) restAt = now;
        if (now - restAt < 1600) {
          // One timer, not frames, for the wait.
          window.setTimeout(() => loop.again(), 1600 - (now - restAt) + 8);
          return;
        }
      }
      const pose = { look: clamp(look, -2.1, 2.1), head, pick, eyeLift: eye * 2.2, eyeScale: 1 + eye * 0.34, pupil, pupilOrbit: orbit };
      if (giveBody(ctx, beat === "home" ? "nook" : "park", box.left + x, box.top + floor, face, pose)) {
        held = true;
        ctx.clearRect(0, 0, w, h);
      }
      return;
    }
    loop.again();
  };

  const loop = frameLoop(paint);
  const wake = () => {
    wokeAt = performance.now();
    loop.again();
  };
  wakeRef.current = wake;
  const unwake = wakeOn(root, wake, { scroll: () => emptyDrive != null, note: watchNotes ? emptyNote : undefined });
  loop.again();
  return () => {
    dead = true;
    loop.stop();
    unwake();
    offKeeper();
    window.removeEventListener("pointermove", onMove);
    if (watchNotes) releaseNotes();
    placeHit(hit, false, 0, 0);
  };
}

/**
 * Favorites empty slot. The same scout leaves whatever point he is on,
 * drops to the line, and scratches it out with the pick.
 */
function runFavoritesErrand(canvas: HTMLCanvasElement, header: HTMLElement, wakeRef: { current: () => void }) {
  const prev = canvas.getAttribute("style");
  canvas.style.position = "fixed";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.zIndex = "30";

  let dead = false;
  let last = 0;
  let wokeAt = 0;
  let beatAt = 0;
  let ready = false;
  let x = scoutPose?.x ?? 80;
  let y = scoutPose?.y ?? 36;
  let roll = scoutPose?.roll ?? 0;
  let face: 1 | -1 = scoutPose?.face ?? 1;
  let apart = 0;
  let fromX = x;
  let fromY = y;
  let written = "";
  let aim: { x: number; y: number } | null = null;
  type Phase = "home" | "rail" | "drop" | "rollin" | "write" | "live" | "retreat" | "rise";
  let phase: Phase = "home";
  const wide = window.matchMedia(WIDE_QUERY).matches;
  const homeWhere: BodyWhere = wide ? "nook" : "park";
  /** Kayolo holds the body at home or by the note (M1): the scout draws nothing. */
  let held = false;
  let owned = false;
  const offKeeper = onKeeper(() => wake());

  let near = false;
  const onMove = (e: PointerEvent) => {
    aim = { x: e.clientX, y: e.clientY };
    if (held) return;
    // At rest his eyes follow a pointer within 140–160 px: wake for it, and once more as it leaves.
    const close = Math.hypot(e.clientX - x, e.clientY - y) < 220;
    if (close || near) wake();
    near = close;
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  const noteEl = () => document.querySelector<HTMLElement>("[data-fav-note]");

  const headerHome = () => {
    const slip = searchSlip(header);
    const y0 = slip?.floorY ?? header.getBoundingClientRect().bottom - 6;
    if (KAYOLO_LAYER && wide) {
      // Home is Kayolo's niche (Э1b).
      const n = nookNow();
      if (n) return { x: n.x, y: n.y };
    }
    const title = header.querySelector<HTMLElement>('[data-scout="title"]');
    const titleBox = title?.getBoundingClientRect();
    const x0 = titleBox && titleBox.width > 2 ? titleBox.left - 40 : slip?.parkX ?? x;
    return { x: x0, y: y0 };
  };

  const standAt = (note: HTMLElement) => {
    const r = note.getBoundingClientRect();
    return { x: r.left - 34, y: r.bottom - 2, rect: r };
  };

  const barLeft = () => header.getBoundingClientRect().left + 28;

  /** Words in the bar. The body rolls under them; the eyes lift off, same as the toolbar pass. */
  const underBar = (px: number) => {
    const nodes = header.querySelectorAll<HTMLElement>("[data-scout]");
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (px > r.left - 16 && px < r.right + 16) return true;
    }
    return false;
  };

  const beginTrip = (now: number) => {
    phase = "rail";
    beatAt = now;
    written = "";
    const note = noteEl();
    if (note) claimNote(note);
  };

  const paint = (now: number) => {
    if (dead) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ready) {
      const home = headerHome();
      if (!scoutPose) {
        x = home.x;
        y = home.y;
      }
      beatAt = now;
      last = now;
      ready = true;
      const waiting = noteEl();
      if (KAYOLO_LAYER && !waiting && kayoloHolds() === homeWhere) {
        // Already at home with Kayolo: nothing to do until a note appears.
        held = true;
        owned = true;
        x = home.x;
        y = home.y;
      }
      if (waiting) beginTrip(now);
    }
    if (!owned) {
      owned = true;
      const p = takeBody(ctx);
      if (p) {
        x = p.x;
        y = p.y;
        face = p.face;
      }
    }
    const dt = Math.min(34, now - last);
    last = now;
    const note = noteEl();
    const line = note?.getAttribute("data-fav-note") ?? "";

    let head = 0;
    let look = 0.4;
    let pick = 0.12;
    let eye = 0.12;
    let eyeScale = 1;
    let pupil = now * 0.0014;
    let orbit = 0.3;

    if (phase === "home") {
      const home = headerHome();
      x += (home.x - x) * 0.12;
      y += (home.y - y) * 0.12;
      roll += Math.abs(home.x - x) * 0.02;
      const blink = now % 2700;
      eyeScale = blink < 80 ? 1 - Math.sin((blink / 80) * Math.PI) * 0.85 : 1;
      look = Math.sin(now / 1400) * 0.7;
      head = look * 0.16;
      pick = 0.1 + Math.sin(now / 1600) * 0.04;
      if (aim && Math.hypot(aim.x - x, aim.y - y) < 140) {
        look = clamp((aim.x - x) / 22, -1.3, 1.3);
        eye = 0.35;
      }
      if (note) beginTrip(now);
    } else if (phase === "rail") {
      if (!note) {
        phase = "home";
      } else {
        const floorY = headerHome().y;
        const leftX = barLeft();
        y += (floorY - y) * 0.4;
        const d = leftX - x;
        face = -1;
        const step = Math.sign(d) * Math.min(Math.abs(d), (260 * dt) / 1000);
        x += step;
        roll += Math.abs(step) * 0.55;
        const under = underBar(x);
        apart += ((under ? 1 : 0) - apart) * 0.22;
        look = under ? 0.12 : 0.35;
        head = under ? 0.04 : 0;
        pick = 0.08;
        if (Math.abs(d) < 1.5 && Math.abs(floorY - y) < 2) {
          x = leftX;
          y = floorY;
          apart = 0;
          phase = "drop";
          beatAt = now;
          fromY = y;
        }
      }
    } else if (phase === "drop" && note) {
      const stand = standAt(note);
      const u = Math.min(1, (now - beatAt) / 460);
      const k = smooth(u);
      x = barLeft();
      y = fromY + (stand.y - fromY) * k;
      apart += (0 - apart) * 0.2;
      look = 0.2;
      pupil = Math.PI / 2;
      orbit = 0.9;
      roll += (dt / 16) * (1 - k) * 1.4;
      face = 1;
      if (u >= 1) {
        y = stand.y;
        phase = "rollin";
        beatAt = now;
      }
    } else if (phase === "rollin" && note) {
      const stand = standAt(note);
      const d = stand.x - x;
      face = d >= 0 ? 1 : -1;
      const step = Math.sign(d) * Math.min(Math.abs(d), (220 * dt) / 1000);
      x += step;
      y += (stand.y - y) * 0.45;
      roll += Math.abs(step) * 0.55;
      apart = 0;
      look = 0.55;
      pick = 0.1;
      if (Math.abs(d) < 1.5) {
        x = stand.x;
        y = stand.y;
        phase = "write";
        beatAt = now;
        written = line;
        note.style.setProperty("--scratch", "0");
      }
    } else if (phase === "write" && note) {
      const stand = standAt(note);
      const elapsed = now - beatAt;
      const WRITE = 760;
      const u = Math.min(1, elapsed / WRITE);
      const scratch = smooth(u);
      note.style.setProperty("--scratch", scratch.toFixed(3));
      const tip = stand.rect.left - 34 + stand.rect.width * scratch * 0.18;
      const nx = x + (tip - x) * 0.2;
      roll += Math.abs(nx - x) * 0.5;
      x = nx;
      y += (stand.y - y) * 0.25;
      face = 1;
      const stroke = Math.sin(Math.min(1, u) * Math.PI * 2);
      pick = 0.14 + Math.abs(stroke) * 0.9;
      look = 1.05;
      head = 0.12 + Math.abs(stroke) * 0.08;
      eye = 0.55 + Math.abs(stroke) * 0.35;
      apart = 0;
      if (u >= 1) {
        note.style.setProperty("--scratch", "1");
        phase = "live";
        beatAt = now;
        pick = 0.16;
      }
    } else if (phase === "live" && note) {
      const stand = standAt(note);
      x += (stand.x - x) * 0.08;
      y += (stand.y + Math.sin(now / 900) * 0.7 - y) * 0.2;
      face = 1;
      const blink = (now - beatAt) % 2600;
      eyeScale = blink < 90 ? 1 - Math.sin((blink / 90) * Math.PI) * 0.86 : 1;
      look = 0.85 + Math.sin(now / 1700) * 0.28;
      head = 0.1 + Math.sin(now / 1700) * 0.05;
      pick = 0.14 + Math.sin(now / 1100) * 0.05;
      eye = 0.22;
      if (aim && Math.hypot(aim.x - x, aim.y - (y - 18)) < 160) {
        const pull = 1 - Math.hypot(aim.x - x, aim.y - y) / 160;
        look = clamp((aim.x - x) / 20, -1.2, 1.4);
        eye = 0.22 + pull * 0.4;
        pick = 0.14 + pull * 0.12;
      }
      if (line !== written) {
        written = line;
        note.style.setProperty("--scratch", "0");
        phase = "write";
        beatAt = now;
        eyeScale = 1.2;
      }
    } else if (phase === "retreat") {
      const leftX = barLeft();
      const d = leftX - x;
      face = d >= 0 ? 1 : -1;
      const step = Math.sign(d) * Math.min(Math.abs(d), (240 * dt) / 1000);
      x += step;
      roll += Math.abs(step) * 0.5;
      apart = 0;
      if (Math.abs(d) < 1.5) {
        x = leftX;
        phase = "rise";
        beatAt = now;
        fromY = y;
      }
    } else if (phase === "rise") {
      const homeY = headerHome().y;
      const u = Math.min(1, (now - beatAt) / 480);
      const k = smooth(u);
      x = barLeft();
      y = fromY + (homeY - fromY) * k;
      apart += (0 - apart) * 0.2;
      look = -0.15;
      pupil = -Math.PI / 2;
      orbit = 0.7;
      roll += (dt / 16) * k;
      if (u >= 1) {
        y = homeY;
        phase = "home";
        beatAt = now;
      }
    } else if (!note) {
      phase = "retreat";
      beatAt = now;
    }

    const restingHere = phase === "home" || phase === "live";
    if (held && !restingHere) {
      // Off to the note (or back): the body comes back in this frame.
      held = false;
      takeBody(ctx);
    }
    if (held) {
      if (phase === "live" && note) {
        const stand = standAt(note);
        x = stand.x;
        y = stand.y;
      } else if (phase === "home") {
        const home = headerHome();
        x = home.x;
        y = home.y;
      }
      if (kayoloHolds() !== "nook") moveBody({ x, y });
      return;
    }
    const floor = y;
    const air = phase === "drop" || phase === "rise" ? 0.45 : 0;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.18 * (1 - air)})`;
    ctx.beginPath();
    ctx.ellipse(x, floor + 1, 12, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    scoutPose = { x, y: floor, face, roll };
    const bodyPose = { head, look: clamp(look, -2.1, 2.1), pick, eyesApart: apart, eyeLift: eye * 2.2, eyeScale, pupil, pupilOrbit: orbit };
    drawScout(ctx, {
      ...bodyPose,
      x: clamp(x, 16, w - 16),
      y: floor,
      roll,
      face,
      scale: SCALE,
      mood: phase === "write" ? "work" : phase === "drop" ? "surprised" : phase === "retreat" ? "happy" : phase === "live" ? "curious" : "idle",
    });
    // By the title or by the written line: once still, no frames until an event.
    const blinking = phase === "home" ? now % 2700 < 80 : phase === "live" ? (now - beatAt) % 2600 < 90 : false;
    if (restingHere && !blinking && settled(ctx, now, Math.max(beatAt, wokeAt))) {
      // Still: Kayolo lives in him from here (M1); the canvas is cleared in this frame.
      if (giveBody(ctx, phase === "live" ? "note" : homeWhere, x, floor, face, bodyPose)) {
        held = true;
        ctx.clearRect(0, 0, w, h);
      }
      return;
    }
    loop.again();
  };

  const loop = frameLoop(paint);
  const wake = () => {
    wokeAt = performance.now();
    loop.again();
  };
  wakeRef.current = wake;
  const unwake = wakeOn(header, wake, { scroll: () => true, note: noteEl });
  loop.again();
  return () => {
    dead = true;
    loop.stop();
    unwake();
    offKeeper();
    window.removeEventListener("pointermove", onMove);
    releaseNotes();
    if (prev == null) canvas.removeAttribute("style");
    else canvas.setAttribute("style", prev);
  };
}

export function HeaderScout() {
  const path = usePathname();
  const { t, locale } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef(false);
  /** «Call him home» from Kayolo's window during the tour (the door uses leaveRef). */
  const homeRef = useRef(false);
  const machineRef = useRef<"perch" | "pass" | "errand" | null>(null);
  /** The running pass sleeps when parked; a click on him or a rent answer wakes it. */
  const wakeRef = useRef<() => void>(() => {});
  // Live media: a changed motion setting restarts him; on address pages so does crossing 1024 px.
  const reduceTick = useMediaTick(REDUCE_QUERY);
  const wideTick = useMediaTick(WIDE_QUERY);
  const perchTick = isAddressHome(path) ? wideTick : 0;

  useEffect(
    () =>
      onKayolo((ev) => {
        if (ev.k === "kayolo:call-home") {
          if (machineRef.current === "perch") leaveRef.current = true;
          else homeRef.current = true;
          wakeRef.current();
          return;
        }
        // Home celebrates in the live-blocks yard; he is not in the bar there. Kayolo answers it
        // himself when he holds the body.
        if (ev.k !== "chain:rare" || window.location.pathname === "/" || kayoloHolds()) return;
        rareCalledAt = performance.now();
        wakeRef.current();
      }),
    []
  );

  useEffect(() => {
    leaveRef.current = false;
    homeRef.current = false;
    machineRef.current = null;
    wakeRef.current = () => {};
    if (path === "/") {
      perchedOnAddresses = false;
      returnedToHeader = false;
      addressPassed = false;
      rentTold = "";
      if (bodyOwner() === "scout") setOwner("none");
      return;
    }
    const canvas = ref.current;
    const root = canvas?.parentElement;
    if (!canvas || !root) return;
    if (window.matchMedia(REDUCE_QUERY).matches || (KAYOLO_LAYER && currentMode() !== "live")) {
      // No scout under reduced motion (or in «Тихий» and the quieter modes): Kayolo keeps him at
      // home, still. Switched on live, the last frame must not stay behind.
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      placeHit(hitRef.current, false, 0, 0);
      if (bodyOwner() === "scout") setOwner("none");
      return;
    }
    const wide = window.matchMedia(WIDE_QUERY).matches;
    const layer = KAYOLO_LAYER;
    // The gate (§7.1, §9.8 M1): a tour only when one is due, once per arrival.
    const arrival = layer ? arrive(path) : null;
    const tour = !!arrival && arrival.tour && tourRanFor !== path;
    if (tour) tourRanFor = path;
    const midPass = layer && bodyOwner() === "scout" && scoutPose != null;
    const kayolo = { nook: layer && wide, homeRef };
    const homeLabel = t("kayolo.home");
    const askLabel = t("kayolo.ask");
    const addressId = addressIdOf(path);
    if (!addressId) rentTold = "";
    else if (rentTold && rentTold !== addressId) rentTold = "";
    const blocks = { current: undefined as number | null | undefined };
    let cancelRent = false;
    if (addressId && wide && !returnedToHeader) {
      void lookupScoutRent(addressId).then((n) => {
        if (cancelRent) return;
        blocks.current = n;
        wakeRef.current();
      });
    }
    const scratch = (n: number) =>
      rentScratch(
        n,
        {
          danger: t("scout.rentDanger"),
          what: t("scout.rentWhat"),
          due: t("scout.rentDue"),
        },
        locale === "ru" ? "ru" : "en"
      );
    let stopPerch = () => {};
    let stopPass = () => {};
    if (isAddressHome(path) && wide && !returnedToHeader) {
      machineRef.current = "perch";
      stopPerch = runAddressPerch(canvas, hitRef.current, leaveRef, homeLabel, (vx) => {
        const local = vx - root.getBoundingClientRect().left;
        machineRef.current = "pass";
        stopPass = runHeaderPass(canvas, root, hitRef.current, leaveRef, askLabel, {
          from: "after-fall",
          x: local,
          markDone: true,
        }, wakeRef, true, kayolo);
      }, { addressId, blocks, scratch }, wakeRef);
      return () => {
        cancelRent = true;
        stopPerch();
        stopPass();
      };
    }
    if (!(isAddressHome(path) && wide)) {
      perchedOnAddresses = false;
      returnedToHeader = false;
      addressPassed = false;
      rentTold = "";
    }
    placeHit(hitRef.current, false, 0, 0);
    if (path === "/favorites") {
      machineRef.current = "errand";
      return runFavoritesErrand(canvas, root, wakeRef);
    }
    // Kayolo is held where this page does not keep him (the door after leaving Addresses): home.
    const holds = kayoloHolds();
    if (layer && holds && holds !== (wide ? "nook" : "park") && !tour) sendHome();
    machineRef.current = "pass";
    const local = (vx: number) => vx - root.getBoundingClientRect().left;
    let from: PassFrom;
    let x: number | undefined;
    if (isAddressHome(path) && wide) from = addressPassed ? (layer ? "rest" : "seek") : "after-fall";
    else if (!layer) from = "start";
    else if (tour) {
      // The first show in a session falls in; later tours start where he is.
      from = arrival?.first && !midPass && !holds ? "start" : "nook";
      if (midPass && scoutPose) x = local(scoutPose.x);
    } else if (midPass && scoutPose) {
      from = "walk-home";
      x = local(scoutPose.x);
    } else from = "rest";
    if (from === "rest") {
      // Nothing to draw: Kayolo has him at home (or takes him there). The last frame must go.
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      if (bodyOwner() === "scout") setOwner("none");
    }
    return runHeaderPass(canvas, root, hitRef.current, leaveRef, askLabel, {
      from,
      x,
      markDone: isAddressHome(path) && wide,
    }, wakeRef, isAddressHome(path), kayolo);
  }, [path, locale, t, reduceTick, perchTick]);

  if (path === "/") return null;
  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        className="header-scout pointer-events-none absolute inset-0 z-10 h-full w-full"
      />
      <button
        ref={hitRef}
        type="button"
        tabIndex={-1}
        aria-label={t("kayolo.home")}
        className="header-scout pointer-events-none fixed z-20 h-14 w-[52px] cursor-pointer rounded-full border-0 bg-transparent p-0 opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          leaveRef.current = true;
          wakeRef.current();
        }}
        onClick={() => {
          leaveRef.current = true;
          wakeRef.current();
        }}
      />
    </>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  root: HTMLElement,
  g: World,
  x: number,
  y: number,
  floor: number,
  lift: number,
  face: 1 | -1,
  roll: number,
  apart: number,
  head: number,
  look: number,
  pick: number,
  eye: number,
  pupil: number,
  orbit: number,
  lineA: number,
  lineTo: number
) {
  if (lineA > 0.02 && g.title) {
    const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#3ca2ff";
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = clamp(lineA, 0, 1);
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(g.title.left, g.title.bottom + 3);
    ctx.lineTo(Math.max(g.title.left, lineTo), g.title.bottom + 3);
    ctx.stroke();
    ctx.restore();
  }
  const air = Math.min(1, lift / HOP);
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${0.2 * (1 - air * 0.65)})`;
  ctx.beginPath();
  ctx.ellipse(x, floor + 1, 12 * (1 + air * 0.3), 2.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawScout(ctx, {
    x: clamp(x, 16, g.w - 16),
    y,
    head,
    look: clamp(look, -2.1, 2.1),
    pick,
    roll,
    face,
    scale: SCALE,
    eyesApart: apart,
    eyeLift: eye * 2.2,
    eyeScale: 1 + eye * 0.34,
    pupil,
    pupilOrbit: orbit,
  });
}

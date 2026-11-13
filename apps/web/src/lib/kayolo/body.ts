/**
 * One body (design/brand/kayolo-life.md §9.4, §9.8 M1). The header scout walks him (the pass, the
 * address door, the notes); Kayolo lives in him at rest. Who draws is decided here, synchronously,
 * so a hand-over happens inside one task and no frame shows two bodies:
 *
 * - `handoff(pose)`: the scout is parked and offers the body; Kayolo draws it at once at the same
 *   point with the same face (`adoptPixelState`) and says `kayolo:took`; then the scout clears.
 * - `reclaim()`: the scout needs to move again (a tour is due, a click at the door, a note to
 *   write); Kayolo stops drawing at once and hands back where and how he is (`kayolo:release`).
 * - `moveBody()`: the scout's resting point moved (scroll by a note, the window resized).
 *
 * The keeper registers when the lazy layer loads; until then the scout keeps the body as in Э1a.
 * The gate for the tour lives here too, so both sides read the same answer.
 */

import type { PixelPose, PixelState } from "@/components/pixel";
import { say, type BodyWhere } from "./events";
import { KAYOLO_LAYER, TOUR_GAP_MS } from "./thresholds";
import { modeOf, pageMemory, readMode, sectionOf, type Mode } from "./memory";

export type BodyPose = {
  /** Ground point under his middle, viewport px. */
  x: number;
  y: number;
  face: 1 | -1;
  where: BodyWhere;
  /** Face fields of the last frame (look, head, eyes): he eases out of them. */
  pose?: Partial<PixelPose>;
  state: PixelState | null;
  color?: string;
};

export type Keeper = {
  take(p: BodyPose): boolean;
  move(p: { x: number; y: number; face?: 1 | -1 }): void;
  give(): BodyPose | null;
  /** Where he is while Kayolo holds him; null when the scout does. */
  where(): BodyWhere | null;
  /** He is held at a place this page has no use for (the door after leaving Addresses): go home. */
  home(): void;
};

/**
 * Who draws the body right now. «none»: nobody (his window shows the still frame, or Kayolo takes
 * him home by himself). The scout says «scout» when it starts drawing and «none» when it stops.
 */
export type Owner = "none" | "scout" | "kayolo";
let owner: Owner = "none";
const ownerSubs = new Set<(o: Owner) => void>();

export function bodyOwner(): Owner {
  return owner;
}

export function setOwner(o: Owner) {
  if (o === owner) return;
  owner = o;
  for (const fn of [...ownerSubs]) {
    try {
      fn(o);
    } catch {
      /* a listener failed: the body still has one owner */
    }
  }
}

export function onOwner(fn: (o: Owner) => void): () => void {
  ownerSubs.add(fn);
  return () => ownerSubs.delete(fn);
}

let keeper: Keeper | null = null;
const keeperWaiters = new Set<() => void>();

/** The lazy layer registers here (null on unmount). Parked scouts waiting for it are woken. */
export function setKeeper(k: Keeper | null) {
  keeper = KAYOLO_LAYER ? k : null;
  if (keeper) for (const w of [...keeperWaiters]) w();
}

/** Called when the keeper arrives. Returns the cleanup. */
export function onKeeper(fn: () => void): () => void {
  keeperWaiters.add(fn);
  return () => keeperWaiters.delete(fn);
}

/** Where Kayolo holds the body, or null when the scout has it (or nobody yet). */
export function kayoloHolds(): BodyWhere | null {
  return keeper?.where() ?? null;
}

export function hasKeeper(): boolean {
  return keeper != null;
}

/** The parked scout offers the body. True: Kayolo draws it now, the scout must clear in this task. */
export function handoff(p: BodyPose): boolean {
  if (!keeper) return false;
  let ok = false;
  try {
    ok = keeper.take(p);
  } catch {
    ok = false;
  }
  if (ok) {
    setOwner("kayolo");
    say({ k: "kayolo:took", where: p.where });
  }
  return ok;
}

/** The scout takes the body back. Kayolo has already stopped drawing when this returns a pose. */
export function reclaim(): BodyPose | null {
  if (!keeper || keeper.where() == null) return null;
  let p: BodyPose | null = null;
  try {
    p = keeper.give();
  } catch {
    p = null;
  }
  if (p) {
    setOwner("scout");
    say({ k: "kayolo:release", x: p.x, y: p.y, face: p.face, where: p.where });
  }
  return p;
}

export function moveBody(p: { x: number; y: number; face?: 1 | -1 }) {
  try {
    keeper?.move(p);
  } catch {
    /* the layer went away: the scout keeps its own pose */
  }
}

/* ---------------- his window's place ---------------- */

/** Where his window puts the body at home, viewport px (ground point under his middle). */
export type SlotPlace = { x: number; y: number; face: 1 | -1 };
let slot: SlotPlace | null = null;
const slotSubs = new Set<(p: SlotPlace | null, was: SlotPlace | null) => void>();

export function slotPlace(): SlotPlace | null {
  return slot;
}

/** The window moved to a new title edge (or went away). Listeners walk him over. */
export function setSlotPlace(p: SlotPlace | null) {
  const was = slot;
  if (p && was && Math.abs(p.x - was.x) < 0.5 && Math.abs(p.y - was.y) < 0.5 && p.face === was.face) return;
  slot = p;
  for (const fn of [...slotSubs]) {
    try {
      fn(p, was);
    } catch {
      /* */
    }
  }
}

export function onSlotPlace(fn: (p: SlotPlace | null, was: SlotPlace | null) => void): () => void {
  slotSubs.add(fn);
  return () => slotSubs.delete(fn);
}

/** Kayolo holds him somewhere this page does not keep him: he goes home by himself. */
export function sendHome() {
  try {
    keeper?.home();
  } catch {
    /* */
  }
}

/* ---------------- mode ---------------- */

function local() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The mode in force now (stored choice, else «Тихий» under reduced motion). */
export function currentMode(): Mode {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return modeOf(readMode(local), reduce);
}

/* ---------------- the tour gate (§7.1) ---------------- */

export type TourInput = {
  path: string;
  mode: Mode;
  reduce: boolean;
  /** He was already shown in this tab's session. */
  shown: boolean;
  /** This section was already entered today. */
  seenToday: boolean;
  lastTourMs: number;
  nowMs: number;
  pointerInHeader: boolean;
};

/**
 * A tour is due on the first show in a session or the first entry to a section today, at least
 * 10 min after the last one, in «Живой», not on home and not while the pointer is in the header.
 */
export function tourDue(i: TourInput): boolean {
  if (i.path === "/" || i.mode !== "live" || i.reduce || i.pointerInHeader) return false;
  if (i.shown && i.seenToday) return false;
  return i.nowMs - i.lastTourMs >= TOUR_GAP_MS;
}

let pointerY = -1;
let pointerWatch = false;

function watchPointer() {
  if (pointerWatch || typeof window === "undefined") return;
  pointerWatch = true;
  const note = (e: PointerEvent) => {
    pointerY = e.clientY;
  };
  window.addEventListener("pointermove", note, { passive: true });
  window.addEventListener("pointerdown", note, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => {
    pointerY = -1;
  });
}

function pointerInHeader(): boolean {
  if (pointerY < 0) return false;
  const h = document.querySelector("header");
  return !!h && pointerY <= h.getBoundingClientRect().bottom;
}

type Arrival = { path: string; tour: boolean; first: boolean };
let arrival: Arrival | null = null;

/**
 * One answer per arrival on a path (re-runs on the same path, a locale change, get the same one).
 * `first`: he has not been shown in this tab's session yet, so a tour starts with the fall.
 * Records the section as seen and, when the tour is due, the tour itself.
 */
export function arrive(path: string): Arrival {
  watchPointer();
  if (arrival?.path === path) return arrival;
  const mem = pageMemory();
  const sec = sectionOf(path);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const first = !mem.shown();
  const tour = tourDue({
    path,
    mode: currentMode(),
    reduce,
    shown: !first,
    seenToday: mem.sectionSeenToday(sec),
    lastTourMs: mem.lastTour(),
    nowMs: Date.now(),
    pointerInHeader: pointerInHeader(),
  });
  if (path !== "/") {
    mem.noteSection(sec);
    mem.markShown();
    if (tour) mem.noteTour();
    else mem.flush();
  }
  arrival = { path, tour, first };
  return arrival;
}

/** The arrival answer for this path, if `arrive` already ran for it. */
export function arrivalOf(path: string): Arrival | null {
  return arrival?.path === path ? arrival : null;
}

/**
 * E20, rare heights (design/brand/kayolo-life.md §8.2, stage Э0). Fires on crossing
 * `prev < H ≤ cur`, so a catch-up or a reconnect does not miss H, and once ever: shown heights
 * live in localStorage `kayolo.v1` (field `rare`). Whoever opens a page within 30 min after H
 * sees it too. A hidden tab counts quietly and celebrates when it is shown, if the window is
 * still open. No requests: heights come from the stream PageSync already reads.
 */

import { say as busSay, type KayoloEvent, type RareKind } from "./events";

/** How long after the block a newcomer still gets the celebration. */
export const RARE_WINDOW_MS = 30 * 60_000;
/** Ergo aims at 2 min; the stream's own average (fees.histogram) replaces it. */
const DEFAULT_INTERVAL_MS = 120_000;
/** Planned emission: the reward steps down every 64 800 blocks from 525 600 and ends at 2 080 800. */
const STEP_FROM = 525_600;
const STEP_EVERY = 64_800;
export const EMISSION_END = 2_080_800;
/** Э0 celebrates the 10k steps only; the other kinds wait for Э7. */
export const RARE_LIVE: ReadonlySet<RareKind> = new Set<RareKind>(["10k"]);

const STORE_KEY = "kayolo.v1";
const RARE_CAP = 8;

export function rareKind(h: number): RareKind | null {
  if (!Number.isInteger(h) || h <= 0) return null;
  if (h % 100_000 === 0) return "100k";
  if (h === EMISSION_END) return "emission-end";
  if (h >= STEP_FROM && h < EMISSION_END && (h - STEP_FROM) % STEP_EVERY === 0) return "emission-step";
  if (h % 10_000 === 0) return "10k";
  return null;
}

/** Rare heights H with lo < H ≤ hi, lowest first. */
export function rareBetween(lo: number, hi: number): number[] {
  const out = new Set<number>();
  if (!(hi > lo)) return [];
  for (let h = (Math.floor(lo / 10_000) + 1) * 10_000; h <= hi; h += 10_000) out.add(h);
  const k = Math.floor((lo - STEP_FROM) / STEP_EVERY) + 1;
  for (let h = STEP_FROM + Math.max(0, k) * STEP_EVERY; h <= hi && h <= EMISSION_END; h += STEP_EVERY) {
    if (h > lo) out.add(h);
  }
  return [...out].filter((h) => rareKind(h) != null).sort((a, b) => a - b);
}

type Store = Pick<Storage, "getItem" | "setItem">;

function readMemory(store: () => Store | null): Record<string, unknown> {
  try {
    const raw = store()?.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function shownIn(mem: Record<string, unknown>): number[] {
  return Array.isArray(mem.rare) ? mem.rare.filter((h): h is number => Number.isInteger(h)) : [];
}

/** Read, merge, write: another tab's fields stay as they are. */
function remember(store: () => Store | null, height: number) {
  try {
    const mem = readMemory(store);
    const rare = [...new Set([...shownIn(mem), height])].sort((a, b) => a - b).slice(-RARE_CAP);
    store()?.setItem(STORE_KEY, JSON.stringify({ ...mem, v: 1, rare }));
  } catch {
    /* full or blocked storage: this session still remembers */
  }
}

export type RareDeps = {
  say?: (ev: KayoloEvent) => void;
  /** Monotonic ms (performance.now in the page). */
  now: () => number;
  visible: () => boolean;
  storage: () => Store | null;
  live?: ReadonlySet<RareKind>;
};

export function createRareSense(deps: RareDeps) {
  const say = deps.say ?? busSay;
  const live = deps.live ?? RARE_LIVE;
  let prev: number | null = null;
  let avgMs = DEFAULT_INTERVAL_MS;
  /** Age of the tip when the stream opened (server and miner clocks, not the browser's). */
  let tipAgeMs = 0;
  let mock = false;
  const shownHere = new Set<number>();
  let pending: { height: number; what: RareKind; ageMs: number; at: number } | null = null;

  const shown = (h: number) => shownHere.has(h) || shownIn(readMemory(deps.storage)).includes(h);

  const fire = () => {
    if (!pending || !deps.visible()) return;
    const p = pending;
    pending = null;
    if (p.ageMs + (deps.now() - p.at) > RARE_WINDOW_MS || shown(p.height)) return;
    shownHere.add(p.height);
    remember(deps.storage, p.height);
    say({ k: "chain:rare", height: p.height, what: p.what });
  };

  const height = (cur: number) => {
    if (mock || !Number.isInteger(cur) || cur <= 0) return;
    const first = prev == null;
    if (prev != null && cur <= prev) return;
    const lo = prev ?? cur - Math.ceil(RARE_WINDOW_MS / avgMs) - 1;
    prev = cur;
    const hit = rareBetween(lo, cur).filter((h) => live.has(rareKind(h)!)).pop();
    if (hit == null) return;
    const ageMs = (cur - hit) * avgMs + (first ? tipAgeMs : 0);
    if (ageMs > RARE_WINDOW_MS || shown(hit)) return;
    pending = { height: hit, what: rareKind(hit)!, ageMs, at: deps.now() };
    fire();
  };

  return {
    /** A raw stream message: chain.tip and block.sealed heights, the interval, the mock flag. */
    feed(msg: unknown) {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: unknown; data?: Record<string, unknown> | null };
      const data = m.data && typeof m.data === "object" ? m.data : null;
      if (m.type === "hello") {
        mock = data?.mock === true;
        return;
      }
      if (m.type === "fees.histogram") {
        const eta = data?.eta as { avgIntervalMs?: unknown; lastBlockTs?: unknown } | undefined;
        const avg = Number(eta?.avgIntervalMs);
        if (Number.isFinite(avg) && avg >= 20_000 && avg <= 20 * 60_000) avgMs = avg;
        const age = Number(data?.ts) - Number(eta?.lastBlockTs);
        if (prev == null && Number.isFinite(age)) tipAgeMs = Math.min(RARE_WINDOW_MS, Math.max(0, age));
        return;
      }
      if (m.type === "chain.tip" || m.type === "block.sealed") height(Number(data?.height));
    },
    height,
    /** The tab is shown again: a waiting celebration plays if its 30 min are not over. */
    resume: fire,
  };
}

let page: ReturnType<typeof createRareSense> | null = null;

/** PageSync hands every stream message here. Browser only; never throws. */
export function feedRare(msg: unknown) {
  if (typeof window === "undefined") return;
  try {
    if (!page) {
      page = createRareSense({
        now: () => performance.now(),
        visible: () => document.visibilityState === "visible",
        storage: () => window.localStorage,
      });
      document.addEventListener("visibilitychange", () => page?.resume());
    }
    page.feed(msg);
  } catch {
    /* the celebration is never worth a broken stream */
  }
}

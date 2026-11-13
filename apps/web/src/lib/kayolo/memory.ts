/**
 * Kayolo's memory, browser only (design/brand/kayolo-life.md §5). Nothing goes to the server.
 *
 * - `kayolo.v1.mode` and `kayolo.v1.home`: the person's choices. Only a person's action writes them
 *   (the panel and /settings come in Э2); the `storage` event applies them in every tab.
 * - `kayolo.v1`: counters, at most 2 KB. Always read → merge → write, on pagehide and hidden, else
 *   at most once a minute: times take the max, counters add this tab's growth since its last write,
 *   lists join. Two tabs never wipe each other. Other fields (Э0's `rare`) are kept as they are.
 * - sessionStorage `kayolo.s`: he was already shown in this tab's session.
 * Every storage access is in try/catch; without storage the defaults live in memory.
 */

export type Mode = "live" | "calm" | "asleep" | "hidden" | "off";
export type Home = "r" | "l" | "p";

export const MODE_KEY = "kayolo.v1.mode";
export const HOME_KEY = "kayolo.v1.home";
export const MEMORY_KEY = "kayolo.v1";
export const SESSION_KEY = "kayolo.s";
export const MEMORY_MAX = 2048;
const SECS_MAX = 24;
const COUNT_MAX = 9999;
const FLUSH_MS = 60_000;

type Store = Pick<Storage, "getItem" | "setItem">;

function get(store: () => Store | null, key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(store: () => Store | null, key: string, value: string): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function parseMode(v: string | null): Mode | null {
  return v === "live" || v === "calm" || v === "asleep" || v === "hidden" || v === "off" ? v : null;
}

export function parseHome(v: string | null): Home | null {
  return v === "r" || v === "l" || v === "p" ? v : null;
}

export function readMode(store: () => Store | null): Mode | null {
  return parseMode(get(store, MODE_KEY));
}

export function readHome(store: () => Store | null): Home | null {
  return parseHome(get(store, HOME_KEY));
}

/** A person's choice only (a click that wakes him from «Спит», the panel, /settings). */
export function writeMode(store: () => Store | null, mode: Mode): void {
  set(store, MODE_KEY, mode);
}

/** The mode in force: the stored choice, else «Тихий» under reduced motion, else «Живой». */
export function modeOf(stored: Mode | null, reduce: boolean): Mode {
  return stored ?? (reduce ? "calm" : "live");
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The section of a path: its first segment ("/block/9" → "block"); "" for home. */
export function sectionOf(path: string): string {
  return path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
}

export type Memory = Record<string, unknown> & {
  v?: number;
  first?: string;
  last?: number;
  days?: number;
  day?: string;
  secs?: string[];
  tour?: number;
  pokes?: number;
};

export function parseMemory(raw: string | null): Memory {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Memory) : {};
  } catch {
    return {};
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** This tab's view: what it learned since it last wrote. */
export type Draft = { first?: string; last?: number; day?: string; secs: string[]; tour?: number; pokes: number; newDay: boolean };

/**
 * Disk + this tab. Times and days take the max, counters add the tab's growth, today's sections
 * join (a later day starts the list again). Unknown fields stay.
 */
export function mergeMemory(disk: Memory, mine: Draft): Memory {
  const out: Memory = { ...disk, v: 1 };
  const firstDisk = typeof disk.first === "string" ? disk.first : undefined;
  out.first = firstDisk && mine.first ? (firstDisk < mine.first ? firstDisk : mine.first) : (firstDisk ?? mine.first);
  if (!out.first) delete out.first;
  const last = Math.max(num(disk.last), mine.last ?? 0);
  if (last) out.last = last;
  const tour = Math.max(num(disk.tour), mine.tour ?? 0);
  if (tour) out.tour = tour;
  const dayDisk = typeof disk.day === "string" ? disk.day : "";
  const day = mine.day && mine.day > dayDisk ? mine.day : dayDisk;
  if (day) {
    out.day = day;
    const join = [...(dayDisk === day ? strs(disk.secs) : []), ...(mine.day === day ? mine.secs : [])];
    out.secs = [...new Set(join)].slice(-SECS_MAX);
  }
  const days = num(disk.days) + (mine.newDay && day !== dayDisk ? 1 : 0);
  if (days) out.days = Math.min(COUNT_MAX, days);
  const pokes = Math.min(COUNT_MAX, num(disk.pokes) + mine.pokes);
  if (pokes) out.pokes = pokes;
  return out;
}

export type MemoryDeps = {
  local: () => Store | null;
  session: () => Store | null;
  /** Wall clock, ms. */
  now: () => number;
};

export function createMemory(deps: MemoryDeps) {
  let draft: Draft = { secs: [], pokes: 0, newDay: false };
  let wroteAt = -Infinity;
  /** No session storage: this module remembers the session. */
  let shownHere = false;

  const disk = () => parseMemory(get(deps.local, MEMORY_KEY));
  const view = () => mergeMemory(disk(), draft);

  const flush = (force = false) => {
    const t = deps.now();
    if (!force && t - wroteAt < FLUSH_MS) return;
    const merged = mergeMemory(disk(), { ...draft, last: Math.floor(t / 1000) });
    let text = JSON.stringify(merged);
    if (text.length > MEMORY_MAX) {
      merged.secs = (merged.secs ?? []).slice(-4);
      text = JSON.stringify(merged);
    }
    if (text.length <= MEMORY_MAX && set(deps.local, MEMORY_KEY, text)) {
      wroteAt = t;
      draft = { day: draft.day, secs: [], pokes: 0, newDay: false };
    }
  };

  return {
    view,
    /** He has been shown in this tab's session already (F5 keeps it). */
    shown(): boolean {
      return shownHere || get(deps.session, SESSION_KEY) === "1";
    },
    markShown() {
      shownHere = true;
      set(deps.session, SESSION_KEY, "1");
    },
    sectionSeenToday(sec: string): boolean {
      const v = view();
      return v.day === dayKey(deps.now()) && (v.secs ?? []).includes(sec);
    },
    noteSection(sec: string) {
      const day = dayKey(deps.now());
      const known = view();
      if (draft.day !== day) {
        draft = { ...draft, day, secs: [], newDay: known.day !== day };
      }
      if (!known.first) draft.first = day;
      if (!draft.secs.includes(sec)) draft.secs = [...draft.secs, sec].slice(-SECS_MAX);
    },
    lastTour(): number {
      return num(view().tour);
    },
    noteTour() {
      draft.tour = deps.now();
      flush(true);
    },
    poke() {
      draft.pokes += 1;
    },
    flush,
  };
}

export type KayoloMemory = ReturnType<typeof createMemory>;

let page: KayoloMemory | null = null;

/** The page's memory (browser only). */
export function pageMemory(): KayoloMemory {
  if (!page) {
    page = createMemory({
      local: () => (typeof window === "undefined" ? null : window.localStorage),
      session: () => (typeof window === "undefined" ? null : window.sessionStorage),
      now: () => Date.now(),
    });
    if (typeof window !== "undefined") {
      const write = () => page?.flush(true);
      window.addEventListener("pagehide", write);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") write();
      });
    }
  }
  return page;
}

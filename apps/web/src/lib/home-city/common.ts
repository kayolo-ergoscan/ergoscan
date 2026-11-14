/**
 * Home «Ночной город» + «Склад»: shared types, pixel helpers and the one clock of a block seal.
 *
 * Every mark is a chain fact: a storey is one transaction of that block (in block order, the
 * coinbase is the lobby), a crate is one waiting transaction, the gaps between towers are the real
 * intervals. The painters are pure `(ctx, w, h, scene, frame)` functions, so any moment of a seal can
 * be drawn and tested; the component only decides when to draw.
 */

/** One storey: the kind of one transaction of the block. */
export type CityTx = { color: string; category: string };

export type CityBlock = {
  id: string;
  height: number;
  /** Header timestamp, ms (the miner's template start): the street's gaps and the tower tip. */
  ts: number;
  /** When the gateway saw this block, on this browser's clock (a live seal has it, the snapshot not). */
  seenAt?: number | null;
  txCount: number;
  size: number;
  /** The pool's slice ink on the home «Mining pools» donut; null for a solo or unknown miner. */
  flag: string | null;
  lithos: boolean;
  /** Per-tx kinds in block order (coinbase first), from the `/v1/blocks/:id` read the home makes. */
  txs: CityTx[] | null;
};

export type YardTx = {
  id: string;
  size: number;
  fee: number;
  feeRate: number;
  color: string;
  category: string;
  firstSeen: number;
};

/** The gateway's own levels (`fees.histogram` recommend): normal = p50, turbo = p90 of what waits. */
export type Fees = { normal: number; turbo: number };

export type Scene = {
  /** Newest first. */
  blocks: CityBlock[];
  /** `count` is the whole pool; `txs` are the ones the page holds (the stream keeps up to 80). */
  mem: { count: number; txs: YardTx[] };
  fees: Fees | null;
  /** Wall clock, ms (dust on old crates). */
  now: number;
  avgBlockMs: number;
};

/** A seal in progress: the new block, how long ago it came, and its txs that waited in the yard, in block order. */
export type Seal = { ms: number; block: CityBlock; ids: string[] };

export type Frame = {
  seal: Seal | null;
  /** Txs that just arrived and how long ago (ms). */
  add: ReadonlyMap<string, number> | null;
  hover: string | null;
  reduce: boolean;
  /** performance.now(), Kayolo's clock. */
  now: number;
};

export type Inks = {
  text: string;
  muted: string;
  muted2: string;
  wash: string;
  washMid: string;
  washStrong: string;
  kayolo: string;
  sans: string;
  mono: string;
};

export function readInks(el: Element): Inks {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const sans = v("--font-sans", "");
  const mono = v("--font-mono", "");
  return {
    text: v("--text", "#ffffff"),
    muted: v("--muted", "rgba(255,255,255,0.58)"),
    muted2: v("--muted-2", "rgba(255,255,255,0.38)"),
    wash: v("--wash", "rgba(255,255,255,0.06)"),
    washMid: v("--wash-mid", "rgba(255,255,255,0.1)"),
    washStrong: v("--wash-strong", "rgba(255,255,255,0.16)"),
    kayolo: v("--ent-block", "#ffd23c"),
    sans: `${sans}${sans ? ", " : ""}ui-sans-serif, system-ui, sans-serif`,
    mono: `${mono}${mono ? ", " : ""}ui-monospace, monospace`,
  };
}

/* ---------------- colour ---------------- */

export function rgb(hex: string): [number, number, number] {
  const c = hex.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const s = /^#([0-9a-f]{3})$/i.exec(c);
  if (s) {
    const [r, g, b] = s[1]!.split("").map((x) => parseInt(x + x, 16));
    return [r!, g!, b!];
  }
  const f = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (f) return [Number(f[1]), Number(f[2]), Number(f[3])];
  return [160, 160, 160];
}

export function hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Multiply (k < 1 darker) or lift toward white (k > 1). */
export function shade(color: string, k: number): string {
  const [r, g, b] = rgb(color);
  if (k <= 1) return hex(r * k, g * k, b * k);
  const u = k - 1;
  return hex(r + (255 - r) * u, g + (255 - g) * u, b + (255 - b) * u);
}

export function alpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------------- pixels ---------------- */

/** One crisp rect on the CSS pixel grid. */
export function R(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Deterministic 0…1 noise: the same texture every frame. */
export function noise(a: number, b: number): number {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

export function hash01(id: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const easeOut = (u: number) => 1 - (1 - clamp(u, 0, 1)) ** 3;
export const easeInOut = (u: number) => {
  const t = clamp(u, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const easeIn = (u: number) => clamp(u, 0, 1) ** 2;

/* ---------------- the seal timeline, shared by both cards ---------------- */

/**
 * One seal, one clock for both cards. The coinbase is the miner's own: it comes with the block and
 * never leaves the yard. Every block tx that waited in the yard leaves it in block order, rides the
 * crane's cable and lands as one storey of the new tower. Then the roof closes and the street moves
 * one lot left.
 */
export type SealPlan = {
  /** ms: the yard marks the leaving crates. */
  mark: number;
  depart: (k: number) => number;
  fly: number;
  land: (k: number) => number;
  /** Last landing (or the lobby alone for an empty block). */
  built: number;
  /** Roof and flag. */
  closed: number;
  /** The street slides one lot left. */
  slideFrom: number;
  slideTo: number;
  end: number;
};

export function sealPlan(n: number): SealPlan {
  const mark = 320;
  const stagger = n <= 1 ? 0 : Math.min(110, 1300 / n);
  const fly = 640;
  const depart = (k: number) => mark + k * stagger;
  const land = (k: number) => depart(k) + fly;
  const built = n > 0 ? land(n - 1) : 520;
  const closed = built + 220;
  const slideFrom = closed + 650;
  const slideTo = slideFrom + 720;
  return { mark, depart, fly, land, built, closed, slideFrom, slideTo, end: slideTo + 120 };
}

/** The miner's own txs: the coinbase and the fee collection. They come with the block, not from the pool. */
export function minerTx(t: CityTx): boolean {
  return t.category === "coinbase" || t.category === "fee-collect";
}

/**
 * When each storey of a sealing block stands, ms after `block.sealed`, in block order (bottom up):
 * the lobby (the miner's coinbase, always the first tx) at 300; a tx that waited in the yard when its
 * crate lands; a block tx the yard never held together with the storey under it; the fee collection
 * (the last tx, when it is the miner's) with the roof. Never earlier than the storey below.
 * `kinds[i]` is «yard» for a tx that rides in from the yard, else its category, or "" if unknown.
 */
export function storeyTimes(kinds: readonly string[], flying: number): number[] {
  const plan = sealPlan(flying);
  const out: number[] = [];
  let j = 0;
  let prev = 300;
  const n = kinds.length;
  for (let i = 0; i < n; i++) {
    const k = kinds[i]!;
    let at: number;
    if (k === "yard") at = plan.land(Math.min(j++, Math.max(0, flying - 1)));
    else if (i === 0) at = 300;
    else if (i === n - 1 && n > 1 && (k === "fee-collect" || k === "")) at = plan.closed - 120;
    else at = prev;
    at = Math.max(at, prev);
    out.push(at);
    prev = at;
  }
  return out;
}

/** How many storeys stand at `ms` of the seal, and when the last of them landed (-1: none yet). */
export function builtAt(kinds: readonly string[], txCount: number, ms: number, flying: number): { built: number; lastAt: number } {
  if (!kinds.length) return ms >= 300 ? { built: Math.max(1, txCount), lastAt: 300 } : { built: 0, lastAt: -1 };
  const times = storeyTimes(kinds, flying);
  let built = 0;
  let lastAt = -1;
  for (const at of times) {
    if (ms < at) break;
    built++;
    lastAt = at;
  }
  return { built, lastAt };
}

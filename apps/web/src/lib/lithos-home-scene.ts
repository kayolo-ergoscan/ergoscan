/**
 * Geometry of the home «Lithos» scene (components/HomeLithos.tsx). Top: the network seam, a band
 * of stones, one per Ergo block of the hashrate window, the Lithos finds in gold. Left: an
 * isometric quarry where the round's miners knock NISP chips loose, with registered miners outside
 * the round on the plateau behind. Right: one track in three stretches — NISP collection (360
 * blocks), the fraud-proof check (360 blocks) and payout. A round is a cart; how far it has rolled
 * is how far its phase has run at the live chain tip. Finds come about every 10 h and a phase lasts
 * about 12 h, so two rounds often share a stretch: the one furthest along keeps the front track, the
 * others ride on tracks behind it, each with its label on a flag. Pure, so it is tested.
 */
import { LITHOS_EVAL_PERIOD, LITHOS_HOLDING_PERIOD, type LithosRound } from "@ergoscan/shared";

export type Seg = { a: number; b: number };

export type SceneLayout = {
  w: number;
  h: number;
  /** Phone-sized scene: smaller miners, short labels. */
  small: boolean;
  /** The network seam band across the top. */
  seam: { y: number; h: number };
  /** Track line. Carts stand on it. */
  ground: number;
  /** Quarry: the front block 0…cliff, steps cliff…quarry. */
  cliff: number;
  quarry: number;
  steps: { x0: number; x1: number; top: number }[];
  /** Top of the front block. */
  cliffTop: number;
  /** Plateau behind it (0…backEnd), its top at backTop: registered miners outside this round sit there. */
  backEnd: number;
  backTop: number;
  /** Isometric depth of the rock's top faces (x shift; the rise is half of it). */
  iso: number;
  collect: Seg;
  check: Seg;
  payout: Seg;
  cartHw: number;
  cartBody: number;
  /** How much higher each track behind the front one runs (a stretch shared by several rounds). */
  lane: number;
  minerScale: number;
  /** Font sizes (CSS px): a round's height, the small lines, the stage names. */
  font: { strong: number; small: number; stage: number; line: number };
};

const STEPS = 3;

export function sceneLayout(w: number, h: number): SceneLayout {
  const small = w < 420;
  const tall = !small && h >= 200;
  // A little sky above the seam so a new block's stone visibly drops in.
  const seam = { y: small ? 6 : 8, h: small ? 9 : 11 };
  const sky = seam.y + seam.h;
  // Room under the rails for the stage boards (name, then the period).
  const ground = Math.round(h - (small ? 34 : 40));
  // Wide enough on the phone for two miners per step (a 296 px scene still fits eight in front).
  const quarry = Math.round(small ? Math.min(150, Math.max(120, w * 0.37)) : Math.min(176, Math.max(112, w * 0.34)));
  const iso = small ? 6 : 8;
  // A wide rock top so two miners fit up there.
  const cliff = Math.round(quarry * 0.24);
  // The rock reaches up to just under the seam; the plateau behind sits a little higher still.
  const backTop = sky + (small ? 18 : 24);
  const cliffTop = backTop + Math.round(iso / 2) + 2;
  const stepH = (ground - cliffTop) / (STEPS + 1);
  const stepW = (quarry - cliff) / STEPS;
  const steps = Array.from({ length: STEPS }, (_, k) => ({
    x0: Math.round(cliff + k * stepW),
    x1: Math.round(cliff + (k + 1) * stepW),
    top: Math.round(ground - (STEPS - k) * stepH),
  }));
  const railA = quarry + (small ? 8 : 12);
  const railB = w - 4;
  const pay = Math.round(Math.min(100, Math.max(64, (railB - railA) * 0.26)));
  const run = (railB - railA - pay) / 2;
  return {
    w,
    h,
    small,
    seam,
    ground,
    cliff,
    quarry,
    steps,
    cliffTop,
    backEnd: Math.round(quarry * 0.6),
    backTop,
    iso,
    collect: { a: railA, b: railA + run },
    check: { a: railA + run, b: railA + 2 * run },
    payout: { a: railA + 2 * run, b: railB },
    // The pipeline is the hero: big carts on a tall desktop scene, compact ones on the phone.
    cartHw: small ? 16 : tall ? 29 : 21,
    cartBody: small ? 15 : tall ? 25 : 18,
    // Enough that a cart right behind another still shows its rim and ore over it.
    lane: small ? 10 : tall ? 16 : 12,
    minerScale: small ? 0.46 : tall ? 0.62 : 0.52,
    font: small ? { strong: 11, small: 10.5, stage: 10.5, line: 12.5 } : { strong: 13, small: 11.5, stage: 12, line: 14 },
  };
}

/**
 * Where the round's miners stand: bottom step first (nearest the track), a front and a back row
 * per step, then the top of the front block. Never more spots than fit; the card says the count.
 */
export function minerSpots(L: SceneLayout, n: number): { x: number; y: number; back: boolean }[] {
  const size = 26 * L.minerScale;
  const gap = size + 2;
  const out: { x: number; y: number; back: boolean }[] = [];
  for (const back of [false, true]) {
    for (let k = STEPS - 1; k >= 0; k--) {
      const s = L.steps[k]!;
      const x0 = s.x0 + 3 + size / 2 + (back ? gap / 2 : 0);
      for (let x = x0; x + size / 2 <= s.x1 - 1; x += gap) out.push({ x, y: s.top - (back ? 4 : 0), back });
    }
  }
  for (let x = L.cliff - size / 2 - 2; x - size / 2 >= 1; x -= gap) out.push({ x, y: L.cliffTop, back: false });
  // Front rows fill bottom-up before any back row.
  const front = out.filter((p) => !p.back);
  const rest = out.filter((p) => p.back);
  return [...front, ...rest].slice(0, Math.max(0, n));
}

/** Size of a dozing miner's square. */
export function idleSize(L: SceneLayout): number {
  return L.small ? 6 : 7;
}

/**
 * Registered miners outside this round: small squares on the plateau, rows going back (up and a
 * little right, as the plateau's top face does), never into the seam band. At most what fits.
 */
export function idleSpots(L: SceneLayout, n: number): { x: number; y: number }[] {
  const s = idleSize(L);
  // Right of the rock top, where the miners in this round do not stand in front of them.
  const x0 = L.cliff + 2;
  const per = Math.max(1, Math.floor((L.backEnd - x0 - 2) / (s + 2)));
  // Bleachers: each row a little higher and half a seat to the right.
  const rise = Math.max(4, Math.round(s * 0.8));
  const rows = Math.max(1, Math.floor((L.backTop - (L.seam.y + L.seam.h) - s - 2) / rise) + 1);
  const count = Math.min(Math.max(0, n), per * rows);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / per);
    return {
      x: x0 + (i % per) * (s + 2) + (row % 2) * Math.round((s + 2) / 2),
      y: L.backTop - row * rise,
    };
  });
}

export type CartSpot = {
  h: number;
  kind: "collect" | "check";
  /** 0…1 along its stretch. */
  u: number;
  /** Blocks until the phase ends. */
  left: number;
  miners: number;
  bank: number;
};

/** Rounds as carts at the live tip. A finished phase waits at the end of its stretch. */
export function sceneCarts(holding: readonly LithosRound[], evaluation: readonly LithosRound[], tip: number): CartSpot[] {
  const spot = (kind: CartSpot["kind"], period: number) => (r: LithosRound): CartSpot => {
    const age = Math.max(0, tip - r.start);
    return { h: r.h, kind, u: Math.min(1, age / period), left: Math.max(0, period - age), miners: r.miners, bank: r.bank };
  };
  return [
    ...holding.map(spot("collect", LITHOS_HOLDING_PERIOD)),
    ...evaluation.map(spot("check", LITHOS_EVAL_PERIOD)),
  ];
}

export function cartX(L: SceneLayout, c: CartSpot): number {
  const s = c.kind === "collect" ? L.collect : L.check;
  const pad = L.cartHw + 2;
  return s.a + pad + (s.b - s.a - 2 * pad) * c.u;
}

/** Tracks in use per stretch, at most this many. */
export const MAX_LANES = 3;

export type Lane = {
  /** 0 is the front track; 1, 2 run behind it. */
  lane: number;
  /** The stretch holds more than one round. */
  shared: boolean;
  /** Furthest along in its stretch (the next to move on). */
  lead: boolean;
};

/**
 * Which track each cart takes. In a stretch with one round it rides the front track. In a shared
 * stretch the round furthest along keeps the front track and the newer ones take the tracks behind,
 * so carts never hide each other while their positions stay the real progress.
 */
export function cartLanes(spots: readonly CartSpot[]): Map<number, Lane> {
  const out = new Map<number, Lane>();
  for (const kind of ["collect", "check"] as const) {
    const here = spots.filter((c) => c.kind === kind).sort((a, b) => b.u - a.u || a.h - b.h);
    here.forEach((c, i) => out.set(c.h, { lane: Math.min(i, MAX_LANES - 1), shared: here.length > 1, lead: i === 0 }));
  }
  return out;
}

export type Box = { l: number; r: number; top: number; bottom: number };

export type LabelSpec = {
  /** Centre of what the text names: a cart or the coin heap. */
  x: number;
  w: number;
  h: number;
  /** Where the text's bottom wants to be. It only ever moves up from here. */
  bottom: number;
  /** A flag: the text hangs beside a pole planted in the cart at this y. Without it the text is centred over x. */
  pole?: number;
};

export type PlacedLabel<T> = T & Box & { lift: number; side: -1 | 0 | 1 };

/** Space between a flag's pole and its text. */
export const FLAG_GAP = 5;

/**
 * Places labels so that none overlaps another, a pole or an obstacle (a cart). Right to left: a
 * flag further left lifts over the ones already standing, and its pole stays left of their text, so
 * no pole ever crosses a text. A flag's text goes right of its pole unless it would run past `max`.
 * A centred text stays within `min…max`. A box that collides moves up just above what it hit.
 */
export function placeLabels<T extends LabelSpec>(
  items: readonly T[],
  min: number,
  max: number,
  obstacles: readonly Box[] = [],
  gap = 6
): PlacedLabel<T>[] {
  const placed: Box[] = [...obstacles];
  const order = [...items].sort((a, b) => b.x - a.x);
  return order.map((it) => {
    let l: number;
    let r: number;
    let side: -1 | 0 | 1;
    if (it.pole == null) {
      const c = Math.min(max - it.w / 2, Math.max(min + it.w / 2, it.x));
      l = c - it.w / 2;
      r = c + it.w / 2;
      side = 0;
    } else if (it.x + FLAG_GAP + it.w <= max) {
      l = it.x - 1;
      r = it.x + FLAG_GAP + it.w;
      side = 1;
    } else {
      l = it.x - FLAG_GAP - it.w;
      r = it.x + 1;
      side = -1;
    }
    let bottom = it.bottom;
    for (;;) {
      const hit = placed.find((p) => p.l < r + gap && p.r + gap > l && p.top < bottom && p.bottom > bottom - it.h);
      if (!hit) break;
      bottom = hit.top - 2;
    }
    const box = { l, r, top: bottom - it.h, bottom };
    placed.push(box);
    if (it.pole != null) placed.push({ l: it.x - 1, r: it.x + 1, top: bottom, bottom: it.pole });
    return { ...it, ...box, lift: it.bottom - bottom, side };
  });
}

/** x of a moment on the seam band: `at` minutes after the window start, `span` minutes wide. */
export function seamX(L: SceneLayout, at: number, span: number): number {
  const u = span > 0 ? Math.min(1, Math.max(0, at / span)) : 1;
  return Math.round(2 + u * (L.w - 6));
}

/** Coins drawn on the payout heap: one per waiting payout, at most 21 (rows of 6…1). */
export function coinSpots(n: number): { dx: number; row: number }[] {
  const out: { dx: number; row: number }[] = [];
  let left = Math.min(21, Math.max(0, n));
  for (let row = 0, width = 6; left > 0 && width > 0; row++, width--) {
    const k = Math.min(width, left);
    for (let i = 0; i < k; i++) out.push({ dx: (i - (k - 1) / 2) * 1, row });
    left -= k;
  }
  return out;
}

/**
 * Geometry of the home «Lithos» scene (components/HomeLithos.tsx): a quarry on the left where the
 * round's miners knock NISP chips loose, and one track to the right in three stretches —
 * NISP collection (360 blocks), the fraud-proof check (360 blocks) and payout. A round is a cart;
 * how far it has rolled is how far its phase has run at the live chain tip. Pure, so it is tested.
 */
import { LITHOS_EVAL_PERIOD, LITHOS_HOLDING_PERIOD, type LithosRound } from "@ergoscan/shared";

export type Seg = { a: number; b: number };

export type SceneLayout = {
  w: number;
  h: number;
  /** Phone-sized scene: smaller miners, short labels. */
  small: boolean;
  /** Track line. Carts stand on it. */
  ground: number;
  /** Quarry: rock face 0…cliff, steps cliff…quarry. */
  cliff: number;
  quarry: number;
  steps: { x0: number; x1: number; top: number }[];
  /** Top of the rock face. Behind it a back ledge (0…backEnd) where registered miners outside this round sit. */
  cliffTop: number;
  backEnd: number;
  collect: Seg;
  check: Seg;
  payout: Seg;
  cartHw: number;
  cartBody: number;
  minerScale: number;
};

const STEPS = 3;

export function sceneLayout(w: number, h: number): SceneLayout {
  const small = w < 420;
  const ground = Math.round(h - (small ? 26 : 28));
  const quarry = Math.round(Math.min(180, Math.max(110, w * 0.36)));
  const cliff = Math.round(quarry * 0.2);
  const stepH = Math.round(Math.min(34, Math.max(22, (ground - 40) / (STEPS + 1.6))));
  const stepW = (quarry - cliff) / STEPS;
  const steps = Array.from({ length: STEPS }, (_, k) => ({
    x0: Math.round(cliff + k * stepW),
    x1: Math.round(cliff + (k + 1) * stepW),
    top: ground - (STEPS - k) * stepH,
  }));
  const railA = quarry + 6;
  const railB = w - 6;
  const pay = Math.round(Math.min(104, Math.max(60, (railB - railA) * 0.27)));
  const run = (railB - railA - pay) / 2;
  return {
    w,
    h,
    small,
    ground,
    cliff,
    quarry,
    steps,
    cliffTop: ground - (STEPS + 1) * stepH,
    backEnd: Math.round(quarry * 0.56),
    collect: { a: railA, b: railA + run },
    check: { a: railA + run, b: railA + 2 * run },
    payout: { a: railA + 2 * run, b: railB },
    cartHw: small ? 13 : 19,
    cartBody: small ? 12 : 16,
    minerScale: small ? 0.42 : 0.52,
  };
}

/**
 * Where the round's miners stand: bottom step first (nearest the track), a front and a back row
 * per step, then the top of the rock face. Never more spots than fit; the card says the count.
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

/** Registered miners outside this round: small squares on the back ledge, rows from the bottom. */
export function idleSpots(L: SceneLayout, n: number): { x: number; y: number }[] {
  const s = L.small ? 6 : 7;
  const per = Math.max(1, Math.floor((L.backEnd - 4) / (s + 2)));
  return Array.from({ length: n }, (_, i) => ({
    x: 3 + (i % per) * (s + 2) + ((Math.floor(i / per) % 2) * (s + 2)) / 2,
    y: L.cliffTop - Math.floor(i / per) * (s + 1),
  }));
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

/** Text boxes, left to right: a box that would overlap the one before it moves up a row. */
export function stackLabels<T extends { x: number; w: number }>(items: readonly T[], gap = 6): (T & { row: number })[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const rows: number[] = [];
  return sorted.map((it) => {
    const left = it.x - it.w / 2;
    let row = 0;
    while (rows[row] != null && rows[row]! + gap > left) row++;
    rows[row] = it.x + it.w / 2;
    return { ...it, row };
  });
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

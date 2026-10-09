/**
 * Seal Well — mempool cinema. Mouth on the left (toward Live blocks).
 * Pure stepper + pack. Canvas lives in TxBallPit. No Matter / d3 / R3F.
 */

export const MORE_ID = "__more";
/** Soft ceiling for idle display. Included-in-block txs always get a body. */
export const MAX_BALLS = 80;
export const HOME_R = { min: 4, max: 12 } as const;
export const SCENE_R = { min: 5, max: 18 } as const;
/** Circle-area sum vs canvas. Count changes size, not the fill. */
export const FILL_TARGET = 2 / 3;
/** Fee spreads radius around the pack mean (±). High fee = bigger. */
export const FEE_SPREAD = 0.38;
export const BIRTH_MS = 560;
export const BIRTH_PEAK = 1.2;
export const STEER = 4;
export const DAMP = 0.92;
export const REST = 0.28;
export const COLLIDE_PASSES = 7;
export const COLLIDE_GAP = 1.1;
export const SQUASH_SLACK = 2.2;
export const SQUASH_MAX = 0.5;
export const IDLE_CAP = 8;
export const SEAL_V_CAP = 40;
export const CAT_PULL = 10;
export const SPAWN_MS = 280;
/** Path to the hole — always arrives, then the other side pours. */
export const SEAL_PATH_MIN = 1000;
export const SEAL_PATH_PER_PX = 2.8;
export const SEAL_STAGGER = 80;
export const SEAL_STAGGER_CAP = 12;
export const SEAL_TUNNEL_MS = 140;
export const SEAL_FLY_MIN = 900;
export const SEAL_FLY_MAX = 1400;
export const SEAL_STEER = 7;
export const RECOIL_MS = 150;
export const FADE_MS = 200;
export const FLASH_MS = 200;
export const THETA_MAX = (70 * Math.PI) / 180;

export type WellScale = "home" | "scene";
export type WellDie = "none" | "seal" | "recoil" | "fade";

export type WellSeed = {
  id: string;
  size: number;
  fee?: number;
  feeRate?: number;
  color: string;
  category?: string;
  action?: string | null;
  platform?: string | null;
  firstSeen?: number;
  href?: string | null;
  title?: string;
  value?: number | null;
};

export type WellBody = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  size: number;
  fee: number;
  feeRate: number;
  category: string;
  action: string | null;
  platform: string | null;
  value: number;
  theta: number;
  omega: number;
  href: string | null;
  title: string;
  born: number;
  more: boolean;
  dying: WellDie;
  dieT0: number;
  dieDur: number;
  r0: number;
  alpha: number;
  stunUntil: number;
  sealX0: number;
  sealY0: number;
  sealDelay: number;
  /** Draw-only squash: 0 idle, up to SQUASH_MAX when pressed. */
  sq: number;
  sqx: number;
  sqy: number;
  /** Second-strongest contact — pinch from two neighbors. */
  sq2: number;
  sq2x: number;
  sq2y: number;
};

export function feeRateOf(fee: number, size: number): number {
  if (!(size > 0)) return 0;
  const f = Number.isFinite(fee) ? Math.max(0, fee) : 0;
  return f / size;
}

export function hash01(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function wellRadius(size: number, scale: WellScale): number {
  const { min, max } = scale === "home" ? HOME_R : SCENE_R;
  const w = Math.max(80, Number.isFinite(size) ? size : 80);
  const t = Math.sqrt(w / 80);
  const r = min + (max - min) * Math.min(1, Math.max(0, (t - 1) / 6));
  return Math.min(max, Math.max(min, r));
}

export function packFillBudget(w: number, h: number): number {
  return FILL_TARGET * Math.max(1, w * h);
}

export function packFillUsed(radii: readonly number[]): number {
  let used = 0;
  for (const r of radii) used += Math.PI * r * r;
  return used;
}

export function packFillRatio(radii: readonly number[], w: number, h: number): number {
  return packFillUsed(radii) / Math.max(1, w * h);
}

export function playableArea(w: number, h: number, scale: WellScale = "home"): number {
  const keep = mouthKeepOut(h, scale);
  return Math.max(1, w * h - Math.PI * keep * keep);
}

/** Scale radii so Σπr² never exceeds the budget. */
export function fitPackRadii(radii: number[], budget: number, floor: number): void {
  for (let pass = 0; pass < 3; pass++) {
    const used = packFillUsed(radii);
    if (used <= budget + 0.5) return;
    const s = Math.sqrt(budget / used);
    for (let i = 0; i < radii.length; i++) {
      radii[i] = Math.max(floor * 0.85, radii[i] * s);
    }
  }
}

/**
 * Mean radius so n disks cover at most 2/3 of the tile (1/3 stays air).
 * Short tiles also cap by hex-pack in the field to the right of the hole.
 */
export function packMeanRadius(n: number, w: number, h: number, scale: WellScale = "home"): number {
  const count = Math.max(1, n);
  const areaCap = Math.sqrt(packFillBudget(w, h) / (count * Math.PI));
  const keep = mouthKeepOut(h, scale);
  const pad = 6;
  const fieldW = Math.max(8, w - keep - pad);
  const fieldH = Math.max(8, h - 2 * pad);
  const squat = fieldH / fieldW;
  const eff = squat < 0.22 ? 0.56 : squat < 0.4 ? 0.7 : 0.86;
  const hexCap = Math.sqrt((fieldW * fieldH * eff) / (count * 2 * Math.sqrt(3)));
  const heightCap = Math.min(fieldH / 2.2, (h - 4) / (2 * BIRTH_PEAK));
  return Math.min(areaCap, hexCap, heightCap);
}

/** Pack mean so n balls fill ~2/3. Fee only spreads around that mean. */
export function wellRadiusForPack(opts: {
  n: number;
  w: number;
  h: number;
  feeRate: number;
  lo: number;
  hi: number;
  scale: WellScale;
}): number {
  const mean = packMeanRadius(opts.n, opts.w, opts.h, opts.scale);
  const fee = feeNorm(opts.feeRate, opts.lo, opts.hi);
  const spread = 1 - FEE_SPREAD + fee * (2 * FEE_SPREAD);
  const floor = opts.scale === "home" ? HOME_R.min : SCENE_R.min;
  const minSide = Math.max(8, Math.min(opts.w, opts.h));
  const sideCap = minSide * (opts.n <= 3 ? 0.44 : opts.n <= 8 ? 0.38 : 0.32);
  // Eight balls on the home tile used to hit this side cap and fill the tile.
  // The home ceiling is a third of that eight-ball cap. More balls still shrink
  // through the 2/3 area budget below.
  const maxR = opts.scale === "home" ? (minSide * 0.38) / 3 : sideCap;
  return Math.min(maxR, Math.max(floor, mean * spread));
}

/** 0 → peak overshoot → 1. Draw-only; physics keeps settled r. */
export function birthScale(ageMs: number): number {
  if (!(ageMs > 0)) return 0.06;
  if (ageMs >= BIRTH_MS) return 1;
  const t = ageMs / BIRTH_MS;
  if (t < 0.64) {
    const u = t / 0.64;
    const e = 1 - (1 - u) * (1 - u);
    return 0.06 + (BIRTH_PEAK - 0.06) * e;
  }
  const u = (t - 0.64) / 0.36;
  const e = u * u * (3 - 2 * u);
  return BIRTH_PEAK + (1 - BIRTH_PEAK) * e;
}

export function assignPackRadii(
  bodies: WellBody[],
  w: number,
  h: number,
  scale: WellScale,
  dt?: number
): void {
  const live = bodies.filter((b) => !b.more && b.dying !== "seal" && b.dying !== "fade");
  const n = Math.max(1, live.length);
  const { lo, hi } = poolFeeRange(live);
  const ease = dt != null && dt > 0 ? Math.min(1, dt * 7) : 1;
  const floor = scale === "home" ? HOME_R.min : SCENE_R.min;
  const targets = live.map((b) =>
    wellRadiusForPack({
      n,
      w,
      h,
      feeRate: b.feeRate,
      lo,
      hi,
      scale,
    })
  );
  const moreBodies = bodies.filter((b) => b.more);
  const moreR = moreBodies.length
    ? Math.min(scale === "home" ? 11 : 14, packMeanRadius(n, w, h, scale) * 0.62)
    : 0;
  const moreArea = moreBodies.length * Math.PI * moreR * moreR;
  const liveBudget = Math.max(packFillBudget(w, h) * 0.45, packFillBudget(w, h) - moreArea);
  fitPackRadii(targets, liveBudget, floor);
  live.forEach((b, i) => {
    const target = targets[i] ?? b.r;
    b.r = b.r + (target - b.r) * ease;
    if (b.dying !== "seal") b.r0 = b.r;
  });
  for (const b of moreBodies) {
    b.r = b.r + (moreR - b.r) * ease;
    b.r0 = b.r;
  }
}

export function feeNorm(feeRate: number, lo: number, hi: number): number {
  const a = Math.log(Math.max(feeRate, 1));
  const b = Math.log(Math.max(lo, 1));
  const c = Math.log(Math.max(hi, lo + 1e-9));
  if (c <= b) return 0.5;
  return Math.min(1, Math.max(0, (a - b) / (c - b)));
}

/** Higher fee → smaller orbit → closer to the left mouth. */
export function orbitRadius(
  feeRate: number,
  lo: number,
  hi: number,
  rMouth: number,
  rRim: number
): number {
  const n = feeNorm(feeRate, lo, hi);
  return rMouth + (rRim - rMouth) * (1 - n);
}

export function attractorOf(w: number, h: number): { x: number; y: number } {
  return { x: Math.max(10, w * 0.035), y: h * 0.55 };
}

/** Sealed balls dissolve here: the left edge of the tile. */
export function sealExit(h: number): { x: number; y: number } {
  return { x: 0, y: h * 0.55 };
}

export function mouthRadius(h: number, scale: WellScale = "home"): number {
  return scale === "home" ? Math.max(8, h * 0.16) : Math.max(10, h * 0.13);
}

/** No reserved hole. Idle balls may cross the whole tile, including the old mouth. */
export function mouthKeepOut(_h: number, _scale: WellScale = "home"): number {
  return 0;
}

export function fallingIntoMouth(b: WellBody, now: number): boolean {
  return b.dying === "seal" && sealAge(b, now) >= 0;
}

/** Orbits may sit on the old mouth. The rim still reaches across the tile. */
export function mouthRim(
  w: number,
  _h: number,
  _scale: WellScale,
  _innerR?: number
): { rMouth: number; rRim: number } {
  const rMouth = 0;
  const rRim = Math.max(24, w * 0.42);
  return { rMouth, rRim };
}

/** Inset so the drawn disk (birth overshoot + stroke) stays inside the tile. */
export function bodyInset(r: number): number {
  return r * BIRTH_PEAK + 2;
}

function clampPlay(v: number, r: number, span: number): number {
  const inset = Math.min(bodyInset(r), span / 2);
  return Math.min(span - inset, Math.max(inset, v));
}

export function wellSquashAxes(r: number, sq: number): { rx: number; ry: number } {
  const s = Math.min(SQUASH_MAX, Math.max(0, sq));
  return {
    rx: Math.max(1.1, r * (1 - s * 0.5)),
    ry: Math.max(1.1, r * (1 + s * 0.42)),
  };
}

export function poolFeeRange(rows: readonly { feeRate: number }[]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.feeRate)) continue;
    if (r.feeRate < lo) lo = r.feeRate;
    if (r.feeRate > hi) hi = r.feeRate;
  }
  if (!Number.isFinite(lo)) return { lo: 1, hi: 1 };
  if (hi <= lo) return { lo: Math.max(1, lo * 0.8), hi: Math.max(lo + 1, hi * 1.2) };
  return { lo, hi };
}

export function packForSeal<T extends { feeRate: number; size: number }>(
  balls: readonly T[],
  cap: number
): { packed: T[]; leftover: T[] } {
  const sorted = [...balls].sort((a, b) => {
    if (b.feeRate !== a.feeRate) return b.feeRate - a.feeRate;
    return a.size - b.size;
  });
  const packed: T[] = [];
  const leftover: T[] = [];
  let sum = 0;
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 0;
  for (const b of sorted) {
    const sz = Number.isFinite(b.size) ? Math.max(0, b.size) : 0;
    if (sum + sz <= limit) {
      packed.push(b);
      sum += sz;
    } else leftover.push(b);
  }
  return { packed, leftover };
}

/** Idle cap + optional +N. `keep` (included in the new block) is never dropped. */
export function pickWellSeeds<T extends { id: string; feeRate?: number }>(
  seeds: readonly T[],
  max = MAX_BALLS,
  keep?: ReadonlySet<string>
): { shown: T[]; more: number } {
  const byFee = (a: T, b: T) => (b.feeRate ?? 0) - (a.feeRate ?? 0);
  if (keep?.size) {
    const must = seeds.filter((s) => keep.has(s.id));
    const rest = seeds.filter((s) => !keep.has(s.id));
    if (must.length + rest.length <= max) return { shown: [...must, ...rest], more: 0 };
    const room = Math.max(0, max - must.length);
    if (room <= 1) return { shown: must, more: rest.length };
    const extra = [...rest].sort(byFee).slice(0, room - 1);
    return { shown: [...must, ...extra], more: rest.length - extra.length };
  }
  if (seeds.length <= max) return { shown: [...seeds], more: 0 };
  const top = [...seeds].sort(byFee).slice(0, max - 1);
  return { shown: top, more: seeds.length - top.length };
}

/** Re-attach departed seeds that the new block included. */
export function mergeWellSeeds(
  live: readonly WellSeed[],
  extra: readonly WellSeed[],
  keep?: ReadonlySet<string>
): WellSeed[] {
  const byId = new Map<string, WellSeed>();
  for (const s of live) byId.set(s.id, s);
  if (keep?.size) {
    for (const s of extra) {
      if (keep.has(s.id) && !byId.has(s.id)) byId.set(s.id, s);
    }
  }
  return [...byId.values()];
}

/** Spawn a body for every included seed we still know (skip coinbase-only ids). */
export function ensureIncludedBodies(
  bodies: WellBody[],
  included: ReadonlySet<string>,
  seeds: readonly WellSeed[],
  w: number,
  h: number,
  scale: WellScale,
  now: number
): WellBody[] {
  if (!included.size) return bodies;
  const have = new Set(bodies.map((b) => b.id));
  for (const seed of seeds) {
    if (!included.has(seed.id) || have.has(seed.id) || seed.id === MORE_ID) continue;
    bodies.push(makeWellBody(seed, w, h, scale, now));
    have.add(seed.id);
  }
  return bodies;
}

export function spawnXY(
  w: number,
  h: number,
  r: number,
  id: string
): { x: number; y: number } {
  const top = hash01(id, 4) >= 0.55;
  const inset = bodyInset(r);
  if (top) {
    return {
      x: w * (0.62 + hash01(id, 5) * 0.3),
      y: inset + hash01(id, 6) * Math.max(8, h * 0.22),
    };
  }
  return {
    x: w * (0.78 + hash01(id, 5) * 0.16),
    y: inset + hash01(id, 6) * Math.max(8, h - 2 * inset),
  };
}

function clampTheta(t: number): number {
  return Math.min(THETA_MAX, Math.max(-THETA_MAX, t));
}

export function seedRate(s: WellSeed): number {
  if (typeof s.feeRate === "number" && Number.isFinite(s.feeRate) && s.feeRate > 0) {
    return s.feeRate;
  }
  return feeRateOf(s.fee ?? 0, s.size);
}

export function makeWellBody(
  s: WellSeed,
  w: number,
  h: number,
  scale: WellScale,
  now: number,
  opts?: { more?: boolean; title?: string; href?: string | null; relayout?: boolean; old?: WellBody }
): WellBody {
  const r = wellRadius(s.size, scale);
  const old = opts?.old;
  const more = Boolean(opts?.more);
  const rate = seedRate(s);
  const theta = clampTheta((hash01(s.id, 7) * 2 - 1) * THETA_MAX);
  const omega = (0.12 + hash01(s.id, 8) * 0.28) * (hash01(s.id, 9) < 0.5 ? -1 : 1);
  if (old && !opts?.relayout) {
    old.color = s.color;
    old.size = s.size;
    old.fee = s.fee ?? old.fee;
    old.feeRate = rate;
    old.category = s.category || old.category || "unknown";
    old.action = s.action ?? old.action ?? null;
    old.platform = s.platform ?? old.platform ?? null;
    old.value = typeof s.value === "number" && Number.isFinite(s.value) ? s.value : old.value;
    if (opts?.title) old.title = opts.title;
    if (opts?.href !== undefined) old.href = opts.href;
    if (old.sq == null) {
      old.sq = 0;
      old.sqx = 1;
      old.sqy = 0;
      old.sq2 = 0;
      old.sq2x = 0;
      old.sq2y = 1;
    }
    return old;
  }
  const pos = more
    ? { x: w * 0.88, y: h * (0.38 + hash01(s.id, 2) * 0.28) }
    : old
      ? { x: old.x, y: old.y }
      : spawnXY(w, h, r, s.id);
  return {
    id: s.id,
    x: pos.x,
    y: pos.y,
    vx: more ? 0 : -18 - hash01(s.id, 11) * 10,
    vy: more ? 0 : (hash01(s.id, 12) - 0.5) * 8,
    r,
    color: s.color,
    size: s.size,
    fee: s.fee ?? 0,
    feeRate: rate,
    category: s.category || "unknown",
    action: s.action ?? null,
    platform: s.platform ?? null,
    value: Number.isFinite(s.value) ? Number(s.value) : 0,
    theta,
    omega,
    href: opts?.href === undefined ? s.href ?? `/tx/${s.id}` : opts.href,
    title: opts?.title || s.title || s.id.slice(0, 8),
    born: old?.born ?? now,
    more,
    dying: "none",
    dieT0: 0,
    dieDur: 0,
    r0: r,
    alpha: 1,
    stunUntil: 0,
    sealX0: 0,
    sealY0: 0,
    sealDelay: 0,
    sq: 0,
    sqx: 1,
    sqy: 0,
    sq2: 0,
    sq2x: 0,
    sq2y: 1,
  };
}

/** Cue-ball poke — hard hit, then Brownian scatter through the pack. */
export const POKE_IMPULSE = 520;
export const POKE_STUN_MS = 1280;
export const POKE_CHAIN_STUN_MS = 920;
export const POKE_CAP = 176;
export const BILLIARD_REST = 0.94;
export const BROWNIAN = 38;

export function pokeWell(
  b: WellBody,
  px: number,
  py: number,
  now: number,
  pack?: readonly WellBody[]
): boolean {
  if (b.more || b.dying !== "none") return false;
  let dx = b.x - px;
  let dy = b.y - py;
  let dist = Math.hypot(dx, dy);
  if (dist < 0.8) {
    const a = hash01(b.id, 31) * Math.PI * 2;
    dx = Math.cos(a);
    dy = Math.sin(a);
    dist = 1;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const spin = (hash01(b.id, 33) - 0.5) * 0.22;
  b.vx += (nx - ny * spin) * POKE_IMPULSE;
  b.vy += (ny + nx * spin) * POKE_IMPULSE;
  b.stunUntil = now + POKE_STUN_MS;
  if (!pack) return true;
  for (const o of pack) {
    if (o === b || o.more || o.dying !== "none") continue;
    const ox = o.x - b.x;
    const oy = o.y - b.y;
    const d = Math.hypot(ox, oy) || 0.0001;
    const reach = b.r + o.r + 7;
    if (d > reach * 2.4) continue;
    const falloff = Math.max(0.12, 1 - (d - reach) / Math.max(8, reach * 1.35));
    const ux = ox / d;
    const uy = oy / d;
    const jx = hash01(o.id, 41) - 0.5;
    const jy = hash01(o.id, 42) - 0.5;
    const mag = POKE_IMPULSE * 0.62 * falloff;
    o.vx += ux * mag + jx * mag * 0.7;
    o.vy += uy * mag + jy * mag * 0.7;
    o.stunUntil = Math.max(o.stunUntil, now + POKE_CHAIN_STUN_MS);
  }
  return true;
}

function brownianKick(b: WellBody, now: number, dt: number): void {
  const tick = (now * 0.055) | 0;
  const ax = hash01(b.id, tick) - 0.5;
  const ay = hash01(b.id, tick + 19) - 0.5;
  b.vx += ax * BROWNIAN * dt * 18;
  b.vy += ay * BROWNIAN * dt * 18;
}

function armSeal(b: WellBody, now: number, delay: number, mouth: { x: number; y: number }): void {
  b.dying = "seal";
  b.dieT0 = now;
  b.sealDelay = delay;
  b.sealX0 = b.x;
  b.sealY0 = b.y;
  const dist = Math.hypot(b.x - mouth.x, b.y - mouth.y);
  b.dieDur = SEAL_PATH_MIN + dist * SEAL_PATH_PER_PX;
  b.r0 = b.r;
  b.alpha = 1;
}

export function sealAge(b: WellBody, now: number): number {
  return now - b.dieT0 - b.sealDelay;
}

export function sealProgress(b: WellBody, now: number): number {
  if (b.dying !== "seal") return 0;
  return Math.min(1, Math.max(0, sealAge(b, now) / Math.max(1, b.dieDur)));
}

export function beginSeal(
  bodies: WellBody[],
  now: number,
  included: ReadonlySet<string>,
  mouth?: { x: number; y: number }
): WellBody[] {
  if (!included.size) return bodies;
  const chosen = bodies
    .filter((b) => !b.more && b.dying !== "seal" && included.has(b.id))
    .sort((a, b) => {
      const mx = mouth?.x ?? 10;
      const my = mouth?.y ?? (a.y + b.y) / 2;
      return Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my);
    });
  chosen.forEach((b, i) => {
    const hole = mouth ?? { x: 10, y: b.y };
    armSeal(b, now, Math.min(i, SEAL_STAGGER_CAP) * SEAL_STAGGER, hole);
  });
  return bodies;
}

export function markMissing(
  bodies: WellBody[],
  live: Set<string>,
  kind: "seal" | "fade",
  now: number,
  included?: ReadonlySet<string>,
  mouth?: { x: number; y: number }
): WellBody[] {
  const gone = bodies.filter((b) => !b.more && b.dying !== "seal" && !live.has(b.id));
  if (!gone.length) return bodies;
  let extra = 0;
  for (const b of gone) {
    if (included && typeof included.has === "function" && included.has(b.id)) {
      armSeal(b, now, Math.min(extra, SEAL_STAGGER_CAP) * SEAL_STAGGER, mouth ?? { x: 10, y: b.y });
      extra += 1;
    } else if (kind && b.dying === "none") {
      b.dying = "fade";
      b.dieT0 = now;
      b.dieDur = FADE_MS;
      b.r0 = b.r;
    }
  }
  return bodies;
}

export type PourSeed = {
  id: string;
  color: string;
  r: number;
  delayMs: number;
};

export function pourSeedsOf(bodies: readonly WellBody[]): PourSeed[] {
  const next: PourSeed[] = [];
  for (const b of bodies) {
    if (b.more || b.dying !== "seal") continue;
    next.push({
      id: b.id,
      color: b.color,
      r: Math.max(3.2, b.r0 || b.r),
      delayMs: b.sealDelay + b.dieDur + SEAL_TUNNEL_MS,
    });
  }
  next.sort((a, b) => a.delayMs - b.delayMs || a.id.localeCompare(b.id));
  return next;
}

/** Stack pour seeds inside the empty cadence slot (bar grows from the floor). */
export function assembleHomes(n: number, w: number, barH: number): { x: number; y: number }[] {
  const count = Math.max(0, n);
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(count * 0.75))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const gx = w / (cols + 1);
  const gy = Math.max(5, (barH - 4) / (rows + 0.35));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: gx * ((i % cols) + 1),
      y: barH - 5 - Math.floor(i / cols) * gy,
    });
  }
  return out;
}

export function dyingCount(bodies: readonly WellBody[]): number {
  let n = 0;
  for (const b of bodies) {
    if (b.more) continue;
    if (b.dying === "seal" || b.dying === "fade") n += 1;
  }
  return n;
}

export function visibleCount(bodies: readonly WellBody[]): number {
  let n = 0;
  for (const b of bodies) if (!b.more) n += 1;
  return n;
}

export function sweepDead(bodies: WellBody[], now: number): WellBody[] {
  const next: WellBody[] = [];
  for (const b of bodies) {
    if (b.dying === "recoil") {
      if (now >= b.dieT0 + b.dieDur) {
        b.dying = "none";
        b.alpha = 1;
      }
      next.push(b);
      continue;
    }
    if (b.dying === "none") {
      next.push(b);
      continue;
    }
    if (b.dying === "seal") {
      if (sealProgress(b, now) < 1) next.push(b);
      continue;
    }
    if (now < b.dieT0 + b.dieDur) next.push(b);
  }
  return next;
}

function resetSquash(b: WellBody): void {
  b.sq = 0;
  b.sqx = 1;
  b.sqy = 0;
  b.sq2 = 0;
  b.sq2x = 0;
  b.sq2y = 1;
}

function addSquash(b: WellBody, nx: number, ny: number, press: number): void {
  const p = Math.min(SQUASH_MAX, Math.max(0, press));
  if (p < 0.012) return;
  const L = Math.hypot(nx, ny) || 1;
  const x = nx / L;
  const y = ny / L;
  if (p >= b.sq) {
    b.sq2 = b.sq;
    b.sq2x = b.sqx;
    b.sq2y = b.sqy;
    b.sq = p;
    b.sqx = x;
    b.sqy = y;
    return;
  }
  if (p >= b.sq2) {
    b.sq2 = p;
    b.sq2x = x;
    b.sq2y = y;
  }
}

function collide(a: WellBody, b: WellBody, now: number) {
  if (a.dying === "fade" || b.dying === "fade") return;
  const aFall = fallingIntoMouth(a, now);
  const bFall = fallingIntoMouth(b, now);
  if (aFall && bFall) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = a.r + b.r + COLLIDE_GAP;
  if (dist >= min) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = min - dist;
  const ma = a.r * a.r;
  const mb = b.r * b.r;
  const sum = ma + mb;
  const aSeal = a.dying === "seal";
  const bSeal = b.dying === "seal";
  const aHot = now < a.stunUntil;
  const bHot = now < b.stunUntil;
  const bounce = aSeal || bSeal ? 0.72 : aHot || bHot ? BILLIARD_REST : REST;
  if (aSeal && !bSeal) {
    b.x += nx * overlap;
    b.y += ny * overlap;
  } else if (bSeal && !aSeal) {
    a.x -= nx * overlap;
    a.y -= ny * overlap;
  } else {
    a.x -= nx * overlap * (mb / sum);
    a.y -= ny * overlap * (mb / sum);
    b.x += nx * overlap * (ma / sum);
    b.y += ny * overlap * (ma / sum);
  }
  const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rv > 0) return;
  const j = (-(1 + bounce) * rv) / (1 / ma + 1 / mb);
  a.vx += (j / ma) * nx;
  a.vy += (j / ma) * ny;
  b.vx -= (j / mb) * nx;
  b.vy -= (j / mb) * ny;
  if (aSeal && !bSeal) {
    b.vx += nx * 90;
    b.vy += ny * 90;
    b.stunUntil = now + 340;
  } else if (bSeal && !aSeal) {
    a.vx -= nx * 90;
    a.vy -= ny * 90;
    a.stunUntil = now + 340;
  } else if (aHot !== bHot && a.dying === "none" && b.dying === "none") {
    const cold = aHot ? b : a;
    const jx = hash01(cold.id, 51) - 0.5;
    const jy = hash01(cold.id, 52) - 0.5;
    cold.vx += jx * 46;
    cold.vy += jy * 46;
    cold.stunUntil = Math.max(cold.stunUntil, now + POKE_CHAIN_STUN_MS);
  }
}

function gatherSquash(a: WellBody, b: WellBody, now: number) {
  if (a.dying === "fade" || b.dying === "fade") return;
  if (fallingIntoMouth(a, now) && fallingIntoMouth(b, now)) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const min = a.r + b.r;
  if (dist >= min + SQUASH_SLACK) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const reach = min + SQUASH_SLACK - dist;
  const press = Math.min(1, reach / Math.max(3.2, (a.r + b.r) * 0.38));
  addSquash(a, nx, ny, press);
  addSquash(b, -nx, -ny, press);
}

export function keepClearOfMouth(
  b: WellBody,
  mouth: { x: number; y: number },
  keepR: number,
  w: number,
  h: number,
  now: number
): void {
  if (fallingIntoMouth(b, now)) return;
  let dx = b.x - mouth.x;
  let dy = b.y - mouth.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-3) {
    dx = 1;
    dy = 0;
    dist = 1;
  }
  const min = keepR + b.r;
  const nx0 = dx / dist;
  const ny0 = dy / dist;
  if (dist >= min) {
    const slack = min + 2.6 - dist;
    if (slack > 0) addSquash(b, -nx0, -ny0, slack / Math.max(5, b.r));
    return;
  }
  b.x = mouth.x + nx0 * min;
  b.y = mouth.y + ny0 * min;
  b.x = clampPlay(b.x, b.r, w);
  b.y = clampPlay(b.y, b.r, h);
  dx = b.x - mouth.x;
  dy = b.y - mouth.y;
  dist = Math.hypot(dx, dy) || 1e-3;
  if (dist < min) {
    const need = Math.sqrt(Math.max(0, min * min - dy * dy));
    b.x = clampPlay(mouth.x + Math.max(need, 0), b.r, w);
  }
  const vn = b.vx * nx0 + b.vy * ny0;
  if (vn < 0) {
    b.vx -= vn * nx0 * 1.2;
    b.vy -= vn * ny0 * 1.2;
  }
  addSquash(b, -nx0, -ny0, Math.min(SQUASH_MAX, (min - dist) / Math.max(4, b.r)));
}

export function idleCoversMouth(
  b: WellBody,
  mouth: { x: number; y: number },
  keepR: number,
  now: number
): boolean {
  if (fallingIntoMouth(b, now)) return false;
  return Math.hypot(b.x - mouth.x, b.y - mouth.y) < keepR + b.r - 0.45;
}

function softWalls(b: WellBody, w: number, h: number) {
  const ox = b.x;
  const oy = b.y;
  b.x = clampPlay(b.x, b.r, w);
  b.y = clampPlay(b.y, b.r, h);
  if (b.x !== ox && (b.x - ox) * b.vx < 0) b.vx *= 0.2;
  if (b.y !== oy && (b.y - oy) * b.vy < 0) b.vy *= 0.2;
}

function capSpeed(b: WellBody, max: number) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > max) {
    const s = max / sp;
    b.vx *= s;
    b.vy *= s;
  }
}

export function stepWell(
  bodies: WellBody[],
  w: number,
  h: number,
  dt: number,
  now: number,
  scale: WellScale = "home"
): void {
  for (const b of bodies) resetSquash(b);
  assignPackRadii(bodies, w, h, scale, dt);
  const mouth = attractorOf(w, h);
  const live = bodies.filter((b) => b.dying === "none" && !b.more);
  let maxLiveR = packMeanRadius(Math.max(1, live.length), w, h, scale);
  for (const b of live) maxLiveR = Math.max(maxLiveR, b.r);
  const rim = mouthRim(w, h, scale, maxLiveR);
  const { lo, hi } = poolFeeRange(live.length ? live : bodies);
  const catX = new Map<string, { x: number; y: number; n: number }>();
  for (const b of live) {
    const c = catX.get(b.category) ?? { x: 0, y: 0, n: 0 };
    c.x += b.x;
    c.y += b.y;
    c.n += 1;
    catX.set(b.category, c);
  }

  for (const b of bodies) {
    if (b.dying === "fade") {
      const u = Math.min(1, (now - b.dieT0) / Math.max(1, b.dieDur));
      b.alpha = 1 - u;
      b.vx *= 0.8;
      b.vy *= 0.8;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      continue;
    }
    if (b.dying === "seal") {
      if (sealAge(b, now) < 0) {
        b.vx *= 0.86;
        b.vy *= 0.86;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r = b.r0;
        b.alpha = 1;
        continue;
      }
      const u = sealProgress(b, now);
      const lift = Math.sin(Math.PI * u) * Math.min(12, h * 0.14);
      const exit = sealExit(h);
      const nx = b.sealX0 + (exit.x - b.sealX0) * u;
      const ny = b.sealY0 + (exit.y - b.sealY0) * u - lift;
      if (dt > 1e-4) {
        b.vx = (nx - b.x) / dt;
        b.vy = (ny - b.y) / dt;
      }
      b.x = nx;
      b.y = ny;
      b.r = b.r0;
      b.alpha = u < 0.58 ? 1 : Math.max(0, 1 - (u - 0.58) / 0.42);
      continue;
    }
    if (b.dying === "recoil") {
      b.vx += 220 * dt;
      b.vy *= 0.9;
      capSpeed(b, 48);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      continue;
    }
    if (b.more) {
      const tx = w * 0.88;
      const ty = h * 0.48;
      b.vx += (tx - b.x) * 2.2 * dt;
      b.vy += (ty - b.y) * 2.2 * dt;
      b.vx *= DAMP;
      b.vy *= DAMP;
      capSpeed(b, IDLE_CAP);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      continue;
    }

    b.theta = clampTheta(b.theta + b.omega * dt);
    const targetR = orbitRadius(b.feeRate, lo, hi, rim.rMouth, rim.rRim);
    const tx = clampPlay(mouth.x + Math.cos(b.theta) * targetR, b.r, w);
    const ty = clampPlay(mouth.y + Math.sin(b.theta) * targetR, b.r, h);
    const spawn = now - b.born < SPAWN_MS;
    const stunned = now < b.stunUntil;
    const steer = spawn ? STEER * 1.8 : stunned ? STEER * 0.035 : STEER;
    b.vx += (tx - b.x) * steer * dt;
    b.vy += (ty - b.y) * steer * dt;
    if (stunned) brownianKick(b, now, dt);
    const cat = catX.get(b.category);
    if (cat && cat.n > 1 && !stunned) {
      b.vx += (cat.x / cat.n - b.x) * CAT_PULL * dt * 0.08;
      b.vy += (cat.y / cat.n - b.y) * CAT_PULL * dt * 0.08;
    }
    b.vx *= stunned ? 0.987 : DAMP;
    b.vy *= stunned ? 0.987 : DAMP;
    capSpeed(b, spawn ? 88 : stunned ? POKE_CAP : IDLE_CAP);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  const n = bodies.length;
  for (let pass = 0; pass < COLLIDE_PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) collide(bodies[i], bodies[j], now);
    }
  }
  for (const b of bodies) {
    if (b.dying === "fade") continue;
    if (b.dying !== "seal") softWalls(b, w, h);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) collide(bodies[i], bodies[j], now);
  }
  for (const b of bodies) {
    if (b.dying === "fade" || fallingIntoMouth(b, now)) continue;
    softWalls(b, w, h);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) gatherSquash(bodies[i], bodies[j], now);
  }
}

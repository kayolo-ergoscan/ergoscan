/**
 * Home «network» block: the week of price, hashrate, transactions and fees on one time axis.
 * Pure helpers (no React): series from the home snapshot, 6 h sums, scales, SVG paths, day ticks.
 * Everything here comes from data the page already has; nothing is fetched.
 */

export type NetPt = { t: number; v: number };
/** A sum over one display bin. `open`: the bin is still filling (the hour now). */
export type NetBin = { t: number; t1: number; v: number; open: boolean; known: boolean };

export type ActivityHour = { t: number; txs: number; feesErg: number; feesKnown?: boolean };

export const NET_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
export const NET_BIN_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Finite, positive, time-ordered points. */
export function cleanLine(points: readonly NetPt[]): NetPt[] {
  const out = points.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Hourly activity summed into UTC walls of `binMs`. A wall whose last hour is not in yet is `open`
 * (its sum is the part so far). Fees count only the hours whose fees are known.
 */
export function binActivity(
  hours: readonly ActivityHour[],
  key: "txs" | "feesErg",
  binMs = NET_BIN_MS
): NetBin[] {
  if (!hours.length) return [];
  const last = Math.max(...hours.map((h) => h.t));
  const first = Math.min(...hours.map((h) => h.t));
  const groups = new Map<number, { v: number; n: number; known: boolean }>();
  for (const h of hours) {
    if (!Number.isFinite(h.t)) continue;
    const t = Math.floor(h.t / binMs) * binMs;
    const g = groups.get(t) ?? { v: 0, n: 0, known: false };
    const isFee = key === "feesErg";
    const known = !isFee || h.feesKnown !== false;
    const v = Number(h[key]);
    if (known && Number.isFinite(v) && v >= 0) {
      g.v += v;
      g.known = true;
    }
    g.n += 1;
    groups.set(t, g);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    // A wall the week cuts at either end holds only part of its hours: drawn as a ghost.
    .map(([t, g]) => ({ t, t1: t + binMs, v: g.v, known: g.known, open: t + binMs - HOUR_MS > last || t < first }));
}

/** The shared week: ends at the newest point of any series. */
export function netDomain(...series: ReadonlyArray<readonly { t: number }[]>): [number, number] {
  let t1 = 0;
  for (const s of series) for (const p of s) if (p.t > t1) t1 = p.t;
  if (!t1) t1 = Date.now();
  // Hourly points carry their hour's start: the week ends where the newest hour does.
  t1 = Math.ceil((t1 + 1) / HOUR_MS) * HOUR_MS;
  return [t1 - NET_SPAN_MS, t1];
}

/** Value range of a line, with a little air. */
export function extent(vals: readonly number[]): [number, number] {
  const xs = vals.filter((v) => Number.isFinite(v));
  if (!xs.length) return [0, 1];
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  if (hi === lo) {
    const d = Math.abs(hi) * 0.05 || 1;
    return [lo - d, hi + d];
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

export type Frame = { w: number; h: number; t0: number; t1: number; lo: number; hi: number; top?: number; bottom?: number };

export function xOf(f: Frame, t: number): number {
  return ((t - f.t0) / (f.t1 - f.t0)) * f.w;
}

export function yOf(f: Frame, v: number): number {
  const top = f.top ?? 2;
  const bottom = f.bottom ?? 2;
  const span = f.hi - f.lo || 1;
  return top + (1 - (v - f.lo) / span) * (f.h - top - bottom);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Polyline through the points inside the frame's week. */
export function linePath(f: Frame, pts: readonly NetPt[]): string {
  let d = "";
  for (const p of pts) {
    if (p.t < f.t0 - HOUR_MS) continue;
    d += `${d ? "L" : "M"}${r1(xOf(f, p.t))} ${r1(yOf(f, p.v))}`;
  }
  return d;
}

/** The line closed down to the frame's floor: the area wash under it. */
export function areaPath(f: Frame, pts: readonly NetPt[]): string {
  const inside = pts.filter((p) => p.t >= f.t0 - HOUR_MS);
  if (inside.length < 2) return "";
  const floor = r1(f.h);
  return `${linePath(f, inside)}L${r1(xOf(f, inside[inside.length - 1]!.t))} ${floor}L${r1(xOf(f, inside[0]!.t))} ${floor}Z`;
}

/**
 * Top of a column scale. One hour of fees can be fifty times a usual one; on a plain scale every
 * other column is a hairline. When the tallest is over 4× the 90th percentile the scale stops at
 * 2.2× that percentile and the taller columns are drawn cut (a surface notch near the top).
 */
export function barCeiling(vals: readonly number[]): { hi: number; clip: boolean } {
  const xs = vals.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!xs.length) return { hi: 1, clip: false };
  const max = xs[xs.length - 1]!;
  const p90 = xs[Math.floor((xs.length - 1) * 0.9)]!;
  if (p90 > 0 && max > p90 * 4) return { hi: p90 * 2.2, clip: true };
  return { hi: max > 0 ? max : 1, clip: false };
}

export type BarPaths = {
  closed: string;
  open: string;
  /** Notches across the columns cut by the ceiling, painted in the surface colour. */
  cut: string;
};

/**
 * One column per bin: ≤ 24 px wide, a 2 px gap at least, 4 px rounded data end, square at the
 * baseline. Returns one path for all closed bins and one for the open bins (drawn as a ghost).
 */
export function barPaths(f: Frame, bins: readonly NetBin[], maxW = 24): BarPaths {
  let closed = "";
  let open = "";
  let cut = "";
  if (!bins.length) return { closed, open, cut };
  const pitch = xOf(f, bins[0]!.t1) - xOf(f, bins[0]!.t);
  const bw = Math.max(1, Math.min(maxW, pitch - Math.max(2, pitch * 0.32)));
  const base = f.h - (f.bottom ?? 0);
  for (const b of bins) {
    if (b.t1 <= f.t0 || !b.known) continue;
    const cx = (xOf(f, Math.max(b.t, f.t0)) + xOf(f, b.t1)) / 2;
    const x = cx - bw / 2;
    const over = b.v > f.hi;
    const y = yOf(f, over ? f.hi : b.v);
    const hgt = base - y;
    if (hgt < 0.5) continue;
    const r = Math.min(4, bw / 2, hgt);
    const seg =
      `M${r1(x)} ${r1(base)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}` +
      `H${r1(x + bw - r)}Q${r1(x + bw)} ${r1(y)} ${r1(x + bw)} ${r1(y + r)}V${r1(base)}Z`;
    if (b.open) open += seg;
    else closed += seg;
    if (over) {
      const ny = y + Math.min(6, hgt / 3);
      cut += `M${r1(x - 0.5)} ${r1(ny)}h${r1(bw + 1)}v2h${r1(-bw - 1)}Z`;
    }
  }
  return { closed, open, cut };
}

/** UTC midnights inside the week, every `every` days. */
export function dayTicks(t0: number, t1: number, every = 1): number[] {
  const day = 24 * HOUR_MS;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / day) * day; t < t1; t += day * every) out.push(t);
  return out;
}

/** Index of the point nearest to t (points sorted by t). */
export function nearestIndex(pts: readonly { t: number }[], t: number): number {
  if (!pts.length) return -1;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo]!.t - t) <= Math.abs(pts[hi]!.t - t) ? lo : hi;
}

/** Index of the bin that holds t, or -1. */
export function binIndex(bins: readonly NetBin[], t: number): number {
  for (let i = 0; i < bins.length; i++) if (t >= bins[i]!.t && t < bins[i]!.t1) return i;
  return -1;
}

/**
 * `next` unless it holds the same rows as `prev` (same length, same values under `keys`): then `prev`,
 * so a snapshot that changed nothing keeps the array a memo already knows.
 */
export function sameRows<A extends readonly object[]>(prev: A, next: A, keys: readonly (keyof A[number])[]): A {
  if (prev === next) return prev;
  if (prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a: A[number] = prev[i]!;
    const b: A[number] = next[i]!;
    for (const k of keys) if (a[k] !== b[k]) return next;
  }
  return prev;
}

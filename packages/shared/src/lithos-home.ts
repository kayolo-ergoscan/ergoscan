/**
 * Home card «Lithos»: a small cut of the Lithos snapshot (`snapshot_kv.lithos_protocol`), built by
 * the gateway for `/v1/page/home` from the row the indexer already writes. No table, no new row.
 */
import { DAY_MS, parseLithosStats, type LithosDay, type LithosRound } from "./lithos-protocol.js";

/** Most seam marks we send. The busiest week so far had ~350 Lithos blocks. */
const SEAM_MAX = 600;

export type LithosHome = {
  v: 1;
  tip: { height: number; ts: number };
  /** Hashrate estimate over the window (7 days, at least 20 blocks). */
  hash: { hs: number; err: number; n: number; netN: number; from: number; to: number } | null;
  /** NISP lower bound, H/s. */
  nispHs: number | null;
  /** Whole network now, H/s. */
  netHs: number | null;
  blocks: { total: number; d1: number; d7: number };
  miners: { round: number | null; registry: number | null };
  /** Rounds collecting NISPs, newest first. */
  holding: LithosRound[];
  /** Rounds in the fraud-proof window, nearest to payout first. */
  evaluation: LithosRound[];
  payoutN: number;
  payoutNano: number;
  /** Newest find. */
  last: { h: number; ts: number } | null;
  /**
   * Lithos blocks inside the hash window as minutes after `hash.from`, oldest first. Exact for the
   * finds the snapshot lists; older ones are spread evenly inside their UTC day (`approx`).
   */
  seam: { at: number[]; approx: boolean } | null;
};

export type LithosFindMark = { h: number; ts: number };

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
}

/** `[[height, ts], …]` or `[{height, ts}, …]` → finds, newest first. */
export function parseFindMarks(raw: unknown): LithosFindMark[] {
  if (!Array.isArray(raw)) return [];
  const out: LithosFindMark[] = [];
  for (const row of raw) {
    const h = num(Array.isArray(row) ? row[0] : (row as { height?: unknown; h?: unknown })?.height ?? (row as { h?: unknown })?.h);
    const ts = num(Array.isArray(row) ? row[1] : (row as { ts?: unknown })?.ts);
    if (h != null && h > 0 && ts != null && ts > 0) out.push({ h, ts });
  }
  return out.sort((a, b) => b.h - a.h);
}

/**
 * Where the window's Lithos blocks sit in time. `finds` (newest first) give exact times; when the
 * window holds more blocks than that, the daily series fills the older part day by day.
 */
export function lithosSeam(
  win: { from: number; to: number; n: number },
  finds: readonly LithosFindMark[],
  series: readonly LithosDay[]
): { at: number[]; approx: boolean } {
  const { from, to, n } = win;
  if (!(to > from) || n <= 0) return { at: [], approx: false };
  const exact = finds.filter((f) => f.ts > from && f.ts <= to).map((f) => f.ts);
  const times = exact.slice();
  let missing = n - exact.length;
  let approx = false;
  if (missing > 0) {
    const edge = exact.length ? Math.min(...exact) : to + 1;
    const byDay = new Map(series.map((d) => [d.d, d.lb]));
    for (let d = Math.floor((edge - 1) / DAY_MS); d >= Math.floor(from / DAY_MS) && missing > 0; d--) {
      const dayStart = d * DAY_MS;
      const known = exact.filter((ts) => ts >= dayStart && ts < dayStart + DAY_MS).length;
      const left = Math.min(missing, Math.max(0, (byDay.get(d) ?? 0) - known));
      if (!left) continue;
      const a = Math.max(from + 1, dayStart);
      const b = Math.min(edge, dayStart + DAY_MS);
      if (!(b > a)) continue;
      for (let i = 0; i < left; i++) times.push(a + ((i + 0.5) / left) * (b - a));
      missing -= left;
      approx = true;
    }
  }
  const at = times
    .sort((x, y) => x - y)
    .slice(-SEAM_MAX)
    .map((ts) => Math.max(0, Math.round((ts - from) / 60_000)));
  return { at, approx };
}

/** The home cut from the snapshot's `stats` and its find list. Null when the stats are not there yet. */
export function lithosHomeFromSnapshot(statsRaw: unknown, findsRaw: unknown): LithosHome | null {
  const st = parseLithosStats(statsRaw);
  if (!st) return null;
  const finds = parseFindMarks(findsRaw);
  const hash = st.hash
    ? { hs: st.hash.hs, err: st.hash.err, n: st.hash.n, netN: st.hash.netN, from: st.hash.from, to: st.hash.to }
    : null;
  return {
    v: 1,
    tip: st.tip,
    hash,
    nispHs: st.nisp?.hs ?? null,
    netHs: st.netHs,
    blocks: { total: st.blocks.total, d1: st.blocks.d1, d7: st.blocks.d7 },
    miners: st.miners,
    holding: st.rounds.holding.slice().sort((a, b) => b.h - a.h).slice(0, 4),
    evaluation: st.rounds.evaluation.slice().sort((a, b) => a.start - b.start).slice(0, 4),
    payoutN: st.rounds.payoutN,
    payoutNano: st.rounds.payoutNano,
    last: finds[0] ?? null,
    seam: hash ? lithosSeam(hash, finds, st.series) : null,
  };
}

function round(raw: unknown): LithosRound | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const h = num(r?.h);
  if (!r || h == null || h <= 0) return null;
  const nn = (v: unknown) => Math.max(0, num(v) ?? 0);
  return { h, start: nn(r.start), miners: nn(r.miners), bank: nn(r.bank) };
}

/** Defensive read of `/v1/page/home` `lithos`. Null when absent or not v1. */
export function parseLithosHome(raw: unknown): LithosHome | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || r.v !== 1) return null;
  const tip = r.tip as Record<string, unknown> | undefined;
  const height = num(tip?.height);
  const ts = num(tip?.ts);
  if (height == null || ts == null) return null;
  const nn = (v: unknown) => Math.max(0, num(v) ?? 0);
  const h = r.hash as Record<string, unknown> | null | undefined;
  const hs = num(h?.hs);
  const blocks = (r.blocks ?? {}) as Record<string, unknown>;
  const miners = (r.miners ?? {}) as Record<string, unknown>;
  const last = r.last as Record<string, unknown> | null | undefined;
  const seam = r.seam as Record<string, unknown> | null | undefined;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(round).filter((x): x is LithosRound => x != null) : []);
  return {
    v: 1,
    tip: { height, ts },
    hash:
      h && hs != null && hs >= 0 && nn(h.n) > 0 && nn(h.to) > nn(h.from)
        ? { hs, err: nn(h.err), n: nn(h.n), netN: nn(h.netN), from: nn(h.from), to: nn(h.to) }
        : null,
    nispHs: num(r.nispHs),
    netHs: num(r.netHs),
    blocks: { total: nn(blocks.total), d1: nn(blocks.d1), d7: nn(blocks.d7) },
    miners: { round: num(miners.round), registry: num(miners.registry) },
    holding: list(r.holding),
    evaluation: list(r.evaluation),
    payoutN: nn(r.payoutN),
    payoutNano: nn(r.payoutNano),
    last: last && num(last.h) != null && num(last.ts) != null ? { h: num(last.h)!, ts: num(last.ts)! } : null,
    seam:
      seam && Array.isArray(seam.at)
        ? {
            at: seam.at.map(num).filter((x): x is number => x != null && x >= 0).slice(0, SEAM_MAX),
            approx: seam.approx === true,
          }
        : null,
  };
}

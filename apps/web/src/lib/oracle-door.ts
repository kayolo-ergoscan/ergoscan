import { ORACLE_BLOCK_MS, ORACLE_FEEDS, type OracleFeedSlug } from "@ergoscan/shared";
import type { OracleFeedPack, OracleTick } from "./oracle-feed";

export const DOOR_SPARK_DAYS = 7;
const DAY_MS = 86_400_000;

/** What an /oracles card needs from a feed pack: small enough to ship with the page. */
export type OracleDoorSummary = {
  slug: OracleFeedSlug;
  quote: number | null;
  /** When the pool answer last moved on chain (ms), from its newest tick or the block age. */
  lastMs: number | null;
  /** Quotes over the last 7 days, oldest first, one per bucket. */
  spark: number[];
};

/**
 * One quote per time bucket (the bucket's last), oldest first. Empty buckets are skipped,
 * so a quiet stretch draws as a straight line rather than a drop.
 */
export function sparkQuotes(
  ticks: readonly OracleTick[],
  now: number,
  days = DOOR_SPARK_DAYS,
  buckets = 56
): number[] {
  const since = now - days * DAY_MS;
  const width = (now - since) / buckets;
  const last = new Map<number, { t: number; q: number }>();
  for (const tick of ticks) {
    const t = tick.t;
    if (t == null || !Number.isFinite(t) || t < since || t > now) continue;
    if (!Number.isFinite(tick.quote) || tick.quote <= 0) continue;
    const i = Math.min(buckets - 1, Math.floor((t - since) / width));
    const prev = last.get(i);
    if (!prev || t >= prev.t) last.set(i, { t, q: tick.quote });
  }
  return [...last.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.q);
}

export function summarizeOracleFeed(pack: OracleFeedPack, now: number): OracleDoorSummary {
  let newest: number | null = null;
  for (const tick of pack.ticks) {
    if (tick.t != null && Number.isFinite(tick.t) && (newest == null || tick.t > newest)) newest = tick.t;
  }
  let lastMs = newest;
  if (lastMs == null && pack.height != null && pack.tipHeight != null && pack.tipHeight >= pack.height) {
    lastMs = now - (pack.tipHeight - pack.height) * ORACLE_BLOCK_MS;
  }
  const quote = pack.quote != null && Number.isFinite(pack.quote) && pack.quote > 0 ? pack.quote : null;
  return { slug: pack.slug, quote, lastMs, spark: sparkQuotes(pack.ticks, now) };
}

export type DoorFreshness = "fresh" | "late" | "stale";

/**
 * Fresh within two heartbeats of the pool, late within four, stale after that.
 * The pool posts once per epoch (6 blocks for the USD pools, 30 for gold).
 */
export function doorFreshness(slug: OracleFeedSlug, lastMs: number | null, now: number): DoorFreshness | null {
  if (lastMs == null || !Number.isFinite(lastMs)) return null;
  const beat = ORACLE_FEEDS[slug].epochLength * ORACLE_BLOCK_MS;
  const age = Math.max(0, now - lastMs);
  if (age <= beat * 2) return "fresh";
  if (age <= beat * 4) return "late";
  return "stale";
}

/** An SVG polyline through the values, scaled to w×h with a pad so the stroke never clips. */
export function sparkPath(values: readonly number[], w: number, h: number, pad = 2): string {
  if (values.length < 2) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || Math.abs(hi) || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

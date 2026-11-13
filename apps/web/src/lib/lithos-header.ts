/**
 * Pure helpers for the /lithos header: the rolling chart series, the round pipeline and the
 * short texts (spans, windows, hashrate). The figures themselves come from the snapshot
 * (`stats`, shared `lithos-protocol.ts`); nothing here reads the chain.
 */
import {
  DAY_MS,
  ERGO_BLOCK_SECONDS,
  LITHOS_EVAL_PERIOD,
  LITHOS_HOLDING_PERIOD,
  type LithosDay,
  type LithosProtocolStats,
} from "@ergoscan/shared";
import { formatGroupedNumber } from "./format";

export const LITHOS_ROLL_DAYS = 7;

export type LithosRollPoint = {
  d: number;
  /** Lithos GH/s over the rolling window. */
  ghs: number;
  lo: number;
  hi: number;
  /** Lithos blocks in the window. */
  n: number;
  /** All blocks in the window. */
  nb: number;
  /** Lithos share of blocks in the window, %. */
  share: number;
  shareLo: number;
  shareHi: number;
  /** The window ends on today's partial day. */
  partial: boolean;
};

/**
 * Rolling `days`-day window ending on each day: Σ Lithos difficulty ÷ seconds covered (GH/s),
 * Σ Lithos blocks ÷ Σ all blocks (share). Bands are ±1/√n on the window's block count.
 */
export function rollingSeries(series: readonly LithosDay[], days = LITHOS_ROLL_DAYS): LithosRollPoint[] {
  const out: LithosRollPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    let lg = 0;
    let n = 0;
    let nb = 0;
    let sec = 0;
    for (let j = Math.max(0, i - days + 1); j <= i; j++) {
      const day = series[j]!;
      lg += day.lg;
      n += day.lb;
      nb += day.nb;
      sec += day.s ?? 86_400;
    }
    const ghs = sec > 0 ? lg / sec : 0;
    const share = nb > 0 ? (n / nb) * 100 : 0;
    const err = n > 0 ? 1 / Math.sqrt(n) : 0;
    out.push({
      d: series[i]!.d,
      ghs,
      lo: Math.max(0, ghs * (1 - err)),
      hi: ghs * (1 + err),
      n,
      nb,
      share,
      shareLo: Math.max(0, share * (1 - err)),
      shareHi: share * (1 + err),
      partial: series[i]!.s != null,
    });
  }
  return out;
}

function isRu(locale: string): boolean {
  return locale === "ru" || locale.startsWith("ru-");
}

/**
 * A span of time, short: `7 ч 04 мин` / `7 h 04 min`, `45 мин`, `1 д 3 ч`. `coarse` drops the
 * minutes from 3 hours up (an average, not a clock).
 */
export function formatSpan(ms: number, locale: string, coarse = false): string {
  const ru = isRu(locale);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60_000));
  const H = ru ? "ч" : "h";
  const M = ru ? "мин" : "min";
  const D = ru ? "д" : "d";
  if (min < 60) return `${Math.max(1, min)} ${M}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d} ${D} ${rh} ${H}` : `${d} ${D}`;
  }
  if (coarse && h >= 3) return `${Math.round(min / 60)} ${H}`;
  return `${h} ${H} ${String(m).padStart(2, "0")} ${M}`;
}

/** A window length in days: `7`, `8.4`. */
export function formatWindowDays(ms: number, locale: string): string {
  const days = ms / DAY_MS;
  if (!Number.isFinite(days) || days <= 0) return "—";
  if (Math.abs(days - Math.round(days)) < 0.05) return String(Math.round(days));
  return formatGroupedNumber(days, 1, 1, locale);
}

/** `1.83` + `GH/s`: the figure and its unit apart, so the unit can be set small. */
export function splitHashrate(hs: number | null | undefined): { value: string; unit: string } | null {
  if (hs == null || !Number.isFinite(hs) || hs <= 0) return null;
  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s"];
  let v = hs;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  const d = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return { value: v.toFixed(d), unit: units[i]! };
}

export function hashrateText(hs: number | null | undefined): string {
  const p = splitHashrate(hs);
  return p ? `${p.value} ${p.unit}` : "—";
}

/** A share in %, two decimals under 10. */
export function formatShare(pct: number, locale: string): string {
  if (!Number.isFinite(pct)) return "—";
  return formatGroupedNumber(pct, pct < 10 ? 2 : 1, pct < 10 ? 2 : 1, locale);
}

/** `35 и 121` / `35 and 121`; more than three: `35, 121, 200 и ещё 2`. */
export function joinAnd(items: string[], locale: string): string {
  const and = isRu(locale) ? "и" : "and";
  if (items.length <= 1) return items[0] ?? "";
  if (items.length <= 3) return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
  const more = isRu(locale) ? `ещё ${items.length - 3}` : `${items.length - 3} more`;
  return `${items.slice(0, 3).join(", ")} ${and} ${more}`;
}

export type PipelineMark = {
  h: number;
  miners: number;
  bank: number;
  /** 0..1 along its stage. */
  at: number;
  /** Blocks until the stage ends; 0 when it is over and the box waits for the next step. */
  left: number;
};

export type LithosPipeline = {
  collect: PipelineMark[];
  check: PipelineMark[];
  payoutN: number;
  payoutNano: number;
};

/** Where each live round stands: blocks since its phase began, over the phase length. */
export function lithosPipeline(stats: LithosProtocolStats): LithosPipeline {
  const tip = stats.tip.height;
  const mark = (period: number) => (r: { h: number; start: number; miners: number; bank: number }): PipelineMark => {
    const age = Math.max(0, tip - r.start);
    return {
      h: r.h,
      miners: r.miners,
      bank: r.bank,
      at: Math.min(1, age / period),
      left: Math.max(0, period - age),
    };
  };
  return {
    collect: stats.rounds.holding.map(mark(LITHOS_HOLDING_PERIOD)).sort((a, b) => b.h - a.h),
    check: stats.rounds.evaluation.map(mark(LITHOS_EVAL_PERIOD)).sort((a, b) => a.left - b.left),
    payoutN: stats.rounds.payoutN,
    payoutNano: stats.rounds.payoutNano,
  };
}

/** Blocks → time at Ergo's 2-minute target. */
export function blocksToMs(blocks: number): number {
  return blocks * ERGO_BLOCK_SECONDS * 1000;
}

/** 0 and up to three round steps covering `max` (1·2·5 × 10^k). */
export function niceTicks(max: number, count = 3): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** nanoERG → ERG text with `frac` decimals. */
export function ergText(nano: number, locale: string, frac = 2): string {
  return formatGroupedNumber(nano / 1e9, frac, frac, locale);
}

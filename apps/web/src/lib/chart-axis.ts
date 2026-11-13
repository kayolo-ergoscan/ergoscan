import { formatDottedDay, formatGroupedNumber, formatH24 } from "./format";

/**
 * Phone charts. Below this width a chart keeps about three round y labels inside the plot,
 * three or four dates under it, and reads the point under a finger into its own header.
 */
export const PHONE_CHART_QUERY = "(max-width: 767px)";

/** Plot height a phone chart keeps (the readout line sits above it). */
export const PHONE_CHART_PX = 160;
export const PHONE_READOUT_PX = 24;

/** Most dates under a phone chart. */
export const PHONE_X_LABELS = 4;

/** Two y labels closer than this (px) would touch: a label is about 13 px tall. */
export const Y_LABEL_GAP_PX = 18;

function clean(v: number, step: number): number {
  const d = stepDigits(step) + 2;
  return Number(v.toFixed(Math.min(20, d)));
}

/**
 * Up to `count` round values inside (min, max) for a y axis whose labels sit inside the plot.
 * The top label keeps a label's height from the top edge, so it never clips; labels never come
 * closer than `gapPx` when the plot is `plotPx` tall. Fewer ticks, never crowded ones.
 */
export function insideTicks(
  min: number,
  max: number,
  count = 3,
  plotPx = PHONE_CHART_PX,
  gapPx = Y_LABEL_GAP_PX
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || count < 1) return [];
  const span = max - min;
  const pxPerUnit = plotPx > 0 ? plotPx / span : Infinity;
  // A label stands on its line, so the top one needs a label's height of room.
  const hi = max - (plotPx > 0 ? (14 / plotPx) * span : span * 0.08);
  const lo = min;
  if (hi <= lo) return [];
  // Finest round step first: the first one that fits gives the most labels, up to `count`.
  const top = Math.floor(Math.log10(span));
  for (let e = top - 3; e <= top + 1; e++) {
    for (const f of [1, 2, 2.5, 3, 4, 5]) {
      const step = f * 10 ** e;
      if (step * pxPerUnit < gapPx) continue;
      const out: number[] = [];
      for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) {
        out.push(clean(v, step));
        if (out.length > count) break;
      }
      if (out.length >= 1 && out.length <= count) return out;
    }
  }
  return [];
}

/** Digits after the point a step needs: 0.05 → 2, 2.5 → 1, 100 → 0. */
export function stepDigits(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let d = 0; d <= 10; d++) {
    const scaled = step * 10 ** d;
    const r = Math.round(scaled);
    if (r >= 1 && Math.abs(scaled - r) < 1e-6 * r) return d;
  }
  return 10;
}

/** The step between sorted ticks (their smallest gap). */
export function tickStep(ticks: number[]): number {
  let step = Infinity;
  for (let i = 1; i < ticks.length; i++) step = Math.min(step, ticks[i]! - ticks[i - 1]!);
  if (Number.isFinite(step) && step > 0) return step;
  const one = Math.abs(ticks[0] ?? 0);
  return one > 0 ? 10 ** Math.floor(Math.log10(one)) : 1;
}

/**
 * Bare axis figure; the unit lives once in the chart header.
 * 30k / 1.5M for big values, otherwise as many digits as the step needs.
 */
export function tickText(v: number, step: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1_000_000 && step >= 100_000) {
    return `${formatGroupedNumber(v / 1_000_000, 0, stepDigits(step / 1_000_000))}M`;
  }
  if (a >= 10_000 && step >= 1_000) {
    return `${formatGroupedNumber(v / 1_000, 0, stepDigits(step / 1_000))}k`;
  }
  const d = stepDigits(step);
  return formatGroupedNumber(v, d, d);
}

/** At most `max` of the ticks, spread evenly; the first stays. */
export function thinTicks<T>(ticks: T[], max: number): T[] {
  if (max < 1) return [];
  if (ticks.length <= max) return ticks.slice();
  const every = Math.ceil(ticks.length / max);
  return ticks.filter((_, i) => i % every === 0);
}

/**
 * Labels along one line that would not overlap: `at` is each label's centre (px, any order),
 * `size` its extent. Keeps a label only when it clears the last kept one by `gap`.
 * Returns the kept indexes in position order.
 */
export function spreadLabels(items: { at: number; size: number }[], gap = 6): number[] {
  const order = items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => Number.isFinite(it.at) && it.size >= 0)
    .sort((a, b) => a.at - b.at);
  const kept: number[] = [];
  let edge = -Infinity;
  for (const it of order) {
    const lo = it.at - it.size / 2;
    if (lo < edge + gap) continue;
    kept.push(it.i);
    edge = it.at + it.size / 2;
  }
  return kept;
}

/** Min and max of the finite values, or null. */
export function finiteExtent(values: (number | null | undefined)[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a reading in a phone chart header happened, short enough to sit beside two values:
 * a day bin «12.11», a part-day bin «12.11 00–12», a raw point «12.11 23:23».
 */
export function readoutWhen(t: number, windowMs: number, timeZone = "UTC"): string {
  const day = formatDottedDay(t, timeZone);
  if (windowMs >= DAY_MS) return day;
  if (windowMs > 0) {
    const a = formatH24(t, timeZone, false);
    const b = formatH24(t + windowMs, timeZone, false);
    const hh = (s: string) => (s.endsWith(":00") ? s.slice(0, 2) : s);
    return `${day} ${hh(a)}–${hh(b) === "00" ? "24" : hh(b)}`;
  }
  return `${day} ${formatH24(t, timeZone, false)}`;
}

/** Width of a 10 px mono axis figure, per glyph. */
const LABEL_GLYPH_PX = 6.2;

/**
 * The right boundary gap (a fraction of the x span) that ends the line before the y labels
 * standing inside the plot's right edge, so the latest point and its pulse never sit on a label.
 * The left gap is `leftGap` of the span, as the charts already draw it.
 */
export function labelGutter(labels: string[], plotPx: number, leftGap = 0.02, padPx = 8): number {
  const widest = labels.reduce((w, s) => Math.max(w, s.length), 0);
  if (!widest || !(plotPx > 0)) return leftGap;
  const px = widest * LABEL_GLYPH_PX + padPx;
  if (px >= plotPx * 0.5) return leftGap;
  return ((1 + leftGap) * px) / (plotPx - px);
}

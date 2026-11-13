/**
 * What lets the yard hold any load: the fee zone of a tx against the gateway's levels, the zone
 * marks on the ground with their labels, and the wrapped «+N» pallet for the txs it cannot draw one
 * by one.
 *
 * The zones are the gateway's own levels (`fees.histogram` → recommend): «Турбо» = p90 of what waits
 * now, «Норма» = p50. Nothing here invents a number: «+N» is the exact count of waiting txs that are
 * not drawn as their own crate.
 */
import { R, alpha, type Fees, type Inks } from "./common";

export type FeeZone = 0 | 1 | 2;

/** 2: at or above «Turbo», 1: at or above «Normal», 0: below. Without levels every tx is «Normal» (no marks). */
export function feeZone(rate: number, fees: Fees | null): FeeZone {
  if (!fees) return 1;
  if (rate >= fees.turbo) return 2;
  if (rate >= fees.normal) return 1;
  return 0;
}

/**
 * The gateway's formula (packages/shared buildFeeHistogram) on the txs the page holds, for when the
 * stream's own levels are not there (the HTTP poll gives the whole pool).
 */
export function feeLevels(rates: readonly number[]): Fees | null {
  if (!rates.length) return null;
  const s = [...rates].sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length * 0.5)] ?? 1000;
  const p90 = s[Math.floor(s.length * 0.9)] ?? p50 * 2;
  return { normal: Math.floor(p50), turbo: Math.floor(p90) };
}

export type ZoneSpan = { zone: FeeZone; x0: number; x1: number };

/** Runs of one zone along a row, from items already laid out left to right. */
export function zoneSpans<T>(items: readonly T[], zoneOf: (t: T) => FeeZone, x0Of: (t: T) => number, x1Of: (t: T) => number): ZoneSpan[] {
  const out: ZoneSpan[] = [];
  for (const it of items) {
    const z = zoneOf(it);
    const last = out[out.length - 1];
    if (last && last.zone === z) last.x1 = Math.max(last.x1, x1Of(it));
    else out.push({ zone: z, x0: x0Of(it), x1: x1Of(it) });
  }
  return out;
}

export type ZoneWords = { turbo: string; normal: string };

/**
 * Zone marks on the ground: a line under each zone (gold for «Turbo», light for «Normal», none
 * below), a tick where a zone starts, and its label; labels never overlap, they slide right.
 */
export function drawZoneMarks(ctx: CanvasRenderingContext2D, spans: readonly ZoneSpan[], y: number, inks: Inks, words: ZoneWords, small: boolean) {
  ctx.font = `${small ? 8 : 9}px ${inks.sans}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let free = -Infinity;
  for (const s of spans) {
    if (s.zone === 0) continue;
    const ink = s.zone === 2 ? (inks.day ? "#a77f1f" : "#ebcb71") : inks.day ? "#5f5a50" : "#cfc8ba";
    R(ctx, s.x0, y, Math.max(1, s.x1 - s.x0), 1, alpha(ink, s.zone === 2 ? 0.85 : 0.5));
    R(ctx, s.x0, y - 2, 1, 3, alpha(ink, 0.9));
    const label = s.zone === 2 ? words.turbo : words.normal;
    const x = Math.max(s.x0 + 2, free + 6);
    ctx.fillStyle = alpha(ink, s.zone === 2 ? 0.95 : 0.75);
    ctx.fillText(label, x, y + 2);
    free = x + ctx.measureText(label).width;
  }
}

/** The wrapped pallet: the waiting txs the yard does not draw one by one, with their count. */
export function drawPlusPallet(ctx: CanvasRenderingContext2D, x: number, ground: number, w: number, h: number, text: string, inks: Inks, small: boolean) {
  const top = ground - 2 - h;
  R(ctx, x, ground - 2, w, 2, inks.day ? "#a8865a" : "#7a5f3f");
  for (let i = x + 2; i < x + w - 1; i += 3) R(ctx, i, ground - 1, 1, 1, inks.day ? "#7a5f3f" : "#3a2c1d");
  for (let yy = top; yy < ground - 2; yy += 5) {
    R(ctx, x + 1, yy, w - 2, 4, inks.day ? "#b9b2a8" : "#4a4540");
    R(ctx, x + 1, yy, w - 2, 1, inks.day ? "#cdc6bb" : "#5a554e");
    for (let xx = x + 1 + ((yy >> 2) % 2) * 4; xx < x + w - 2; xx += 8) R(ctx, xx, yy + 1, 1, 3, inks.day ? "#a39c92" : "#3a3632");
  }
  R(ctx, x, top, w, ground - 2 - top, "rgba(214,220,226,0.16)");
  R(ctx, x + 2, top + 1, 1, ground - 4 - top, "rgba(240,244,248,0.35)");
  R(ctx, x, top, w, 1, "rgba(240,244,248,0.45)");
  ctx.font = `600 ${small ? 9 : 10}px ${inks.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inks.day ? "#14131a" : "#f3efe6";
  ctx.fillText(text, x + w / 2, top + (ground - 2 - top) / 2 + 1);
}

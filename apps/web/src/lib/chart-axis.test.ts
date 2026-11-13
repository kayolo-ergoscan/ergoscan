import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Y_LABEL_GAP_PX,
  finiteExtent,
  insideTicks,
  labelGutter,
  readoutWhen,
  spreadLabels,
  stepDigits,
  thinTicks,
  tickStep,
  tickText,
} from "./chart-axis";

function gapsPx(ticks: number[], min: number, max: number, plotPx: number): number[] {
  const k = plotPx / (max - min);
  return ticks.slice(1).map((v, i) => (v - ticks[i]!) * k);
}

test("oracle price scale: round ticks inside the padded extent, none crowded", () => {
  const min = 0.1557;
  const max = 0.2829;
  const ticks = insideTicks(min, max, 3, 160);
  assert.ok(ticks.length >= 2 && ticks.length <= 3, `got ${ticks}`);
  for (const v of ticks) assert.ok(v > min && v < max);
  for (const g of gapsPx(ticks, min, max, 160)) assert.ok(g >= Y_LABEL_GAP_PX);
  // Round values only: no 0.2829 or 0.1557 edge labels.
  for (const v of ticks) assert.equal(Number(v.toFixed(3)), v);
});

test("home fees scale 0…97.3: three labels, the top one leaves room under the edge", () => {
  const ticks = insideTicks(0, 97.3, 3, 160);
  assert.deepEqual(ticks, [0, 30, 60]);
  const top = ticks[ticks.length - 1]!;
  assert.ok(((97.3 - top) / 97.3) * 160 >= 14);
});

test("a short plot drops labels instead of letting them touch", () => {
  const ticks = insideTicks(0, 100, 3, 40);
  assert.ok(ticks.length <= 2);
  for (const g of gapsPx(ticks, 0, 100, 40)) assert.ok(g >= Y_LABEL_GAP_PX);
});

test("degenerate extents give no ticks", () => {
  assert.deepEqual(insideTicks(5, 5), []);
  assert.deepEqual(insideTicks(Number.NaN, 1), []);
  assert.deepEqual(insideTicks(2, 1), []);
});

test("rent ERG scale keeps whole figures", () => {
  const ticks = insideTicks(102.92, 209.1, 3, 160);
  assert.ok(ticks.length >= 2);
  const step = tickStep(ticks);
  assert.equal(stepDigits(step), 0);
  assert.equal(tickText(ticks[0]!, step).includes("."), false);
});

test("step digits", () => {
  assert.equal(stepDigits(100), 0);
  assert.equal(stepDigits(2.5), 1);
  assert.equal(stepDigits(0.05), 2);
  assert.equal(stepDigits(0.025), 3);
  assert.equal(stepDigits(0.0000002), 7);
});

test("tick text is bare and short", () => {
  assert.equal(tickText(30_000, 10_000), "30k");
  assert.equal(tickText(12_500, 2_500), "12.5k");
  assert.equal(tickText(1_500_000, 500_000), "1.5M");
  assert.equal(tickText(0.25, 0.05), "0.25");
  assert.equal(tickText(0.2, 0.05), "0.20");
  assert.equal(tickText(150, 50), "150");
  assert.equal(tickText(5_000, 1_000), "5 000");
});

test("thin ticks keeps at most max, evenly, first kept", () => {
  assert.deepEqual(thinTicks([1, 2, 3, 4, 5, 6, 7], 4), [1, 3, 5, 7]);
  assert.deepEqual(thinTicks([1, 2, 3], 4), [1, 2, 3]);
  assert.deepEqual(thinTicks([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 4, 7]);
  assert.deepEqual(thinTicks([1, 2], 0), []);
});

test("spread labels drops the ones that would overlap", () => {
  // 97.3 sat 9 px above 90.0 with 14 px tall labels.
  const kept = spreadLabels(
    [
      { at: 10, size: 14 },
      { at: 19, size: 14 },
      { at: 60, size: 14 },
      { at: 110, size: 14 },
    ],
    4
  );
  assert.deepEqual(kept, [0, 2, 3]);
  assert.deepEqual(spreadLabels([{ at: 50, size: 30 }, { at: 0, size: 30 }], 6), [1, 0]);
});

test("finite extent skips gaps", () => {
  assert.deepEqual(finiteExtent([3, null, 1, Number.NaN, 7]), { min: 1, max: 7 });
  assert.equal(finiteExtent([null, undefined]), null);
});

test("readout when: day bin, part-day bin, raw point", () => {
  const t = Date.UTC(2026, 10, 12, 0, 0);
  assert.equal(readoutWhen(t, 24 * 3600_000), "12.11");
  assert.equal(readoutWhen(t, 12 * 3600_000), "12.11 00–12");
  assert.equal(readoutWhen(Date.UTC(2026, 10, 12, 12), 12 * 3600_000), "12.11 12–24");
  assert.equal(readoutWhen(Date.UTC(2026, 10, 12, 23, 23), 0), "12.11 23:23");
});

test("label gutter ends the line where the y labels begin", () => {
  const plot = 300;
  const g = labelGutter(["0.18", "0.21", "0.24"], plot);
  // The line spans [0.02, 1.02] of a (1.02 + g) wide axis: its right end meets the label column.
  const lineEndPx = (plot * 1.02) / (1.02 + g);
  const labelPx = 4 * 6.2 + 8;
  assert.ok(Math.abs(plot - lineEndPx - labelPx) < 0.5);
  assert.equal(labelGutter([], plot), 0.02);
  assert.equal(labelGutter(["123456789012345678901234"], 200), 0.02);
});

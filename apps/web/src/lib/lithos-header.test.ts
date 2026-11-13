import assert from "node:assert/strict";
import { test } from "node:test";
import type { LithosDay, LithosProtocolStats } from "@ergoscan/shared";
import {
  formatShare,
  formatSpan,
  formatWindowDays,
  joinAnd,
  lithosPipeline,
  niceTicks,
  rollingSeries,
  splitHashrate,
} from "./lithos-header";

test("spans: clock under 3 h, coarse hours for averages, days", () => {
  assert.equal(formatSpan((7 * 60 + 4) * 60_000, "ru"), "7 ч 04 мин");
  assert.equal(formatSpan((7 * 60 + 4) * 60_000, "en"), "7 h 04 min");
  assert.equal(formatSpan(13.4 * 3_600_000, "ru", true), "13 ч");
  assert.equal(formatSpan(2.5 * 3_600_000, "ru", true), "2 ч 30 мин");
  assert.equal(formatSpan(45 * 60_000, "en"), "45 min");
  assert.equal(formatSpan(10_000, "ru"), "1 мин");
  assert.equal(formatSpan(27 * 3_600_000, "ru"), "1 д 3 ч");
  assert.equal(formatSpan(48 * 3_600_000, "en"), "2 d");
});

test("window days, share, hashrate split", () => {
  assert.equal(formatWindowDays(7 * 86_400_000, "ru"), "7");
  assert.equal(formatWindowDays(8.36 * 86_400_000, "en"), "8.4");
  assert.equal(formatShare(0.33484, "ru"), "0.33");
  assert.equal(formatShare(12.345, "en"), "12.3");
  assert.deepEqual(splitHashrate(1_830_098_090), { value: "1.83", unit: "GH/s" });
  assert.deepEqual(splitHashrate(493_243_299_703), { value: "493", unit: "GH/s" });
  assert.equal(splitHashrate(0), null);
});

test("joinAnd", () => {
  assert.equal(joinAnd(["35"], "ru"), "35");
  assert.equal(joinAnd(["35", "121"], "ru"), "35 и 121");
  assert.equal(joinAnd(["1", "2", "3"], "en"), "1, 2 and 3");
  assert.equal(joinAnd(["1", "2", "3", "4", "5"], "ru"), "1, 2, 3 и ещё 2");
});

test("rolling 7-day series: GH/s, share, band, partial day", () => {
  const days: LithosDay[] = Array.from({ length: 10 }, (_, i) => ({
    d: 20_000 + i,
    lb: 2,
    lg: 2 * 86_400, // 2 GH/s for a whole day
    nb: 720,
    ng: 0,
  }));
  days[9] = { ...days[9]!, lb: 1, lg: 43_200, nb: 360, s: 43_200 };
  const r = rollingSeries(days);
  assert.equal(r.length, 10);
  assert.equal(r[0]!.ghs, 2);
  assert.equal(r[6]!.n, 14);
  assert.ok(Math.abs(r[6]!.share - (14 / (7 * 720)) * 100) < 1e-9);
  assert.ok(Math.abs(r[6]!.lo - 2 * (1 - 1 / Math.sqrt(14))) < 1e-9);
  const last = r[9]!;
  assert.equal(last.partial, true);
  // 6 whole days + half a day.
  assert.ok(Math.abs(last.ghs - (6 * 2 * 86_400 + 43_200) / (6 * 86_400 + 43_200)) < 1e-9);
  assert.equal(last.n, 13);
});

test("pipeline: progress along each phase", () => {
  const stats = {
    tip: { height: 1_915_936, ts: 0 },
    rounds: {
      holding: [{ h: 1_915_708, start: 1_915_708, miners: 8, bank: 5_070_867_821 }],
      evaluation: [
        { h: 1_915_217, start: 1_915_578, miners: 7, bank: 4_413_559_747 },
        { h: 1_915_303, start: 1_915_664, miners: 7, bank: 8_156_800_013 },
      ],
      payoutN: 56,
      payoutNano: 1_742_536_573,
    },
  } as unknown as LithosProtocolStats;
  const p = lithosPipeline(stats);
  assert.equal(p.collect[0]!.left, 360 - 228);
  assert.ok(Math.abs(p.collect[0]!.at - 228 / 360) < 1e-9);
  assert.deepEqual(
    p.check.map((m) => m.left),
    [2, 88]
  );
  assert.equal(p.payoutN, 56);
});

test("nice ticks", () => {
  assert.deepEqual(niceTicks(57), [0, 20, 40, 60]);
  assert.deepEqual(niceTicks(37), [0, 20, 40]);
  assert.deepEqual(niceTicks(7.2), [0, 2.5, 5, 7.5]);
  assert.deepEqual(niceTicks(0), [0, 1]);
});

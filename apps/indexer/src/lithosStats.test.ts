import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_MS, utcDay, type LithosBlockSample, type LithosDay } from "@ergoscan/shared";
import { buildLithosStats, seriesRecomputeFrom, type LithosStatsInput } from "./lithosStats.js";

const H = 3_600_000;
// 13 Nov 2026 14:10 UTC, as in the prototype.
const TIP_TS = Date.UTC(2026, 10, 13, 14, 10);
const DIFF = 66_000_000_000_000_000n; // ≈ 550 GH/s × 120 s

function finds(): LithosBlockSample[] {
  // 3 in the last 24 h, 13 in 7 days, 40 more before that every 6 h.
  const out: LithosBlockSample[] = [];
  let h = 1_915_708;
  const recent = [7, 21, 23, 40, 60, 80, 100, 110, 120, 130, 140, 150, 160];
  for (const age of recent) out.push({ height: h--, ts: TIP_TS - age * H, diff: DIFF });
  for (let i = 1; i <= 40; i++) out.push({ height: h - i * 50, ts: TIP_TS - 7 * 24 * H - i * 6 * H, diff: DIFF });
  return out;
}

function input(over: Partial<LithosStatsInput> = {}): LithosStatsInput {
  return {
    tip: { height: 1_915_902, ts: TIP_TS, diff: DIFF },
    finds: finds(),
    netWindowN: 5_008,
    holding: [
      {
        creationHeight: 1_915_709,
        valueNano: 5_086_867_821,
        live: true,
        r5: "0410",
        r6: "060406df2f90",
        r7: "1103f8ece901f8ece9018090a10f",
      },
    ],
    evaluation: [
      {
        creationHeight: 1_915_577,
        valueNano: 4_427_559_747,
        live: true,
        r5: "040e",
        r6: "0604067e4ae0",
        r7: "1103f4eae901a2e5e90180feac0d",
      },
      // A spent evaluation box of an older round, and a garbage row.
      {
        creationHeight: 1_888_900,
        valueNano: 2_954_750_000,
        live: false,
        r5: "0404",
        r6: "0604008de820",
        r7: "1103cacee601f8c8e60180a4e803",
      },
      { creationHeight: 1, valueNano: 1, live: false, r5: null, r6: null, r7: null },
    ],
    payout: { n: 56, nano: 1_742_536_573 },
    collateral: { n: 100, nano: 295_259_001_125 },
    queue: { n: 180, nano: 530_686_000_000 },
    minerRegistry: 25,
    genesisNano: 2_934_900_013,
    litPool: { nano: 1_609_237_218_066n, lit: 590_100_861_106_397n },
    prevSeries: [],
    netDays: [],
    recomputeFrom: 0,
    ...over,
  };
}

test("headline figures from fixture rows", () => {
  const s = buildLithosStats(input());
  assert.equal(s.v, 1);
  assert.deepEqual(s.tip, { height: 1_915_902, ts: TIP_TS });
  assert.equal(s.netHs, Number(DIFF / 120n));
  // 13 blocks in 7 days → the window reaches back to the 21st newest block.
  assert.ok(s.hash);
  assert.equal(s.hash.n, 20);
  assert.equal(s.hash.extended, true);
  assert.equal(s.hash.netN, 5_008);
  assert.equal(s.hash.err, Math.round((1 / Math.sqrt(20)) * 10_000) / 10_000);
  const seconds = (s.hash.to - s.hash.from) / 1000;
  assert.equal(s.hash.hs, Math.round(Number(DIFF * 20n) / seconds));
  assert.deepEqual(s.blocks, { total: 53, d1: 3, d7: 13, launch: TIP_TS - 7 * 24 * H - 40 * 6 * H });
  assert.deepEqual(s.miners, { round: 8, registry: 25 });
  // NISP: the live holding round, Σscore 115 290 000 → ≈ 1.60 GH/s.
  assert.equal(s.nisp?.h, 1_915_708);
  assert.equal(s.nisp?.miners, 8);
  assert.ok(Math.abs((s.nisp?.hs ?? 0) / 1e9 - 1.601) < 0.001);
});

test("rounds, banks and collateral", () => {
  const s = buildLithosStats(input());
  assert.deepEqual(s.rounds.holding, [{ h: 1_915_708, start: 1_915_708, miners: 8, bank: 5_070_867_821 }]);
  assert.deepEqual(s.rounds.evaluation, [{ h: 1_915_217, start: 1_915_578, miners: 7, bank: 4_413_559_747 }]);
  assert.equal(s.rounds.payoutN, 56);
  assert.equal(s.rounds.payoutNano, 1_742_536_573);
  assert.deepEqual(s.collateral, {
    active: 100,
    activeNano: 295_259_001_125,
    max: 100,
    queue: 180,
    queueNano: 530_686_000_000,
  });
  // Three rounds: holding, live evaluation, old evaluation (bond 0.004 ERG out).
  assert.equal(s.bank.totalN, 3);
  assert.equal(s.bank.totalNano, 5_070_867_821 + 4_413_559_747 + 2_950_750_000);
  // Only the holding round's block (1 915 708) is a find in the window here.
  assert.equal(s.bank.avgN, 1);
  assert.equal(s.bank.avgNano, 5_070_867_821);
  assert.equal(s.bank.genesisNano, 2_934_900_013);
  assert.ok(Math.abs((s.litErg ?? 0) - 0.002727) < 0.00001);
});

test("missing parts stay null, nothing throws", () => {
  const s = buildLithosStats(
    input({
      finds: [],
      netWindowN: null,
      holding: [],
      evaluation: [],
      payout: null,
      collateral: null,
      queue: null,
      minerRegistry: null,
      genesisNano: null,
      litPool: null,
    })
  );
  assert.equal(s.hash, null);
  assert.equal(s.nisp, null);
  assert.equal(s.collateral, null);
  assert.equal(s.litErg, null);
  assert.deepEqual(s.series, []);
  assert.deepEqual(s.miners, { round: null, registry: null });
  assert.equal(s.bank.totalN, 0);
});

test("series: every UTC day since launch, today partial, kept days reused", () => {
  const base = input();
  const launchDay = utcDay(base.finds.reduce((m, b) => Math.min(m, b.ts), Infinity));
  const tipDay = utcDay(TIP_TS);
  const fresh = [];
  for (let d = launchDay; d <= tipDay; d++) fresh.push({ d, nb: 720, ng: 47_000_000_000 });
  const first = buildLithosStats({ ...base, netDays: fresh, recomputeFrom: launchDay });
  assert.equal(first.series.length, tipDay - launchDay + 1);
  assert.equal(first.series[0]!.d, launchDay);
  const today = first.series[first.series.length - 1]!;
  assert.equal(today.d, tipDay);
  assert.equal(today.s, Math.round((TIP_TS - tipDay * DAY_MS) / 1000));
  assert.equal(first.series.reduce((n, d) => n + d.lb, 0), 53);
  assert.equal(today.lg, Number((DIFF * BigInt(today.lb)) / 1_000_000_000n));

  // Next pass: only the last stored day is read again; older days come from the snapshot.
  const from = seriesRecomputeFrom(first.series, launchDay, tipDay);
  assert.equal(from, tipDay);
  const kept = first.series.map((d, i) => (i === 0 ? { ...d, nb: 333 } : d));
  const next = buildLithosStats({
    ...base,
    prevSeries: kept,
    netDays: [{ d: tipDay, nb: 600, ng: 1 }],
    recomputeFrom: from,
  });
  assert.equal(next.series[0]!.nb, 333);
  assert.equal(next.series[next.series.length - 1]!.nb, 600);
});

test("seriesRecomputeFrom rebuilds on a gap, a zero day or a new launch", () => {
  const days = (d0: number, n: number, nb = 700): LithosDay[] =>
    Array.from({ length: n }, (_, i) => ({ d: d0 + i, lb: 0, lg: 0, nb, ng: 0 }));
  assert.equal(seriesRecomputeFrom([], 100, 110), 100);
  assert.equal(seriesRecomputeFrom(days(101, 5), 100, 110), 100);
  assert.equal(seriesRecomputeFrom([...days(100, 3), ...days(104, 2)], 100, 110), 100);
  const zero = days(100, 6);
  zero[3] = { ...zero[3]!, nb: 0 };
  assert.equal(seriesRecomputeFrom(zero, 100, 110), 103);
  assert.equal(seriesRecomputeFrom(days(100, 6), 100, 110), 105);
  // Day rolled over: yesterday (last stored) and today are read.
  assert.equal(seriesRecomputeFrom(days(100, 11), 100, 111), 110);
});

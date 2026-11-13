import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_MS } from "./lithos-protocol.js";
import { lithosHomeFromSnapshot, lithosSeam, parseFindMarks, parseLithosHome } from "./lithos-home.js";

const D0 = 20_760;

test("seam: exact finds only when the snapshot lists them all", () => {
  const from = D0 * DAY_MS;
  const finds = parseFindMarks([
    [1_000_300, from + 3 * 3_600_000],
    [1_000_100, from + 60_000],
    [1_000_200, from + 2 * 3_600_000],
    [999_000, from - 1], // before the window
  ]);
  assert.deepEqual(
    finds.map((f) => f.h),
    [1_000_300, 1_000_200, 1_000_100, 999_000]
  );
  const s = lithosSeam({ from, to: from + DAY_MS, n: 3 }, finds, []);
  assert.deepEqual(s, { at: [1, 120, 180], approx: false });
});

test("seam: older blocks come from the daily series, spread inside their day", () => {
  const from = D0 * DAY_MS;
  const to = from + 3 * DAY_MS;
  // 2 exact finds on day 2; the series says day 0 had 4 and day 1 had 2, day 2 had 3 (one unlisted).
  const finds = [
    { h: 30, ts: from + 2 * DAY_MS + 12 * 3_600_000 },
    { h: 29, ts: from + 2 * DAY_MS + 6 * 3_600_000 },
  ];
  const series = [
    { d: D0, lb: 4, lg: 0, nb: 720, ng: 0 },
    { d: D0 + 1, lb: 2, lg: 0, nb: 720, ng: 0 },
    { d: D0 + 2, lb: 3, lg: 0, nb: 720, ng: 0 },
  ];
  const s = lithosSeam({ from, to, n: 9 }, finds, series);
  assert.equal(s.approx, true);
  assert.equal(s.at.length, 9);
  assert.deepEqual(s.at, [...s.at].sort((a, b) => a - b));
  // Day 2's unlisted block sits before the oldest exact one (06:00 on day 2).
  const day2 = s.at.filter((m) => m >= 2 * 1440);
  assert.equal(day2.length, 3);
  assert.ok(day2[0]! < 2 * 1440 + 360);
  // Days 0 and 1 keep their counts.
  assert.equal(s.at.filter((m) => m < 1440).length, 4);
  assert.equal(s.at.filter((m) => m >= 1440 && m < 2 * 1440).length, 2);
});

test("home cut from a live-shaped snapshot, and its parse", () => {
  const stats = {
    v: 1,
    tip: { height: 1_915_941, ts: 1_794_583_387_577 },
    netHs: 493_243_299_703,
    hash: { from: 1_793_860_077_684, to: 1_794_583_387_577, n: 2, netN: 5978, hs: 1_828_178_434, err: 0.2236, extended: true },
    nisp: { h: 1_915_708, miners: 8, hs: 1_601_250_000 },
    blocks: { total: 817, d1: 2, d7: 13, launch: 1_791_303_658_309 },
    miners: { round: 8, registry: 25 },
    rounds: {
      holding: [{ h: 1_915_708, start: 1_915_708, miners: 8, bank: 5_070_867_821 }],
      evaluation: [{ h: 1_915_303, start: 1_915_664, miners: 7, bank: 8_156_800_013 }],
      payoutN: 57,
      payoutNano: 2_603_426_484,
    },
    collateral: null,
    bank: { genesisNano: 1, avgNano: 1, avgN: 1, totalNano: 1, totalN: 1 },
    litErg: 0.0027,
    series: [],
  };
  const finds = [
    { height: 1_915_708, ts: 1_794_553_589_225 },
    { height: 1_915_303, ts: 1_794_505_743_263 },
  ];
  const home = lithosHomeFromSnapshot(stats, finds);
  assert.ok(home);
  assert.equal(home.last?.h, 1_915_708);
  assert.equal(home.seam?.at.length, 2);
  assert.equal(home.holding[0]?.h, 1_915_708);
  const back = parseLithosHome(JSON.parse(JSON.stringify(home)));
  assert.deepEqual(back, home);
  assert.equal(lithosHomeFromSnapshot(null, finds), null);
  assert.equal(parseLithosHome({ v: 2 }), null);
});

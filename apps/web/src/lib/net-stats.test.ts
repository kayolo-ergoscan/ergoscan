import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asOfHour,
  barCeiling,
  barPaths,
  binActivity,
  binHours,
  dayChange,
  dayTicks,
  linePath,
  nearestIndex,
  netDomain,
  NET_BIN_MS,
  NET_SPAN_MS,
  sameRows,
  weekLine,
} from "./net-stats";
import { patchHomeStats } from "./chain-stats";

const H = 3_600_000;
const DAY = 24 * H;
/** A UTC midnight. */
const T0 = Date.UTC(2026, 10, 8);

test("binActivity sums 6 h walls; a wall the week cuts at either end is open", () => {
  // From 03:00 to 13:00: the 00–06 wall starts before the first hour, 12–18 is not over.
  const hours = Array.from({ length: 11 }, (_, i) => ({ t: T0 + (3 + i) * H, txs: 10, feesErg: 1 }));
  const bins = binActivity(hours, "txs");
  assert.deepEqual(
    bins.map((b) => [b.t - T0, b.v, b.open]),
    [
      [0, 30, true],
      [6 * H, 60, false],
      [12 * H, 20, true],
    ]
  );
  assert.equal(bins[0]!.t1 - bins[0]!.t, NET_BIN_MS);
});

test("binActivity: a wall whose newest hour is still filling stays open until the snapshot passes its end", () => {
  // Hours 06:00..11:00; the 11:00 hour is the one now (snapshot at 11:40): 06–12 is not over.
  const hours = Array.from({ length: 6 }, (_, i) => ({ t: T0 + (6 + i) * H, txs: 5, feesErg: 1 }));
  const at1140 = asOfHour(new Date(T0 + 11 * H + 40 * 60_000).toISOString());
  assert.equal(at1140, T0 + 11 * H);
  assert.equal(binActivity(hours, "txs", at1140)[0]!.open, true);
  // No snapshot time: the newest hour counts as filling.
  assert.equal(binActivity(hours, "txs")[0]!.open, true);
  // At 12:05 the wall is whole.
  const at1205 = asOfHour(new Date(T0 + 12 * H + 5 * 60_000).toISOString());
  assert.equal(binActivity(hours, "txs", at1205)[0]!.open, false);
  assert.equal(asOfHour(null), null);
  assert.equal(asOfHour("not a date"), null);
});

test("binHours names a wall by its UTC hours", () => {
  assert.deepEqual(binHours(T0 + 12 * H, T0 + 18 * H), ["12", "18"]);
  assert.deepEqual(binHours(T0, T0 + 6 * H), ["00", "06"]);
  assert.deepEqual(binHours(T0 + 18 * H, T0 + DAY), ["18", "24"]);
});

test("dayChange compares the newest point with the one a day back", () => {
  const hourly = Array.from({ length: 49 }, (_, i) => ({ t: T0 + i * H, v: i < 24 ? 1 : 1.1 }));
  assert.ok(Math.abs(dayChange(hourly)! - 0) < 1e-9);
  const rising = Array.from({ length: 49 }, (_, i) => ({ t: T0 + i * H, v: 1 + i / 24 }));
  // 48 h → 3, 24 h → 2: +50 %.
  assert.ok(Math.abs(dayChange(rising)! - 0.5) < 1e-9);
  // Twelve hours of line: no point a day back.
  assert.equal(dayChange(rising.slice(-12)), null);
  assert.equal(dayChange([]), null);
});

test("weekLine starts the line on the plot's left edge and keeps only the week's points to read", () => {
  const pts = [
    { t: T0 - 2 * H, v: 10 },
    { t: T0 + 2 * H, v: 20 },
    { t: T0 + 4 * H, v: 30 },
  ];
  const w = weekLine(pts, T0);
  assert.deepEqual(w.pts.map((p) => p.t), [T0 + 2 * H, T0 + 4 * H]);
  assert.deepEqual(w.edge, { t: T0, v: 15 });
  const d = linePath({ w: 100, h: 20, t0: T0, t1: T0 + 4 * H, lo: 0, hi: 40 }, [w.edge!, ...w.pts]);
  assert.ok(d.startsWith("M0 "), d);
  // A line that begins inside the week has no edge.
  assert.equal(weekLine(pts.slice(1), T0).edge, null);
});

test("patchHomeStats takes the rolling 24 h fees from each snapshot", () => {
  const a = patchHomeStats(null, { txPerDay: 4600, feesErg: 7.5 });
  assert.equal(a.stats24h.feesErg, 7.5);
  const b = patchHomeStats(a, { txPerDay: 4613, feesErg: 8.18 });
  assert.equal(b.stats24h.feesErg, 8.18);
  assert.equal(b.stats24h.txs, 4613);
  // A snapshot without the field keeps the painted figure.
  assert.equal(patchHomeStats(b, { txPerDay: 4620 }).stats24h.feesErg, 8.18);
});

test("binActivity leaves out fee hours whose fees are unknown", () => {
  const hours = [
    { t: T0 + 6 * H, txs: 1, feesErg: 2 },
    { t: T0 + 7 * H, txs: 1, feesErg: 5, feesKnown: false },
  ];
  const [b] = binActivity(hours, "feesErg");
  assert.equal(b!.v, 2);
  assert.equal(b!.known, true);
});

test("netDomain is the week that ends after the newest hour", () => {
  const [t0, t1] = netDomain([{ t: T0 + 5 * H }], [{ t: T0 + 2 * H }]);
  assert.equal(t1, T0 + 6 * H);
  assert.equal(t1 - t0, NET_SPAN_MS);
});

test("barCeiling cuts one outlier and keeps an even series whole", () => {
  const even = [3, 4, 5, 4, 6, 5, 4];
  assert.deepEqual(barCeiling(even), { hi: 6, clip: false });
  const spike = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 70];
  const c = barCeiling(spike);
  assert.equal(c.clip, true);
  assert.ok(c.hi < 10 && c.hi >= 2);
});

test("barPaths marks the columns over the ceiling", () => {
  const bins = [
    { t: T0, t1: T0 + NET_BIN_MS, v: 1, open: false, known: true },
    { t: T0 + NET_BIN_MS, t1: T0 + 2 * NET_BIN_MS, v: 50, open: false, known: true },
  ];
  const p = barPaths({ w: 200, h: 40, t0: T0, t1: T0 + 2 * NET_BIN_MS, lo: 0, hi: 4 }, bins);
  // One notch: the 50 is cut, the 1 is whole.
  assert.equal(p.cut.split("M").length - 1, 1);
  assert.ok(p.closed.split("M").length - 1 === 2);
});

test("dayTicks land on UTC midnights", () => {
  assert.deepEqual(dayTicks(T0 - 3 * H, T0 + 2 * DAY + H), [T0, T0 + DAY, T0 + 2 * DAY]);
  assert.deepEqual(dayTicks(T0 - 3 * H, T0 + 4 * DAY, 2), [T0, T0 + 2 * DAY]);
});

test("nearestIndex picks the closest point", () => {
  const pts = [{ t: 0 }, { t: 10 }, { t: 20 }];
  assert.equal(nearestIndex(pts, 4), 0);
  assert.equal(nearestIndex(pts, 16), 2);
  assert.equal(nearestIndex([], 5), -1);
});

test("sameRows keeps the array a memo knows when a snapshot changed nothing", () => {
  const a = [{ t: 1, v: 2 }, { t: 2, v: 3 }];
  assert.equal(sameRows(a, [{ t: 1, v: 2 }, { t: 2, v: 3 }], ["t", "v"]), a);
  const moved = [{ t: 1, v: 2 }, { t: 2, v: 4 }];
  assert.equal(sameRows(a, moved, ["t", "v"]), moved);
  const longer = [...a, { t: 3, v: 1 }];
  assert.equal(sameRows(a, longer, ["t", "v"]), longer);
});

test("barPaths keeps a bin the week holds only part of inside the plot", () => {
  // The week ends at 13:00; the 12–18 wall is one hour old.
  const t1 = T0 + 13 * H;
  const f = { w: 520, h: 40, t0: t1 - 13 * H, t1, lo: 0, hi: 10 };
  const bins = [
    { t: T0 + 6 * H, t1: T0 + 12 * H, v: 5, open: false, known: true },
    { t: T0 + 12 * H, t1: T0 + 18 * H, v: 1, open: true, known: true },
  ];
  const p = barPaths(f, bins);
  const xs = (d: string) => [...d.matchAll(/[MLHQ]([\d.-]+)/g)].map((m) => Number(m[1]));
  for (const x of xs(p.open)) assert.ok(x >= f.w * 12 / 13 - 0.1 && x <= f.w + 0.1, `open column at ${x}`);
  for (const x of xs(p.closed)) assert.ok(x >= 0 && x <= f.w * 12 / 13, `closed column at ${x}`);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barCeiling,
  barPaths,
  binActivity,
  dayTicks,
  nearestIndex,
  netDomain,
  NET_BIN_MS,
  NET_SPAN_MS,
  sameRows,
} from "./net-stats";

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

import assert from "node:assert/strict";
import { test } from "node:test";
import { doorFreshness, formatOracleQuote, sparkPath, sparkQuotes, summarizeOracleFeed } from "./oracle-door";
import { emptyOracleFeed } from "./oracle-feed";

const NOW = Date.UTC(2026, 10, 12, 23, 0);
const H = 3_600_000;

test("spark keeps one quote per bucket, the latest, oldest first", () => {
  const ticks = [
    { t: NOW - 2 * H, height: 3, quote: 0.19, market: null },
    { t: NOW - 2 * H - 60_000, height: 2, quote: 0.18, market: null },
    { t: NOW - 6 * 24 * H, height: 1, quote: 0.25, market: null },
    { t: NOW - 9 * 24 * H, height: 0, quote: 0.4, market: null },
  ];
  assert.deepEqual(sparkQuotes(ticks, NOW), [0.25, 0.19]);
});

test("spark skips missing times and bad quotes", () => {
  const ticks = [
    { t: null, height: 1, quote: 0.2, market: null },
    { t: NOW - H, height: 2, quote: Number.NaN, market: null },
    { t: NOW - H, height: 3, quote: 0, market: null },
    { t: NOW + H, height: 4, quote: 0.3, market: null },
  ];
  assert.deepEqual(sparkQuotes(ticks, NOW), []);
});

test("summary takes the newest tick time, else the block age", () => {
  const pack = {
    ...emptyOracleFeed("ergusd"),
    quote: 0.1817,
    height: 100,
    tipHeight: 103,
    ticks: [
      { t: NOW - 5 * 60_000, height: 100, quote: 0.1817, market: null },
      { t: NOW - 10 * H, height: 90, quote: 0.18, market: null },
    ],
  };
  const s = summarizeOracleFeed(pack, NOW);
  assert.equal(s.lastMs, NOW - 5 * 60_000);
  assert.equal(s.quote, 0.1817);
  assert.deepEqual(s.spark, [0.18, 0.1817]);
  const bare = summarizeOracleFeed({ ...pack, ticks: [] }, NOW);
  assert.equal(bare.lastMs, NOW - 3 * 120_000);
  assert.equal(summarizeOracleFeed({ ...pack, ticks: [], tipHeight: null }, NOW).lastMs, null);
});

test("freshness follows the pool heartbeat", () => {
  // USD pools post every 6 blocks (12 min).
  assert.equal(doorFreshness("ergusd", NOW - 4 * 60_000, NOW), "fresh");
  assert.equal(doorFreshness("ergusd", NOW - 30 * 60_000, NOW), "late");
  assert.equal(doorFreshness("ergusd", NOW - 60 * 60_000, NOW), "stale");
  // Gold posts every 30 blocks (an hour): 30 minutes is fresh.
  assert.equal(doorFreshness("xau-erg", NOW - 30 * 60_000, NOW), "fresh");
  assert.equal(doorFreshness("xau-erg", null, NOW), null);
});

test("spark path spans the box and stays inside the pad", () => {
  const d = sparkPath([1, 3, 2], 100, 30, 2);
  assert.equal(d, "M2.0 28.0 L50.0 2.0 L98.0 15.0");
  assert.equal(sparkPath([5], 100, 30), "");
  assert.equal(sparkPath([2, 2], 100, 30, 2), "M2.0 15.0 L98.0 15.0");
});

test("pool answers: dollars for USD pools, three significant digits for gold, point decimals", () => {
  assert.equal(formatOracleQuote("ergusd", 0.18224), "$0.1822");
  assert.equal(formatOracleQuote("erg-usd", 0.1816, "ru"), "$0.1816");
  assert.equal(formatOracleQuote("xau-erg", 0.0000014612), "0.00000146");
  assert.equal(formatOracleQuote("xau-erg", 0.0000468, "ru"), "0.0000468");
  assert.equal(formatOracleQuote("xau-erg", 1234.5, "en"), "1,234.5");
  assert.equal(formatOracleQuote("xau-erg", 0), "—");
  assert.equal(formatOracleQuote("xau-erg", null), "—");
});

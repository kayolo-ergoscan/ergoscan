import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { LITHOS_COLLAT_ADDRESS } from "./lithosdex.js";
import {
  LITHOS_ADDR_MD5,
  decodeSigmaBigInt,
  lithosHashWindow,
  lithosNispLowerBoundHs,
  lithosRollupRegs,
  parseLithosStats,
  type LithosBlockSample,
} from "./lithos-protocol.js";

test("collateral md5 matches the address constant", () => {
  const md5 = createHash("md5").update(LITHOS_COLLAT_ADDRESS).digest("hex");
  assert.equal(md5, LITHOS_ADDR_MD5.collateral);
});

test("Sigma BigInt: positive, sign bit, bad shapes", () => {
  assert.equal(decodeSigmaBigInt("060406df2f90"), 115_290_000n);
  assert.equal(decodeSigmaBigInt("0601ff"), -1n);
  assert.equal(decodeSigmaBigInt("060200ff"), 255n);
  assert.equal(decodeSigmaBigInt("0504"), null);
  assert.equal(decodeSigmaBigInt("060406df2f"), null);
  assert.equal(decodeSigmaBigInt(null), null);
});

test("holding box registers (live box at 1 915 709)", () => {
  const regs = lithosRollupRegs("0410", "060406df2f90", "1103f8ece901f8ece9018090a10f");
  assert.deepEqual(regs, {
    miners: 8,
    score: 115_290_000n,
    s0: 1_915_708,
    s1: 1_915_708,
    bond: 16_000_000,
  });
  // Evaluation: period start moved on, block height kept, 7 bonds of 0.002 ERG.
  const ev = lithosRollupRegs("040e", "0604067e4ae0", "1103f4eae901a2e5e90180feac0d");
  assert.equal(ev?.miners, 7);
  assert.equal(ev?.s0, 1_915_578);
  assert.equal(ev?.s1, 1_915_217);
  assert.equal(ev?.bond, 14_000_000);
  assert.equal(lithosRollupRegs("0410", "060406df2f90", "1102f8ece901f8ece901"), null);
  assert.equal(lithosRollupRegs(undefined, "060406df2f90", "1103f8ece901f8ece9018090a10f"), null);
});

test("NISP lower bound: Σscore × 10 × 10 000 / 7 200 s", () => {
  const hs = lithosNispLowerBoundHs(115_290_000n);
  assert.ok(Math.abs(hs / 1e9 - 1.601) < 0.001, String(hs));
  assert.equal(lithosNispLowerBoundHs(0n), 0);
});

const H = 3_600_000;
const D = 24 * H;

function blocks(tss: number[], diff = 1_000_000_000n): LithosBlockSample[] {
  return tss.map((ts, i) => ({ height: 1000 + i, ts, diff }));
}

test("hash window: 7 days when it holds 20 blocks", () => {
  const tip = 100 * D;
  const rows = blocks(Array.from({ length: 30 }, (_, i) => tip - i * 5 * H));
  const w = lithosHashWindow(rows, tip);
  assert.ok(w);
  assert.equal(w.extended, false);
  assert.equal(w.from, tip - 7 * D);
  assert.equal(w.n, 30);
  assert.equal(w.hs, (30 * 1e9) / (7 * 86_400));
  assert.equal(w.err, 1 / Math.sqrt(30));
});

test("hash window: reaches back to the 21st block when 7 days are sparse", () => {
  const tip = 100 * D;
  // 13 blocks in the last 7 days, the rest one every 12 h before that.
  const recent = Array.from({ length: 13 }, (_, i) => tip - i * 12 * H);
  const older = Array.from({ length: 20 }, (_, i) => tip - 7 * D - (i + 1) * 12 * H);
  const rows = blocks([...older, ...recent]);
  const w = lithosHashWindow(rows, tip);
  assert.ok(w);
  assert.equal(w.extended, true);
  assert.equal(w.n, 20);
  const desc = [...recent, ...older];
  assert.equal(w.from, desc[20]);
  assert.equal(w.hs, (20 * 1e9) / ((tip - desc[20]!) / 1000));
});

test("hash window: few blocks in all start at the first one", () => {
  const tip = 100 * D;
  const w = lithosHashWindow(blocks([tip - 30 * D, tip - 20 * D, tip - 10 * D]), tip);
  assert.ok(w);
  assert.equal(w.n, 2);
  assert.equal(w.from, tip - 30 * D);
  assert.equal(lithosHashWindow([], tip), null);
  assert.equal(lithosHashWindow(blocks([tip]), tip), null);
});

test("parseLithosStats: absent, wrong version, partial", () => {
  assert.equal(parseLithosStats(undefined), null);
  assert.equal(parseLithosStats({ v: 2 }), null);
  assert.equal(parseLithosStats({ v: 1 }), null);
  const s = parseLithosStats({
    v: 1,
    tip: { height: 10, ts: 20 },
    hash: { n: 0, hs: 1 },
    rounds: { holding: [{ h: 5, start: 5, miners: 2, bank: 9 }, { h: "x" }], payoutN: 3 },
    series: [{ d: 20368, lb: 2, lg: 1, nb: 700, ng: 9, s: 120 }, { d: 0 }],
    litErg: -1,
  });
  assert.ok(s);
  assert.equal(s.hash, null);
  assert.equal(s.collateral, null);
  assert.equal(s.litErg, null);
  assert.deepEqual(s.rounds.holding, [{ h: 5, start: 5, miners: 2, bank: 9 }]);
  assert.equal(s.rounds.payoutN, 3);
  assert.deepEqual(s.series, [{ d: 20368, lb: 2, lg: 1, nb: 700, ng: 9, s: 120 }]);
});

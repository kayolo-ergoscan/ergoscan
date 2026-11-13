import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksToWait, levelCostNano, medianOf } from "./fee-levels";

test("median of sorted sizes", () => {
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([300]), 300);
  assert.equal(medianOf([200, 300, 900]), 300);
  assert.equal(medianOf([200, 300, 400, 900]), 400);
});

test("cost of a median-size tx: 1 107 n/B × 1 000 B ≈ 0.0011 ERG", () => {
  assert.equal(levelCostNano(1107, 1000), 1_107_000n);
  assert.equal(levelCostNano(2215.4, 3), 6646n);
  assert.equal(levelCostNano(undefined, 1000), null);
  assert.equal(levelCostNano(1000, null), null);
  assert.equal(levelCostNano(Number.NaN, 1000), null);
  assert.equal(levelCostNano(1000, 0), null);
});

test("a small mempool fits the next block at every level", () => {
  const txs = [
    { feeRate: 500, size: 400 },
    { feeRate: 2000, size: 900 },
    { feeRate: 30_000, size: 1200 },
  ];
  assert.equal(blocksToWait(100, txs, 400), 1);
  assert.equal(blocksToWait(30_000, txs, 400), 1);
});

test("bytes paying more push a low rate past the next block", () => {
  const big = Array.from({ length: 30 }, () => ({ feeRate: 5000, size: 100_000 }));
  // 3 000 000 B ahead in 1 271 009 B blocks: two full blocks, the tx lands in the third.
  assert.equal(blocksToWait(1000, big, 400), 3);
  // Paying more than all of them: next block.
  assert.equal(blocksToWait(6000, big, 400), 1);
  // Equal rate is not ahead.
  assert.equal(blocksToWait(5000, big, 400), 1);
});

test("unknown rate has no estimate", () => {
  assert.equal(blocksToWait(undefined, []), null);
  assert.equal(blocksToWait(100, [], 0, 0), null);
});

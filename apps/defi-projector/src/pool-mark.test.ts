import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCfmmMove, reserveMarkErg } from "./pool-mark.js";

test("CFMM move is a swap when reserves move apart and liquidity when they move together", () => {
  assert.deepEqual(classifyCfmmMove(-10, 2), { eventKind: "swap", side: "buy" });
  assert.deepEqual(classifyCfmmMove(10, -2), { eventKind: "swap", side: "sell" });
  assert.deepEqual(classifyCfmmMove(10, 2), { eventKind: "mint", side: "mint" });
  assert.deepEqual(classifyCfmmMove(-10, -2), { eventKind: "redeem", side: "redeem" });
  assert.equal(classifyCfmmMove(0, 2), null);
  assert.equal(classifyCfmmMove(4, 0), null);
});

test("reserve mark is ERG in the box over whole tokens", () => {
  const px = reserveMarkErg(64.74, "250000000000000", 8);
  assert.ok(px != null && Math.abs(px - 64.74 / 2_500_000) < 1e-12);
  assert.equal(reserveMarkErg(0, "100", 0), null);
  assert.equal(reserveMarkErg(10, "0", 0), null);
});

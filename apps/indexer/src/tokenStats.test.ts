import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeActivityHeights,
  encodeTokenBalanceTxCountCursor,
  parseTokenBalanceTxCountCursor,
  encodeLongHolderTxCursor,
  parseLongHolderTxCursor,
  holderTxCountNeedsFullHistory,
  heightWindows,
  foldHolderTxSlice,
  transferCountDelta,
  TAPE_NOT_MINTBURN_SQL,
  TAPE_NOT_SWAP_PACKED_SQL,
} from "./tokenStats.js";

test("credit sets first once and always advances last", () => {
  assert.deepEqual(mergeActivityHeights(null, null, 100, "credit"), { first: 100, last: 100 });
  assert.deepEqual(mergeActivityHeights(100, 100, 180, "credit"), { first: 100, last: 180 });
  assert.deepEqual(mergeActivityHeights(100, 180, 90, "credit"), { first: 100, last: 180 });
});

test("debit does not move first", () => {
  assert.deepEqual(mergeActivityHeights(100, 100, 200, "debit"), { first: 100, last: 200 });
  assert.deepEqual(mergeActivityHeights(null, null, 50, "debit"), { first: null, last: 50 });
});

test("null height leaves the row alone", () => {
  assert.deepEqual(mergeActivityHeights(10, 20, null, "credit"), { first: 10, last: 20 });
  assert.deepEqual(mergeActivityHeights(10, 20, -1, "debit"), { first: 10, last: 20 });
});

test("tile tx count follows the tape, not a ride-along", () => {
  assert.equal(transferCountDelta(false, false), 0);
  assert.equal(transferCountDelta(false, true), 1);
  assert.equal(transferCountDelta(true, true), 0);
  assert.equal(transferCountDelta(true, false), -1);
  assert.match(TAPE_NOT_MINTBURN_SQL, /m\.spent = 0 AND m\.created > 0/);
  assert.match(TAPE_NOT_MINTBURN_SQL, /9007199254740991/);
  assert.match(TAPE_NOT_SWAP_PACKED_SQL, /defi\.trades/);
  assert.match(TAPE_NOT_SWAP_PACKED_SQL, /encode\(m\.tx_id, 'hex'\)/);
});

test("long holder recount covers contracts and fat wallets only", () => {
  assert.equal(holderTxCountNeedsFullHistory(51, 10), false);
  assert.equal(holderTxCountNeedsFullHistory(992, 10), true);
  assert.equal(holderTxCountNeedsFullHistory(51, 25_000), true);
  const raw = encodeLongHolderTxCursor("L", "03fa", "9" + "h".repeat(20));
  assert.deepEqual(parseLongHolderTxCursor(raw), {
    phase: "L",
    tokenId: "03fa",
    address: "9" + "h".repeat(20),
  });
  assert.equal(parseLongHolderTxCursor("").phase, "L");
  assert.deepEqual(heightWindows(150_000, 100_000), [
    [0, 100_000],
    [100_000, 200_000],
  ]);
  assert.deepEqual(
    foldHolderTxSlice(
      { n: 1, first: 10, last: 20 },
      { n: 4, lo: 5, hi: 30 }
    ),
    { n: 5, first: 5, last: 30 }
  );
});

test("token_balances tx_count cursor is token_id TAB address", () => {
  const raw = encodeTokenBalanceTxCountCursor("ab", "9fLYhello");
  assert.equal(raw, "ab\t9fLYhello");
  assert.deepEqual(parseTokenBalanceTxCountCursor(raw), { tokenId: "ab", address: "9fLYhello" });
  assert.deepEqual(parseTokenBalanceTxCountCursor(""), { tokenId: "", address: "" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeOutputAssets } from "./batchSql.js";

test("a token listed twice in one box: amounts add up, first place kept", () => {
  const box = "aa".repeat(32);
  const x = "0c".repeat(32);
  const y = "47".repeat(32);
  const rows = mergeOutputAssets([
    { boxId: box, tokenId: "94".repeat(32), amount: "500000000", index: 0 },
    { boxId: box, tokenId: x, amount: "2500", index: 2 },
    { boxId: box, tokenId: x.toUpperCase(), amount: "10000", index: 3 },
    { boxId: box, tokenId: y, amount: "9223372036854775807", index: 4 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.tokenId.slice(0, 2), r.amount, r.index]),
    [
      ["94", "500000000", 0],
      ["0c", "12500", 2],
      ["47", "9223372036854775807", 4],
    ]
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { sameTipListDue } from "./snapshots.js";

test("same tip: one follow-up rebuild after 30 s, then every 5 min", () => {
  assert.equal(sameTipListDue(1, 10_000, 30_000, 300_000), false);
  assert.equal(sameTipListDue(1, 30_000, 30_000, 300_000), true);
  assert.equal(sameTipListDue(2, 60_000, 30_000, 300_000), false);
  assert.equal(sameTipListDue(2, 300_000, 30_000, 300_000), true);
});

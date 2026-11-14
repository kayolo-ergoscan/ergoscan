import assert from "node:assert/strict";
import { test } from "node:test";
import { blockConfirmations, confirmationsAwait, confirmationsEvent, confirmationsLive } from "./page-data";
import { statusOf, type ChainNow } from "./chain-sense";

test("a tx's confirmations follow the live tip, never below the snapshot", () => {
  assert.equal(confirmationsLive(3, 100, 105), 6);
  assert.equal(confirmationsLive(8, 100, 105), 8);
  assert.equal(confirmationsLive(3, 100, null), 3);
  assert.equal(confirmationsLive(null, null, 105), null);
  assert.equal(blockConfirmations(100, 100), 0);
  assert.equal(blockConfirmations(100, 99), 0);
});

test("confirmation milestones by data: /tx nods 2…10, /block 1 («›»), 2…10 and 720", () => {
  assert.equal(confirmationsEvent("tx", null, 2, 101), null, "nothing on the first read");
  assert.deepEqual(confirmationsEvent("tx", 1, 2, 101), { k: "page:confirmations", n: 2, of: "tx", height: 101 });
  assert.equal(confirmationsEvent("tx", 10, 11, 110), null);
  assert.equal(confirmationsEvent("tx", 3, 3, 110), null, "no growth, no event");
  assert.deepEqual(confirmationsEvent("block", 0, 1, 101), { k: "page:confirmations", n: 1, of: "block", height: 101 });
  assert.deepEqual(confirmationsEvent("block", 719, 721, 9), { k: "page:confirmations", n: 720, of: "block", height: 9 });
  assert.equal(confirmationsAwait("tx", 1), true);
  assert.equal(confirmationsAwait("tx", 10), false);
  assert.equal(confirmationsAwait("block", 0), true);
  assert.equal(confirmationsAwait("block", 719), true);
  assert.equal(confirmationsAwait("block", 300), false);
});

const base: ChainNow = {
  height: 100,
  at: 0,
  mempool: 30,
  live: true,
  downSince: null,
  avgMs: 120_000,
  wait: 0,
  net: "live",
  behind: { on: false, lag: null, node: false, peers: false },
  mock: false,
};

test("the status line (§4.8): noStream → offline → stall → wait → behind → status", () => {
  assert.deepEqual(statusOf({ ...base, net: "lost", live: false, downSince: 0 }, 200_000), { k: "noStream" });
  assert.deepEqual(statusOf({ ...base, live: false, downSince: 0, net: "down" }, 7_000), { k: "offline" });
  assert.deepEqual(statusOf({ ...base, net: "offline" }, 1000), { k: "offline" });
  assert.deepEqual(statusOf({ ...base, wait: 3 }, 9 * 60_000), { k: "stall", min: 9 });
  assert.deepEqual(statusOf({ ...base, wait: 1 }, 250_000), { k: "wait", ageS: 250 });
  assert.deepEqual(statusOf({ ...base, behind: { on: true, lag: 9, node: false, peers: false } }, 10_000), { k: "behind", lag: 9 });
  assert.deepEqual(statusOf(base, 12_000), { k: "status", height: 100, ageS: 12, mempool: 30 });
  assert.equal(statusOf({ ...base, height: null }, 1), null);
});

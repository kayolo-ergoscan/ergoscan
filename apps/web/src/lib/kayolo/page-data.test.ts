import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { ORACLE_FEEDS } from "@ergoscan/shared";
import {
  blockConfirmations,
  confirmationsAwait,
  confirmationsEvent,
  confirmationsLive,
  oracleReread,
  pendingNod,
  rentNoteParts,
  rereads,
  sealCarries,
  sealDoubts,
} from "./page-data";
import { createChainSense, statusOf, type ChainNote, type ChainNow, type OracleTx } from "./chain-sense";

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

test("/tx: did the seal carry the tx — yes, no, or maybe (a block not read)", () => {
  assert.equal(sealCarries({ txIds: ["a", "mine"] }, "mine"), "yes");
  assert.equal(sealCarries({ txIds: ["a"] }, "mine"), "no");
  assert.equal(sealCarries({ txIds: null }, "mine"), "maybe");
});

test("/address: «в блок» only when seals carried every tx that left the list (review 2026-11-14)", () => {
  const sealed = new Map([["a", 1_916_538]]);
  assert.deepEqual(pendingNod(["a"], [], sealed), { height: 1_916_538 });
  // The rent claims were double-spent by a miner's own claim: removed after the seal, not in it.
  assert.equal(pendingNod(["claim1", "claim2"], [], new Map()), null);
  assert.equal(pendingNod(["a", "claim1"], [], sealed), null, "one evicted tx is enough to say nothing");
  assert.equal(pendingNod(["a", "b"], ["b"], sealed), null, "not empty yet");
  assert.equal(pendingNod([], [], sealed), null);
  assert.deepEqual(pendingNod(["a", "b"], [], new Map([["a", 10], ["b", 11]])), { height: 11 });
});

test("/tx, /block: a seal doubts the shown block when another real id sits at its height, or a fork replaced one below", () => {
  const B = "b".repeat(64);
  assert.equal(sealDoubts({ height: 100, blockId: B }, 100, B), false);
  assert.equal(sealDoubts({ height: 100, blockId: "c".repeat(64), replaced: true }, 100, B), true);
  assert.equal(sealDoubts({ height: 100, blockId: "c".repeat(64) }, 100, B), true, "a late seal with another id too");
  assert.equal(sealDoubts({ height: 100, blockId: "height-100" }, 100, B), false, "a partial seal without an id says nothing");
  assert.equal(sealDoubts({ height: 100, blockId: null }, 100, B), false, "a tip standing in says nothing");
  assert.equal(sealDoubts({ height: 99, blockId: "c".repeat(64), replaced: true }, 100, B), true);
  assert.equal(sealDoubts({ height: 99, blockId: "c".repeat(64) }, 100, B), false);
  assert.equal(sealDoubts({ height: 101, blockId: "c".repeat(64), replaced: true }, 100, B), false);
});

type Fixture = { messages: { t: number; type: string; data: Record<string, unknown> }[] };
const liveOracle = JSON.parse(readFileSync(new URL("./fixtures/oracle-live.json", import.meta.url), "utf8")) as Fixture;

/** The oracle txs of each seal in the live recording, as chain-sense hands them to the page. */
function liveOracleSeals(): { height: number; oracle: readonly OracleTx[] }[] {
  const s = createChainSense({ say: () => {}, now: () => 0, visible: () => true, setTimer: () => 0, clearTimer: () => {} });
  const out: { height: number; oracle: readonly OracleTx[] }[] = [];
  s.listen((n: ChainNote) => {
    if (n.k === "seal") out.push({ height: n.height, oracle: n.oracle });
  });
  for (const m of liveOracle.messages) s.feed({ type: m.type, data: m.data });
  return out;
}

test("E15 on the live recording: only the refresh of its own feed re-reads the oracle page", () => {
  const seals = liveOracleSeals();
  const at = (h: number) => seals.find((x) => x.height === h)!.oracle;
  assert.equal(oracleReread(at(1_916_558), ORACLE_FEEDS["erg-usd"]), "steps", "erg-usd refresh: pool NFT and refresh NFT");
  assert.equal(oracleReread(at(1_916_558), ORACLE_FEEDS["xau-erg"]), null, "another feed's refresh");
  assert.equal(oracleReread(at(1_916_558), ORACLE_FEEDS.ergusd), null);
  const datapoint = at(1_916_558).filter((o) => o.action === "oracle-datapoint");
  assert.equal(datapoint.length, 1);
  assert.equal(oracleReread(datapoint, ORACLE_FEEDS["erg-usd"]), null, "a datapoint post does not move the quote");
  assert.equal(oracleReread(at(1_916_559), ORACLE_FEEDS["erg-usd"]), null);
});

test("E15: an oracle tx the pool could not name gets one re-read", () => {
  const feed = ORACLE_FEEDS["erg-usd"];
  assert.equal(oracleReread([{ id: "o", action: null, tokens: [] }], feed), "once");
  assert.equal(oracleReread([{ id: "o", action: "oracle-other", tokens: [feed.oracleToken] }], feed), "once");
  assert.equal(oracleReread([{ id: "o", action: null, tokens: ["f".repeat(64)] }], feed), null, "another feed's tokens");
  assert.equal(oracleReread([{ id: "o", action: "oracle-refresh", tokens: [] }], feed), "steps", "a refresh without tokens may be ours");
});

test("E23's line: 1 block is minutes, not «1 д»; hours below a day; days from 720 blocks", () => {
  assert.deepEqual(rentNoteParts(0), { unit: "now", n: 0 });
  assert.deepEqual(rentNoteParts(-5), { unit: "now", n: 0 });
  assert.deepEqual(rentNoteParts(1), { unit: "min", n: 2 });
  assert.deepEqual(rentNoteParts(29), { unit: "min", n: 58 });
  assert.deepEqual(rentNoteParts(30), { unit: "h", n: 1 });
  assert.deepEqual(rentNoteParts(719), { unit: "h", n: 23 });
  assert.deepEqual(rentNoteParts(720), { unit: "d", n: 1 });
  assert.deepEqual(rentNoteParts(721), { unit: "d", n: 2 });
});

test("re-reads: one chain at a time, 0–400 ms jitter per step, a hidden tab ends it with no request", () => {
  let t = 0;
  let shown = true;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const reads: number[] = [];
  const r = rereads(() => reads.push(t), {
    setTimer: (fn, ms) => {
      const x = { at: t + ms, fn, id: next++ };
      timers.push(x);
      return x.id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    shown: () => shown,
    jitter: () => 250,
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  r.start([1_000, 2_000, 3_000]);
  assert.equal(r.busy(), true);
  advance(10_000);
  assert.deepEqual(reads, [1_250, 3_500, 6_750]);
  assert.equal(r.busy(), false);
  assert.equal(timers.length, 0);
  // A second start replaces the chain; hiding the tab ends it at the next step, without a request.
  r.start([1_000, 2_000]);
  advance(500);
  r.start([1_000, 2_000]);
  assert.equal(timers.length, 1, "one chain");
  shown = false;
  advance(5_000);
  assert.equal(reads.length, 3);
  assert.equal(r.busy(), false);
  assert.equal(timers.length, 0);
  r.start([1_000]);
  r.stop();
  assert.equal(timers.length, 0);
  assert.equal(r.busy(), false);
});

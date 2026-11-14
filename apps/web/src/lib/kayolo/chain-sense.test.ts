import assert from "node:assert/strict";
import { test } from "node:test";
import { blockKind, createChainSense } from "./chain-sense";
import type { KayoloEvent } from "./events";
import { pageKind } from "./anchors";

function rig() {
  const said: KayoloEvent[] = [];
  let t = 0;
  let visible = true;
  const timers: { at: number; fn: () => void }[] = [];
  const s = createChainSense({
    say: (e) => said.push(e),
    now: () => t,
    visible: () => visible,
    setTimer: (fn, ms) => {
      const x = { at: t + ms, fn };
      timers.push(x);
      return x;
    },
    clearTimer: (id) => {
      const i = timers.indexOf(id as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    t += ms;
    for (const x of [...timers].sort((a, b) => a.at - b.at)) {
      if (x.at <= t) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    }
  };
  const tip = (height: number) => s.feed({ type: "chain.tip", data: { height, headerId: "x".repeat(64) } });
  const seal = (height: number, txCount: number, size = 4000) =>
    s.feed({ type: "block.sealed", data: { height, blockId: "y".repeat(64), txIds: [], txCount, size, timestamp: 0 } });
  return { s, said, advance, tip, seal, setVisible: (v: boolean) => (visible = v), now: () => t, pending: () => timers.length };
}

test("kinds by txCount: ≤ 1 empty, ≥ 39 big", () => {
  assert.deepEqual([0, 1, 2, 38, 39, 200, null].map(blockKind), ["empty", "empty", "normal", "normal", "big", "big", "normal"]);
});

test("the first tip is a baseline; seal and tip of one height are one reaction", () => {
  const r = rig();
  r.tip(1_915_825);
  assert.equal(r.said.length, 0);
  r.seal(1_915_826, 7);
  r.advance(300);
  r.tip(1_915_826);
  r.advance(5000);
  assert.deepEqual(r.said, [{ k: "chain:block", height: 1_915_826, txCount: 7, size: 4000, kind: "normal" }]);
  assert.equal(r.s.state().height, 1_915_826);
});

test("a tip without a seal stands for the block after 3 s", () => {
  const r = rig();
  r.tip(100);
  r.tip(101);
  r.advance(2900);
  assert.equal(r.said.length, 0);
  r.advance(200);
  assert.equal(r.said.length, 1);
  assert.equal((r.said[0] as { txCount: number | null }).txCount, null);
  r.seal(101, 3);
  assert.equal(r.said.length, 1, "the late seal of the same height is not a second reaction");
});

test("a hidden tab counts quietly; mock streams say nothing; a reconnect is a new baseline", () => {
  const r = rig();
  r.tip(10);
  r.setVisible(false);
  r.seal(11, 5);
  assert.equal(r.said.length, 0);
  r.setVisible(true);
  r.seal(11, 5);
  assert.equal(r.said.length, 0, "already passed while hidden");
  r.s.socket(false);
  r.s.socket(true);
  r.tip(14);
  r.advance(4000);
  assert.equal(r.said.length, 0, "missed blocks after a reconnect are not replayed");
  r.seal(15, 50);
  assert.equal((r.said[0] as { kind: string }).kind, "big");
  const m = rig();
  m.s.feed({ type: "hello", data: { mock: true } });
  m.tip(1);
  m.seal(2, 4);
  assert.equal(m.said.length, 0);
});

test("the status line knows the mempool and the feed", () => {
  const r = rig();
  r.s.socket(true);
  r.s.feed({ type: "mempool.snapshot", data: { count: 36, balls: [] } });
  r.s.feed({ type: "mempool.add", data: { txId: "a" } });
  assert.equal(r.s.state().mempool, 37);
  r.advance(1000);
  r.s.socket(false);
  assert.equal(r.s.state().live, false);
  assert.equal(r.s.state().downSince, 1000);
});

test("page kinds for the block matrix", () => {
  assert.equal(pageKind("/blocks"), "b");
  assert.equal(pageKind("/block/1915825"), "b");
  assert.equal(pageKind("/mempool"), "b");
  assert.equal(pageKind("/address/9abc"), "d");
  assert.equal(pageKind("/tx/ab"), "d");
  assert.equal(pageKind("/addresses"), "n");
  assert.equal(pageKind("/favorites"), "n");
  assert.equal(pageKind("/tokens"), "n");
});

/* ---- Э4 ---- */

const sealIds = (r: ReturnType<typeof rig>, height: number, txIds: string[]) =>
  r.s.feed({ type: "block.sealed", data: { height, blockId: "y".repeat(64), txIds, txCount: txIds.length + 1, size: 3000, timestamp: 0 } });
const kinds = (said: KayoloEvent[]) => said.map((e) => e.k);

test("E4: a jump of ≥ 2 is one catch-up; a hidden tab or a reconnect is not replayed", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  r.seal(101, 4);
  r.setVisible(false);
  r.seal(102, 4);
  r.setVisible(true);
  r.seal(103, 4);
  assert.deepEqual(kinds(r.said), ["chain:block", "chain:block"]);
  // The tip-only fallback skipped a height (two seals were lost): one catch-up.
  r.tip(106);
  r.advance(3100);
  assert.deepEqual(r.said.at(-1), { k: "chain:catchup", from: 103, to: 106 });
});

test("E5–E7: one timer per edge — 2×, 3× the average, 8 min; a block ends it and is a relief", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  r.seal(101, 4);
  r.said.length = 0;
  r.advance(240_100);
  assert.equal(r.said.at(-1)?.k, "chain:tip-wait");
  assert.equal((r.said.at(-1) as { level: number }).level, 1);
  r.advance(120_000);
  assert.equal((r.said.at(-1) as { level: number }).level, 2);
  r.advance(120_000);
  assert.equal((r.said.at(-1) as { level: number }).level, 3);
  assert.equal(r.s.state().wait, 3);
  r.seal(102, 4);
  const block = r.said.find((e) => e.k === "chain:block") as { after?: string };
  assert.equal(block.after, "stall");
  assert.ok(r.said.some((e) => e.k === "chain:tip-wait" && e.level === 0));
  assert.equal(r.s.state().wait, 0);
  // While the feed is down the chain is not «late».
  r.said.length = 0;
  r.s.socket(false);
  r.advance(600_000);
  assert.equal(r.said.filter((e) => e.k === "chain:tip-wait").length, 0);
});

test("E5–E7: a hidden tab keeps no wait timer; showing it again catches the level up once", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  r.seal(101, 4);
  r.advance(4_000);
  assert.equal(r.pending(), 1, "a visible tab arms the next edge");
  r.setVisible(false);
  r.s.visibility(false);
  assert.equal(r.pending(), 0, "hidden: the timer is dropped");
  r.seal(102, 4);
  assert.equal(r.pending(), 0, "a block while hidden arms nothing");
  r.said.length = 0;
  r.advance(250_000);
  assert.equal(r.said.length, 0, "nothing is said while hidden");
  r.setVisible(true);
  r.s.visibility(true);
  assert.deepEqual(
    r.said.map((e) => [e.k, (e as { level?: number }).level]),
    [["chain:tip-wait", 1]],
  );
  assert.equal(r.pending(), 1, "visible again: one timer to the next edge");
});

test("E12: the pool drained right after a seal (≥ 100 before, ≤ 0.4 within 3 s)", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  r.advance(11_000);
  r.s.feed({ type: "mempool.snapshot", data: { count: 150 } });
  r.seal(101, 80);
  r.advance(1500);
  r.s.feed({ type: "mempool.snapshot", data: { count: 40 } });
  assert.deepEqual(r.said.at(-1), { k: "chain:drain", height: 101 });
});

test("E10: a topic tx on its page, at most once in 3 min; on /mempool only a rare category", () => {
  let path = "/rosen";
  const said: KayoloEvent[] = [];
  let t = 0;
  const s = createChainSense({ say: (e) => said.push(e), now: () => t, visible: () => true, setTimer: () => 0, clearTimer: () => {}, path: () => path });
  s.feed({ type: "mempool.add", data: { txId: "a", category: "bridge" } });
  s.feed({ type: "mempool.add", data: { txId: "b", category: "bridge" } });
  assert.deepEqual(said, [{ k: "chain:tx-topic", category: "bridge", txId: "a", rare: false }]);
  path = "/mempool";
  t = 200_000;
  for (let i = 0; i < 60; i++) s.feed({ type: "mempool.add", data: { txId: `p${i}`, category: "transfer" } });
  assert.equal(said.length, 1, "a common category is not a topic");
  s.feed({ type: "mempool.add", data: { txId: "n1", category: "nft" } });
  assert.deepEqual(said.at(-1), { k: "chain:tx-topic", category: "nft", txId: "n1", rare: true });
});

test("E11 / E13: a surge and a fee spike need two readings; the snapshot after a reconnect is not a surge", () => {
  const r = rig();
  r.s.socket(true);
  for (let m = 0; m < 30; m++) {
    r.advance(60_000);
    r.s.feed({ type: "mempool.snapshot", data: { count: 40 } });
    r.s.feed({ type: "fees.histogram", data: { p50: 2000, eta: { avgIntervalMs: 120_000 } } });
  }
  r.said.length = 0;
  r.s.feed({ type: "mempool.snapshot", data: { count: 420 } });
  assert.equal(r.said.length, 0, "one reading is not a surge");
  r.advance(2500);
  r.s.feed({ type: "mempool.snapshot", data: { count: 430 } });
  assert.deepEqual(r.said.at(-1), { k: "chain:pool", state: "surge", count: 430, base: 40 });
  r.s.feed({ type: "fees.histogram", data: { p50: 9000 } });
  r.advance(2500);
  r.s.feed({ type: "fees.histogram", data: { p50: 9100 } });
  assert.deepEqual(r.said.at(-1), { k: "chain:fee", state: "spike", p50: 9100, base: 2000 });
  // A reconnect: its first snapshot (10 s) never counts.
  const q = rig();
  q.s.socket(true);
  for (let m = 0; m < 30; m++) {
    q.advance(60_000);
    q.s.feed({ type: "mempool.snapshot", data: { count: 40 } });
  }
  q.s.socket(false);
  q.advance(3000);
  q.s.socket(true);
  q.said.length = 0;
  q.s.feed({ type: "mempool.snapshot", data: { count: 500 } });
  q.advance(2500);
  q.s.feed({ type: "mempool.snapshot", data: { count: 500 } });
  assert.equal(q.said.filter((e) => e.k === "chain:pool").length, 0);
});

test("E13: p50 against p90 (2 215 / 1 052 631) is no spike; a small pool's p50 is not judged", () => {
  const r = rig();
  r.s.socket(true);
  r.s.feed({ type: "mempool.snapshot", data: { count: 36 } });
  for (let m = 0; m < 70; m++) {
    r.advance(60_000);
    r.s.feed({ type: "fees.histogram", data: { p50: 2215, p90: 1_052_631, eta: { avgIntervalMs: 115_085 } } });
  }
  assert.equal(r.said.filter((e) => e.k === "chain:fee").length, 0);
  // Six txs: the live p50 swings 1 746 → 96 948 → 1 052 632; nothing is said.
  r.s.feed({ type: "mempool.snapshot", data: { count: 6 } });
  for (const p50 of [1746, 96_948, 96_948, 1_052_632, 1_052_632]) {
    r.advance(2500);
    r.s.feed({ type: "fees.histogram", data: { p50 } });
  }
  assert.equal(r.said.filter((e) => e.k === "chain:fee").length, 0);
});

test("E15: oracle txs in a seal — the page's awaiter learns it, chain:oracle once in 2 min", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  const seen: { oracle?: boolean }[] = [];
  r.s.await((x) => {
    seen.push({ oracle: x.oracle });
    return !!x.oracle;
  });
  r.s.feed({ type: "mempool.snapshot", data: { count: 3, balls: [{ txId: "o1", category: "oracle" }, { txId: "t1", category: "transfer" }] } });
  sealIds(r, 101, ["o1", "t1"]);
  assert.deepEqual(seen, [{ oracle: true }]);
  const block = r.said.find((e) => e.k === "chain:block") as { hold?: boolean };
  assert.equal(block.hold, true, "the page holds this block's E1");
  assert.deepEqual(r.said.at(-1), { k: "chain:oracle", txIds: ["o1"], height: 101 });
  r.s.feed({ type: "mempool.add", data: { txId: "o2", category: "oracle" } });
  r.advance(60_000);
  sealIds(r, 102, ["o2"]);
  assert.equal(r.said.filter((e) => e.k === "chain:oracle").length, 1, "the next within 2 min is quiet");
});

test("E16–E18: down at 6 s, lost at 2 min, back with a cheer and the blocks missed; offline is its own", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(100);
  r.s.socket(false);
  r.advance(5_900);
  assert.equal(r.said.length, 0);
  r.advance(200);
  assert.deepEqual(kinds(r.said), ["net:state"]);
  assert.equal((r.said[0] as { state: string }).state, "down");
  r.advance(120_000);
  assert.equal((r.said.at(-1) as { state: string }).state, "lost");
  r.s.socket(true);
  r.tip(103);
  const back = r.said.at(-1) as { state: string; cheer?: boolean; missed?: number };
  assert.equal(back.state, "live");
  assert.equal(back.cheer, true);
  assert.equal(back.missed, 3);
  assert.equal(r.said.filter((e) => e.k === "chain:catchup").length, 0, "the rejoin counts them, not a catch-up");
  r.s.online(false);
  assert.equal((r.said.at(-1) as { state: string }).state, "offline");
  assert.equal(r.s.state().net, "offline");
});

test("E19: behind after two lagging polls, cleared at ≤ 2; a node trailing its headers > 30 s", () => {
  const r = rig();
  r.s.indexer(9);
  assert.equal(r.s.state().behind.on, false, "one poll is not enough");
  r.s.indexer(9);
  assert.deepEqual(r.said.at(-1), { k: "site:behind", on: true, lag: 9, node: false, peers: false });
  r.s.indexer(4);
  assert.equal(r.s.state().behind.on, true, "4 is not cleared yet");
  r.s.indexer(2);
  assert.equal((r.said.at(-1) as { on: boolean }).on, false);
  r.s.feed({ type: "node.info", data: { headersHeight: 110, fullHeight: 100, peersCount: 8 } });
  r.advance(29_000);
  assert.equal(r.s.state().behind.on, false);
  r.advance(2_000);
  assert.equal(r.s.state().behind.node, true);
});

test("E21: crossing a multiple of 1024 says the epoch; E22: a mock stream says nothing of Э4", () => {
  const r = rig();
  r.tip(2047);
  r.seal(2048, 3);
  assert.deepEqual(r.said.at(-1), { k: "chain:epoch", height: 2048 });
  const m = rig();
  m.s.feed({ type: "hello", data: { mock: true } });
  m.s.socket(true);
  m.s.indexer(50);
  m.s.indexer(50);
  m.s.price(1);
  m.s.price(2);
  m.s.socket(false);
  m.advance(10_000);
  assert.equal(m.said.length, 0);
});

test("clock offset: after a connect the wait counts from the stream's last block on the server clock", () => {
  const said: KayoloEvent[] = [];
  let t = 1_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  const s = createChainSense({
    say: (e) => said.push(e),
    now: () => t,
    visible: () => true,
    wall: () => 1_700_000_000_000,
    setTimer: (fn, ms) => {
      const x = { at: t + ms, fn };
      timers.push(x);
      return x;
    },
    clearTimer: (id) => {
      const i = timers.indexOf(id as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  s.socket(true);
  // The server clock runs 5 s ahead; its last block was 200 s ago on the server.
  s.feed({ type: "mempool.snapshot", data: { count: 3, ts: 1_700_000_005_000 } });
  s.feed({ type: "fees.histogram", data: { p50: 2000, eta: { avgIntervalMs: 120_000, lastBlockTs: 1_700_000_005_000 - 200_000 } } });
  s.feed({ type: "chain.tip", data: { height: 500, headerId: "z".repeat(64) } });
  assert.equal(s.state().at, 1_000_000 - 200_000);
  // 2× the average (240 s) is 40 s away, not 240 s.
  t += 40_100;
  for (const x of [...timers]) if (x.at <= t) x.fn();
  assert.equal(said.at(-1)?.k, "chain:tip-wait");
});

test("a partial seal (no block read) is a block of unknown size, never an empty one", () => {
  const r = rig();
  r.tip(200);
  r.s.feed({ type: "block.sealed", data: { height: 201, blockId: "z".repeat(64), txIds: [], txCount: 0, timestamp: 0, seenAt: 0, partial: true } });
  assert.deepEqual(r.said, [{ k: "chain:block", height: 201, txCount: null, size: null, kind: "normal" }]);
});

test("two seals in one breath: one reaction each, in order", () => {
  const r = rig();
  r.tip(300);
  r.seal(301, 5);
  r.seal(302, 6);
  assert.deepEqual(
    r.said.map((e) => (e.k === "chain:block" ? e.height : null)),
    [301, 302]
  );
});

test("E5–E7 count from the seal's seenAt (the gateway's clock), not from when the tab got it", () => {
  const said: KayoloEvent[] = [];
  const t = 1_000_000;
  const s = createChainSense({
    say: (e) => said.push(e),
    now: () => t,
    visible: () => true,
    wall: () => 1_700_000_000_000,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  s.socket(true);
  // The server clock runs 5 s ahead.
  s.feed({ type: "mempool.snapshot", data: { count: 3, ts: 1_700_000_005_000 } });
  s.feed({ type: "chain.tip", data: { height: 500, headerId: "z".repeat(64) } });
  // The gateway saw 501 20 s ago on its clock; the seal reaches this tab only now.
  s.feed({ type: "block.sealed", data: { height: 501, blockId: "y".repeat(64), txIds: [], txCount: 4, size: 3000, timestamp: 0, seenAt: 1_700_000_005_000 - 20_000 } });
  assert.equal(s.state().at, 1_000_000 - 20_000);
  // A seenAt «from the future» (clock noise) never puts the block after now.
  s.feed({ type: "block.sealed", data: { height: 502, blockId: "w".repeat(64), txIds: [], txCount: 4, size: 3000, timestamp: 0, seenAt: 1_700_000_005_000 + 3_000 } });
  assert.equal(s.state().at, 1_000_000);
});

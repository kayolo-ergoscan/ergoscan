import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { blockKind, createChainSense, pageTopics, type ChainNote } from "./chain-sense";
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

test("E10: a tx of the page's protocol (the live ball's platform), at most once in 3 min; on /mempool only a rare one", () => {
  let path = "/rosen";
  const said: KayoloEvent[] = [];
  let t = 0;
  const s = createChainSense({ say: (e) => said.push(e), now: () => t, visible: () => true, setTimer: () => 0, clearTimer: () => {}, path: () => path });
  // Live balls: `category` is the shape, `platform` the protocol.
  s.feed({ type: "mempool.add", data: { txId: "a", category: "contract", platform: "rosen" } });
  s.feed({ type: "mempool.add", data: { txId: "b", category: "contract", platform: "rosen" } });
  assert.deepEqual(said, [{ k: "chain:tx-topic", category: "rosen", txId: "a", rare: false }]);
  path = "/oracles/erg-usd";
  t = 200_000;
  s.feed({ type: "mempool.add", data: { txId: "o", category: "contract", platform: "oracle", action: "oracle-datapoint" } });
  assert.deepEqual(said.at(-1), { k: "chain:tx-topic", category: "oracle", txId: "o", rare: false });
  path = "/mempool";
  t = 400_000;
  for (let i = 0; i < 60; i++) s.feed({ type: "mempool.add", data: { txId: `p${i}`, category: "transfer" } });
  assert.equal(said.length, 2, "a common one is not a topic");
  s.feed({ type: "mempool.add", data: { txId: "l1", category: "contract", platform: "lithos" } });
  assert.deepEqual(said.at(-1), { k: "chain:tx-topic", category: "lithos", txId: "l1", rare: true });
});

test("E10: page topics are protocols; no page is about a shape", () => {
  assert.deepEqual(pageTopics("/defi/spectrum"), ["spectrum"]);
  assert.deepEqual(pageTopics("/defi/lithos"), ["lithos"]);
  assert.deepEqual(pageTopics("/defi/pool/abc"), ["spectrum", "lithos"]);
  assert.deepEqual(pageTopics("/defi/stable"), ["sigmausd"]);
  assert.deepEqual(pageTopics("/oracles/xau-erg?x=1"), ["oracle"]);
  assert.deepEqual(pageTopics("/nfts"), []);
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

type Fixture = { messages: { t: number; type: string; data: Record<string, unknown> }[] };
const liveOracle = JSON.parse(readFileSync(new URL("./fixtures/oracle-live.json", import.meta.url), "utf8")) as Fixture;

test("E15 on the live stream (fixtures/oracle-live.json): the seal names its oracle txs with action and tokens", () => {
  const r = rig();
  r.s.socket(true);
  const notes: ChainNote[] = [];
  r.s.listen((n) => notes.push(n));
  const asked: number[] = [];
  r.s.await((x) => {
    asked.push(x.height);
    return x.oracle.some((o) => o.action === "oracle-refresh");
  });
  for (const m of liveOracle.messages) r.s.feed({ type: m.type, data: m.data });
  r.advance(5_000);
  const seals = notes.filter((n): n is Extract<ChainNote, { k: "seal" }> => n.k === "seal");
  assert.deepEqual(seals.map((n) => n.height), [1_916_557, 1_916_558, 1_916_559]);
  assert.deepEqual(asked, [1_916_557, 1_916_558, 1_916_559], "every new block asks the pages");
  assert.deepEqual(seals[0].oracle, []);
  assert.deepEqual(
    seals[1].oracle.map((o) => [o.id.slice(0, 10), o.action, o.tokens.map((x) => x.slice(0, 8))]),
    [
      ["054f327837", "oracle-datapoint", ["74fa4aee", "ae399fcb"]],
      ["96cfdd4939", "oracle-refresh", ["6a2b821b", "ae399fcb", "19b7f2e2", "74fa4aee"]],
    ]
  );
  assert.deepEqual(seals[2].oracle, [], "the next datapoint is still in the pool");
  assert.equal(seals[2].rentBoxes, 2);
  const block = r.said.find((e) => e.k === "chain:block" && e.height === 1_916_558) as { hold?: boolean };
  assert.equal(block.hold, true, "the refresh holds its block's E1 for the oracle page");
  assert.equal((r.said.find((e) => e.k === "chain:block" && e.height === 1_916_559) as { hold?: boolean }).hold, undefined);
});

test("E15: the first recording kept oracle ids only — they come without action or tokens", () => {
  const r = rig();
  r.tip(100);
  const notes: ChainNote[] = [];
  r.s.listen((n) => notes.push(n));
  r.s.feed({ type: "mempool.snapshot", data: { count: 3, oracle: ["o1"], balls: [{ txId: "o2", category: "oracle" }] } });
  sealIds(r, 101, ["o1", "o2", "t1"]);
  assert.deepEqual(notes.at(-1), {
    k: "seal",
    height: 101,
    blockId: "y".repeat(64),
    txIds: ["o1", "o2", "t1"],
    oracle: [
      { id: "o1", action: null, tokens: [] },
      { id: "o2", action: null, tokens: [] },
    ],
  });
});

test("seals for the pages: a partial seal's txs are unknown (null), a tip standing in too, a late seal still comes", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(200);
  const notes: ChainNote[] = [];
  const asked: (readonly string[] | null)[] = [];
  r.s.listen((n) => notes.push(n));
  r.s.await((x) => {
    asked.push(x.txIds);
    return false;
  });
  r.s.feed({ type: "block.sealed", data: { height: 201, blockId: "a".repeat(64), txIds: [], txCount: 0, timestamp: 0, seenAt: 0, partial: true } });
  assert.deepEqual(asked, [null], "a partial seal is not «none of yours»");
  assert.equal((notes[0] as { txIds: unknown }).txIds, null);
  // A tip without its seal stands in after 3 s; the seal that comes later reaches the pages, no reaction.
  r.tip(202);
  r.advance(3_100);
  assert.deepEqual(notes.at(-1), { k: "seal", height: 202, blockId: null, txIds: null, oracle: [] });
  const blocks = r.said.filter((e) => e.k === "chain:block").length;
  r.s.feed({ type: "block.sealed", data: { height: 202, blockId: "b".repeat(64), txIds: ["mine"], txCount: 2, size: 900, timestamp: 0 } });
  assert.deepEqual(notes.at(-1), { k: "seal", height: 202, blockId: "b".repeat(64), txIds: ["mine"], oracle: [] }, "late, not a fork");
  assert.equal(r.said.filter((e) => e.k === "chain:block").length, blocks);
  assert.deepEqual(asked, [null, null], "a late seal asks no E1 question");
});

test("a fork: another block at a shown height reaches the pages as replaced, with no reaction; the same block again is nothing", () => {
  const r = rig();
  r.s.socket(true);
  r.tip(300);
  const notes: ChainNote[] = [];
  let asked = 0;
  r.s.listen((n) => notes.push(n));
  r.s.await(() => {
    asked += 1;
    return true;
  });
  r.s.feed({ type: "block.sealed", data: { height: 301, blockId: "a".repeat(64), txIds: ["x1"], txCount: 1, timestamp: 0 } });
  r.s.feed({ type: "block.sealed", data: { height: 301, blockId: "a".repeat(64), txIds: ["x1"], txCount: 1, timestamp: 0 } });
  r.s.feed({ type: "block.sealed", data: { height: 301, blockId: "b".repeat(64), txIds: ["x1", "mine"], txCount: 2, timestamp: 0 } });
  assert.equal(r.said.filter((e) => e.k === "chain:block").length, 1, "one reaction for the height");
  assert.equal(asked, 1, "the replacement asks no E1 question");
  assert.equal(notes.length, 2);
  assert.deepEqual(notes[1], { k: "seal", height: 301, blockId: "b".repeat(64), txIds: ["x1", "mine"], oracle: [], replaced: true, replaces: "a".repeat(64) });
});

test("every page is asked: one page's yes does not hide the block from the next (no short-circuit)", () => {
  const r = rig();
  r.tip(400);
  const calls: string[] = [];
  r.s.await(() => {
    calls.push("A");
    return true;
  });
  r.s.await(() => {
    calls.push("B");
    return false;
  });
  sealIds(r, 401, ["x1"]);
  assert.deepEqual(calls, ["A", "B"]);
  assert.equal((r.said.at(-1) as { hold?: boolean }).hold, true);
});

test("a tx leaving the pool reaches the pages; a mock stream reaches none", () => {
  const r = rig();
  r.tip(500);
  const notes: ChainNote[] = [];
  r.s.listen((n) => notes.push(n));
  r.s.feed({ type: "mempool.remove", data: { id: "t1" } });
  assert.deepEqual(notes, [{ k: "gone", id: "t1" }]);
  r.s.feed({ type: "hello", data: { mock: true } });
  r.s.feed({ type: "mempool.remove", data: { id: "t2" } });
  sealIds(r, 501, ["t3"]);
  assert.equal(notes.length, 1);
});

test("a hidden tab: no reaction and no E1 question, but the pages still hear the seal", () => {
  const r = rig();
  r.tip(600);
  r.setVisible(false);
  const notes: ChainNote[] = [];
  let asked = 0;
  r.s.listen((n) => notes.push(n));
  r.s.await(() => {
    asked += 1;
    return true;
  });
  sealIds(r, 601, ["t1"]);
  assert.equal(asked, 0);
  assert.equal(r.said.length, 0);
  assert.equal(notes.length, 1);
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

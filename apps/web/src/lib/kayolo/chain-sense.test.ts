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
  return { s, said, advance, tip, seal, setVisible: (v: boolean) => (visible = v), now: () => t };
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

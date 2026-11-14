import { test } from "node:test";
import assert from "node:assert/strict";
import { SEAL_MAX_PER_MOVE, SealWatcher, lastBlockClock, nextSeenTip } from "./seal.js";

/** A node with one or more forks: blocks by id, each with its parent. Records every call. */
function fakeNode() {
  const blocks = new Map<string, { id: string; height: number; parentId: string; timestamp: number; txs: string[] }>();
  const best = new Map<number, string>();
  const calls: string[] = [];
  const failing = new Set<string>();
  /** Ids the node answers 200 with a body that is not a block. */
  const malformed = new Map<string, unknown>();
  const id = (fork: string, h: number) => `${fork}${String(h).padStart(8, "0")}`.padEnd(64, "0");
  function add(fork: string, h: number, parentFork = fork) {
    const b = { id: id(fork, h), height: h, parentId: id(parentFork, h - 1), timestamp: h * 1000, txs: [`tx-${fork}-${h}-a`, `tx-${fork}-${h}-b`] };
    blocks.set(b.id, b);
    best.set(h, b.id);
    return b.id;
  }
  const node = {
    async get<T>(path: string): Promise<T> {
      calls.push(path);
      const at = /^\/blocks\/at\/(\d+)$/.exec(path);
      if (at) return [best.get(Number(at[1]))].filter(Boolean) as T;
      const m = /^\/blocks\/([0-9a-z]+)$/.exec(path);
      if (m) {
        if (failing.has(m[1]!)) throw new Error("node 503");
        if (malformed.has(m[1]!)) return malformed.get(m[1]!) as T;
        const b = blocks.get(m[1]!);
        if (!b) throw new Error("node 404");
        return {
          header: { id: b.id, height: b.height, timestamp: b.timestamp, parentId: b.parentId },
          blockTransactions: { transactions: b.txs.map((t) => ({ id: t })) },
          size: 1234,
        } as T;
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  return { node, add, id, calls, failing, malformed };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
}

test("seal: the first look only takes the tip; one block up seals it with seenAt, one read", async () => {
  const n = fakeNode();
  const c = clock();
  const w = new SealWatcher(n.node, c.now);
  n.add("a", 99);
  const a100 = n.add("a", 100);
  assert.deepEqual(await w.check(100, a100), []);
  assert.equal(n.calls.length, 0);
  const a101 = n.add("a", 101);
  c.set(2_000_000);
  const out = await w.check(101, a101);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.blockId, a101);
  assert.equal(out[0]!.height, 101);
  assert.equal(out[0]!.timestamp, 101_000, "header time stays as it is");
  assert.equal(out[0]!.seenAt, 2_000_000, "seenAt is the gateway clock when the tip moved");
  assert.deepEqual(out[0]!.txIds, ["tx-a-101-a", "tx-a-101-b"]);
  assert.equal(out[0]!.partial, undefined);
  assert.deepEqual(n.calls, [`/blocks/${a101}`]);
  // The same tip again (the 10 s poll after the live loop): nothing.
  assert.deepEqual(await w.check(101, a101), []);
  assert.equal(n.calls.length, 1);
});

test("seal: a jump of 2 seals both heights in order, one read per height", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node, () => 5_000);
  const a100 = n.add("a", 100);
  await w.check(100, a100);
  n.add("a", 101);
  const a102 = n.add("a", 102);
  const out = await w.check(102, a102);
  assert.deepEqual(out.map((s) => s.height), [101, 102]);
  assert.deepEqual(out.map((s) => s.blockId), [n.id("a", 101), a102]);
  assert.ok(out.every((s) => s.seenAt === 5_000 && !s.partial));
  assert.equal(n.calls.length, 2);
  assert.ok(n.calls.every((p) => p.startsWith("/blocks/") && !p.startsWith("/blocks/at/")));
});

test("seal: a jump of 5 seals only the newest few, in order", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  const a100 = n.add("a", 100);
  await w.check(100, a100);
  for (let h = 101; h <= 104; h++) n.add("a", h);
  const a105 = n.add("a", 105);
  const out = await w.check(105, a105);
  assert.equal(SEAL_MAX_PER_MOVE, 3);
  assert.deepEqual(out.map((s) => s.height), [103, 104, 105]);
  assert.equal(n.calls.length, 3, "never more than one read per sealed block");
  // The next block joins the sealed tip with one read.
  const a106 = n.add("a", 106);
  assert.deepEqual((await w.check(106, a106)).map((s) => s.height), [106]);
  assert.equal(n.calls.length, 4);
});

test("seal: a new id at the same height seals the replacing block once", async () => {
  const n = fakeNode();
  const c = clock(10_000);
  const w = new SealWatcher(n.node, c.now);
  n.add("a", 99);
  n.add("a", 100);
  await w.check(99, n.id("a", 99));
  const first = await w.check(100, n.id("a", 100));
  assert.deepEqual(first.map((s) => s.blockId), [n.id("a", 100)]);
  const b100 = n.add("b", 100, "a");
  c.set(20_000);
  const out = await w.check(100, b100);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.blockId, b100);
  assert.equal(out[0]!.height, 100);
  assert.equal(out[0]!.seenAt, 20_000);
  assert.deepEqual(await w.check(100, b100), [], "the same block is never sealed twice");
});

test("seal: a fork switch that also climbs seals the replaced height, then the new tip", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  n.add("a", 99);
  await w.check(99, n.id("a", 99));
  await w.check(100, n.add("a", 100));
  n.add("b", 100, "a");
  const b101 = n.add("b", 101);
  const out = await w.check(101, b101);
  assert.deepEqual(out.map((s) => s.blockId), [n.id("b", 100), b101]);
});

test("seal: the node stepping back and returning to the same block seals nothing", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  n.add("a", 99);
  await w.check(99, n.id("a", 99));
  const a100 = n.add("a", 100);
  assert.equal((await w.check(100, a100)).length, 1);
  assert.deepEqual(await w.check(99, n.id("a", 99)), []);
  assert.deepEqual(await w.check(100, a100), []);
  // It returns on another block: that one is sealed (it replaces the tower at 100).
  const b100 = n.add("b", 100, "a");
  await w.check(99, n.id("a", 99));
  assert.deepEqual((await w.check(100, b100)).map((s) => s.blockId), [b100]);
});

test("seal: a stale /info answer (asked before the last one used) is ignored", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  n.add("a", 99);
  await w.check(99, n.id("a", 99), 1);
  const a100 = n.add("a", 100);
  const b100 = n.add("b", 100, "a");
  n.add("a", 100); // a is best again
  assert.equal((await w.check(100, a100, 3)).length, 1);
  assert.deepEqual(await w.check(100, b100, 2), [], "the older answer does not flip the tip");
  assert.deepEqual(await w.check(100, a100, 4), []);
});

test("seal: a failed block read gives the real id from /info, marked partial", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node, () => 7_000);
  const a100 = n.add("a", 100);
  await w.check(100, a100);
  const a101 = n.add("a", 101);
  n.failing.add(a101);
  const out = await w.check(101, a101);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.blockId, a101, "the real id, not height-N");
  assert.equal(out[0]!.partial, true);
  assert.deepEqual(out[0]!.txIds, []);
  assert.equal(out[0]!.txCount, 0);
  assert.equal(out[0]!.seenAt, 7_000);
  assert.equal(out[0]!.timestamp, 7_000);
  // A failed read of a skipped height: the tip in full, the skipped one partial, still in order.
  const a102 = n.add("a", 102);
  const a103 = n.add("a", 103);
  n.failing.add(a102);
  const two = await w.check(103, a103);
  assert.deepEqual(two.map((s) => [s.height, s.blockId, s.partial === true]), [
    [102, a102, true],
    [103, a103, false],
  ]);
});

test("seal: a body that is not a block (no header, a bad tx list) gives a partial seal, not none", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node, () => 5_000);
  n.add("a", 100);
  await w.check(100, n.id("a", 100));
  const a101 = n.add("a", 101);
  n.malformed.set(a101, {});
  const out = await w.check(101, a101);
  assert.deepEqual(
    out.map((s) => [s.height, s.blockId, s.partial]),
    [[101, a101, true]]
  );
  assert.equal(out[0]!.seenAt, 5_000);
  // The same tip again: already sealed, nothing more.
  assert.deepEqual(await w.check(101, a101), []);
  // A skipped height whose body has a header but no usable tx list: partial, and the walk stops there.
  const a102 = n.add("a", 102);
  const a103 = n.add("a", 103);
  n.malformed.set(a102, {
    header: { id: a102, height: 102, timestamp: 1, parentId: a101 },
    blockTransactions: { transactions: "x" },
  });
  const two = await w.check(103, a103);
  assert.deepEqual(two.map((s) => [s.height, s.blockId, s.partial === true]), [
    [102, a102, true],
    [103, a103, false],
  ]);
});

test("seal: an answer asked earlier but carrying a newer tip is dropped, and stale() says so", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  n.add("a", 99);
  await w.check(99, n.id("a", 99), 1);
  const a100 = n.add("a", 100);
  // The 10 s poll (asked #3) answers first with the old tip; the live tick (asked #2) comes later.
  assert.deepEqual(await w.check(99, n.id("a", 99), 3), []);
  assert.equal(w.stale(3), false);
  assert.deepEqual(await w.check(100, a100, 2), []);
  assert.equal(w.stale(2), true, "the caller looks at this tip again on its next round");
  // The next live tick asks again (#4): the block is sealed then, not at the next 10 s poll.
  assert.deepEqual((await w.check(100, a100, 4)).map((s) => s.blockId), [a100]);
  assert.equal(w.stale(4), false);
});

test("seal: a reorg 3 deep that also climbs seals the newest 3 of the new branch, oldest first", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  for (let h = 96; h <= 100; h++) n.add("a", h);
  for (let h = 97; h <= 100; h++) await w.check(h, n.id("a", h));
  n.add("b", 98, "a");
  n.add("b", 99);
  n.add("b", 100);
  const b101 = n.add("b", 101);
  n.calls.length = 0;
  const out = await w.check(101, b101);
  assert.deepEqual(out.map((s) => s.height), [99, 100, 101]);
  assert.deepEqual(out.map((s) => s.blockId), [n.id("b", 99), n.id("b", 100), b101]);
  assert.equal(n.calls.length, SEAL_MAX_PER_MOVE, "one read per sealed block");
});

test("seal: a node catching up a thousand heights reads only the newest few blocks", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  n.add("a", 1000);
  await w.check(1000, n.id("a", 1000));
  for (let h = 1001; h <= 2000; h++) n.add("a", h);
  n.calls.length = 0;
  const out = await w.check(2000, n.id("a", 2000));
  assert.deepEqual(out.map((s) => s.height), [1998, 1999, 2000]);
  assert.equal(n.calls.length, SEAL_MAX_PER_MOVE);
  // Climbing five a check (a resync): still at most SEAL_MAX_PER_MOVE reads each time.
  for (let h = 2001; h <= 2046; h += 5) {
    for (let k = h; k < h + 5; k++) n.add("a", k);
    n.calls.length = 0;
    assert.equal((await w.check(h + 4, n.id("a", h + 4))).length, SEAL_MAX_PER_MOVE);
    assert.equal(n.calls.length, SEAL_MAX_PER_MOVE);
  }
});

test("seal: no header id and no /blocks/at answer still marks the seal partial", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node, () => 1);
  n.add("a", 100);
  await w.check(100, null);
  const out = await w.check(101, null);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.partial, true);
  assert.equal(out[0]!.blockId, "height-101");
  assert.deepEqual(n.calls, ["/blocks/at/101"]);
});

test("eta: the countdown runs from seenAt, a same-height fork does not restart it", () => {
  const s1 = nextSeenTip(null, { height: 100, seenAt: 50_000 });
  assert.deepEqual(s1, { height: 100, seenAt: 50_000 });
  assert.equal(nextSeenTip(s1, { height: 100, seenAt: 60_000 }), null);
  assert.equal(nextSeenTip(s1, { height: 99, seenAt: 60_000 }), null);
  assert.equal(nextSeenTip(s1, { height: 101 }), null, "a seal from an old gateway (no seenAt) moves nothing");
  assert.deepEqual(nextSeenTip(s1, { height: 101, seenAt: 70_000 }), { height: 101, seenAt: 70_000 });
  // The header of block 100 says 10_000 (template start); the gateway saw it at 50_000.
  assert.equal(lastBlockClock(s1, { height: 100, timestamp: 10_000 }), 50_000);
  // Header one ahead, its body on the way: still the last sighting.
  assert.equal(lastBlockClock(s1, { height: 101, timestamp: 45_000 }), 50_000);
  // Just started (no sighting) or far behind the headers: the header time.
  assert.equal(lastBlockClock(null, { height: 100, timestamp: 10_000 }), 10_000);
  assert.equal(lastBlockClock(s1, { height: 105, timestamp: 90_000 }), 90_000);
});

test("seal: two pollers asking at once get the blocks in order, each once", async () => {
  const n = fakeNode();
  const w = new SealWatcher(n.node);
  const a100 = n.add("a", 100);
  await w.check(100, a100, 1);
  const a101 = n.add("a", 101);
  const a102 = n.add("a", 102);
  // The 10 s poll saw 101, the live loop 102 right after; both checks run together.
  const [x, y] = await Promise.all([w.check(101, a101, 2), w.check(102, a102, 3)]);
  assert.deepEqual([...x, ...y].map((s) => s.height), [101, 102]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { formingAfterSeal, mergeBlockRow, mergeBlockRows, type BlockRow } from "./home-tape";

const id = (fork: string, h: number) => `${fork}${h}`.padEnd(64, "0");
const KEEP = 11;

function indexed(fork: string, h: number): BlockRow {
  return {
    id: id(fork, h),
    height: h,
    timestamp: h * 1000,
    txCount: 7,
    size: 900,
    color: "#abc",
    lithos: true,
    minerName: "pool",
    minerAddress: "9miner",
    feeNano: "1000",
  };
}

test("tape: another block at the same height carries nothing of the replaced one", () => {
  const tape = mergeBlockRows([], [indexed("a", 100), indexed("a", 99)], KEEP);
  // A full seal of the fork's block: counts of its own, no miner, fees, colour or Lithos mark yet.
  const full = mergeBlockRow(tape, { id: id("b", 100), height: 100, timestamp: 5, txCount: 3, size: 400, seenAt: 9 }, KEEP);
  assert.deepEqual(full[0], {
    id: id("b", 100),
    height: 100,
    timestamp: 5,
    txCount: 3,
    size: 400,
    color: null,
    lithos: undefined,
    minerName: null,
    minerAddress: null,
    feeNano: null,
    seenAt: 9,
  });
  assert.equal(full[1]!.id, id("a", 99), "the row below stays");
  // A partial seal of the fork's block: no counts at all, not the old block's.
  const partial = mergeBlockRow(tape, { id: id("b", 100), height: 100, timestamp: 5, txCount: null, size: 0, seenAt: 9 }, KEEP);
  assert.equal(partial[0]!.id, id("b", 100));
  assert.equal(partial[0]!.txCount, null);
  assert.equal(partial[0]!.size, 0);
  assert.equal(partial[0]!.minerAddress, null);
  assert.equal(partial[0]!.feeNano, null);
});

test("tape: the same block fills in what it lacks; a row without a real id takes one", () => {
  const sealed = mergeBlockRow([], { id: id("a", 100), height: 100, timestamp: 5, txCount: 3, size: 400, seenAt: 9 }, KEEP);
  const filled = mergeBlockRow(sealed, indexed("a", 100), KEEP);
  assert.equal(filled[0]!.minerAddress, "9miner");
  assert.equal(filled[0]!.seenAt, 9, "the sighting stays");
  assert.equal(filled[0]!.txCount, 7);
  // `seal-<height>` stands in for a seal without an id; the real id later keeps what it has.
  const stub = mergeBlockRow([], { id: "seal-101", height: 101, timestamp: 5, txCount: 4, size: 300 }, KEEP);
  const named = mergeBlockRow(stub, { id: id("a", 101), height: 101, timestamp: 6, txCount: null, size: 0, seenAt: 3 }, KEEP);
  assert.deepEqual([named[0]!.id, named[0]!.txCount, named[0]!.size, named[0]!.seenAt], [id("a", 101), 4, 300, 3]);
});

test("forming: a new height restarts it; a fork at the top's height keeps what it showed", () => {
  const top = { id: id("a", 100), height: 100 };
  // The block above the top: from its sighting.
  assert.deepEqual(formingAfterSeal({ height: 101, blockId: id("a", 101) }, top, 50, 10), { height: 101, at: 50 });
  // The top's own block (the snapshot was first): its sighting is the better time.
  assert.deepEqual(formingAfterSeal({ height: 100, blockId: top.id }, top, 50, 10), { height: 100, at: 50 });
  // The first seal the page sees is another block at the top's height: no restart.
  assert.deepEqual(formingAfterSeal({ height: 100, blockId: id("b", 100) }, top, 50, 10), { height: 100, at: 10 });
  assert.equal(formingAfterSeal({ height: 100, blockId: id("b", 100) }, top, 50, null), null);
  // An older block than the tape's top: nothing changes.
  assert.equal(formingAfterSeal({ height: 99, blockId: id("a", 99) }, top, 50, 10), null);
  // No tape yet: the seal is all there is.
  assert.deepEqual(formingAfterSeal({ height: 100, blockId: id("b", 100) }, undefined, 50, null), { height: 100, at: 50 });
});

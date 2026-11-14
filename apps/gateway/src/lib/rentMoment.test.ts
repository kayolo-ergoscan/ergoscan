import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeRentOutIndex, type RentCollectedEvent, type SealEvent } from "@ergoscan/shared";
import { SealWatcher } from "./seal.js";
import { RENT_TXS_MAX, announceRent, collectRent, noteRentSpends, resetRentNotes } from "./rentMoment.js";

/** Mainnet block 1 916 412: one rent tx, 38 spends under the rule, 36 of them paid 3.825 ERG. */
const fx = JSON.parse(
  readFileSync(new URL("./fixtures/rent-block-1916412.json", import.meta.url), "utf8")
) as { block: { header: { id: string; height: number; timestamp: number; parentId: string } }; rentTx: { id: string } };
const BLOCK_ID = fx.block.header.id;
const H = fx.block.header.height;
const COLLECTOR = "9gt6gUHYWFS9u448GyP5eqvCTk3eRHcdcC4JcReJxKFmviztSEV";

function seal(rentBoxes?: number): Pick<SealEvent, "blockId" | "height" | "rentBoxes"> {
  return { blockId: BLOCK_ID, height: H, rentBoxes };
}

test("extension 127 decodes without Buffer (browser-safe shared code)", () => {
  assert.equal(decodeRentOutIndex("0302"), 1);
  assert.equal(decodeRentOutIndex("0306"), 3);
  assert.equal(decodeRentOutIndex("0301"), -1);
  assert.equal(decodeRentOutIndex("0e02"), null);
  assert.equal(decodeRentOutIndex(""), null);
});

test("a real block: rent spends counted from the seal's own block JSON", () => {
  resetRentNotes();
  assert.deepEqual(noteRentSpends(fx.block), { rentBoxes: 38 });
});

test("a block with no rent spends adds nothing to the seal", () => {
  resetRentNotes();
  const plain = {
    header: { id: "ab".repeat(32) },
    blockTransactions: { transactions: [{ id: "cd".repeat(32), inputs: [{ boxId: "x", spendingProof: { proofBytes: "aa", extension: {} } }] }] },
  };
  assert.deepEqual(noteRentSpends(plain), {});
});

test("the seal carries rentBoxes for a real rent block", async () => {
  resetRentNotes();
  const node = {
    async get<T>(path: string): Promise<T> {
      if (path === `/blocks/${BLOCK_ID}`) return fx.block as T;
      throw new Error(`unexpected ${path}`);
    },
  };
  const w = new SealWatcher(node, () => 5);
  await w.check(H - 1, fx.block.header.parentId);
  const out = await w.check(H, BLOCK_ID);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.rentBoxes, 38);
  assert.equal(out[0]!.txCount, 2);
});

test("collected: exact ERG and collector from the node's tx index (36 paid, 3.825 ERG)", async () => {
  resetRentNotes();
  noteRentSpends(fx.block);
  const asked: string[] = [];
  const ev = await collectRent(seal(38), async (id) => {
    asked.push(id);
    return fx.rentTx as never;
  }, [0]);
  assert.deepEqual(asked, [fx.rentTx.id]);
  assert.deepEqual(ev, { blockId: BLOCK_ID, height: H, boxes: 36, rentNano: "3825000000", collector: COLLECTOR });
});

test("the index lags: retries, then the exact numbers", async () => {
  resetRentNotes();
  noteRentSpends(fx.block);
  let n = 0;
  const ev = await collectRent(seal(38), async () => (++n < 3 ? null : (fx.rentTx as never)), [0, 0, 0, 0]);
  assert.equal(n, 3);
  assert.equal(ev?.rentNano, "3825000000");
});

test("the index never answers: the count alone, no invented ERG", async () => {
  resetRentNotes();
  noteRentSpends(fx.block);
  const ev = await collectRent(seal(38), async () => null, [0, 0]);
  assert.deepEqual(ev, { blockId: BLOCK_ID, height: H, boxes: 38, rentNano: null, collector: null });
});

test("no rent spends: no event, no node call", async () => {
  resetRentNotes();
  let called = 0;
  assert.equal(await collectRent(seal(0), async () => (called++, null), [0]), null);
  assert.equal(called, 0);
  const sent: RentCollectedEvent[] = [];
  announceRent([{ ...seal(), txIds: [], replaySeed: "s", txCount: 0, timestamp: 1 }], (e) => sent.push(e.data));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sent.length, 0);
});

/** The fixture block with its rent tx repeated `n` times under distinct ids (38 spends each). */
function manyRentTxs(n: number) {
  const rent = (fx.block as unknown as { blockTransactions: { transactions: Array<{ id: string }> } }).blockTransactions
    .transactions.find((t) => t.id === fx.rentTx.id)!;
  const ids = Array.from({ length: n }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  const block = { ...fx.block, blockTransactions: { transactions: ids.map((id) => ({ ...rent, id })) } };
  return { block, ids };
}

test("seven rent txs (more than the old cap of six): every one is read, the sum is whole", async () => {
  resetRentNotes();
  const { block, ids } = manyRentTxs(7);
  assert.deepEqual(noteRentSpends(block), { rentBoxes: 7 * 38 });
  const asked: string[] = [];
  const ev = await collectRent(seal(7 * 38), async (id) => {
    asked.push(id);
    return { ...fx.rentTx, id } as never;
  }, [0]);
  assert.deepEqual(asked, ids);
  assert.equal(ev?.boxes, 7 * 36);
  assert.equal(ev?.rentNano, String(7n * 3825000000n));
});

test("more rent txs than RENT_TXS_MAX: the count alone, no reads, never a partial sum", async () => {
  resetRentNotes();
  const n = RENT_TXS_MAX + 1;
  const { block } = manyRentTxs(n);
  assert.deepEqual(noteRentSpends(block), { rentBoxes: n * 38 });
  let called = 0;
  const ev = await collectRent(seal(n * 38), async () => (called++, fx.rentTx as never), [0]);
  assert.equal(called, 0);
  assert.deepEqual(ev, { blockId: BLOCK_ID, height: H, boxes: n * 38, rentNano: null, collector: null });
});

test("rent counting that throws leaves the seal whole (not partial), with one warning", async () => {
  resetRentNotes();
  const bad = {
    id: "ef".repeat(32),
    get inputs(): never {
      throw new Error("odd input list");
    },
  };
  const block = { ...fx.block, blockTransactions: { transactions: [bad] } };
  const warns: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a);
  try {
    assert.deepEqual(noteRentSpends(block), {});
    const node = {
      async get<T>(path: string): Promise<T> {
        if (path === `/blocks/${BLOCK_ID}`) return block as T;
        throw new Error(`unexpected ${path}`);
      },
    };
    const w = new SealWatcher(node, () => 5);
    await w.check(H - 1, fx.block.header.parentId);
    const out = await w.check(H, BLOCK_ID);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.partial, undefined);
    assert.equal(out[0]!.blockId, BLOCK_ID);
    assert.deepEqual(out[0]!.txIds, [bad.id]);
    assert.equal(out[0]!.rentBoxes, undefined);
  } finally {
    console.warn = warn;
  }
  assert.equal(warns.length, 1);
});

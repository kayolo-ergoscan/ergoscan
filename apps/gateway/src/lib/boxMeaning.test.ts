import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompactMeaning } from "@ergoscan/shared";
import { boxMeaningFields, loadBoxMeanings } from "./boxMeaning.js";

const MADE = "a".repeat(64);
const SPENT = "b".repeat(64);
const swap = { v: 1, action: "swap", protocol: "ergodex" } as unknown as CompactMeaning;
const send = { v: 1, action: "send", protocol: "ergo" } as unknown as CompactMeaning;

test("both txs known: the box gets creationMeaning and spentMeaning", () => {
  const m = new Map([
    [MADE, swap],
    [SPENT, send],
  ]);
  assert.deepEqual(boxMeaningFields(m, MADE, SPENT), { creationMeaning: swap, spentMeaning: send });
});

test("unspent box or a missing meaning: the field is left out, never null", () => {
  const m = new Map([[MADE, swap]]);
  const unspent = boxMeaningFields(m, MADE, null);
  assert.deepEqual(unspent, { creationMeaning: swap });
  assert.equal("spentMeaning" in unspent, false);
  const none = boxMeaningFields(new Map(), MADE, SPENT);
  assert.deepEqual(none, {});
});

test("ids in upper case still find the meaning", () => {
  const m = new Map([[MADE, swap]]);
  assert.deepEqual(boxMeaningFields(m, MADE.toUpperCase(), undefined), { creationMeaning: swap });
});

test("one read for both txs; no ids, no read", async () => {
  const calls: string[][] = [];
  const load = async (ids: string[]) => {
    calls.push(ids);
    return new Map([[MADE, swap]]);
  };
  const got = await loadBoxMeanings(MADE, SPENT, load);
  assert.deepEqual(calls, [[MADE, SPENT]]);
  assert.equal(got.get(MADE), swap);
  await loadBoxMeanings(MADE, MADE, load);
  assert.deepEqual(calls[1], [MADE]);
  const empty = await loadBoxMeanings(null, undefined, load);
  assert.equal(empty.size, 0);
  assert.equal(calls.length, 2);
});

test("a failing or slow read gives no meanings instead of failing the box", async () => {
  const failed = await loadBoxMeanings(MADE, null, async () => {
    throw new Error("pg down");
  });
  assert.equal(failed.size, 0);
  const slow = await loadBoxMeanings(
    MADE,
    null,
    () => new Promise((resolve) => setTimeout(() => resolve(new Map([[MADE, swap]])), 200)),
    20
  );
  assert.equal(slow.size, 0);
});

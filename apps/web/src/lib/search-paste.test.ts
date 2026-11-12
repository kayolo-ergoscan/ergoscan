import assert from "node:assert/strict";
import { test } from "node:test";
import { pasteTarget } from "./search-paste";

test("paste takes a 64-hex id, lower-cased and trimmed", () => {
  const id = "03FAF2CB329F2E90D6D23B58D91BBB6C046AA143261CC21F52FBE2824BFCBF04";
  assert.equal(pasteTarget(`  ${id}\n`), id.toLowerCase());
});

test("paste takes an Ergo address", () => {
  const p2pk = "9hFmeUHVttnHM1o7GfzpAMr1xLjYQ5Rb1v6iyZMHzzm8yUGYYTE";
  assert.equal(pasteTarget(p2pk), p2pk);
  const p2sh = "88dhgzEuTXaRvR2VKsnZYEqqY5pMRyKBnJ8mUvvmEQ3Zg2ZmqSc1i6Zow2hGGPn7xF7rr1Jvf2Ff3b6p";
  assert.equal(pasteTarget(p2sh), p2sh);
});

test("paste ignores words, short ids and non-base58 text", () => {
  assert.equal(pasteTarget("SigUSD"), null);
  assert.equal(pasteTarget("03faf2cb329f"), null);
  assert.equal(pasteTarget("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"), null);
  assert.equal(pasteTarget("hello world this is a long sentence with spaces"), null);
  assert.equal(pasteTarget(""), null);
  assert.equal(pasteTarget(null), null);
});

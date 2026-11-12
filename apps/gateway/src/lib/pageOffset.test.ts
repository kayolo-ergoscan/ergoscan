import assert from "node:assert/strict";
import { test } from "node:test";
import { pageOffset } from "./pageOffset.js";

test("pageOffset: as given up to max, null above, 0 for junk", () => {
  assert.equal(pageOffset("500", 500), 500);
  assert.equal(pageOffset("501", 500), null);
  assert.equal(pageOffset(["20", "40"], 500), 20);
  assert.equal(pageOffset(undefined, 500), 0);
  assert.equal(pageOffset("abc", 500), 0);
  assert.equal(pageOffset("-5", 500), 0);
  assert.equal(pageOffset("20.9", 500), 20);
});

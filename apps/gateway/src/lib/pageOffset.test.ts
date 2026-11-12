import assert from "node:assert/strict";
import { test } from "node:test";
import { boxCursor, pageOffset } from "./pageOffset.js";

test("pageOffset: as given up to max, null above, 0 for junk", () => {
  assert.equal(pageOffset("500", 500), 500);
  assert.equal(pageOffset("501", 500), null);
  assert.equal(pageOffset(["20", "40"], 500), 20);
  assert.equal(pageOffset(undefined, 500), 0);
  assert.equal(pageOffset("abc", 500), 0);
  assert.equal(pageOffset("-5", 500), 0);
  assert.equal(pageOffset("20.9", 500), 20);
});

test("boxCursor: nextCursor round trip, malformed → null, absent → undefined", () => {
  const id = "AB".repeat(32);
  assert.deepEqual(boxCursor(`1650000:${id}`), { height: 1650000, id: id.toLowerCase() });
  assert.equal(boxCursor(undefined), undefined);
  assert.equal(boxCursor(""), undefined);
  assert.equal(boxCursor("1650000"), null);
  assert.equal(boxCursor(`1.5:${id}`), null);
  assert.equal(boxCursor(`-1:${id}`), null);
  assert.equal(boxCursor(`1650000:${id.slice(2)}`), null);
});

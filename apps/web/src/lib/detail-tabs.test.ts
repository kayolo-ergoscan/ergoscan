import assert from "node:assert/strict";
import { test } from "node:test";
import { railScrollTarget, tabJumpDelta, tabRoom } from "./detail-tabs";

test("tab switch: the page moves only once the strip is stuck", () => {
  // Strip still in its place below the pin: the new content start is in view.
  assert.equal(tabJumpDelta(420, 63.2), null);
  assert.equal(tabJumpDelta(63.2, 63.2), null);
  assert.equal(tabJumpDelta(62.9, 63.2), null);
  // Strip stuck, its place scrolled 1 400 px above: come back so the content starts under it.
  assert.equal(tabJumpDelta(-1336.8, 63.2), -1400);
  assert.equal(tabJumpDelta(40, 63.2), -23);
  assert.equal(tabJumpDelta(Number.NaN, 63.2), null);
});

test("rail: a visible tab leaves the rail alone", () => {
  assert.equal(railScrollTarget(16, 120, 0, 390, 16), null);
  assert.equal(railScrollTarget(260, 374, 0, 390, 16), null);
});

test("rail: a tab cut on the right comes to the left gutter, its snap point", () => {
  assert.equal(railScrollTarget(300, 440, 0, 390, 16), 284);
});

test("rail: a tab cut on the left scrolls back with the gutter before it", () => {
  assert.equal(railScrollTarget(16, 120, 80, 390, 16), 0);
  assert.equal(railScrollTarget(140, 260, 200, 390, 16), 124);
});

test("rail: a tab wider than the rail shows its start", () => {
  assert.equal(railScrollTarget(500, 1000, 0, 390, 16), 484);
});

test("rail: bad input does nothing", () => {
  assert.equal(railScrollTarget(0, 10, 0, 0, 16), null);
  assert.equal(railScrollTarget(Number.NaN, 10, 0, 390, 16), null);
});

test("room: the box stays tall enough for the strip to reach its pin", () => {
  // Strip 900 px into its box, pin 63.2, an 844 px screen: 900 - 63.2 + 844.
  assert.equal(tabRoom(1100, 63.2, 844, 200), 1681);
  // The same while the page is scrolled: only the distance between the two counts.
  assert.equal(tabRoom(-1300, 63.2, 844, -2200), 1681);
  assert.equal(tabRoom(100, 63.2, 0, 0), null);
  assert.equal(tabRoom(Number.NaN, 63.2, 844, 0), null);
});

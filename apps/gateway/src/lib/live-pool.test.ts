import assert from "node:assert/strict";
import { test } from "node:test";
import { RecentIds, VanishClock, freshIds } from "./live-pool.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

test("a missing id waits the grace before it is dropped", () => {
  const clock = new VanishClock(3000);
  assert.deepEqual(clock.settle([A, B], new Set([A]), 0), []);
  assert.equal(clock.size, 1);
  assert.equal(clock.due(2999), false);
  assert.deepEqual(clock.settle([A, B], new Set([A]), 2999), []);
  assert.equal(clock.due(3000), true);
  assert.deepEqual(clock.settle([A, B], new Set([A]), 3000), [B]);
  assert.equal(clock.size, 0);
});

test("an id that comes back stops its clock", () => {
  const clock = new VanishClock(3000);
  clock.settle([A], new Set(), 0);
  clock.settle([A], new Set([A]), 1000);
  assert.deepEqual(clock.settle([A], new Set(), 3500), []);
  assert.deepEqual(clock.settle([A], new Set(), 6500), [A]);
});

test("a sealed id is forgotten, and ids no longer shown drop out of the clock", () => {
  const clock = new VanishClock(3000);
  clock.settle([A, B], new Set(), 0);
  clock.forget([A]);
  assert.equal(clock.size, 1);
  clock.settle([], new Set(), 100);
  assert.equal(clock.size, 0);
});

test("waiting keeps an id inside its grace and releases it after", () => {
  const clock = new VanishClock(3000);
  assert.equal(clock.waiting(A, 0), true);
  assert.equal(clock.waiting(A, 2000), true);
  assert.equal(clock.waiting(A, 3000), false);
  assert.equal(clock.size, 0);
});

test("fresh ids skip shown and just-sealed ids and stop at the cap", () => {
  const shown = new Set([A]);
  const sealed = new RecentIds(60_000);
  sealed.add([B], 0);
  assert.deepEqual(freshIds([A, B, C, "short"], shown, sealed, 10), [C]);
  assert.deepEqual(freshIds([C, C], new Set(), new Set(), 1), [C]);
});

test("recent ids expire", () => {
  const r = new RecentIds(1000);
  r.add([A], 0);
  assert.equal(r.has(A), true);
  r.prune(1001);
  assert.equal(r.has(A), false);
});

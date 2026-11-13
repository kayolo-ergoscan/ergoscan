import assert from "node:assert/strict";
import { test } from "node:test";
import { cartX, coinSpots, idleSpots, minerSpots, sceneCarts, sceneLayout, stackLabels } from "./lithos-home-scene";

test("layout: track to the right of the quarry, three stretches in order, two equal phases", () => {
  for (const [w, h] of [
    [490, 243],
    [326, 210],
  ] as const) {
    const L = sceneLayout(w, h);
    assert.ok(L.collect.a > L.quarry);
    assert.ok(L.collect.b === L.check.a && L.check.b === L.payout.a);
    assert.ok(Math.abs(L.collect.b - L.collect.a - (L.check.b - L.check.a)) < 1e-9);
    assert.ok(L.payout.b <= w);
    assert.ok(L.cliffTop > 0);
    assert.equal(L.small, w < 420);
  }
});

test("carts: progress from the live tip, a finished phase waits at its end", () => {
  const carts = sceneCarts(
    [{ h: 1_915_708, start: 1_915_708, miners: 8, bank: 5e9 }],
    [{ h: 1_915_303, start: 1_915_664, miners: 7, bank: 8e9 }],
    1_915_941
  );
  assert.equal(carts[0]!.kind, "collect");
  assert.equal(carts[0]!.left, 360 - 233);
  assert.equal(carts[1]!.left, 360 - 277);
  const L = sceneLayout(490, 243);
  const x0 = cartX(L, { ...carts[0]!, u: 0 });
  const x1 = cartX(L, { ...carts[0]!, u: 1 });
  assert.ok(x0 > L.collect.a && x1 < L.collect.b && x1 > x0);
  const late = sceneCarts([{ h: 1, start: 1, miners: 1, bank: 1 }], [], 10_000);
  assert.equal(late[0]!.u, 1);
  assert.equal(late[0]!.left, 0);
});

test("miners: steps first, then the rock top; idle ones on the rock", () => {
  const L = sceneLayout(490, 243);
  const m = minerSpots(L, 8);
  assert.equal(m.length, 8);
  assert.ok(m.every((p) => p.x > 0 && p.x < L.quarry));
  assert.ok(m.slice(0, 6).every((p) => !p.back));
  assert.equal(m[0]!.y, L.steps[2]!.top);
  const idle = idleSpots(L, 17);
  assert.equal(idle.length, 17);
  assert.ok(idle.every((p) => p.x >= 0 && p.x <= L.backEnd && p.y <= L.cliffTop));
});

test("labels move up just above the one they would overlap, no further", () => {
  const out = stackLabels([
    { x: 100, w: 80, y: 100, h: 12 },
    { x: 150, w: 60, y: 100, h: 12 },
    { x: 300, w: 60, y: 100, h: 12 },
    // Higher already, clear of the first box's band: stays put.
    { x: 110, w: 40, y: 70, h: 12 },
  ]);
  assert.deepEqual(
    out.map((o) => o.lift),
    [0, 0, 14, 0]
  );
  // A box sitting a little higher than its neighbour only moves the few pixels it needs.
  const near = stackLabels([
    { x: 100, w: 60, y: 100, h: 12 },
    { x: 140, w: 60, y: 95, h: 12 },
  ]);
  assert.equal(near[1]!.lift, 95 - 86);
});

test("coin heap: up to 21 in rows of 6…1", () => {
  assert.equal(coinSpots(57).length, 21);
  assert.equal(coinSpots(3).length, 3);
  assert.deepEqual(
    coinSpots(8).map((c) => c.row),
    [0, 0, 0, 0, 0, 0, 1, 1]
  );
  assert.equal(coinSpots(0).length, 0);
});

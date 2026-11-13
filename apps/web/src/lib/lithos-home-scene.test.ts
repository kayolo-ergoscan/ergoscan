import assert from "node:assert/strict";
import { test } from "node:test";
import { cartLanes, cartX, coinSpots, FLAG_GAP, idleSize, idleSpots, minerSpots, placeLabels, sceneCarts, sceneLayout, seamX, type Box } from "./lithos-home-scene";

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
    // The seam is above the rock, the plateau above the front block, the steps go down to the track.
    assert.ok(L.seam.y + L.seam.h < L.backTop && L.backTop < L.cliffTop);
    assert.ok(L.steps.every((st, k) => st.top > L.cliffTop && (k === 0 || st.top > L.steps[k - 1]!.top) && st.top < L.ground));
  }
  // Desktop carts are the hero; the phone keeps compact ones.
  assert.ok(sceneLayout(488, 250).cartHw > sceneLayout(324, 206).cartHw);
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
  // Eight miners of a round stand in front rows on both widths.
  for (const [w, h] of [
    [488, 250],
    [324, 206],
  ] as const) {
    const LL = sceneLayout(w, h);
    assert.equal(minerSpots(LL, 8).filter((p) => !p.back).length, 8);
  }
  const idle = idleSpots(L, 17);
  assert.equal(idle.length, 17);
  const s = idleSize(L);
  assert.ok(idle.every((p) => p.x >= 0 && p.x + s <= L.backEnd + L.iso && p.y <= L.backTop && p.y - s > L.seam.y + L.seam.h));
  // Never more than fit under the seam.
  assert.ok(idleSpots(L, 500).length < 500);
});

test("seam: a moment maps into the band, the window end at the right edge", () => {
  const L = sceneLayout(488, 250);
  assert.equal(seamX(L, 0, 100), 2);
  assert.equal(seamX(L, 100, 100), 488 - 4);
  assert.equal(seamX(L, 250, 100), 488 - 4);
  assert.ok(seamX(L, 50, 100) > 200 && seamX(L, 50, 100) < 290);
});

test("lanes: a shared stretch keeps the round furthest along in front, the newer ones behind", () => {
  // The state after a find: the new round at 0 %, the previous one about 78 % through collection.
  const tip = 1_915_990;
  const spots = sceneCarts(
    [
      { h: 1_915_987, start: 1_915_987, miners: 0, bank: 3e9 },
      { h: 1_915_708, start: 1_915_708, miners: 8, bank: 5.07e9 },
    ],
    [{ h: 1_915_303, start: 1_915_664, miners: 7, bank: 8e9 }],
    tip
  );
  const lanes = cartLanes(spots);
  assert.deepEqual(lanes.get(1_915_708), { lane: 0, shared: true, lead: true });
  assert.deepEqual(lanes.get(1_915_987), { lane: 1, shared: true, lead: false });
  assert.deepEqual(lanes.get(1_915_303), { lane: 0, shared: false, lead: true });
  // Positions stay the real progress: the lead is to the right of the new round.
  const L = sceneLayout(488, 242);
  assert.ok(cartX(L, spots[1]!) > cartX(L, spots[0]!));
  assert.ok(L.lane > 0 && sceneLayout(324, 214).lane > 0);
  // Four rounds in one stretch: never more than three tracks.
  const four = cartLanes(sceneCarts([1, 2, 3, 4].map((k) => ({ h: 100 * k, start: 100 * k, miners: 1, bank: 1 })), [], 500));
  assert.deepEqual(
    [100, 200, 300, 400].map((h) => four.get(h)!.lane),
    [0, 1, 2, 2]
  );
});

test("labels: none overlaps another, a pole or a cart; flags stair up leftwards", () => {
  const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.top < b.bottom && b.top < a.bottom;
  // Two carts sharing a stretch, their flags, a centred label to the right, a cart behind as an obstacle.
  const cartBehind: Box = { l: 180, r: 238, top: 157, bottom: 186 };
  const out = placeLabels(
    [
      { id: "new", x: 209, w: 70, h: 14, bottom: 146, pole: 161 },
      { id: "lead", x: 254, w: 105, h: 28, bottom: 162, pole: 177 },
      { id: "check", x: 420, w: 70, h: 14, bottom: 162 },
    ],
    168,
    486,
    [cartBehind]
  );
  const by = Object.fromEntries(out.map((o) => [o.id, o]));
  // Placed right to left; the one furthest right stays where it wanted to be.
  assert.deepEqual(
    out.map((o) => o.id),
    ["check", "lead", "new"]
  );
  assert.equal(by.check!.lift, 0);
  assert.equal(by.lead!.lift, 0);
  assert.equal(by.lead!.side, 1);
  assert.equal(by.lead!.r, 254 + FLAG_GAP + 105);
  // The newer flag goes above the lead's text, its pole left of that text.
  assert.ok(by.new!.bottom <= by.lead!.top - 2);
  assert.ok(209 < by.lead!.l + 1 && 209 < 254);
  for (let i = 0; i < out.length; i++) {
    assert.ok(!overlaps(out[i]!, cartBehind), `${out[i]!.id} vs the cart behind`);
    for (let j = i + 1; j < out.length; j++) assert.ok(!overlaps(out[i]!, out[j]!), `${out[i]!.id} vs ${out[j]!.id}`);
  }
  // A flag that would run past the edge flies left of its pole; a centred text stays inside.
  const edge = placeLabels([{ x: 470, w: 60, h: 14, bottom: 100, pole: 120 }], 0, 486);
  assert.equal(edge[0]!.side, -1);
  assert.ok(edge[0]!.r <= 471 && edge[0]!.l >= 470 - FLAG_GAP - 60);
  const clamp = placeLabels([{ x: 480, w: 60, h: 14, bottom: 100 }], 0, 486);
  assert.equal(clamp[0]!.r, 486);
  // A box sitting a little higher than its neighbour only moves the few pixels it needs.
  const near = placeLabels(
    [
      { x: 140, w: 60, h: 12, bottom: 95 },
      { x: 100, w: 60, h: 12, bottom: 100 },
    ],
    0,
    486
  );
  assert.equal(near[1]!.lift, 100 - 81);
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

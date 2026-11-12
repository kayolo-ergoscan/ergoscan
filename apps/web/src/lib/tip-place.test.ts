import assert from "node:assert/strict";
import { test } from "node:test";
import { placeTip, pointRect, TIP_EDGE, TIP_GAP } from "./tip-place";

const VW = 1771;
const VH = 891;

test("a tip sits centred above its anchor when there is room", () => {
  const a = { left: 500, top: 400, width: 100, height: 40 };
  const s = placeTip(a, 200, 60, "top", VW, VH);
  assert.equal(s.side, "top");
  assert.equal(s.x, 450);
  assert.equal(s.y, 400 - TIP_GAP - 60);
});

test("no room above: it flips below, never over the anchor", () => {
  const a = { left: 500, top: 20, width: 100, height: 40 };
  const s = placeTip(a, 200, 60, "top", VW, VH);
  assert.equal(s.side, "bottom");
  assert.equal(s.y, 20 + 40 + TIP_GAP);
});

test("at the right edge it shifts left and stays inside the viewport", () => {
  const a = { left: VW - 30, top: 400, width: 20, height: 20 };
  const s = placeTip(a, 240, 60, "top", VW, VH);
  assert.equal(s.x, VW - 240 - TIP_EDGE);
});

test("at the left edge of a phone it shifts right", () => {
  const s = placeTip(pointRect(4, 300), 280, 80, "top", 390, 844);
  assert.equal(s.x, TIP_EDGE);
});

test("a side tip flips to the other side, then to the other axis", () => {
  const nav = { left: 8, top: 300, width: 56, height: 40 };
  assert.equal(placeTip(nav, 120, 28, "right", VW, VH).side, "right");
  const edge = { left: VW - 60, top: 300, width: 56, height: 40 };
  assert.equal(placeTip(edge, 120, 28, "right", VW, VH).side, "left");
  const tight = { left: 100, top: 300, width: 190, height: 40 };
  assert.equal(placeTip(tight, 120, 28, "right", 390, 844).side, "top");
});

test("a tip taller than either side goes where there is most room, clamped", () => {
  const a = { left: 100, top: 200, width: 40, height: 40 };
  const s = placeTip(a, 300, 500, "top", 390, 600);
  assert.ok(s.y >= TIP_EDGE);
  assert.ok(s.y + 500 <= 600 - TIP_EDGE || s.y === TIP_EDGE);
});

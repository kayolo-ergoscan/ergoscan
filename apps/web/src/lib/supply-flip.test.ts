import assert from "node:assert/strict";
import { test } from "node:test";
import { isSupplyDigit, supplyGlyphs, zipSupplyGlyphs } from "./supply-flip";

function vis(s: string): string {
  return s.replace(/\u00a0/g, " ");
}

test("supplyGlyphs groups whole ERG by the UI language", () => {
  assert.equal(supplyGlyphs(83_430_000, "en").join(""), "83,430,000");
  assert.equal(supplyGlyphs(83_430_000).join(""), "83,430,000");
  assert.equal(vis(supplyGlyphs(83_430_000, "ru").join("")), "83 430 000");
  assert.equal(vis(supplyGlyphs(97_739_924, "ru").join("")), "97 739 924");
  assert.equal(supplyGlyphs(0).join(""), "0");
});

test("zipSupplyGlyphs pads the shorter value on the left", () => {
  const en = zipSupplyGlyphs(83_430_000, 97_739_924, "en");
  assert.equal(en.map((g) => g.idle).join(""), "83,430,000");
  assert.equal(en[2]?.hover, ",");
  const z = zipSupplyGlyphs(999, 97_739_924, "ru");
  assert.equal(z.length, "97 739 924".length);
  assert.equal(vis(z.map((g) => g.hover).join("")), "97 739 924");
  assert.ok(z[0]?.idle === "\u00a0");
  assert.equal(z.at(-1)?.idle, "9");
  assert.equal(z.at(-1)?.hover, "4");
});

test("isSupplyDigit only matches 0-9", () => {
  assert.equal(isSupplyDigit("8"), true);
  assert.equal(isSupplyDigit("\u00a0"), false);
});

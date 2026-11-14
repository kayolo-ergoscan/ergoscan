import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INK_BG,
  INK_BOOT,
  INK_MODULE,
  colorSchemeFor,
  isLightInk,
  parseSkinInk,
} from "./skin-ink";

test("OLED is the default ink; only day/dim/oled parse", () => {
  assert.equal(parseSkinInk("oled"), "oled");
  assert.equal(parseSkinInk("day"), "day");
  assert.equal(parseSkinInk("dim"), "dim");
  assert.equal(parseSkinInk(null), "oled");
  assert.equal(parseSkinInk(undefined), "oled");
  assert.equal(parseSkinInk("light"), "oled");
  assert.equal(parseSkinInk("dark"), "oled");
});

test("day is the only light color-scheme", () => {
  assert.equal(colorSchemeFor("day"), "light");
  assert.equal(colorSchemeFor("dim"), "dark");
  assert.equal(colorSchemeFor("oled"), "dark");
});

test("three inks stay in the OLED hue family, not skill gold/navy", () => {
  assert.equal(INK_BG.oled, "#1c1b22");
  assert.equal(INK_MODULE.oled, "#26252d");
  assert.equal(INK_BG.dim, "#2e2d35");
  assert.equal(INK_MODULE.dim, "#35343d");
  assert.equal(INK_BG.day, "#eceaf0");
  assert.equal(INK_MODULE.day, "#ffffff");
  assert.notEqual(INK_BG.day, "#ffffff");
  assert.notEqual(INK_BG.oled, "#000000");
});

test("boot script lists every canvas hex", () => {
  assert.match(INK_BOOT, /data-ink/);
  assert.match(INK_BOOT, /#1c1b22/);
  assert.match(INK_BOOT, /#2e2d35/);
  assert.match(INK_BOOT, /#eceaf0/);
});

test("light inks are preview-only: a normal build parses them as OLED", () => {
  assert.equal(parseSkinInk("light-a"), "oled");
  assert.equal(parseSkinInk("light-c"), "oled");
  assert.equal(isLightInk("day"), true);
  assert.equal(isLightInk("light-b"), true);
  assert.equal(isLightInk("oled"), false);
  assert.equal(colorSchemeFor("dim"), "dark");
});

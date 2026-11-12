import assert from "node:assert/strict";
import { test } from "node:test";
import { slidePassFrom, TOKEN_PASS_WINDOW } from "./tokenPassWindow.js";

test("token pass window slides up to tip − window and never back", () => {
  assert.equal(slidePassFrom(1874596, 1915166), 1915166 - TOKEN_PASS_WINDOW);
  assert.equal(slidePassFrom(1915000, 1915166), 1915000);
  assert.equal(slidePassFrom(0, 500), 0);
  assert.equal(slidePassFrom(Number.NaN, 1915166), 1915166 - TOKEN_PASS_WINDOW);
});

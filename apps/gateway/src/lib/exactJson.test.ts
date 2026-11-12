import assert from "node:assert/strict";
import { test } from "node:test";
import { exactInt, exactJsonText } from "./exactJson.js";

test("exactInt prints big integers digit for digit, small ones as plain numbers", () => {
  const text = exactJsonText({
    lp: exactInt("9223372036854774807", null),
    max: exactInt("9223372036854775807", null),
    small: exactInt("1000", null),
    none: exactInt(null, null),
    bad: exactInt("1e5", 0),
    label: "9223372036854774807",
  });
  assert.equal(
    text,
    '{"lp":9223372036854774807,"max":9223372036854775807,"small":1000,"none":null,"bad":0,"label":"9223372036854774807"}'
  );
});

test("exactJsonText leaves ordinary JSON alone", () => {
  assert.equal(exactJsonText({ a: [1, "x\u0001y"], b: null }), '{"a":[1,"x\\u0001y"],"b":null}');
  assert.equal(exactJsonText(undefined), "null");
});

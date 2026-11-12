import assert from "node:assert/strict";
import { test } from "node:test";
import { isDbOutage } from "./indexDb.js";

test("isDbOutage: connection trouble trips the circuit, a slow query does not", () => {
  assert.equal(isDbOutage({ code: "ECONNREFUSED" }), true);
  assert.equal(isDbOutage({ code: "57P01", message: "terminating connection due to administrator command" }), true);
  assert.equal(isDbOutage({ code: "53300", message: "too many connections" }), true);
  assert.equal(isDbOutage({ code: "08006" }), true);
  assert.equal(isDbOutage(new Error("timeout exceeded when trying to connect")), true);
  assert.equal(isDbOutage(new Error("Connection terminated unexpectedly")), true);

  assert.equal(isDbOutage({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(isDbOutage({ code: "42P01", message: "relation does not exist" }), false);
  assert.equal(isDbOutage({ code: "22P02" }), false);
  assert.equal(isDbOutage(null), false);
});

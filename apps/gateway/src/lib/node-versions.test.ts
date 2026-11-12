import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeNodeVersions } from "./node-versions.js";

test("versions newest first, modes split full / pruned / digest", () => {
  const got = summarizeNodeVersions(
    [
      { version: "6.0.2", mode: { state: "utxo", fullBlocksSuffix: -1 } },
      { version: "6.0.8", mode: { state: "utxo", fullBlocksSuffix: -1 } },
      { version: "5.0.21", mode: { state: "digest", fullBlocksSuffix: 1440 } },
      { version: "6.0.8", mode: { state: "utxo", fullBlocksSuffix: 2880 } },
      { version: "6.0.10", mode: { state: "utxo", fullBlocksSuffix: -1 } },
      { version: "N/A" },
    ],
    1
  );
  assert.equal(got.total, 6);
  assert.deepEqual(got.versions, [
    { version: "6.0.10", n: 1 },
    { version: "6.0.8", n: 2 },
    { version: "6.0.2", n: 1 },
    { version: "5.0.21", n: 1 },
  ]);
  assert.deepEqual(got.modes, [
    { mode: "full", n: 3 },
    { mode: "pruned", n: 1 },
    { mode: "digest", n: 1 },
  ]);
});

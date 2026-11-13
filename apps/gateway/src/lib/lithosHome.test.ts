import assert from "node:assert/strict";
import { test } from "node:test";
import { lithosHomeCache } from "./lithosHome.js";

const stats = {
  v: 1,
  tip: { height: 100, ts: 1_000 },
  hash: null,
  rounds: { holding: [], evaluation: [], payoutN: 0, payoutNano: 0 },
};

test("home cut: one read per TTL, errors keep the last value, a missing row is null", async () => {
  let clock = 0;
  let reads = 0;
  let mode: "ok" | "fail" | "none" = "ok";
  const cache = lithosHomeCache(async () => {
    reads++;
    if (mode === "fail") throw new Error("db");
    if (mode === "none") return null;
    return { stats, finds: [[90, 900]] };
  }, () => clock);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(reads, 1);
  assert.equal(a?.tip.height, 100);
  assert.equal(b, a);
  clock += 5_000;
  await cache.get();
  assert.equal(reads, 1);
  clock += 20_000;
  mode = "fail";
  assert.equal((await cache.get())?.last?.h, 90);
  assert.equal(reads, 2);
  mode = "none";
  assert.equal(await cache.get(), null);
});

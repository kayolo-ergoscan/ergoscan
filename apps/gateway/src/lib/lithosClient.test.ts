import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LITHOS_CLIENT_KEEP_MS,
  LITHOS_CLIENT_RETRY_MS,
  LITHOS_CLIENT_TTL_MS,
  lithosClientCache,
  parseLithosRelease,
} from "./lithosClient.js";

const BODY = {
  tag_name: "v1.0.8",
  name: "Lithos Mainnet 1.0.8",
  published_at: "2026-11-11T04:31:48Z",
  html_url: "https://github.com/Lithos-Protocol/Lithos-Client/releases/tag/v1.0.8",
  draft: false,
  prerelease: false,
};

test("release body → version, date, page", () => {
  assert.deepEqual(parseLithosRelease(BODY), {
    version: "1.0.8",
    publishedAt: "2026-11-11T04:31:48.000Z",
    url: "https://github.com/Lithos-Protocol/Lithos-Client/releases/tag/v1.0.8",
  });
  assert.equal(parseLithosRelease({ ...BODY, prerelease: true }), null);
  assert.equal(parseLithosRelease({ ...BODY, tag_name: "nightly" }), null);
  assert.equal(parseLithosRelease({ ...BODY, html_url: "https://evil.example/x" }), null);
  assert.equal(parseLithosRelease({ ...BODY, published_at: "soon" })?.publishedAt, null);
  assert.equal(parseLithosRelease(null), null);
});

test("cache: never waits, refreshes when due, hides an old answer", async () => {
  let t = 1_000_000;
  let calls = 0;
  let fail = false;
  const cache = lithosClientCache(async () => {
    calls += 1;
    if (fail) throw new Error("down");
    return BODY;
  }, () => t);

  assert.equal(cache.get(), null, "first call does not wait");
  await cache.settle();
  assert.equal(calls, 1);
  assert.equal(cache.get()?.version, "1.0.8");
  t += LITHOS_CLIENT_TTL_MS - 1;
  cache.get();
  assert.equal(calls, 1, "fresh: no refetch");

  fail = true;
  t += 2;
  assert.equal(cache.get()?.version, "1.0.8", "stale answer kept while refreshing");
  await cache.settle();
  assert.equal(calls, 2);
  t += LITHOS_CLIENT_RETRY_MS - 1;
  cache.get();
  assert.equal(calls, 2, "no retry before 30 min");
  t += 1;
  cache.get();
  await cache.settle();
  assert.equal(calls, 3);

  t += LITHOS_CLIENT_KEEP_MS;
  assert.equal(cache.get(), null, "a day without a good answer hides it");
});

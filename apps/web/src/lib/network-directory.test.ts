import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NETWORK_DIRECTORY,
  NETWORK_KINDS,
  hrefHost,
  hrefPath,
} from "./network-directory.js";

test("directory lists explorers, APIs, and GraphQL without duplicate hrefs", () => {
  assert.equal(NETWORK_DIRECTORY.explorers.length, 5);
  assert.equal(NETWORK_DIRECTORY.apis.length, 3);
  assert.equal(NETWORK_DIRECTORY.graphql.length, 3);
  const hrefs = NETWORK_KINDS.flatMap((k) => NETWORK_DIRECTORY[k].map((row) => row.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const href of hrefs) {
    assert.match(href, /^https:\/\//);
  }
});

test("hrefHost and hrefPath strip the scheme", () => {
  assert.equal(hrefHost("https://api.ergoplatform.com/api/v1/docs/"), "api.ergoplatform.com");
  assert.equal(hrefPath("https://api.ergoplatform.com/api/v1/docs/"), "/api/v1/docs");
  assert.equal(hrefPath("https://explorer.ergoplatform.com/"), "");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isApiRoute, parseApiUse } from "./api-use";

test("API use keeps counts and drops anything that is not a path total", () => {
  const use = parseApiUse(
    {
      generatedAt: "2026-10-07T19:00:00.000Z",
      apiHost: {
        host: "api.ergoscan.me",
        windows: {
          "1h": {
            requests: 12,
            clients: 3,
            graphql: 9,
            rest: 2,
            errors: 1,
            limited: 0,
            paths: [{ path: "/api/graphql", hits: 9 }, { path: "", hits: 4 }],
          },
          "24h": { requests: 40, clients: 8, graphql: 30, rest: 7 },
        },
      },
    },
    { ok: true, height: 1889616 }
  );
  assert.equal(use.ok, true);
  assert.equal(use.height, 1889616);
  assert.equal(use.hour?.requests, 12);
  assert.equal(use.hour?.clients, 3);
  assert.deepEqual(use.hour?.paths, [{ path: "/api/graphql", hits: 9 }]);
  assert.equal(use.day?.requests, 40);
  assert.equal(use.day?.graphql, 30);
});

test("a missing snapshot is an empty API card, not a crash", () => {
  const use = parseApiUse(null, null);
  assert.equal(use.ok, false);
  assert.equal(use.height, null);
  assert.equal(use.hour, null);
  assert.equal(use.day, null);
});

test("probe paths from scanners are not listed as API paths", () => {
  assert.equal(isApiRoute("/api/v1/info"), true);
  assert.equal(isApiRoute("/v1/network/*"), true);
  assert.equal(isApiRoute("/v1"), true);
  assert.equal(isApiRoute("/api/graphql"), true);
  assert.equal(isApiRoute("/api/v3/.env"), false);
  assert.equal(isApiRoute("/api-keys.txt"), false);
  assert.equal(isApiRoute("/v1/.git/config"), false);
  assert.equal(isApiRoute("/v10/x"), false);
  const use = parseApiUse(
    {
      apiHost: {
        windows: {
          "1h": {
            paths: [
              { path: "/api/v3/.env", hits: 50 },
              { path: "/api-keys.txt", hits: 40 },
              { path: "/api/v1/info", hits: 7 },
            ],
          },
        },
      },
    },
    null
  );
  assert.deepEqual(use.hour?.paths, [{ path: "/api/v1/info", hits: 7 }]);
});

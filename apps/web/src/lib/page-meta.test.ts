import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIST_PAGES,
  ROBOTS_DISALLOW,
  SITEMAP_STATIC,
  absUrl,
  addressPageMeta,
  badAddressMeta,
  missMeta,
  pageMeta,
  tokenPageMeta,
  txPageMeta,
} from "./page-meta";
import { SITE_URL } from "./site-meta";

test("absUrl joins the public host", () => {
  assert.equal(absUrl("/"), SITE_URL);
  assert.equal(absUrl("/tx/abc"), `${SITE_URL}/tx/abc`);
});

test("pageMeta sets canonical + index by default", () => {
  const m = pageMeta({
    title: "Blocks",
    description: "Latest blocks.",
    path: "/blocks",
  });
  assert.equal(m.alternates?.canonical, `${SITE_URL}/blocks`);
  assert.deepEqual(m.robots, { index: true, follow: true });
});

test("an address with a bad checksum is noindex", () => {
  const m = badAddressMeta("9efFUTmfpea6whc8iL8FNJN295Ddc2HDVeQpQjygqsbQS578Bya");
  assert.deepEqual(m.robots, { index: false, follow: false });
  assert.match(String(m.title), /invalid address/i);
});

test("missMeta is noindex", () => {
  const m = missMeta("Transaction", "aa".repeat(32), "/tx/" + "aa".repeat(32));
  assert.deepEqual(m.robots, { index: false, follow: false });
  assert.match(String(m.title), /not found/i);
});

test("tx meta uses short id when the row exists", () => {
  const id = "ab".repeat(32);
  const m = txPageMeta(id, {
    id,
    confirmed: true,
    inclusionHeight: 100,
    numConfirmations: 3,
    size: 200,
    fee: 1000000,
    category: "transfer",
    inputs: [],
    outputs: [],
    valueNano: "1000000000",
    inputCount: 1,
    outputCount: 2,
  });
  assert.match(String(m.title), /Tx /);
  assert.match(String(m.description), /height 100/);
  assert.deepEqual(m.robots, { index: true, follow: true });
});

test("address meta prefers the address book name", () => {
  const addr = "9iKFBBrryPhBYVGDKHuZQW7SuLfuTdUJtTPzecbQ5pQQzD4VykC";
  const m = addressPageMeta(addr, {
    address: addr,
    balance: { confirmedNanoErg: "0", unconfirmedNanoErg: "0", tokens: [] },
    unspentBoxes: [],
    recentTxs: [],
    tokenCount: 0,
  });
  assert.equal(m.alternates?.canonical, `${SITE_URL}/address/${addr}`);
});

test("address meta takes the gateway's contract name when the book has none", () => {
  const addr = `Gqst${"x".repeat(120)}`;
  const m = addressPageMeta(addr, {
    address: addr,
    name: {
      name: "Some position",
      kind: "contract",
      project: { id: "ergodex", name: "ErgoDex", category: "other" },
      by: "ergoscan",
      via: "template",
      current: true,
      until: null,
      file: "",
      fileUrl: "",
      source: "contracts",
    },
    balance: { confirmedNanoErg: "0", unconfirmedNanoErg: "0", tokens: [] },
    unspentBoxes: [],
    recentTxs: [],
    tokenCount: 0,
  });
  assert.equal(String(m.title).startsWith("Some position"), true);
  assert.match(String(m.description), /^Ergo contract address .*\(Some position\)\./);
});

test("token miss is noindex", () => {
  const m = tokenPageMeta("ff".repeat(32), null);
  assert.deepEqual(m.robots, { index: false, follow: false });
});

test("sitemap static paths are indexable list pages plus home", () => {
  assert.ok(SITEMAP_STATIC.includes("/"));
  assert.equal(SITEMAP_STATIC.includes("/docs"), false);
  assert.equal(SITEMAP_STATIC.includes("/search"), false);
  assert.equal(SITEMAP_STATIC.includes("/address/x"), false);
  for (const path of SITEMAP_STATIC) {
    if (path === "/") continue;
    assert.ok(LIST_PAGES[path], path);
    assert.notEqual(LIST_PAGES[path].index, false, path);
  }
});

test("robots keep API, ops, and search off the index", () => {
  for (const p of ["/api/", "/v1/", "/_ops", "/search"]) {
    assert.ok(ROBOTS_DISALLOW.includes(p as (typeof ROBOTS_DISALLOW)[number]), p);
  }
  assert.equal(
    ROBOTS_DISALLOW.includes("/address/" as (typeof ROBOTS_DISALLOW)[number]),
    false
  );
});

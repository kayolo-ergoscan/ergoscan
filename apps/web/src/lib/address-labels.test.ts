import assert from "node:assert/strict";
import { test } from "node:test";
import { roleByTemplate } from "@ergoscan/shared";
import { listBookEntries } from "./address-book";
import { contractName, describeParty } from "./address-labels";

// Labels are read from the contract registry, never copied into a test.
const V3_TPL = "64607fe0fe3c0e5fd7c41ca1f1d65e48270da2f98e9a17049bfb2172356b5b5f";
const LIMIT_V3_TPL = "cb3087cb229ef0ff020553ecf398908cff6de06cb21888a7cfc4565060ff4acd";
const CP_T2T_TPL = "d685202ad30554f9a0b0b32b0b3cab866f8786a14f87b91b1fbfbab422674d0c";
const GRID_N2T_TPL = "a68900b67ff5d74f74e7907aca83680adfc8ba01c1925430339d9e4c3f5dd0a3";
const GUESS_TPL = "db697243c2c862454a4be4c7cebf5cdb75a9d360e9297cb1543acfb0a32c5bd0";
/** Any P2S the book does not name (the shape is all describeParty reads). */
const BARE_P2S = `Gqst${"x".repeat(120)}`;
const WALLET = "9h8yx5e4s22UaVyuY4r77vkbav4ieZ9BCjo2BTdKAWKvaQmMKsi";

test("an order or a position the book does not name gets the registry's contract name", () => {
  for (const hash of [V3_TPL, LIMIT_V3_TPL, CP_T2T_TPL, GRID_N2T_TPL]) {
    const d = describeParty(BARE_P2S, false, { templateHash: hash });
    assert.equal(d.kind, "contract");
    assert.equal(d.known, roleByTemplate(hash)!.label);
    assert.equal(d.book, null);
  }
  assert.equal(describeParty(BARE_P2S).known, null);
  assert.equal(describeParty(BARE_P2S, false, { templateHash: "00".repeat(32) }).known, null);
});

test("a name the gateway looked up is used as is; a guess is not a name", () => {
  assert.equal(describeParty(BARE_P2S, false, { name: " Some order " }).known, "Some order");
  assert.equal(roleByTemplate(GUESS_TPL)?.src, "guess");
  assert.equal(contractName({ templateHash: GUESS_TPL }), null);
  assert.equal(contractName(null), null);
});

test("the book wins, and a wallet is never named by a template", () => {
  const bank = listBookEntries({ q: "SigmaUSD Bank" })[0]!;
  const d = describeParty(bank.address, false, { templateHash: V3_TPL });
  assert.equal(d.known, bank.name);
  assert.ok(d.book);
  const w = describeParty(WALLET, false, { templateHash: V3_TPL, name: "x" });
  assert.equal(w.kind, "wallet");
  assert.equal(w.known, null);
});

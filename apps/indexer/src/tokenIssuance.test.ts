import assert from "node:assert/strict";
import { test } from "node:test";
import { SIGUSD_TOKEN_ID } from "@ergoscan/shared";
import {
  issuancePatch,
  pickTokenDecimals,
  tokenRowFromOutputAsset,
} from "./tokenIssuance.js";

const MINT = "aa".repeat(32);
const OTHER = "bb".repeat(32);

test("tokenRowFromOutputAsset: transfer does not set emission", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: MINT,
    boxId: OTHER,
    height: 100,
    amount: "213",
    registers: { R6: "0e0132" },
  });
  assert.equal(row.emission, null);
  assert.equal(row.decimals, null);
  assert.equal(row.nftBoxId, null);
});

test("tokenRowFromOutputAsset: mint tx spends issuer, amount+R6 on output", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: MINT,
    boxId: OTHER,
    height: 9,
    amount: "10000000000001",
    registers: { R6: "0e0132" },
    issuance: true,
  });
  assert.equal(row.emission, "10000000000001");
  assert.equal(row.decimals, 2);
  assert.equal(row.nftBoxId, OTHER);
});

test("tokenRowFromOutputAsset: issuer box id alone is not a mint", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: MINT,
    boxId: MINT,
    height: 8,
    amount: "213",
    registers: { R6: "0e0132" },
  });
  assert.equal(row.emission, null);
  assert.equal(row.decimals, null);
});

test("tokenRowFromOutputAsset: amount=1 transfer still records nft box", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: MINT,
    boxId: OTHER,
    height: 11,
    amount: "1",
  });
  assert.equal(row.emission, null);
  assert.equal(row.nftBoxId, OTHER);
});

test("pickTokenDecimals: known id beats leftover R6", () => {
  assert.equal(pickTokenDecimals(SIGUSD_TOKEN_ID, { R6: "0e0130" }), 2);
  assert.equal(pickTokenDecimals(MINT, { R6: "0e0138" }), 8);
  assert.equal(pickTokenDecimals(MINT), null);
});

test("issuancePatch: known overwrites, R6 does not force", () => {
  const known = issuancePatch(SIGUSD_TOKEN_ID, { R6: "0e0130" }, "999");
  assert.equal(known.decimals, 2);
  assert.equal(known.forceDecimals, true);
  assert.equal(known.emission, "999");

  const r6only = issuancePatch(MINT, { R6: "0e0138" }, "0");
  assert.equal(r6only.decimals, 8);
  assert.equal(r6only.forceDecimals, false);
  assert.equal(r6only.emission, null);
});

test("tokenRowFromOutputAsset: known decimals on a transfer, still no emission", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: SIGUSD_TOKEN_ID,
    boxId: OTHER,
    height: 50,
    amount: "213",
  });
  assert.equal(row.emission, null);
  assert.equal(row.decimals, 2);
});

test("tokenRowFromOutputAsset: mint output without R6 → 0 decimals (EIP-4, as the node)", () => {
  const row = tokenRowFromOutputAsset({
    tokenId: MINT,
    boxId: OTHER,
    height: 9,
    amount: "9223372036854774807",
    registers: { R4: "0e114552475f456c656d656e743131355f4c50" },
    issuance: true,
  });
  assert.equal(row.emission, "9223372036854774807");
  assert.equal(row.decimals, 0);
});

test("issuancePatch: mint found without R6 → 0; mint not found → unknown", () => {
  const noR6 = issuancePatch(MINT, { R4: "0e0141" }, "9223372036854774807");
  assert.equal(noR6.decimals, 0);
  assert.equal(noR6.emission, "9223372036854774807");
  assert.equal(noR6.forceDecimals, false);

  const unknown = issuancePatch(MINT, null, null);
  assert.equal(unknown.decimals, null);
  assert.equal(unknown.emission, null);
});

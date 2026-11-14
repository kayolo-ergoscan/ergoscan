import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_TOKEN_LOGOS,
  SIGRSV_ID,
  resolveTokenMeta,
  tokenDecimals,
  tokenLogoSrc,
  tokenAtRisk,
  tokenTickerInk,
} from "./token-meta";
import { INK } from "./palette";
import { INK_TEXT } from "@/lib/palette";

const USE = "a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669";
const SIGUSD = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";
const RSADA = "e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297";

test("known logos are same-origin png, not jsDelivr", () => {
  const src = tokenLogoSrc(SIGUSD);
  assert.equal(src, `/token-logos/${SIGUSD}.png`);
  assert.doesNotMatch(src ?? "", /jsdelivr|github/);
  assert.equal(tokenLogoSrc("0".repeat(64)), "/token-logos/erg.png");
});

test("unknown token has no remote logo url", () => {
  assert.equal(tokenLogoSrc("f".repeat(64)), null);
});

test("USE is the Dexy stable and ships a local mark", () => {
  assert.equal(tokenDecimals(USE), 3);
  assert.equal(LOCAL_TOKEN_LOGOS.has(USE), true);
  assert.equal(tokenLogoSrc(USE), `/token-logos/${USE}.png`);
  const meta = resolveTokenMeta(USE, "SEED");
  assert.equal(meta.symbol, "USE");
  assert.equal(meta.logoUrl, `/token-logos/${USE}.png`);
});

test("rsADA catalog decimals", () => {
  assert.equal(tokenDecimals(RSADA), 6);
  assert.equal(resolveTokenMeta(RSADA).symbol, "rsADA");
});

test("LIT ships a local Lithos mark", () => {
  const lit = "c1980d829988229516430a47a5eca376060b6ce859616db0936e78ab25cb6de7";
  assert.equal(resolveTokenMeta(lit).symbol, "LIT");
  assert.equal(tokenLogoSrc(lit), `/token-logos/${lit}.png`);
  assert.equal(LOCAL_TOKEN_LOGOS.has(lit), true);
});

test("known id wins over a leftover issuance ticker", () => {
  const rsb = "7a51950e5f548549ec1aa63ffdc38279505b11e7e803d01bcf8347e0123c88b0";
  assert.equal(resolveTokenMeta(rsb, "rsPALM").symbol, "rsBTC");
});

test("emoji issuance name stays on the tile instead of a short hash", () => {
  const id = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
  const meta = resolveTokenMeta(id, "🚬", "🚬");
  assert.equal(meta.symbol, "🚬");
  assert.equal(meta.name, "🚬");
  assert.doesNotMatch(meta.symbol, /ebb4/);
});

test("at-risk tokens are priced or protocol, not a bare NFT", () => {
  const nft = "01b3fd6b41c94eaee93f95c98f4c00bdfb4219d3e47670b0ce02fe38c5bdd6e2";
  assert.equal(tokenAtRisk(nft), false);
  assert.equal(tokenAtRisk(nft, null), false);
  assert.equal(tokenAtRisk(SIGUSD), true);
  assert.equal(tokenAtRisk(RSADA), true);
  assert.equal(tokenAtRisk("ab".repeat(32), 0.42), true);
  assert.equal(tokenAtRisk("ab".repeat(32), 0), false);
});

test("Flux and Faku keep their names instead of a short hash", () => {
  const flux = "e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807";
  const faku = "f0cac602d618081f46db086726d3c4da53006b646b50e382989054dcf3c93bd8";
  assert.equal(resolveTokenMeta(flux, null, "Flux").symbol, "Flux");
  assert.equal(resolveTokenMeta(flux).name, "Flux");
  assert.equal(tokenDecimals(flux), 8);
  assert.equal(resolveTokenMeta(faku, null, "Faku").symbol, "Faku");
  assert.equal(resolveTokenMeta(faku).name, "Faku");
  assert.doesNotMatch(resolveTokenMeta(flux).symbol, /e8b2/);
  assert.doesNotMatch(resolveTokenMeta(faku).symbol, /f0ca/);
});

test("SigRSV uses the same ticker ink as every other token", () => {
  assert.equal(tokenTickerInk(SIGRSV_ID), INK_TEXT.coral);
  assert.equal(tokenTickerInk(SIGUSD), INK_TEXT.coral);
});

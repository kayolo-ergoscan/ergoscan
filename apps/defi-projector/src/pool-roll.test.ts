import assert from "node:assert/strict";
import { test } from "node:test";
import { n2nQuoteErg, n2tErgVolume, poolVolMaxErg, wholeTokenQty } from "./pool-roll.js";

const ERG = "0".repeat(64);

test("N2T volume follows the Spectrum tile cap", () => {
  assert.equal(n2tErgVolume("spectrum_cfmm", ERG, 12.5, 3, 3000), 12.5);
  assert.equal(n2tErgVolume("spectrum_cfmm", ERG, 3001, 3, 3000), 0);
  assert.equal(n2tErgVolume("spectrum_cfmm", ERG, 10, 0, 3000), 0);
  assert.equal(n2tErgVolume("spectrum_cfmm", null, 4, 1, 3000), 4);
});

test("N2N does not add an ERG volume", () => {
  assert.equal(n2tErgVolume("spectrum_n2n", "ab".repeat(32), 9, 9, 3000), null);
  assert.equal(n2tErgVolume("lithos_dex", ERG, 9, 1, 3000), null);
});

test("n2n whole qty undoes a raw write and keeps a scaled one", () => {
  assert.equal(wholeTokenQty(0.000100531, 9), 0.000100531);
  assert.equal(wholeTokenQty(4_509_062_468, 3), 4_509_062.468);
  assert.equal(wholeTokenQty(12, 0), 12);
});

test("n2n quote erg is the whole amount times the ERG-pool price", () => {
  assert.ok(Math.abs(n2nQuoteErg(0.000100531, 6160.141170385004) - 0.619) < 0.001);
  assert.equal(n2nQuoteErg(1, 0), 0);
  assert.equal(n2nQuoteErg(1, 1e12), 0);
});

test("volume cap defaults to the tape cap", () => {
  assert.equal(poolVolMaxErg(undefined), 25000);
  assert.equal(poolVolMaxErg("2500"), 2500);
  assert.equal(poolVolMaxErg("nope"), 25000);
});

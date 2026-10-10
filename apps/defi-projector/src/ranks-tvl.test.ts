import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absorbPoolBox,
  classifyPoolTvlBox,
  keepWithdrawn,
  nextSnapTvl,
  poolNeedsNftTvl,
} from "./ranks-tvl.js";

test("keepWithdrawn rests a withdrawn pool, then walks it again; forceNft always walks", () => {
  const rest = 15 * 60_000;
  assert.equal(keepWithdrawn(undefined, 1_000_000, rest), false);
  assert.equal(keepWithdrawn(1_000_000, 1_000_000 + rest - 1, rest), true);
  assert.equal(keepWithdrawn(1_000_000, 1_000_000 + rest, rest), false);
  assert.equal(keepWithdrawn(1_000_000, 1_000_001, rest, true), false);
});

test("nextSnapTvl keeps the previous snap when the box is missing", () => {
  assert.equal(nextSnapTvl(0, false, 412), 412);
  assert.equal(nextSnapTvl(0, true, 412), 0);
  assert.equal(nextSnapTvl(88, true, 412), 88);
  assert.equal(nextSnapTvl(0, false, 0), 0);
});

test("poolNeedsNftTvl walks when the last fill box is missing, including a quiet pool", () => {
  assert.equal(
    poolNeedsNftTvl({ hadBox: true, hadLastSwap: true, prevTvl: 0, volumeErg: 0 }),
    false
  );
  assert.equal(
    poolNeedsNftTvl({ hadBox: false, hadLastSwap: true, prevTvl: 0, volumeErg: 0 }),
    true
  );
  assert.equal(
    poolNeedsNftTvl({ hadBox: false, hadLastSwap: false, prevTvl: 0, volumeErg: 0 }),
    true
  );
});

test("P2PK leftover pool NFT is a wallet, not AMM TVL", () => {
  assert.equal(
    classifyPoolTvlBox({
      address: "9etDbVVWiZqQyPdKy8zn1XnLK4xH3h7ojxj9joPXRA7PHxfSejf",
      ergo_tree: "0008cd0230ab",
      n_assets: 33,
    }),
    "wallet"
  );
  assert.equal(
    classifyPoolTvlBox({
      address: "5vSUZRZb".padEnd(80, "x"),
      ergo_tree: "1999030f04deadbeef",
      n_assets: 3,
    }),
    "amm"
  );
  const nft = "cd".repeat(32);
  const best = new Map();
  assert.equal(
    absorbPoolBox(
      best,
      {
        pool_id: nft,
        value_nano: "653729980290642",
        quote_raw: "1",
        base_raw: "0",
        address: "9etDbVVWiZqQyPdKy8zn1XnLK4xH3h7ojxj9joPXRA7PHxfSejf",
        ergo_tree: "0008cd0230ab",
        n_assets: 33,
      },
      false
    ),
    "wallet"
  );
  assert.equal(best.size, 0);
});

test("absorbPoolBox keeps the fattest N2T box and allows T2T rent-zero", () => {
  const nft = "ab".repeat(32);
  const best = new Map();
  absorbPoolBox(
    best,
    { pool_id: nft, value_nano: "100", quote_raw: "1", base_raw: "2" },
    false
  );
  absorbPoolBox(
    best,
    { pool_id: nft, value_nano: "40", quote_raw: "9", base_raw: "8" },
    false
  );
  assert.equal(best.get(nft)?.valueNano, "100");
  absorbPoolBox(
    best,
    { pool_id: nft, value_nano: "0", quote_raw: "1", base_raw: "2" },
    false
  );
  assert.equal(best.get(nft)?.valueNano, "100");
  const t2t = new Map();
  absorbPoolBox(
    t2t,
    { pool_id: nft, value_nano: "0", quote_raw: "11", base_raw: "22" },
    true
  );
  assert.equal(t2t.get(nft)?.quoteRaw, "11");
  assert.equal(t2t.get(nft)?.baseRaw, "22");
});

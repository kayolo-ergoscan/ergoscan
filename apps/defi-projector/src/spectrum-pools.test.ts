import assert from "node:assert/strict";
import { test } from "node:test";
import { pickCfmmPool, poolsFromBoxes, type SpectrumAsset } from "./spectrum-pools.js";

const NFT = "aa".repeat(32);
const QUOTE = "bb".repeat(32);
const LP = "cc".repeat(32);

function asset(
  tokenId: string,
  amount: bigint,
  name: string | null,
  emission: bigint | null
): SpectrumAsset {
  return { tokenId, amount, name, decimals: 0, emission };
}

test("CFMM pool is the emission-1 NFT, the large LP, and the quote", () => {
  const parts = pickCfmmPool([
    asset(NFT, 1n, null, 1n),
    asset(QUOTE, 119_736_181n, "FAKU", 10_000_000_000n),
    asset(LP, 9_223_372_018_346_669_354n, "Mew Fund ERG/FAKU LP", 9_223_372_036_854_774_807n),
  ]);
  assert.deepEqual(parts, { nft: NFT, quote: QUOTE, lp: LP });
});

test("a fat wallet box is not a CFMM pool", () => {
  const assets = [asset(NFT, 1n, "EGIO Stake Key", 1n), asset(QUOTE, 50n, "AHT", 100n)];
  for (let i = 0; i < 10; i += 1) {
    assets.push(asset((i + 1).toString(16).padStart(64, "0"), 1n, "vesting", 1n));
  }
  assert.equal(pickCfmmPool(assets), null);
});

test("poolsFromBoxes keeps a 3-asset CFMM and drops a stake box on another tree", () => {
  const { pools, skipped } = poolsFromBoxes([
    {
      venue: "spectrum_cfmm",
      height: 100,
      assets: [
        asset(NFT, 1n, "Ergo_x_LP", 1n),
        asset(QUOTE, 10n, "AHT", 1000n),
        asset(LP, 1000n, "Ergo_x_LP", 1000n),
      ],
    },
    {
      venue: "spectrum_cfmm",
      height: 200,
      assets: [
        asset("dd".repeat(32), 1n, "Sigmanaut", 1n),
        asset(QUOTE, 10n, "KINGBEE", 100n),
        asset(LP, 3n, "other", 3n),
        asset("ee".repeat(32), 1n, "more", 1n),
      ],
    },
  ]);
  assert.equal(skipped, 1);
  assert.equal(pools.length, 1);
  assert.equal(pools[0]?.poolId, NFT);
  assert.equal(pools[0]?.quoteToken, QUOTE);
  assert.equal(pools[0]?.symbol, "AHT");
});

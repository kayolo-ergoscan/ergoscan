import assert from "node:assert/strict";
import { test } from "node:test";
import { AGEUSD_BANK_V2_NFT } from "./ageusd.js";
import { ORACLE_FEEDS } from "./oracle-pools.js";
import { ERG_USD_ORACLE_NFT, ERGUSD_PT, GOLD_POOL_ORACLE_TOKENS, ORACLE_POOL_NFTS } from "./registers.js";
import { MINERS_FEE_ADDRESS } from "./tx-shape.js";
import {
  LOCK_BY_ADDRESS,
  ROSEN_LOCK_ADDRESS,
  SIGMAUSD_BANK_ADDRESS,
  classifyBoxLock,
  pickTxLock,
} from "./lock-overlay.js";
import { ROSEN_CHAINS } from "./rosen-chains.js";

const p2pk = { address: `9${"x".repeat(51)}` };
const leftover = { address: `2${"A".repeat(51)}` };
const lock88 = { address: `88${"a".repeat(50)}` };

test("named bank is sigmausd", () => {
  const t = classifyBoxLock({ address: SIGMAUSD_BANK_ADDRESS });
  assert.equal(t?.id, "sigmausd");
});

test("Rosen lock family", () => {
  assert.equal(classifyBoxLock({ address: ROSEN_LOCK_ADDRESS })?.id, "rosen");
});

test("other-chain Ergo-side trigger is still Rosen", () => {
  const cardano = ROSEN_CHAINS.find((c) => c.id === "cardano");
  assert.ok(cardano);
  assert.equal(classifyBoxLock({ address: cardano.trigger })?.id, "rosen");
  assert.equal(
    classifyBoxLock({ assets: [{ tokenId: cardano.rwtId, amount: "1" }] })?.id,
    "rosen"
  );
});

test("reemission address is in the map", () => {
  const addr =
    "22WkKcVUvboYCZJe1urbmvBL3j67LKb5KEAvFhJXqA6ubYvHpSCvbvwvEY3xzUr7QvxpEtqjzMAPMsVdZh1VGWmZphvKoJdVzL1ayhsMftTtEFoA3YYdq3zKeeYXavVrrPUmK3fRXJ2HWEbZexewtBWcgAnHBw5tKvYFy9dEUi645gE2fYMUvVBtbvMExE9mjZ2W9goWkqu1VtThAsMZWZWjHxDjX116HpeQKu9b9neEUBj4kE5sX8QXaV6ZeReXxYHFJFg2rmaTknSPMxHXA8NpQKgzryBwLssp5EJ1QTqn5R6xuvGgFCEUZicCEo8qk8UNbE7e2d4WqW5qzpQPzJkKoPa5UtJEPYDWNhaCKmCpzdSc77";
  assert.equal(LOCK_BY_ADDRESS.get(addr), "reemission");
  assert.equal(classifyBoxLock({ address: addr })?.id, "reemission");
});

test("miner fee is not a lock overlay", () => {
  assert.equal(classifyBoxLock({ address: MINERS_FEE_ADDRESS }), null);
});

test("unnamed leftover stays unnamed", () => {
  assert.equal(classifyBoxLock(leftover), null);
});

test("P2PK and 88 reward are not a dApp", () => {
  assert.equal(classifyBoxLock(p2pk), null);
  assert.equal(classifyBoxLock(lock88), null);
});

test("oracle NFT names the box", () => {
  const t = classifyBoxLock({
    address: leftover.address,
    assets: [{ tokenId: ERG_USD_ORACLE_NFT, amount: "1" }],
  });
  assert.equal(t?.id, "oracle");
});

test("every oracle feed pool NFT and oracle token marks the tx as oracle", () => {
  for (const def of Object.values(ORACLE_FEEDS)) {
    for (const id of [def.poolNft, def.oracleToken]) {
      assert.ok(ORACLE_POOL_NFTS.includes(id), `${def.slug} ${id}`);
    }
  }
});

test("gold seats of every token generation and USD v1 datapoints are oracle", () => {
  for (const tokenId of [...GOLD_POOL_ORACLE_TOKENS, ERGUSD_PT]) {
    const t = classifyBoxLock({ address: leftover.address, assets: [{ tokenId, amount: "1" }] });
    assert.equal(t?.id, "oracle", tokenId);
  }
});

test("AgeUSD bank NFT is sigmausd even if registry lists it as a pool", () => {
  const t = classifyBoxLock(
    {
      address: SIGMAUSD_BANK_ADDRESS,
      assets: [{ tokenId: AGEUSD_BANK_V2_NFT, amount: "1" }],
    },
    { poolNftIds: new Set([AGEUSD_BANK_V2_NFT]) }
  );
  assert.equal(t?.id, "sigmausd");
});

test("spectrum pool NFT from hints", () => {
  const nft = "aa".repeat(32);
  const t = classifyBoxLock(
    { address: leftover.address, assets: [{ tokenId: nft, amount: "1" }] },
    { poolNftIds: new Set([nft]) }
  );
  assert.equal(t?.id, "spectrum");
});

test("Lithos pool NFT is not labeled Spectrum", () => {
  const nft = "ab".repeat(32);
  const t = classifyBoxLock(
    { address: leftover.address, assets: [{ tokenId: nft, amount: "1" }] },
    { poolNftIds: new Set([nft]), lithosNftIds: new Set([nft]) }
  );
  assert.equal(t?.id, "lithos");
});

test("spent named lock beats a named output", () => {
  const r = pickTxLock({
    inputs: [{ address: SIGMAUSD_BANK_ADDRESS }],
    outputs: [{ address: ROSEN_LOCK_ADDRESS }, { address: MINERS_FEE_ADDRESS }],
  });
  assert.equal(r?.id, "sigmausd");
});

test("a data input never names the lock", () => {
  const r = pickTxLock({
    inputs: [p2pk],
    dataInputs: [{ address: SIGMAUSD_BANK_ADDRESS }],
    outputs: [p2pk, { address: MINERS_FEE_ADDRESS }],
  });
  assert.equal(r, null);
});

test("pay into Rosen is still Rosen", () => {
  const r = pickTxLock({
    inputs: [p2pk],
    outputs: [{ address: ROSEN_LOCK_ADDRESS }, { address: MINERS_FEE_ADDRESS }],
  });
  assert.equal(r?.id, "rosen");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { dangerHoldingUsd, groupRentDanger, parseRentDanger } from "./rent-danger.ts";

const BOX = "a".repeat(64);
const TOKEN = "b".repeat(64);

test("parseRentDanger keeps priced rows and drops a broken id", () => {
  assert.equal(parseRentDanger(undefined), null);
  assert.deepEqual(parseRentDanger([]), []);
  const rows = parseRentDanger([
    {
      boxId: BOX,
      tokenId: TOKEN,
      amount: "2500000000",
      decimals: 4,
      priceUsd: 2,
      name: "SigUSD",
      blocksUntilRent: 12,
    },
    { boxId: "nope", tokenId: TOKEN, amount: "1" },
  ]);
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0]?.name, "SigUSD");
  assert.equal(dangerHoldingUsd(rows![0]!), 500_000);
});

test("groupRentDanger folds boxes per token, soonest first", () => {
  const OTHER = "c".repeat(64);
  const row = (boxId: string, tokenId: string, amount: string, blocks: number, priceUsd: number) => ({
    boxId,
    address: null,
    tokenId,
    name: tokenId === TOKEN ? "Paideia" : null,
    amount,
    decimals: 4,
    priceUsd,
    valueNano: "1000000",
    rentNano: "65000000",
    shortfallNano: "64000000",
    blocksUntilRent: blocks,
  });
  const groups = groupRentDanger([
    row("1".repeat(64), TOKEN, "10000", 900, 2),
    row("2".repeat(64), OTHER, "50000", 600, 0),
    row("3".repeat(64), TOKEN, "30000", 400, 2),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.tokenId, TOKEN);
  assert.equal(groups[0]?.boxes, 2);
  assert.equal(groups[0]?.amount, 40000n);
  assert.equal(groups[0]?.usd, 8);
  assert.equal(groups[0]?.soonest, 400);
  assert.equal(groups[1]?.usd, 0);
  assert.deepEqual(groupRentDanger([]), []);
});

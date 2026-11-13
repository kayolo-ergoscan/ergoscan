import assert from "node:assert/strict";
import { test } from "node:test";
import { groupParties, partyNameMap, type TxIo } from "./tx-flow";

const TPL = "64607fe0fe3c0e5fd7c41ca1f1d65e48270da2f98e9a17049bfb2172356b5b5f";

test("a party keeps the template hash of its boxes for the contract name", () => {
  const io = (address: string, value: string, templateHash?: string): TxIo => ({
    boxId: `${address}-${value}`,
    value,
    address,
    ...(templateHash ? { templateHash } : {}),
  });
  const parties = groupParties([io("P", "5"), io("P", "7", TPL), io("W", "1")], new Set(), "in");
  assert.equal(parties.find((p) => p.address === "P")?.templateHash, TPL);
  assert.equal(parties.find((p) => p.address === "W")?.templateHash, undefined);
});

test("activity names line up with from / to; nothing named is null", () => {
  const m = partyNameMap([
    [["W", "P"], [null, "Position"]],
    [["Q"], ["  Order "]],
  ]);
  assert.deepEqual([...(m ?? new Map())], [
    ["P", "Position"],
    ["Q", "Order"],
  ]);
  assert.equal(partyNameMap([[["W"], undefined]]), null);
  assert.equal(partyNameMap([[["W"], [null]], [undefined, ["x"]]]), null);
});

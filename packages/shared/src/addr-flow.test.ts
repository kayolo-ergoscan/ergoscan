import assert from "node:assert/strict";
import { test } from "node:test";
import { MINERS_FEE_ADDRESS } from "./tx-shape.js";
import {
  ADDR_FLOW_RULES_VERSION,
  asAddrFlowKind,
  classifyAddrFlow,
  eip4MintOfOutputs,
  netValueParties,
} from "./addr-flow.js";

const ERG = 1_000_000_000n;
const FEE = 1_100_000n;

test("rules version", () => {
  assert.equal(ADDR_FLOW_RULES_VERSION, 2);
});

test("send with change is sent, not intra", () => {
  const kind = classifyAddrFlow({
    netErg: -(10n * ERG + FEE),
    fee: FEE,
  });
  assert.equal(kind, "sent");
});

test("receive is received", () => {
  assert.equal(classifyAddrFlow({ netErg: 5n * ERG, fee: FEE }), "received");
});

test("consolidation / self-pay is intra when net is exactly −fee", () => {
  assert.equal(classifyAddrFlow({ netErg: -FEE, fee: FEE }), "intra");
});

test("net zero is intra", () => {
  assert.equal(classifyAddrFlow({ netErg: 0n, fee: FEE }), "intra");
});

test("both-sides presence is not the rule", () => {
  // Old code: hasIn && hasOut → intra. A normal send always has both.
  assert.notEqual(
    classifyAddrFlow({ netErg: -(ERG + FEE), fee: FEE }),
    "intra"
  );
});

test("token send covering fee only is sent", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: -FEE,
      fee: FEE,
      tokens: [{ amount: -50n }],
    }),
    "sent"
  );
});

test("lost ERG gained token follows ERG — sent, not a DEX swap label", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: -(2n * ERG + FEE),
      fee: FEE,
      tokens: [{ amount: 100n }],
    }),
    "sent"
  );
});

test("ERG in and token out is received (fill-shaped)", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: 3n * ERG,
      fee: FEE,
      tokens: [{ amount: -40n }],
    }),
    "received"
  );
});

test("Spectrum-shaped order: lock tokens, pay fee, is sent", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: -FEE,
      fee: FEE,
      tokens: [{ amount: -250n }],
    }),
    "sent"
  );
});

test("Spectrum-shaped fill: only the bought asset arrives, is received", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: 0n,
      fee: FEE,
      tokens: [{ amount: 250n }],
    }),
    "received"
  );
});

test("mint to self while paying fee is intra, not received", () => {
  assert.equal(
    classifyAddrFlow({
      netErg: -FEE,
      fee: FEE,
      tokens: [{ amount: 1_000n, mint: 1_000n }],
    }),
    "intra"
  );
});

test("EIP-4 mint: token id is the id of a spent input box, any input order", () => {
  const firstInput = "ab".repeat(32);
  const otherInput = "cd".repeat(32);
  const outputId = "ef".repeat(32);
  const mint = eip4MintOfOutputs(
    [
      { boxId: outputId, assets: [{ tokenId: firstInput, amount: "40" }, { tokenId: "99".repeat(32), amount: "5" }] },
      { boxId: "12".repeat(32), assets: [{ tokenId: firstInput, amount: "2" }] },
    ],
    [otherInput, firstInput]
  );
  assert.equal(mint.get(firstInput), 42n);
  assert.equal(mint.size, 1);
});

test("EIP-4 mint: an output's own box id is not a mint", () => {
  const outputId = "ef".repeat(32);
  const mint = eip4MintOfOutputs([{ boxId: outputId, assets: [{ tokenId: outputId, amount: "1" }] }], ["ab".repeat(32)]);
  assert.equal(mint.size, 0);
});

test("unknown kind is null", () => {
  assert.equal(asAddrFlowKind("in"), null);
  assert.equal(asAddrFlowKind("swap"), null);
});

test("a refreshed contract box is not a from or a to; the fee payer is both", () => {
  const wallet = "9wallet";
  const script = "2vOracleScript";
  const got = netValueParties(
    [
      { address: wallet, value: "9370500000", assets: [{ tokenId: "dort", amount: "6200" }] },
      {
        address: script,
        value: "10000000",
        assets: [
          { tokenId: "oracle", amount: "1" },
          { tokenId: "dort", amount: "5185" },
        ],
      },
    ],
    [
      {
        address: script,
        value: "10000000",
        assets: [
          { tokenId: "oracle", amount: "1" },
          { tokenId: "dort", amount: "5185" },
        ],
      },
      { address: wallet, value: "9369000000", assets: [{ tokenId: "dort", amount: "6200" }] },
      { address: MINERS_FEE_ADDRESS, value: "1500000" },
    ],
    1_500_000n
  );
  assert.deepEqual(got.from, [wallet]);
  assert.deepEqual(got.to, [wallet]);
});

test("a real payment is payer to recipient, change stays off the to list", () => {
  const got = netValueParties(
    [{ address: "9alice", value: String(10n * ERG) }],
    [
      { address: "9alice", value: String(4n * ERG) },
      { address: "9bob", value: String(10n * ERG - 4n * ERG - FEE) },
      { address: MINERS_FEE_ADDRESS, value: String(FEE) },
    ],
    FEE
  );
  assert.deepEqual(got.from, ["9alice"]);
  assert.deepEqual(got.to, ["9bob"]);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ergoEpoch,
  mapEpochParams,
  mapTokenInfo,
  mapBlockHeader,
  mapExplorerBox,
  mapExplorerTx,
  registersAsExplorer,
  registersAsSigma,
  mempoolBalanceDelta,
  mempoolUnspentForAddress,
  sumBalances,
  asDecString,
  notImplemented,
  resolveDecimals,
  sharePctOfEmission,
} from "./explorerCompat.js";

describe("explorerCompat", () => {
  it("epoch is height / 1024", () => {
    assert.equal(ergoEpoch(0), 0);
    assert.equal(ergoEpoch(1023), 0);
    assert.equal(ergoEpoch(1024), 1);
    assert.equal(ergoEpoch(1871872), 1828);
  });

  it("maps node /info.parameters to EpochInfo names", () => {
    const p = mapEpochParams({
      height: 1871872,
      storageFeeFactor: 1250000,
      minValuePerByte: 360,
      maxBlockSize: 1271009,
      maxBlockCost: 8001091,
      blockVersion: 4,
      tokenAccessCost: 100,
      inputCost: 2407,
      dataInputCost: 100,
      outputCost: 298,
      subblocksPerBlock: 30,
    });
    assert.ok(p);
    assert.equal(p.height, 1871872);
    assert.equal(p.blockVersion, 4);
    assert.equal(p.subblocksPerBlock, 30);
    assert.equal(mapEpochParams({}), null);
  });

  it("TokenInfo uses official names and string emission", () => {
    const t = mapTokenInfo({
      tokenId: "aa".repeat(32),
      boxId: "bb".repeat(32),
      emission: "10000000000001",
      name: "SigUSD",
      description: "stable",
      decimals: 2,
    });
    assert.equal(t.id, "aa".repeat(32));
    assert.equal(t.emissionAmount, "10000000000001");
    assert.equal(t.decimals, 2);
    assert.equal(mapTokenInfo({ tokenId: "x", emission: "1" }).type, "EIP-004");
  });

  it("resolveDecimals keeps DB, fills known map, leaves NFTs at 0", () => {
    const sig = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";
    assert.equal(resolveDecimals(sig, 0), 2);
    assert.equal(resolveDecimals(sig, 2), 2);
    assert.equal(resolveDecimals(sig, 0, "1"), 0);
    assert.equal(resolveDecimals("f".repeat(64), 0), 0);
    assert.equal(resolveDecimals("f".repeat(64), 6), 6);
  });

  it("header epoch follows height", () => {
    const h = mapBlockHeader({
      id: "h1",
      parentId: "h0",
      height: 2048,
      timestamp: 1,
      difficulty: "9",
      size: 12,
    });
    assert.equal(h.epoch, 2);
    assert.equal(h.difficulty, "9");
  });

  it("box value stays a decimal string", () => {
    const b = mapExplorerBox({
      boxId: "b1",
      value: 9223372036854776000 as unknown as number,
      creationHeight: 10,
      transactionId: "t1",
      assets: [{ tokenId: "tok", amount: "437101" }],
    });
    assert.equal(typeof b.value, "string");
    assert.equal(b.assets[0].amount, "437101");
    assert.equal(b.mainChain, true);
    assert.equal(b.globalIndex, null);
  });

  it("box gix becomes official globalIndex", () => {
    const b = mapExplorerBox({
      boxId: "b2",
      value: "1",
      gix: 396864,
    });
    assert.equal(b.globalIndex, 396864);
  });

  it("settlementHeight uses inclusion when passed, else list creation", () => {
    const split = mapExplorerBox({
      boxId: "b3",
      value: "1",
      creationHeight: 966513,
      settlementHeight: 966515,
      blockId: "06e19079ec68dc2440dd4d99df3cf3a4a2fdb405b851e755449c92462bc24c2b",
    });
    assert.equal(split.creationHeight, 966513);
    assert.equal(split.settlementHeight, 966515);
    assert.equal(
      split.blockId,
      "06e19079ec68dc2440dd4d99df3cf3a4a2fdb405b851e755449c92462bc24c2b"
    );
    const listed = mapExplorerBox({
      boxId: "b4",
      value: "1",
      creationHeight: 10,
    });
    assert.equal(listed.settlementHeight, 10);
  });

  it("registersAsSigma matches the official box object", () => {
    const r = registersAsSigma({ R4: "04c60f" });
    assert.equal(r.R4?.serializedValue, "04c60f");
    assert.equal(r.R4?.sigmaType, "SInt");
    assert.equal(r.R4?.renderedValue, "995");
    const box = mapExplorerBox({
      boxId: "b5",
      value: "18767889",
      additionalRegisters: { R4: "04c60f" },
    });
    assert.equal(typeof box.value, "string");
    assert.equal(box.additionalRegisters.R4?.sigmaType, "SInt");
  });

  it("registersAsExplorer picks serialized hex", () => {
    const r = registersAsExplorer({
      R4: { serializedValue: "0e03555344", renderedValue: "USD" },
      R5: "0e01",
    });
    assert.equal(r.R4, "0e03555344");
    assert.equal(r.R5, "0e01");
  });

  it("tx gix becomes official globalIndex", () => {
    const t = mapExplorerTx({
      id: "tx1",
      gix: 12,
      inclusionHeight: 9,
      outputs: [{ boxId: "b", value: "1", gix: 13 }],
    });
    assert.equal(t.globalIndex, 12);
    assert.equal(t.outputs[0].globalIndex, 13);
    assert.deepEqual(t.dataInputs, []);
  });

  it("mempool delta credits outputs and debits valued inputs", () => {
    const addr = "9addr";
    const d = mempoolBalanceDelta(addr, [
      {
        outputs: [{ address: addr, value: "5000", assets: [{ tokenId: "t", amount: "2" }] }],
        inputs: [{ address: addr, value: "1000", assets: [{ tokenId: "t", amount: "1" }] }],
      },
    ]);
    assert.equal(d.nanoErgs, "4000");
    assert.equal(d.tokens[0]?.amount, "1");
  });

  it("sumBalances keeps confirmed + pending as strings", () => {
    const s = sumBalances(
      { nanoErgs: "10", tokens: [{ tokenId: "t", amount: "3", decimals: 2, name: "X" }] },
      { nanoErgs: "-4", tokens: [{ tokenId: "t", amount: "-1", decimals: 0 }] }
    );
    assert.equal(s.nanoErgs, "6");
    assert.equal(s.tokens[0]?.amount, "2");
    assert.equal(s.tokens[0]?.decimals, 2);
  });

  it("mempool unspent boxes for one address", () => {
    const addr = "9addr";
    const boxes = mempoolUnspentForAddress(addr, [
      {
        id: "tx1",
        outputs: [
          { boxId: "b1", address: addr, value: "10", assets: [] },
          { boxId: "b2", address: "other", value: "1", assets: [] },
        ],
      },
    ]);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].boxId, "b1");
    assert.equal(boxes[0].value, "10");
  });

  it("asDecString never emits empty", () => {
    assert.equal(asDecString(""), "0");
    assert.equal(asDecString(null), "0");
    assert.equal(asDecString(12n), "12");
  });

  it("sharePctOfEmission is % of tokens.emission, not circulating sum", () => {
    assert.equal(sharePctOfEmission(21_000_000, 21_000_000), 100);
    assert.equal(sharePctOfEmission("10500000", "21000000"), 50);
    assert.equal(sharePctOfEmission(21_000_000, 20_000_000), 105);
    assert.equal(sharePctOfEmission(1, 21_000_000), 0);
    assert.equal(sharePctOfEmission(21_000_000, 0), null);
    assert.equal(sharePctOfEmission(21_000_000, null), null);
  });

  it("wallet box and tx keep official names and string amounts", () => {
    const box = mapExplorerBox({
      boxId: "ab".repeat(32),
      value: "242695253860240",
      creationHeight: 100,
      address: "9addr",
      ergoTree: "00",
      transactionId: "cd".repeat(32),
      index: 1,
      assets: [{ tokenId: "ef".repeat(32), amount: "10" }],
      additionalRegisters: { R4: "0702" },
    });
    for (const key of ["boxId", "value", "ergoTree", "assets", "additionalRegisters", "creationHeight", "transactionId", "index", "address"]) {
      assert.ok(key in box, key);
    }
    assert.equal(box.additionalRegisters.R4?.serializedValue, "0702");
    assert.equal(typeof box.additionalRegisters.R4, "object");
    assert.equal(typeof box.value, "string");
    assert.equal(box.assets[0]?.amount, "10");
    const tx = mapExplorerTx({
      id: "cd".repeat(32),
      inclusionHeight: 100,
      index: 2,
      size: 400,
      inputs: [],
      outputs: [{ boxId: "ab".repeat(32), value: "1" }],
    });
    for (const key of ["id", "inclusionHeight", "index", "inputs", "outputs", "size"]) {
      assert.ok(key in tx, key);
    }
    assert.equal(tx.outputs[0]?.value, "1");
  });

  it("notImplemented is a stable 501 body", () => {
    const n = notImplemented("boxes.search");
    assert.equal(n.error, "not_implemented");
    assert.equal(n.status, 501);
    assert.match(n.note, /byGlobalIndex streams are live/);
    assert.equal(/DEX history/i.test(n.note), false);
  });
});

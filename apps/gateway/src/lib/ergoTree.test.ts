import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it, test } from "node:test";
import {
  decodeErgoTree,
  ecPointShort,
  officialConstantsText,
  decodeErgoTreeSync,
  ergoTreeTemplateHash,
  sha256HexBytes,
} from "./ergoTree.js";

/** Rosen RWT box — creation 966513 / settlement 966515. */
const ROSEN_TREE =
  "101c04000e204791c75d9e73dd1546e0c391d190350176ba91acdaff9387cf00dc86d6fc33ab04000200020004020400010004000400040004000400040604040402050205c8010500040204000400020004000400040204000400d80bd601b2a4730000d6027301d60393cbc272017202d604e4c6a7041ad6059572037201b2a5730200d606e4c67205041ad607c67205051ad608e67207d609957208b0e472078301027303d901093c0e0eb38c7209018c7209028301027304d60ab472097305b17209d60bb2a5730600957203d801d60cb2b5a5d9010c63d801d60ec6720c041a95e6720e93e4720e72047307730800d19683040193cbc2720ce4c6a7070e938cb2db6308720c730900018cb2db6308a7730a0001efae7206d9010d0e93720483010e720d93cbb3720ab27204730b00e4c6a7060ed801d60ccbc2720b9593720c7202d806d60db5a4d9010d6393c2a7c2720dd60eb1720dd60fb2db6501fe730c00d610e4c6720f0611d611b27210730d00d6129ab27210730e009d9cb27210730f00997eb1e4c6720f041a0573107311d19683080192c1720bb0ad720dd9011363c172137312d90113599a8c7213018c72130293b1b5720dd901136393e4c67213041a72047313ae7206d901130e9383010e7213720493e4c67205060ee4c6a7070e93b17206720e93cbb3720ab27204731400e4c6a7060e93e4c6a7051a83010e957208cbb2e472077315008301027316917e720e05958f7211721272117212d19683050193c5a7c57201938cb2db6308720b731700018cb2db6308a77318000193e4c6720b041a7204938cb2db6308b2a4731900731a0001b27204731b0093720ce4c6a7070e";

const ROSEN_TEMPLATE_HASH =
  "83359e0ba727b204f33acf2b8e0ded97fd0005c9b833258fbd364a1e70e5eb46";

const P2PK =
  "0008cd033e299a9add2321db9220fd34d41b75ce6a2dd0564fd6032205c39b32ef59da98";

describe("ergoTree", () => {
  it("hashes template bytes, not hex ASCII", () => {
    const hex = "00";
    const asBytes = sha256HexBytes(hex);
    const asAscii = createHash("sha256").update(hex, "utf8").digest("hex");
    assert.notEqual(asBytes, asAscii);
    assert.equal(asBytes.length, 64);
  });

  it("broken hex does not throw", async () => {
    const bad = await decodeErgoTree("zz");
    assert.equal(bad.ergoTreeScript, "");
    assert.equal(bad.ergoTreeTemplateHash, null);
    const odd = await decodeErgoTree("0");
    assert.equal(odd.ergoTreeTemplateHash, null);
  });

  it("Rosen tree: SHA-256(template) + signed Coll constant", async () => {
    const d = await decodeErgoTree(ROSEN_TREE);
    assert.equal(d.ergoTreeTemplateHash, ROSEN_TEMPLATE_HASH);
    assert.equal(await ergoTreeTemplateHash(ROSEN_TREE), ROSEN_TEMPLATE_HASH);
    assert.equal(d.treeConstants.length, 28);
    const coll = d.treeConstants[1];
    assert.ok(coll);
    assert.match(coll.sigmaType, /Coll\[SByte/);
    assert.match(coll.renderedValue, /Coll\(71,-111,/);
    assert.ok(d.ergoTreeScript.length > 10);
    assert.notEqual(d.ergoTreeScript, "[object Object]");
    assert.match(d.ergoTreeConstants, /1: Coll\[SByte/);
  });

  it("P2PK tree hashes and prints a SigmaProp, not [object Object]", async () => {
    const d = await decodeErgoTree(P2PK);
    assert.ok(d.ergoTreeTemplateHash && /^[0-9a-f]{64}$/.test(d.ergoTreeTemplateHash));
    assert.equal(d.treeConstants.length, 0);
    assert.match(d.ergoTreeScript, /SigmaProp|ProveDlog/);
    assert.notEqual(d.ergoTreeScript, "[object Object]");
  });

  it("caches by tree hex", async () => {
    const a = await decodeErgoTree(P2PK);
    const b = await decodeErgoTree(P2PK);
    assert.equal(a, b);
  });

  it("sync helper matches async when lib is loaded", async () => {
    const asyncD = await decodeErgoTree(P2PK);
    const lib = await import("sigmastate-js/main");
    const syncD = decodeErgoTreeSync(P2PK, {
      ErgoTree$: lib.ErgoTree$,
    });
    assert.equal(syncD.ergoTreeTemplateHash, asyncD.ergoTreeTemplateHash);
    assert.equal(syncD.treeConstants.length, asyncD.treeConstants.length);
  });
});

test("points print as the official explorer does (12 Nov 2026)", async () => {
  assert.equal(
    ecPointShort("021dde34603426402615658f1d970cfa7c7bd92ac81a8b16eeebff264d59ce4604"),
    "ECPoint(1dde34,63f0c9,...)"
  );
  assert.equal(
    ecPointShort("0282e3b9a641625a578d171e012ecda131d4dd63b603ff70a5d73bad126aa1f050"),
    "ECPoint(82e3b9,edc90f,...)"
  );
  assert.equal(ecPointShort("04" + "00".repeat(32)), null);
  const d = await decodeErgoTree(
    "100204a00b08cd021dde34603426402615658f1d970cfa7c7bd92ac81a8b16eeebff264d59ce4604ea02d192a39a8cc7a70173007301"
  );
  assert.equal(
    officialConstantsText(d.treeConstants),
    "[\n  0: SInt$ = 720,\n  1: SSigmaProp = SigmaProp(ProveDlog(ECPoint(1dde34,63f0c9,...)))\n]"
  );
  assert.equal(officialConstantsText([]), "[]");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { blake2b } from "@noble/hashes/blake2.js";
import {
  boxBytesSql,
  ergoBoxSizeBytes,
  ergoBoxSizeOf,
  headerEpochStart,
  parseRentEpochCollected,
  rentEpochCollectedAt,
  rentFeeSql,
  rentTakeSql,
  rentTakesWhole,
  storageFeeNano,
  vlqLen,
  vlqLenSql,
} from "./rent-exact.js";
import { computeBoxRent, DEFAULT_RENT_PARAMS } from "./rent.js";

/**
 * Real boxes a miner collected rent from (node /blockchain/box/byId), each with the fee it paid
 * from rent_collected. Every one covered its fee, so rent / 1 250 000 is its true byte size.
 */
type Fixture = {
  name: string;
  boxId: string;
  value: string;
  ergoTree: string;
  creationHeight: number;
  assets: [string, string][];
  registers: Record<string, string>;
  transactionId: string;
  index: number;
  rentNano: string;
};

const FIXTURES: Fixture[] = [
  {
    name: "P2PK, no tokens",
    boxId: "4952ae733c73681bfc59c783f5f2d0b3893cfcde4a31902604a0a082c69191af",
    value: "6000408986390",
    ergoTree: "0008cd034972dc83aec267584316f5122d99c96e4ef4aca78d4657096b4c9887d5fed65f",
    creationHeight: 856294,
    assets: [],
    registers: {},
    transactionId: "4da86fbbca723834ea759a9b2012d1696a31b911f17be8efa6a8828d6995447b",
    index: 0,
    rentNano: "101250000",
  },
  {
    name: "P2PK, output index 131 (two-byte VLQ)",
    boxId: "ce81bcc97da5f42e1475e8d1f96b05aeaf0c6945403e28ad184121691321fe66",
    value: "44654658200",
    ergoTree: "0008cd020a9292f494699df906750ecdc3f9af3e0e1715e0db2b5e985939d47d3681bd74",
    creationHeight: 863859,
    assets: [],
    registers: {},
    transactionId: "4087fbc4b1671e0ecdf8615f562e1caac0a9f2a8bcd2a6239b1a912e36e0af94",
    index: 131,
    rentNano: "101250000",
  },
  {
    name: "P2PK with R4",
    boxId: "f838eb7aafc8436e2cc3e1324e511851648c54c2e85fa5ba3d55c0586b6b528d",
    value: "40180000000",
    ergoTree: "0008cd02519b37823e5d55156e976d6cc2fcc27a5259bc832740dd238e6ed31366105a19",
    creationHeight: 860164,
    assets: [],
    registers: { R4: "0e20c038617e253a2b60d7f6313725b0fec9e746715019c98c30461c5536ee8d0aa0" },
    transactionId: "cfed96c89e5a19b34ea71622f906f66189e0bfa10b805796753f166bd7818da3",
    index: 0,
    rentNano: "142500000",
  },
  {
    name: "script, output index 214",
    boxId: "1178441f203ce2d0462b93a72db8ac34d3e09efdf30b7d76d9658b66ef975dc7",
    value: "505950167",
    ergoTree:
      "100204a00b08cd025ed60a7daf03c00cdcf684f5b1df5d0f6fa751696150a7a22f753675b728751aea02d192a39a8cc7a70173007301",
    creationHeight: 858538,
    assets: [],
    registers: {},
    transactionId: "e47f73bee37fd84bfb49b61b4786573c9a09eced4e647718b743b78109ca8999",
    index: 214,
    rentNano: "122500000",
  },
  {
    name: "contract with 2 tokens and R4",
    boxId: "4c05c124c3e8acf09a6ec58a7d909d02710d4faed647e1e58799735963bce7b5",
    value: "28367741500",
    ergoTree:
      "1022040004000400040204020500040404000402040004000e20771ae41339fed6cb16134ce18da107d72c49addd21a676279d7203f150a33f0904000e20011d3364de07e5a26f0c4eef0852cddb387039a921b7154ef3cab22c6eda887f040204000e203354d53ffff347656f9151eb7188658ef81a54c78508020f0befd2740e5a54d204000e2003faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04010004000514041a01000501050005010500050005000500058289ceb0f9dcfc1f058289ceb0f9dcfc1f0480897ad812d601db6501fed602b2a5730000d603c17202d604c1a7d6059972037204d606db63087202d607db6308a7d60893b27206730100b27207730200d609b27206730300d60a8c720902d60bb27207730400d60c8c720b02d60d9399720a720c7305d60e93b172067306d60fe4c672020405d610e4c6a70405d61199720f7210d61293c27202c2a79591b172017307d805d613b2a5730800d614b27201730900d615db63087213d61694b17215730ad617e4c672130405d1ededededededededed93cbc27213730b938cb2db63087214730c0001730d938cb2db6308b27201730e00730f00017310957216938cb272157311000173127313957216928cb27215731400029d9c9c721773157e731605e4c6721404057317939c7205731872177208720d720e9372117217d1ecedededededed721272089172057319720d720eec9272059c7211731aed8f9972107205731b93720f731c92720f731dedededededed72127208938c7209018c720b01937211731e929d9a7203720f99731f720a9d9a72047210997320720c720e9272037e732105",
    creationHeight: 857806,
    assets: [
      ["3a53f5f89d96640d4526fe97964640668c196c4e530c4ccb9d1cf8d31f71592a", "1"],
      ["7ce5d846e7ec1af207cb0da7629498d5cf6ffacd7b4d28d08dcd95d889ca773a", "8999971311179218"],
    ],
    registers: { R4: "0580e4bd8b09" },
    transactionId: "daff0f4e1726c0566212b1ddb2a64ceedd734684d5d9206989c487509df09812",
    index: 0,
    rentNano: "922500000",
  },
  {
    name: "P2PK with 20 tokens",
    boxId: "f417eb167d093d97ba33d14c1129e9ac843a676fc279c1424c9f24cae00c5d90",
    value: "8117119896",
    ergoTree: "0008cd02582e3a96aa77a90135e86259d464b1521b2528418c095d66a0a0dfbe2bf5c4bc",
    creationHeight: 862065,
    assets: [
      ["944f72c571f7e894fe75fe5b351cdc67ea2fa6daa538321d72f759d551b1d147", "1800000000000"],
      ["96c402c0e658909aa03f534006124f0e43725c467dbc8dea39680d0861892de5", "800000"],
      ["6e6547eb720ac46703d20a2903fc588c9a7079d2f32897b6f222cf443c5cdac7", "188369666"],
      ["5a34d53ca483924b9a6aa0c771f11888881b516a8d1a9cdc535d063fe26d065e", "23100000000"],
      ["0b7c3cd3145209c6f455e2a0b890195eafcde934e09ca3d54d7972d1f1ce3c44", "20"],
      ["65553d2f2adf9ee6bdf1e9b91204f06794f83e55bd47b2311a3a75e5f70809c7", "1"],
      ["472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8", "55000000"],
      ["30974274078845f263b4f21787e33cc99e9ec19a17ad85a5bc6da2cca91c5a2e", "832423916673"],
      ["94180232cc0d91447178a0a995e2c14c57fbf03b06d5d87d5f79226094f52ffc", "500000000"],
      ["47959eb4a860ea11a29b09d5034c781d97549e50705bd0f3a6ea0303e03af6f0", "59989500"],
      ["ef802b475c06189fdbf844153cdc1d449a5ba87cce13d11bb47b5a539f27f12b", "9800000000000"],
      ["45623c86e3b301157ebefab7901465a2b458be2e8f4e3b64c35e329b43068ef0", "7970"],
      ["1c51c3a53abfe87e6db9a03c649e8360f255ffc4bd34303d30fc7db23ae551db", "51149436"],
      ["7229734e3f0871cd8e50e3cab79bd81edd31eceaadd3f2688cc5a8eeb6d02fca", "1"],
      ["00b1e236b60b95c2c6f8007a9d89bc460fc9e78f98b09faec9449007b40bccf3", "10000000"],
      ["0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b", "2967165"],
      ["74d7745b32e895008027a853ea7a6974ba3cbd1efa986537563c12d6ab22c506", "30"],
      ["fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40", "267614"],
      ["d71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413", "5000"],
      ["81a62b362238964238b48f92a717dbaac248c4e152d0d9f518af536c14587389", "1"],
    ],
    registers: {},
    transactionId: "2b8fc5932209d0bf9ba09d047ccd311abe43cd2ebf258874efa92c89bc448711",
    index: 2,
    rentNano: "983750000",
  },
];

function hex(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

function vlq(v: bigint): number[] {
  const out: number[] = [];
  let n = v;
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    out.push(byte);
  } while (n > 0n);
  return out;
}

/** The box as the protocol serializes it. Its blake2b256 is the box id, so the length is the truth. */
function serialize(f: Fixture): Uint8Array {
  const bytes = [
    ...vlq(BigInt(f.value)),
    ...hex(f.ergoTree),
    ...vlq(BigInt(f.creationHeight)),
    f.assets.length,
    ...f.assets.flatMap(([id, amount]) => [...hex(id), ...vlq(BigInt(amount))]),
    Object.keys(f.registers).length,
    ...Object.values(f.registers).flatMap(hex),
    ...hex(f.transactionId),
    ...vlq(BigInt(f.index)),
  ];
  return Uint8Array.from(bytes);
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

test("vlqLen follows 7-bit groups", () => {
  assert.equal(vlqLen(0), 1);
  assert.equal(vlqLen(127), 1);
  assert.equal(vlqLen(128), 2);
  assert.equal(vlqLen(16383), 2);
  assert.equal(vlqLen(16384), 3);
  assert.equal(vlqLen(1_000_000_000), 5);
  assert.equal(vlqLen("9223372036854775807"), 9);
  assert.equal(vlqLen(-5), 1);
  assert.equal(vlqLen("nope"), 1);
});

for (const f of FIXTURES) {
  test(`real collected box: ${f.name}`, () => {
    const bytes = serialize(f);
    // The serialization below is the real one: it hashes to the box id.
    assert.equal(toHex(blake2b(bytes, { dkLen: 32 })), f.boxId);
    // The fee the miner took is exactly 1 250 000 per byte.
    assert.equal(BigInt(f.rentNano), 1_250_000n * BigInt(bytes.length));
    const size = ergoBoxSizeBytes({
      valueNano: f.value,
      ergoTree: f.ergoTree,
      creationHeight: f.creationHeight,
      tokenAmounts: f.assets.map(([, amount]) => amount),
      registers: f.registers,
      outputIndex: f.index,
    });
    assert.equal(size, bytes.length);
    // Same from the stored columns (tree_bytes + register hex), as the SQL reads them.
    assert.equal(
      ergoBoxSizeBytes({
        valueNano: BigInt(f.value),
        treeBytes: f.ergoTree.length / 2,
        creationHeight: f.creationHeight,
        tokenAmounts: f.assets.map(([, amount]) => BigInt(amount)),
        registerBytes: Object.values(f.registers).reduce((n, h) => n + h.length / 2, 0),
        outputIndex: f.index,
      }),
      bytes.length
    );
    // And from a box as the node or the index hands it to the box page.
    assert.equal(
      ergoBoxSizeOf({
        value: f.value,
        ergoTree: f.ergoTree,
        creationHeight: f.creationHeight,
        index: f.index,
        assets: f.assets.map(([tokenId, amount]) => ({ tokenId, amount })),
        additionalRegisters: f.registers,
      }),
      bytes.length
    );
  });
}

test("a plain P2PK box is 79 bytes at 1 ERG, not tree + 16", () => {
  const size = ergoBoxSizeBytes({
    valueNano: 1_000_000_000,
    treeBytes: 36,
    creationHeight: 1_916_000,
    outputIndex: 0,
  });
  assert.equal(size, 5 + 36 + 3 + 34 + 1);
});

test("vlqLenSql thresholds match vlqLen", () => {
  const sql = vlqLenSql("x");
  assert.match(sql, /WHEN x < 128 THEN 1/);
  assert.match(sql, /WHEN x < 72057594037927936 THEN 8 ELSE 9 END/);
  const cuts = [...sql.matchAll(/< (\d+) THEN (\d)/g)].map((m) => [BigInt(m[1]!), Number(m[2])] as const);
  for (const [cut, len] of cuts) {
    assert.equal(vlqLen(cut - 1n), len);
    assert.equal(vlqLen(cut), len + 1);
  }
});

test("boxBytesSql can bound the token probe by height", () => {
  assert.match(boxBytesSql("b"), /FROM packed\.box_assets ta WHERE ta\.box_id = b\.box_id/);
  assert.match(boxBytesSql("b", { tokensUpTo: "$7" }), /CASE WHEN b\.creation_height <= \$7 THEN/);
});

test("header epoch start is floor(height / 1024) × 1024", () => {
  assert.equal(headerEpochStart(1_916_483), 1_871 * 1024);
  assert.equal(headerEpochStart(1_871 * 1024), 1_871 * 1024);
  assert.equal(headerEpochStart(1_872 * 1024 - 1), 1_871 * 1024);
  assert.equal(headerEpochStart(-1), 0);
});

test("parseRentEpochCollected is strict", () => {
  const ok = { boxes: 12, rentNano: "1250000", fromHeight: 1_871 * 1024 };
  assert.deepEqual(parseRentEpochCollected(ok), ok);
  assert.equal(parseRentEpochCollected(null), null);
  assert.equal(parseRentEpochCollected([]), null);
  assert.equal(parseRentEpochCollected({ ...ok, boxes: -1 }), null);
  assert.equal(parseRentEpochCollected({ ...ok, boxes: 1.5 }), null);
  assert.equal(parseRentEpochCollected({ ...ok, boxes: "12" }), null);
  assert.equal(parseRentEpochCollected({ ...ok, rentNano: 1250000 }), null);
  assert.equal(parseRentEpochCollected({ ...ok, rentNano: "-1" }), null);
  assert.equal(parseRentEpochCollected({ ...ok, rentNano: "1.5" }), null);
  assert.equal(parseRentEpochCollected({ ...ok, fromHeight: 1_871 * 1024 + 3 }), null);
  assert.deepEqual(parseRentEpochCollected({ boxes: 0, rentNano: "0", fromHeight: 0 }), {
    boxes: 0,
    rentNano: "0",
    fromHeight: 0,
  });
});

test("rentEpochCollectedAt drops last epoch's sum", () => {
  const snap = { boxes: 3, rentNano: "300000000", fromHeight: 1_871 * 1024 };
  assert.deepEqual(rentEpochCollectedAt(snap, 1_871 * 1024 + 528), snap);
  assert.equal(rentEpochCollectedAt(snap, 1_872 * 1024), null);
  assert.equal(rentEpochCollectedAt(snap, 1_871 * 1024 - 1), null);
  assert.equal(rentEpochCollectedAt(snap, null), null);
});

test("storage fee: factor × bytes, once per spend, no age term", () => {
  assert.equal(storageFeeNano(79), 98_750_000n); // a plain P2PK box
  assert.equal(storageFeeNano(79, 2_500_000), 197_500_000n);
  assert.equal(storageFeeNano(0), 0n);
  assert.equal(storageFeeNano(-5), 0n);
  // A box three periods old pays the same single fee (the node's checkExpiredBox has no age term).
  const period = DEFAULT_RENT_PARAMS.storagePeriodBlocks;
  const r = computeBoxRent({ creationHeight: 1, currentHeight: 1 + 3 * period + 10, valueNano: 5e9, sizeBytes: 79 });
  assert.equal(r.periodsElapsed, 3);
  assert.equal(r.estimatedRentNano, 98_750_000);
  assert.equal(r.storageFeeNano, 98_750_000);
  assert.equal(r.takenWhole, false);
});

test("box rent estimate: min(value, fee); a box worth no more than its fee is taken whole", () => {
  const period = DEFAULT_RENT_PARAMS.storagePeriodBlocks;
  const due = { creationHeight: 1, currentHeight: 2 + period, sizeBytes: 79 };
  const small = computeBoxRent({ ...due, valueNano: 1_000_000 });
  assert.equal(small.storageFeeNano, 98_750_000);
  assert.equal(small.estimatedRentNano, 1_000_000);
  assert.equal(small.takenWhole, true);
  const exact = computeBoxRent({ ...due, valueNano: 98_750_000 });
  assert.equal(exact.estimatedRentNano, 98_750_000);
  assert.equal(exact.takenWhole, true);
  const above = computeBoxRent({ ...due, valueNano: 98_750_001 });
  assert.equal(above.estimatedRentNano, 98_750_000);
  assert.equal(above.takenWhole, false);
  // Value unknown: the fee stands, nothing said about the whole box.
  const unknown = computeBoxRent({ ...due, valueNano: 0 });
  assert.equal(unknown.estimatedRentNano, 98_750_000);
  assert.equal(unknown.takenWhole, false);
  // Not due yet: no estimate, no fee.
  const young = computeBoxRent({ creationHeight: 1, currentHeight: 100, sizeBytes: 79, valueNano: 1_000 });
  assert.equal(young.estimatedRentNano, null);
  assert.equal(young.storageFeeNano, null);
  assert.equal(young.takenWhole, false);
});

test("a box worth no more than its fee goes whole", () => {
  assert.equal(rentTakesWhole(98_750_000n, 98_750_000n), true); // value − fee ≤ 0
  assert.equal(rentTakesWhole(1_000_000n, 98_750_000n), true);
  assert.equal(rentTakesWhole(98_750_001n, 98_750_000n), false);
});

test("collectable rent SQL is LEAST(value, fee) on the exact size", () => {
  const take = rentTakeSql("b", "$1", { tokensUpTo: "$4" });
  assert.ok(take.startsWith("LEAST(b.value_nano::numeric, "));
  assert.ok(take.includes(rentFeeSql("b", "$1", { tokensUpTo: "$4" })));
  assert.ok(take.includes(boxBytesSql("b", { tokensUpTo: "$4" })));
  assert.ok(!/FLOOR|GREATEST/.test(take), "no age multiplier");
});

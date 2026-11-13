import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ERGODEX_CP_POOL_TEMPLATES,
  ERGODEX_LP_ART_SOURCE,
  ERGODEX_LP_ART_URL,
  ERGODEX_V3_SHELL_TEMPLATES,
} from "@ergoscan/shared";
import {
  I64_MAX,
  classifyLpRows,
  clCurveFromBox,
  clFeeUnit,
  ergodexClKeyIds,
  lpArtSource,
  parseCollLong,
  setErgodexLpMap,
  shellValidatorHash,
  wholePrice,
  withLpArt,
  type LpBoxAssetRow,
} from "./ergodexLp.js";
import { nftHeldSql } from "./indexDb.js";

const V3 = ERGODEX_V3_SHELL_TEMPLATES[0]!;
const V3_OLD = ERGODEX_V3_SHELL_TEMPLATES[1]!;
const CP = ERGODEX_CP_POOL_TEMPLATES[1]!;
const OTHER = "2dcc7830afe8f355b945850c60ff2b41fdb3e8ade07fde0a7c8a3ec498e8c3f6";

const KEY = "3a797e68a0b50ca619d51f10d3b883860163893b9e80f5f36655ba4065df4ad0";
const SIGRSV = "003bd19d0187117f130b62e1bcab0939929ff5c7709f843c5c4dd158949285d0";
const POOL_NFT = "3a395276477f3e36403f73ad904050380e4abc5ae38a7abd4ff0e055306c68bf";
const LP = "2805201fed264670128c9759c0bf4fbff1c9a5c02c5177ee58d89fa3632c0749";
const TOKEN_B = "00b42b41cb438c41d0139aa8432eb5eeb70d5a02d3df891f880d5fe08670c365";
const SIGUSD = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";

function row(p: Partial<LpBoxAssetRow> & { box_id: string; token_id: string }): LpBoxAssetRow {
  return {
    template: V3,
    height: 100,
    asset_index: null,
    minted_here: false,
    emission: "1000",
    decimals: 0,
    ...p,
  };
}

test("classifyLpRows: by contract, emission and the mint tx, never by name", () => {
  const rows: LpBoxAssetRow[] = [
    // V3 position box: the key minted in this tx, slot 0; SigRSV at slot 1.
    row({ box_id: "b1", token_id: KEY, emission: "2", minted_here: true, asset_index: 0 }),
    row({ box_id: "b1", token_id: SIGRSV, emission: "10000000000001", asset_index: 1 }),
    // An emission-2 token deposited as liquidity, not minted beside the box: not a key.
    row({ box_id: "b2", token_id: "aa".repeat(32), emission: "2", minted_here: false }),
    // Emission 2 but decimals 2: not a key.
    row({ box_id: "b3", token_id: "bb".repeat(32), emission: "2", decimals: 2, minted_here: true }),
    // Same token shape in an unrelated contract: nothing.
    row({ box_id: "b4", template: OTHER, token_id: "cc".repeat(32), emission: "2", minted_here: true }),
    // CP pool: NFT slot 0, LP slot 1 minted in the create tx, reserves after.
    row({ box_id: "p1", template: CP, token_id: POOL_NFT, emission: "1", asset_index: 0 }),
    row({ box_id: "p1", template: CP, token_id: LP, emission: I64_MAX, asset_index: 1, minted_here: true }),
    row({ box_id: "p1", template: CP, token_id: TOKEN_B, emission: "1000000000000", decimals: 4, asset_index: 2 }),
    row({ box_id: "p1", template: CP, token_id: SIGUSD, emission: "10000000000001", decimals: 2, asset_index: 3 }),
    // i64::MAX token in a pool box but not minted with it: not an LP.
    row({ box_id: "p2", template: CP, token_id: "dd".repeat(32), emission: I64_MAX, asset_index: 1 }),
    // Emission 1 at a reserve slot: not the pool NFT.
    row({ box_id: "p3", template: CP, token_id: "ee".repeat(32), emission: "1", asset_index: 2 }),
  ];
  const m = classifyLpRows(rows);
  assert.deepEqual([...m.keys()].sort(), [KEY, LP, POOL_NFT].sort());
  assert.equal(m.get(KEY)?.kind, "cl-key");
  assert.deepEqual(m.get(KEY)?.pair, { x: null, y: SIGRSV });
  assert.equal(m.get(POOL_NFT)?.kind, "cp-pool-nft");
  assert.equal(m.get(LP)?.kind, "cp-lp");
});

test("classifyLpRows: earlier shell, token/token pair by slot, increments keep the set", () => {
  const T2T_KEY = "d36d160fcb531e8192d42ef737972ead72c3539c625e44b3471437ac62aeb40b";
  const X = "7ba2a85fdb302a181578b1f64cb4a533d89b3f8de4159efece75da41041537f9";
  const Y = "ae399fcb751e8e247d0da8179a2bcca2aa5119fff9c85721ffab9cdc9a3cb2dd";
  const first = classifyLpRows([
    // Mint box without slot numbers: the pair order is unknown.
    row({ box_id: "m", template: V3_OLD, height: 10, token_id: T2T_KEY, emission: "2", minted_here: true }),
    row({ box_id: "m", template: V3_OLD, height: 10, token_id: Y }),
    row({ box_id: "m", template: V3_OLD, height: 10, token_id: X }),
  ]);
  assert.equal(first.get(T2T_KEY)?.kind, "cl-key");
  assert.equal(first.get(T2T_KEY)?.pair, null);
  // A later scan sees only the successor box (not minted there), with slots.
  const next = classifyLpRows(
    [
      row({ box_id: "s", template: V3_OLD, height: 20, token_id: T2T_KEY, emission: "2", asset_index: 0 }),
      row({ box_id: "s", template: V3_OLD, height: 20, token_id: Y, asset_index: 2 }),
      row({ box_id: "s", template: V3_OLD, height: 20, token_id: X, asset_index: 1 }),
    ],
    first
  );
  assert.deepEqual(next.get(T2T_KEY), { kind: "cl-key", height: 20, pair: { x: X, y: Y } });
  // The earlier map is not mutated.
  assert.equal(first.get(T2T_KEY)?.height, 10);
});

test("withLpArt: the token's own artwork always wins; the logo only for ErgoDex liquidity tokens", () => {
  setErgodexLpMap(
    classifyLpRows([row({ box_id: "b1", token_id: KEY, emission: "2", minted_here: true })])
  );
  assert.equal(withLpArt(KEY, null), ERGODEX_LP_ART_URL);
  assert.equal(withLpArt(KEY, ""), ERGODEX_LP_ART_URL);
  assert.equal(withLpArt(KEY.toUpperCase(), undefined), ERGODEX_LP_ART_URL);
  assert.equal(withLpArt(KEY, "ipfs://QmOwnPicture"), "ipfs://QmOwnPicture");
  assert.equal(withLpArt("ff".repeat(32), null), null);
  assert.equal(withLpArt("ff".repeat(32), "https://x/y.png"), "https://x/y.png");
  assert.equal(lpArtSource(KEY, ERGODEX_LP_ART_URL), ERGODEX_LP_ART_SOURCE);
  assert.equal(lpArtSource(KEY, "ipfs://QmOwnPicture"), null);
  assert.equal(lpArtSource("ff".repeat(32), ERGODEX_LP_ART_URL), null);
  assert.deepEqual(ergodexClKeyIds(), [KEY]);
  setErgodexLpMap(new Map());
});

test("nftHeldSql: the «NFT» tab also takes the V3 keys passed as a parameter", () => {
  const bal = nftHeldSql("balance", 4);
  assert.match(bal, /t\.emission = 1/);
  assert.match(bal, /tb\.amount = 1/);
  assert.match(bal, /OR tb\.token_id = ANY\(\$4::text\[\]\)/);
  const boxes = nftHeldSql("boxes", 2);
  assert.match(boxes, /SUM\(ba\.amount\) = 1/);
  assert.match(boxes, /OR ba\.token_id = ANY\(\$2::text\[\]\)/);
  assert.doesNotMatch(boxes, /tb\./);
});

// Live box 139f4d61… (h1914675): the first position box of key 3a797e68…, ERG/SigRSV.
const R4 = "1103a6dfc59bf704ead949a09c01";
const R5_ZERO = "11020000";
const SHELL_PPM_HEAD =
  "10020e2070286f997a21187839b4902d464335eafb14c4c397f846ab0c12193b142fe67d0e20289c9c0e8a394769cf5b9622546e58b263d20dd2504eabdcaa01515bf149da8bd808";
const SHELL_BPS_HEAD =
  "10020e20f5e47f921b32094c0b49f2ca09717b56cbbde827d9c68a2f8f1d2455da3f9c7b0e20289c9c0e8a394769cf5b9622546e58b263d20dd2504eabdcaa01515bf149da8bd808";
const SHELL_EARLY_HEAD = "10010e20473a032ec13894d324970c3e73cf432e103f2257bdf3f8d79f659eca1382691ed807d601";

test("parseCollLong reads a position box's R4 = (vx, vy, fee)", () => {
  assert.deepEqual(parseCollLong(R4), [84720269267n, 603765n, 10000n]);
  assert.deepEqual(parseCollLong(R5_ZERO), [0n, 0n]);
  assert.deepEqual(parseCollLong("1102010b"), [-1n, -6n]);
  assert.equal(parseCollLong("0e0101"), null);
  assert.equal(parseCollLong("1103a6df"), null);
  assert.equal(parseCollLong(null), null);
});

test("fee unit only for validator generations on record", () => {
  assert.equal(
    shellValidatorHash(SHELL_PPM_HEAD),
    "70286f997a21187839b4902d464335eafb14c4c397f846ab0c12193b142fe67d"
  );
  assert.equal(clFeeUnit(SHELL_PPM_HEAD), "ppm");
  assert.equal(clFeeUnit(SHELL_BPS_HEAD), "bps");
  assert.equal(clFeeUnit(SHELL_EARLY_HEAD), null);
  assert.equal(clFeeUnit("0008cd02"), null);
});

test("clCurveFromBox: range and fee of an ERG/token position", () => {
  const curve = clCurveFromBox(
    {
      boxId: "139f4d61",
      valueNano: "10001000000",
      assets: [
        { tokenId: SIGRSV, amount: "93405", index: null },
        { tokenId: KEY, amount: "1", index: null },
      ],
      r4: R4,
      r5: R5_ZERO,
      ergoTree: SHELL_PPM_HEAD,
    },
    KEY
  );
  assert.ok(curve);
  assert.equal(curve.x, null);
  assert.equal(curve.y, SIGRSV);
  // The DEX named this key «CL ERG/SigRSV 5520.2–9200.4» (SigRSV has 0 decimals).
  assert.equal(wholePrice(curve.lowRaw, 9, 0).toFixed(1), "5520.2");
  assert.equal(wholePrice(curve.highRaw, 9, 0).toFixed(1), "9200.4");
  assert.deepEqual(curve.fee, { raw: 10000, unit: "ppm", percent: 1 });
  // Same box under the earliest shell: range yes, fee unknown.
  const early = clCurveFromBox(
    {
      boxId: "x",
      valueNano: "10001000000",
      assets: [{ tokenId: SIGRSV, amount: "93405", index: null }, { tokenId: KEY, amount: "1", index: null }],
      r4: R4,
      r5: null,
      ergoTree: SHELL_EARLY_HEAD,
    },
    KEY
  );
  assert.equal(early?.fee, null);
  // token/token without slot numbers: no curve (X and Y cannot be told apart).
  assert.equal(
    clCurveFromBox(
      {
        boxId: "y",
        valueNano: "1000000",
        assets: [
          { tokenId: TOKEN_B, amount: "5", index: null },
          { tokenId: SIGUSD, amount: "3", index: null },
          { tokenId: KEY, amount: "1", index: null },
        ],
        r4: "1103be0dc0d30302",
        r5: R5_ZERO,
        ergoTree: SHELL_PPM_HEAD,
      },
      KEY
    ),
    null
  );
});

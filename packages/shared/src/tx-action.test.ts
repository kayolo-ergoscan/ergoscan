import assert from "node:assert/strict";
import test from "node:test";
import { pickTxAction } from "./tx-action.js";
import { MINERS_FEE_TREE } from "./tx-shape.js";

const POOL = "416babd63f0154df53b3b2f58891fa275048309978b1a1bde7e312f4f13bf2be";
const DATAPOINT = "fcbf6946412dbc9528b24d134c58c8f06c15cb84b13f38e59caf9fe1bd9ba764";
const SPECTRUM = "83d0e88be351507dde3d6adef042c380af82072fb791ae5c5d4e3b711fd3b4cd";

test("refresh outranks a datapoint spent in the same tx", () => {
  const action = pickTxAction(
    {
      inputs: [{ templateHash: DATAPOINT }, { templateHash: POOL }],
      outputs: [],
    },
    "contract"
  );
  assert.equal(action, "oracle-refresh");
});

test("a datapoint spend is named when the pool box is not spent", () => {
  const action = pickTxAction(
    { inputs: [{ templateHash: DATAPOINT }], outputs: [{ templateHash: POOL }] },
    "contract"
  );
  assert.equal(action, "oracle-datapoint");
});

test("paying into a known script uses the output template", () => {
  const action = pickTxAction(
    { inputs: [{ ergoTree: "0008cd" }], outputs: [{ templateHash: SPECTRUM }] },
    "script-pay"
  );
  assert.equal(action, "spectrum-swap");
});

test("fee collection and an unknown hash stay unnamed", () => {
  assert.equal(
    pickTxAction(
      { inputs: [{ ergoTree: MINERS_FEE_TREE }], outputs: [{ address: "88abc" }] },
      "fee-collect"
    ),
    null
  );
  assert.equal(
    pickTxAction({ inputs: [{ templateHash: "ab".repeat(32) }], outputs: [] }, "contract"),
    null
  );
});

const N2T_POOL = "2dcc7830afe8f355b945850c60ff2b41fdb3e8ade07fde0a7c8a3ec498e8c3f6";
const NFT = "11".repeat(32);
const LP = "22".repeat(32);
const Y = "33".repeat(32);
const pool = (lp: string, y: string) => ({
  templateHash: N2T_POOL,
  // token order in a stored box is not trusted: LP first on purpose
  assets: [
    { tokenId: LP, amount: lp },
    { tokenId: Y, amount: y },
    { tokenId: NFT, amount: "1" },
  ],
});

test("the live ERG/token pool template is an ErgoDex swap when LP stays", () => {
  const action = pickTxAction(
    { inputs: [pool("9223372036000000000", "500"), { address: "9user" }], outputs: [pool("9223372036000000000", "400")] },
    "contract"
  );
  assert.equal(action, "spectrum-swap");
});

test("LP leaving the pool is a deposit, LP coming back is a redeem", () => {
  assert.equal(
    pickTxAction(
      { inputs: [pool("9223372036000000000", "500")], outputs: [pool("9223372035000000000", "600")] },
      "contract"
    ),
    "pool-deposit"
  );
  assert.equal(
    pickTxAction(
      { inputs: [pool("9223372035000000000", "600")], outputs: [pool("9223372036000000000", "500")] },
      "contract"
    ),
    "pool-redeem"
  );
});

test("a big 18-decimal reserve does not turn a swap into a deposit", () => {
  const action = pickTxAction(
    {
      inputs: [pool("9223372036000000000", "5000000000000000000")],
      outputs: [pool("9223372036000000000", "4000000000000000000")],
    },
    "contract"
  );
  assert.equal(action, "spectrum-swap");
});

test("oracle v1: live epoch is a rate update, v1 datapoint is a price post, not SigmaUSD", () => {
  assert.equal(
    pickTxAction(
      { inputs: [{ templateHash: "19e4db35624440663cff2f557a32bc714180a199b9cf4cf52910349e7419c180" }], outputs: [] },
      "contract"
    ),
    "oracle-refresh"
  );
  assert.equal(
    pickTxAction(
      { inputs: [{ templateHash: "6c4c6cd7754877bc3b3e590209d8c8fa1c70303140cfdf62071c433956037a50" }], outputs: [] },
      "contract"
    ),
    "oracle-datapoint"
  );
});

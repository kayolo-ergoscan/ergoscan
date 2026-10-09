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

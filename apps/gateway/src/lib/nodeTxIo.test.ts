import assert from "node:assert/strict";
import { test } from "node:test";
import { orderByBoxIds, parseNodeTxIo, pickByBoxIds } from "./nodeTxIo.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const TX = "e".repeat(64);

test("orderByBoxIds: node order wins, unknown rows keep their order at the end", () => {
  const rows = [{ boxId: A }, { boxId: B }, { boxId: C }, { boxId: D }];
  assert.deepEqual(
    orderByBoxIds(rows, [C, A, B]).map((r) => r.boxId),
    [C, A, B, D]
  );
  assert.deepEqual(orderByBoxIds(rows, null).map((r) => r.boxId), [A, B, C, D]);
  assert.deepEqual(orderByBoxIds(rows, [C.toUpperCase(), A]).map((r) => r.boxId), [C, A, B, D]);
});

test("parseNodeTxIo: ids in order, data inputs optional, wrong tx rejected", () => {
  const body = { id: TX, inputs: [{ boxId: B, value: 1 }, { boxId: A }], dataInputs: [{ boxId: C }] };
  assert.deepEqual(parseNodeTxIo(TX, body), { inputs: [B, A], dataInputs: [C] });
  assert.deepEqual(parseNodeTxIo(TX, { id: TX, inputs: [{ boxId: A }] }), { inputs: [A], dataInputs: [] });
  assert.equal(parseNodeTxIo(TX, { ...body, id: A }), null);
  assert.equal(parseNodeTxIo(TX, { id: TX, inputs: [{ boxId: "zz" }] }), null);
  assert.equal(parseNodeTxIo(TX, null), null);
});

test("pickByBoxIds keeps the node order and repeated data inputs", () => {
  const rows = [{ boxId: B }, { boxId: A }, { boxId: C }];
  assert.deepEqual(pickByBoxIds(rows, [A, B, A, C, D]).map((r) => r.boxId), [A, B, A, C]);
  assert.deepEqual(orderByBoxIds([{ boxId: A }, { boxId: B }], [B, A, B]).map((r) => r.boxId), [B, A]);
});

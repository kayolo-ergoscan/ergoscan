import assert from "node:assert/strict";
import test from "node:test";
import { rankPriceTape } from "./price-tape.js";

const id = (n: number) => n.toString(16).padStart(64, "0");

test("price tape leads with the strongest day gain among tokens that traded", () => {
  const tape = rankPriceTape([
    { token_id: id(1), symbol: "QUIET", price_erg: 1.8, vol24: 0, tvl_erg: 9_000, prev_erg: 1 },
    { token_id: id(2), symbol: "BUSY", price_erg: 1.02, vol24: 100, tvl_erg: 80, prev_erg: 1 },
    { token_id: id(3), symbol: "BIG", price_erg: 1.5, vol24: 1, tvl_erg: 10, prev_erg: 1 },
    { token_id: id(4), symbol: "DOWN", price_erg: 0.95, vol24: 50, tvl_erg: 40, prev_erg: 1 },
    { token_id: id(5), symbol: "WARM", price_erg: 1, vol24: 12, tvl_erg: 80, prev_erg: null },
  ]);
  assert.deepEqual(
    tape.map((row) => row.symbol),
    ["BIG", "BUSY", "DOWN", "WARM"]
  );
  assert.ok((tape[0]?.changePct ?? 0) > 0);
  assert.ok((tape[2]?.changePct ?? 0) < 0);
});

test("price tape drops a nameless row and a broken mark", () => {
  const tape = rankPriceTape([
    { token_id: id(4), symbol: "  ", price_erg: 1, vol24: 5, tvl_erg: 5, prev_erg: 1 },
    { token_id: id(5), symbol: "BAD", price_erg: 1e7, vol24: 9, tvl_erg: 9, prev_erg: 1 },
    { token_id: "zz", symbol: "NO", price_erg: 1, vol24: 9, tvl_erg: 9, prev_erg: 1 },
    { token_id: id(6), symbol: "OK", price_erg: 3, vol24: 1, tvl_erg: 1, prev_erg: 2 },
    { token_id: id(7), symbol: "WILD", price_erg: 1, vol24: 2, tvl_erg: 2, prev_erg: 1e-9 },
    { token_id: id(8), symbol: "ALSO", price_erg: 2, vol24: 1, tvl_erg: 1, prev_erg: 1 },
  ]);
  assert.deepEqual(
    tape.map((row) => row.symbol),
    ["ALSO", "OK", "WILD"]
  );
  assert.equal(tape[0]?.changePct, 100);
  assert.equal(tape[1]?.changePct, 50);
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { meaningRow, sayMeaning, type CompactMeaning, type TxMeaning } from "@ergoscan/shared";
import { foldServiceRows, isTxFold, meaningTile, parseMeaning, type TxFold } from "./tx-meaning-row";

const ACTOR = "9fYVe8FpdUEZRwmVgDtFGbhB3JBSoNYVx8f7U3cYofrcUBYreou";
const RSN = "8b08cdd5449a9592a9e79711d7d79249d7a03c535d17efaee83e216e80a44c4b";

const SWAP_FULL: TxMeaning = {
  v: 1,
  action: "swap",
  family: "defi",
  service: false,
  protocol: "ergodex",
  conf: "exact",
  actor: ACTOR,
  counterparty: null,
  gave: [{ token: null, amount: "6730000000", name: "ERG", decimals: 9 }],
  got: [{ token: RSN, amount: "13236", name: "RSN", decimals: 2 }],
  fee: { payer: ACTOR, nano: "2000000" },
  venues: ["ErgoDex"],
  extra: [],
  secondary: [],
  why: [{ k: "pool" }],
  rule: "pools",
  say: { ru: "x", en: "x" },
};

describe("tx meaning rows: parseMeaning", () => {
  it("keeps the list form as it came", () => {
    const c: CompactMeaning = { v: 1, action: "send", conf: "flow", actor: ACTOR, gave: [{ amount: "5" }] };
    assert.deepEqual(parseMeaning(c), c);
  });

  it("turns the full form (a tx endpoint, favorites) into the list form", () => {
    const c = parseMeaning(SWAP_FULL)!;
    assert.equal(c.action, "swap");
    assert.equal(c.protocol, "ergodex");
    assert.equal(c.conf, undefined, "exact is the default and is left out");
    assert.deepEqual(c.gave, [{ amount: "6730000000" }]);
    assert.deepEqual(c.got, [{ token: RSN, amount: "13236", name: "RSN", decimals: 2 }]);
    assert.equal(c.feePayer, undefined, "the actor paid its own fee");
    assert.equal("say" in c, false);
    assert.equal(sayMeaning(c, "ru"), sayMeaning(SWAP_FULL, "ru"));
    assert.deepEqual(meaningRow(c, "en"), meaningRow(SWAP_FULL, "en"));
  });

  it("drops anything that is not a meaning", () => {
    for (const bad of [null, undefined, 3, "swap", [], {}, { action: "swap" }, { v: 1, action: "teleport" }, { v: "1", action: "send" }]) {
      assert.equal(parseMeaning(bad), undefined, JSON.stringify(bad));
    }
    // A prototype key is not an action.
    assert.equal(parseMeaning({ v: 1, action: "toString" }), undefined);
  });
});

describe("tx meaning rows: tiles", () => {
  it("colours by the action's family", () => {
    assert.deepEqual(meaningTile({ action: "send" }), ["transfer", "transfer"]);
    assert.deepEqual(meaningTile({ action: "swap", protocol: "ergodex" }), ["defi", "swap"]);
    assert.deepEqual(meaningTile({ action: "block-reward" }), ["reward", "reward"]);
    assert.deepEqual(meaningTile({ action: "fee-collect" }), ["reward", "fee"]);
    assert.deepEqual(meaningTile({ action: "oracle-post", protocol: "oracle" }), ["oracle", "oracle"]);
    assert.deepEqual(meaningTile({ action: "bridge-in", protocol: "rosen" }), ["bridge", "bridge"]);
    assert.deepEqual(meaningTile({ action: "consolidate" }), ["quiet", "merge"]);
  });

  it("an oracle's upkeep stays an oracle tile, other upkeep is quiet", () => {
    assert.deepEqual(meaningTile({ action: "service", protocol: "oracle" }), ["oracle", "oracle"]);
    assert.deepEqual(meaningTile({ action: "service", protocol: "rosen" }), ["quiet", "protocol"]);
  });

  it("an unknown contract is a contract tile whatever the action", () => {
    assert.deepEqual(meaningTile({ action: "to-contract", conf: "unknown" }), ["contract", "contract"]);
    assert.deepEqual(meaningTile({ action: "send", conf: "unknown" }), ["contract", "contract"]);
  });
});

type Row = { id: string; day: string; action?: CompactMeaning["action"] };

function rows(spec: string): Row[] {
  // "d1:send d1:oracle-post d2:block-reward" → rows in that order.
  return spec.split(/\s+/).map((s, i) => {
    const [day, action] = s.split(":");
    return { id: `t${i}`, day: day!, action: (action || undefined) as Row["action"] };
  });
}

function fold(items: Row[], open: string[] = [], min?: number) {
  return foldServiceRows(items, {
    dayOf: (r) => r.day,
    actionOf: (r) => r.action,
    isOpen: (d) => open.includes(d),
    min,
  });
}

function ids(out: Array<Row | TxFold<Row>>): string[] {
  return out.map((x) => (isTxFold(x) ? `[${x.day}:${x.rows.length}]` : x.id));
}

describe("tx meaning rows: service fold", () => {
  const tape = rows(
    "d1:send d1:oracle-post d1:oracle-post d1:swap d1:block-reward d1:fee-collect d1:oracle-update d1:service d2:oracle-post d2:send d3:block-reward d3:fee-collect d3:"
  );

  it("closed: one summary per day where the first machine row was, the rest gone", () => {
    assert.deepEqual(ids(fold(tape)), ["t0", "[d1:6]", "t3", "t8", "t9", "[d3:2]", "t12"]);
  });

  it("a day with one machine row keeps it as a row", () => {
    const out = fold(tape);
    assert.ok(out.some((x) => !isTxFold(x) && x.id === "t8"));
    assert.ok(!out.some((x) => isTxFold(x) && x.day === "d2"));
  });

  it("open: the summary stays and every row is back in its place", () => {
    assert.deepEqual(ids(fold(tape, ["d1"])), [
      "t0",
      "[d1:6]",
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
      "t9",
      "[d3:2]",
      "t12",
    ]);
    const f = fold(tape, ["d1"]).find(isTxFold)!;
    assert.equal(f.open, true);
    assert.equal(f.key, "fold:d1");
  });

  it("counts most first, ties in the vocabulary's order", () => {
    const f = fold(tape).find((x): x is TxFold<Row> => isTxFold(x) && x.day === "d1")!;
    assert.deepEqual(f.counts, [
      ["oracle-post", 2],
      ["block-reward", 1],
      ["fee-collect", 1],
      ["oracle-update", 1],
      ["service", 1],
    ]);
    const d3 = fold(tape).find((x): x is TxFold<Row> => isTxFold(x) && x.day === "d3")!;
    assert.deepEqual(d3.counts, [
      ["block-reward", 1],
      ["fee-collect", 1],
    ]);
  });

  it("people's rows never fold, rows without a meaning stay", () => {
    const people = rows("d1:send d1:swap d1:multisend d1:miner-payout d1:payout d1:contract-call d1:");
    assert.deepEqual(ids(fold(people)), ["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("min sets how many machine rows a day needs before it folds", () => {
    assert.deepEqual(ids(fold(tape, [], 3)), ["t0", "[d1:6]", "t3", "t8", "t9", "t10", "t11", "t12"]);
    assert.deepEqual(ids(fold(rows("d1:oracle-post"), [], 1)), ["[d1:1]"]);
  });

  it("the plate count stays the number of txs, folded or not", () => {
    const size = (x: Row | TxFold<Row>) => (isTxFold(x) ? (x.open ? 0 : x.rows.length) : 1);
    const sum = (out: Array<Row | TxFold<Row>>) => out.reduce((n, x) => n + size(x), 0);
    assert.equal(sum(fold(tape)), tape.length);
    assert.equal(sum(fold(tape, ["d1", "d3"])), tape.length);
  });
});

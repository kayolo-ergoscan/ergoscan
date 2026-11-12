import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MeaningActionId } from "@ergoscan/shared";
import { FILL_MAX_PACKS, FILL_ROWS, appendPack, isHumanRow, keysetAfter, mergeHead, shouldFill, trimToFill } from "./tx-tape-fill";

type Row = { id: string; inclusionHeight: number | null; index: number | null; meaning?: { action: MeaningActionId } };

let seq = 0;
/** "s s o r f" → rows newest first: s = send (a person), o = oracle post, r = block reward, f = fee collect, - = no meaning. */
function rows(spec: string, height = 1000): Row[] {
  const map: Record<string, MeaningActionId | undefined> = { s: "send", w: "swap", o: "oracle-post", u: "oracle-update", r: "block-reward", f: "fee-collect", "-": undefined };
  return spec.split(/\s+/).filter(Boolean).map((c, i) => {
    const action = map[c];
    const id = `t${seq++}`;
    return { id, inclusionHeight: height, index: 100 - i, ...(action ? { meaning: { action } } : {}) };
  });
}

describe("tx tape fill: what counts", () => {
  it("rows people made: anything that does not fold, rows without a meaning too", () => {
    const [s, w, o, u, r, f, none] = rows("s w o u r f -");
    assert.deepEqual([s, w, o, u, r, f, none].map((x) => isHumanRow(x!)), [true, true, false, false, false, false, true]);
  });

  it("fills while too few rows show, more exist and packs are left", () => {
    const base = { visible: 3, packs: 1, hasMore: true, busy: false, failed: false };
    assert.equal(shouldFill(base), true);
    assert.equal(shouldFill({ ...base, visible: FILL_ROWS }), false, "enough rows");
    assert.equal(shouldFill({ ...base, visible: FILL_ROWS - 1 }), true);
    assert.equal(shouldFill({ ...base, packs: FILL_MAX_PACKS }), false, "150 txs read");
    assert.equal(shouldFill({ ...base, packs: FILL_MAX_PACKS - 1 }), true);
    assert.equal(shouldFill({ ...base, hasMore: false }), false, "end of chain");
    assert.equal(shouldFill({ ...base, busy: true }), false, "one request at a time");
    assert.equal(shouldFill({ ...base, failed: true }), false, "an error stops it");
  });

  it("the live case: 3 people's rows a pack fills in 4 packs, 2 a pack stops at 6", () => {
    // Pack after pack, as the view does it.
    const run = (perPack: number[]) => {
      let visible = 0;
      let packs = 0;
      for (const n of perPack) {
        visible += n;
        packs++;
        if (!shouldFill({ visible, packs, hasMore: true, busy: false, failed: false })) break;
      }
      return { visible, packs };
    };
    assert.deepEqual(run([3, 2, 4, 12, 6, 5]), { visible: 21, packs: 4 });
    assert.deepEqual(run([2, 2, 2, 2, 2, 2, 2]), { visible: 12, packs: 6 });
    assert.deepEqual(run([22]), { visible: 22, packs: 1 });
  });
});

describe("tx tape fill: packs and cursors", () => {
  it("a pack goes under the page without an id twice", () => {
    const a = rows("s o o");
    const b = rows("s r");
    const out = appendPack(a, [a[2]!, ...b, b[0]!]);
    assert.deepEqual(out.map((r) => r.id), [...a, ...b].map((r) => r.id));
    assert.notEqual(appendPack(a, []), a, "a new array, the state changes");
  });

  it("the cursor after a row is the gateway's keyset", () => {
    assert.equal(keysetAfter({ id: "abc", inclusionHeight: 1915431, index: 8 }), "1915431:8:abc");
    assert.equal(keysetAfter({ id: "abc", inclusionHeight: null, index: null }), "-1:-1:abc");
  });

  it("a new block's head goes on top of a filled page", () => {
    const old = rows("s o o s r f o s");
    const head = [...rows("o s", 1001), ...old.slice(0, 3)];
    const merged = mergeHead(old, head)!;
    assert.deepEqual(merged.map((r) => r.id), [...head, ...old.slice(3)].map((r) => r.id));
  });

  it("a head that does not reach the old rows means a fresh fill", () => {
    const old = rows("s o s");
    assert.equal(mergeHead(old, rows("o o s", 1002)), null);
    assert.equal(mergeHead(old, []), null);
  });

  it("a page stays about the same size block after block", () => {
    // 30 rows, people's rows every third: the 20th person's row is row 60, so all 30 stay.
    const sparse = rows(Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? "s" : "o")).join(" "));
    assert.deepEqual(trimToFill(sparse), { rows: sparse, cut: false });
    // 60 rows of people: 25 stay (never shorter than a pack).
    const dense = rows(Array.from({ length: 60 }, () => "s").join(" "));
    const d = trimToFill(dense);
    assert.equal(d.rows.length, 25);
    assert.equal(d.cut, true);
    // 20 people among the first 40 rows: cut right after the 20th.
    const mixed = rows(Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? "s" : "r")).join(" "));
    const m = trimToFill(mixed);
    assert.equal(m.rows.length, 39);
    assert.equal(m.rows.filter(isHumanRow).length, 20);
  });
});

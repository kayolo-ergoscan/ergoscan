import { test } from "node:test";
import assert from "node:assert/strict";
import { builtAt, sealPlan, storeyTimes, type CityBlock, type Fees, type Scene, type YardTx } from "./home-city/common";
import { bodyHeight, cityGeo, drawCity, floorH, frontW, gapPx, storeysUp } from "./home-city/city";
import { feeLevels, feeZone } from "./home-city/load";
import { H_MAX, W_MAX, crateH, feeOrder, sizeIdx, sizesFor, yardLayout, yardStack } from "./home-city/yard";
import { momentLength, momentPlays, sealMatch, sealStoreys, sealTargets, sealYard, waitingShown } from "./home-city/moment";

/* ---------- fixtures ---------- */

let seq = 0;
function tx(feeRate: number, size = 400, o: Partial<YardTx> = {}): YardTx {
  seq++;
  return { id: o.id ?? `t${String(seq).padStart(5, "0")}`, size, fee: feeRate * size, feeRate, color: "#38bdf8", category: "transfer", firstSeen: seq, ...o };
}

function block(height: number, txCount: number, size = 4000, ts = height * 120_000): CityBlock {
  return { id: `b${height}`, height, ts, txCount, size, flag: null, lithos: false, txs: null };
}

function scene(txs: YardTx[], count = txs.length, fees: Fees | null = null, blocks: CityBlock[] = []): Scene {
  return { blocks, mem: { count, txs }, fees, now: 0, avgBlockMs: 120_000 };
}

/** The gateway formula (packages/shared buildFeeHistogram), written out again on its own. */
function gatewayLevels(rates: number[]): Fees {
  const s = [...rates].sort((a, b) => a - b);
  return { normal: Math.floor(s[Math.floor(s.length * 0.5)]!), turbo: Math.floor(s[Math.floor(s.length * 0.9)]!) };
}

const DESK = { w: 760, h: 116 };
const PHONE = { w: 340, h: 116 };

/** Every pool size the yard must hold: a quiet chain, the usual, a busy hour, a surge past the 80 the stream keeps. */
const LOADS = [0, 1, 3, 23, 50, 80, 120, 400, 2500];

function poolOf(n: number): { txs: YardTx[]; count: number } {
  const held = Math.min(n, 80);
  const txs = Array.from({ length: held }, (_, i) => tx(1000 + ((i * 7919) % 97) * 37, [150, 500, 1500, 6000][i % 4]));
  return { txs, count: n };
}

/* ---------- the yard ---------- */

test("yard: every waiting tx is a crate or counted on the wrap, exactly", () => {
  for (const vp of [DESK, PHONE])
    for (const n of LOADS) {
      const { txs, count } = poolOf(n);
      const fees = txs.length ? gatewayLevels(txs.map((t) => t.feeRate)) : null;
      const lay = yardLayout(vp.w, vp.h, scene(txs, count, fees));
      const ids = new Set(lay.crates.map((c) => c.tx.id));
      assert.equal(ids.size, lay.crates.length, `no tx twice (${vp.w}, ${n})`);
      assert.equal(lay.crates.length + (lay.plus?.n ?? 0), count, `shown + wrap = count (${vp.w}, ${n})`);
      if (lay.plus) assert.ok(lay.plus.n > 0);
    }
});

test("yard: nothing leaves the lot, stacks stay under the floodlight", () => {
  for (const vp of [DESK, PHONE])
    for (const n of LOADS) {
      const { txs, count } = poolOf(n);
      const lay = yardLayout(vp.w, vp.h, scene(txs, count, txs.length ? gatewayLevels(txs.map((t) => t.feeRate)) : null));
      const left = vp.w < 420 ? 4 : 6;
      const stack = yardStack(vp.w < 420);
      for (const c of lay.crates) {
        assert.ok(c.x >= left && c.x + c.w <= lay.right, `crate inside x (${vp.w}, ${n})`);
        assert.ok(c.y >= lay.ground - 2 - stack && c.y + c.h <= lay.ground - 2, `crate inside y (${vp.w}, ${n})`);
      }
      for (const p of lay.pallets) assert.ok(p.x >= left && p.x + p.w <= lay.right);
      if (lay.plus) {
        assert.ok(lay.plus.x + lay.plus.w <= lay.right, `wrap inside (${vp.w}, ${n})`);
        assert.ok(lay.plus.h <= stack);
      }
      assert.ok(lay.right <= vp.w);
    }
});

test("yard: stacks are never taller than H_MAX and a pallet holds one fee zone", () => {
  const { txs } = poolOf(80);
  const fees = gatewayLevels(txs.map((t) => t.feeRate));
  for (const vp of [DESK, PHONE]) {
    const lay = yardLayout(vp.w, vp.h, scene(txs, 80, fees));
    const per = new Map<number, Set<number>>();
    const height = new Map<number, number>();
    for (const c of lay.crates) {
      if (!per.has(c.pallet)) per.set(c.pallet, new Set());
      per.get(c.pallet)!.add(feeZone(c.tx.feeRate, fees));
      height.set(c.pallet, (height.get(c.pallet) ?? 0) + 1);
      assert.equal(c.zone, feeZone(c.tx.feeRate, fees));
    }
    for (const z of per.values()) assert.equal(z.size, 1, "one zone per pallet");
    for (const n of height.values()) assert.ok(n <= H_MAX);
  }
});

test("yard: fee order, best payers on the left, zones run Turbo → Normal → below", () => {
  const txs = [tx(900), tx(5000), tx(1200), tx(5000), tx(3000), tx(1100), tx(1000), tx(950), tx(4000), tx(1300)];
  const fees = gatewayLevels(txs.map((t) => t.feeRate));
  const lay = yardLayout(DESK.w, DESK.h, scene(txs, txs.length, fees));
  const byPallet = [...lay.pallets].map((p, i) => ({ x: p.x, zone: p.zone, rates: lay.crates.filter((c) => c.pallet === i).map((c) => c.tx.feeRate) }));
  for (let i = 1; i < byPallet.length; i++) {
    assert.ok(byPallet[i]!.x > byPallet[i - 1]!.x);
    assert.ok(Math.min(...byPallet[i - 1]!.rates) >= Math.max(...byPallet[i]!.rates), "a pallet on the left pays at least what the next one does");
    assert.ok(byPallet[i]!.zone <= byPallet[i - 1]!.zone);
  }
  // Equal rates: arrival, then id, so the order never flickers.
  const a = tx(2000, 400, { firstSeen: 5, id: "b" });
  const b = tx(2000, 400, { firstSeen: 5, id: "a" });
  assert.ok(feeOrder(b, a) < 0);
  assert.ok(feeOrder(tx(3000), tx(2000)) < 0);
});

test("yard: the quiet chain gets big crates in low stacks, a surge smaller and higher ones", () => {
  const few = poolOf(3);
  const busy = poolOf(80);
  const l1 = yardLayout(DESK.w, DESK.h, scene(few.txs, 3, gatewayLevels(few.txs.map((t) => t.feeRate))));
  const l2 = yardLayout(DESK.w, DESK.h, scene(busy.txs, 400, gatewayLevels(busy.txs.map((t) => t.feeRate))));
  assert.ok(l1.level < l2.level, "a bigger pool takes a smaller level");
  assert.equal(l1.plus, null);
  assert.equal(l2.plus?.n, 400 - l2.crates.length);
});

test("yard: a quiet pool fills the lot in big crates; they shrink a pixel at a time as it grows", () => {
  for (const vp of [DESK, PHONE]) {
    const small = vp.w < 420;
    let prevW = Infinity;
    let prevLevel = -1;
    const widths: number[] = [];
    for (let n = 1; n <= 80; n++) {
      const { txs } = poolOf(n);
      const lay = yardLayout(vp.w, vp.h, scene(txs, n, gatewayLevels(txs.map((t) => t.feeRate))));
      const W = Math.max(...lay.crates.map((c) => c.w));
      widths.push(W);
      assert.ok(lay.level >= prevLevel, `level never goes back as the pool grows (${vp.w}, ${n})`);
      prevLevel = lay.level;
      prevW = Math.min(prevW, W);
    }
    // Five to twenty waiting txs stand in crates at least three fifths of the biggest.
    for (const n of [5, 12, 20]) assert.ok(widths[n - 1]! >= Math.round((small ? W_MAX.phone : W_MAX.desk) * 0.6), `big crates at ${n} (${vp.w}): ${widths[n - 1]}`);
  }
  assert.deepEqual(sizesFor(24), [14, 17, 20, 24]);
  assert.deepEqual(sizesFor(7), [4, 5, 6, 7]);
});

test("yard: crate size classes and heights", () => {
  assert.equal(sizeIdx(100), 0);
  assert.equal(sizeIdx(500), 1);
  assert.equal(sizeIdx(2000), 2);
  assert.equal(sizeIdx(9000), 3);
  assert.equal(crateH(24), 22);
  assert.equal(crateH(5), 4);
});

test("yard: an empty pool draws no crates and no wrap", () => {
  const lay = yardLayout(DESK.w, DESK.h, scene([], 0, null));
  assert.equal(lay.crates.length, 0);
  assert.equal(lay.plus, null);
  assert.deepEqual(lay.spans, []);
});

/* ---------- fee levels ---------- */

test("fee levels: the gateway formula, zones against it", () => {
  const rates = [800, 1000, 1000, 1200, 1500, 2000, 2500, 3000, 9000, 12000];
  assert.deepEqual(feeLevels(rates), gatewayLevels(rates));
  assert.deepEqual(feeLevels([1000.7]), { normal: 1000, turbo: 1000 });
  assert.equal(feeLevels([]), null);
  const f = { normal: 1000, turbo: 3000 };
  assert.equal(feeZone(3000, f), 2);
  assert.equal(feeZone(2999, f), 1);
  assert.equal(feeZone(1000, f), 1);
  assert.equal(feeZone(999, f), 0);
  assert.equal(feeZone(1, null), 1, "no levels: no marks, all one zone");
});

/* ---------- the city ---------- */

test("city: width grows with bytes (log), gaps with the real interval, both clamped", () => {
  assert.equal(frontW(200, false), 18);
  assert.equal(frontW(300, false), 18);
  assert.equal(frontW(1200, false), 28);
  assert.equal(frontW(9600, false), 43);
  assert.equal(frontW(10_000_000, false), 48, "the 6-step cap");
  assert.equal(frontW(300, true), 12);
  assert.equal(frontW(10_000_000, true), 30);
  for (let s = 300; s < 2_000_000; s *= 1.7) assert.ok(frontW(s * 1.7, false) >= frontW(s, false));
  assert.equal(gapPx(0, false), 4);
  assert.equal(gapPx(120_000, false), 24);
  assert.equal(gapPx(30 * 60_000, false), 44);
  assert.equal(gapPx(120_000, true), 10);
  assert.equal(gapPx(30 * 60_000, true), 22);
});

test("city: one storey height for the street, the tallest sets it", () => {
  assert.equal(floorH(1, false), 7);
  assert.equal(floorH(1, true), 6);
  assert.equal(floorH(20, false), 4);
  assert.equal(floorH(500, false), 3, "never thinner than 3 px");
  assert.equal(storeysUp(0, 4), 0);
  assert.equal(storeysUp(1, 4), 5, "the lobby is at least 5 px");
  assert.equal(storeysUp(3, 4), 13);
  const g = cityGeo(DESK.w, DESK.h, [block(10, 4), block(9, 16), block(8, 1)]);
  assert.ok(g.towers.every((t) => t.fh === g.fh));
  assert.equal(g.fh, floorH(16, false));
});

test("city: a tower taller than the card is cut at the ceiling", () => {
  const g = cityGeo(DESK.w, DESK.h, [block(10, 400), block(9, 3)]);
  const big = g.towers[0]!;
  const small = g.towers[1]!;
  const b1 = bodyHeight(g, big, big.floors);
  const b2 = bodyHeight(g, small, small.floors);
  assert.equal(b1.cut, true);
  assert.equal(b1.h, g.ground - g.ceil);
  assert.equal(b2.cut, false);
  assert.ok(b2.h < b1.h);
});

test("city: newest stands next to the site, older ones to the left, real gaps between", () => {
  const blocks = [block(12, 5, 4000, 1_000_000), block(11, 2, 1000, 880_000), block(10, 9, 9000, 400_000)];
  const g = cityGeo(DESK.w, DESK.h, blocks);
  assert.equal(g.towers.length, 3);
  const [a, b, c] = g.towers as [(typeof g.towers)[0], (typeof g.towers)[0], (typeof g.towers)[0]];
  assert.ok(a.x + a.fw + a.d <= g.siteX);
  assert.ok(b.x + b.fw + b.d <= a.x - a.gapPx);
  assert.equal(a.gapMs, 120_000);
  assert.equal(b.gapMs, 480_000);
  assert.ok(b.gapPx > a.gapPx);
  assert.ok(c.x < b.x);
  // An empty block is a kiosk: one storey, the lobby.
  const k = cityGeo(DESK.w, DESK.h, [block(5, 0, 300)]);
  assert.equal(k.towers[0]!.floors, 1);
});

test("city: the street fills the card and stops past its left edge", () => {
  const many = Array.from({ length: 40 }, (_, i) => block(100 - i, 3, 2000, (100 - i) * 120_000));
  const g = cityGeo(DESK.w, DESK.h, many);
  assert.ok(g.towers.length < 40);
  const last = g.towers[g.towers.length - 1]!;
  assert.ok(last.x - last.gapPx < 0, "the oldest drawn tower reaches the left edge");
  const p = cityGeo(PHONE.w, PHONE.h, many);
  assert.equal(p.small, true);
  assert.ok(p.siteX + p.siteW <= p.mastX);
});

/* ---------- the moment ---------- */

test("moment: exactly the block's txs that wait in the yard leave, in block order", () => {
  const y = [tx(1000, 400, { id: "a" }), tx(2000, 400, { id: "b" }), tx(3000, 400, { id: "c" }), tx(4000, 400, { id: "d" })];
  assert.deepEqual(sealMatch(["coinbase", "c", "x", "a", "a", "fee"], y), ["c", "a"]);
  assert.deepEqual(sealMatch([], y), [], "an empty block takes nothing");
  assert.deepEqual(sealMatch(["q", "r"], y), [], "txs the yard never held are not taken");
  assert.deepEqual(sealTargets(["coinbase", "c", "x", "a", "fee"], ["c", "a"]), [1, 3]);
});

test("moment: storeys keep the crate's kind, others take the block read's", () => {
  const y = [tx(1000, 400, { id: "a", color: "#f472b6", category: "swap" })];
  const read = [
    { color: "#34d399", category: "coinbase" },
    { color: "#000000", category: "transfer" },
    { color: "#4ade80", category: "fee-collect" },
  ];
  const s = sealStoreys(["cb", "a", "fee"], y, read);
  assert.deepEqual(s.kinds, ["coinbase", "yard", "fee-collect"]);
  assert.deepEqual(s.txs[1], { color: "#f472b6", category: "swap" });
  assert.deepEqual(s.txs[2], { color: "#4ade80", category: "fee-collect" });
  const bare = sealStoreys(["cb", "a", "z"], y, null);
  assert.deepEqual(bare.kinds, ["", "yard", ""]);
});

test("moment: storeys rise in order and never come down, the block is built when the last lands", () => {
  const kinds = ["coinbase", "yard", "", "yard", "yard", "", "fee-collect"];
  const times = storeyTimes(kinds, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i]! >= times[i - 1]!, "non-decreasing");
  const plan = sealPlan(3);
  assert.equal(times[1], plan.land(0));
  assert.equal(times[4], plan.land(2));
  assert.equal(times[6], plan.closed - 120);
  assert.equal(builtAt(kinds, 7, 0, 3).built, 0);
  assert.equal(builtAt(kinds, 7, plan.closed, 3).built, 7);
  let prev = 0;
  for (let ms = 0; ms <= plan.end; ms += 16) {
    const b = builtAt(kinds, 7, ms, 3).built;
    assert.ok(b >= prev);
    prev = b;
  }
  // An empty block: the kiosk stands at once, takes no crate.
  assert.equal(builtAt([], 0, 300, 0).built, 1);
});

test("moment: about 4 s whatever the block, then over", () => {
  for (const n of [0, 1, 5, 20, 80, 400]) {
    const ms = momentLength(n);
    assert.ok(ms >= 2000 && ms <= 4200, `n=${n}: ${ms}`);
    const p = sealPlan(n);
    assert.ok(p.built <= p.closed && p.closed <= p.slideFrom && p.slideTo <= p.end);
    if (n > 0) assert.ok(p.land(n - 1) <= p.built);
  }
});

test("moment: plays only when it can be seen and the block is new", () => {
  assert.equal(momentPlays({ reduce: false, visible: true, height: 11, newest: 10 }), true);
  assert.equal(momentPlays({ reduce: true, visible: true, height: 11, newest: 10 }), false, "reduced motion: final frame");
  assert.equal(momentPlays({ reduce: false, visible: false, height: 11, newest: 10 }), false, "hidden tab: no replay");
  assert.equal(momentPlays({ reduce: false, visible: true, height: 10, newest: 10 }), false, "not newer than the street");
  assert.equal(momentPlays({ reduce: false, visible: true, height: 11, newest: null }), true);
});

test("moment: the yard count holds the crates the crane has not lifted yet", () => {
  const plan = sealPlan(3);
  const ids = ["a", "b", "c"];
  const empty = new Set<string>();
  assert.equal(waitingShown({ streamCount: 10, ids, ms: 0, inStream: empty }), 13);
  assert.equal(waitingShown({ streamCount: 10, ids, ms: plan.depart(1), inStream: empty }), 11);
  assert.equal(waitingShown({ streamCount: 10, ids, ms: plan.end, inStream: empty }), 10);
  // The stream has not dropped them yet: no double count.
  assert.equal(waitingShown({ streamCount: 13, ids, ms: 0, inStream: new Set(ids) }), 13);
});

test("moment: a seal that comes with the snapshot that already dropped its txs still takes them from the yard", () => {
  const a = tx(3000, 400, { id: "a" });
  const b = tx(2000, 400, { id: "b" });
  const c = tx(1000, 400, { id: "c" });
  const left = tx(1500, 400, { id: "left" });
  // The stream already shows only what is left; a, b and an older drop wait in the engine's «gone».
  const gone = new Map([
    ["a", a],
    ["b", b],
    ["old", tx(900, 400, { id: "old" })],
  ]);
  const y = sealYard({ count: 2, txs: [c, left] }, gone, ["cb", "a", "c", "b", "fee"]);
  assert.deepEqual(y.txs.map((t) => t.id), ["c", "left", "a", "b"]);
  assert.equal(y.count, 4, "the count as it was when the block came");
  assert.deepEqual(sealMatch(["cb", "a", "c", "b", "fee"], y.txs), ["a", "c", "b"]);
  // Nothing to put back: the yard as it is.
  const same = sealYard({ count: 7, txs: [c, left] }, new Map(), ["a"]);
  assert.equal(same.count, 7);
  assert.equal(same.txs.length, 2);
});

/* ---------- Kayolo on the roofs ---------- */

/** A 2D context that draws nothing: enough for the painters to lay the scene out. */
function nullCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  return new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: noop });
      return noop;
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const INKS = { day: false, text: "#fff", muted: "#999", muted2: "#777", wash: "#111", washMid: "#222", washStrong: "#333", kayolo: "#ffd23c", sans: "sans-serif", mono: "monospace" };

test("Kayolo: one body, his hops stay within 9 px on a desktop and 6 px on a phone", () => {
  const streets: CityBlock[][] = [
    [block(20, 4), block(19, 5), block(18, 3)],
    [block(20, 1, 300), block(19, 2)],
    [block(20, 60), block(19, 4)],
    [block(20, 3), block(19, 60)],
  ];
  const seals = [block(21, 5), block(21, 1, 300), block(21, 30), block(21, 300)];
  for (const vp of [DESK, PHONE]) {
    const lim = vp.w < 420 ? 6 : 9;
    for (const street of streets)
      for (const sb of seals) {
        const s = scene([], 0, null, street);
        const ids: string[] = [];
        const plan = sealPlan(0);
        const poses: { x: number; y: number; a: number }[] = [];
        for (let ms = 0; ms <= plan.slideFrom; ms += 8) {
          const out = drawCity(nullCtx(), vp.w, vp.h, s, { seal: { ms, block: sb, ids }, add: null, hover: null, reduce: false, now: ms }, INKS, { kinds: [] });
          assert.ok(out.kayolo, "always exactly one Kayolo in the city");
          poses.push({ x: out.kayolo!.x, y: out.kayolo!.y, a: out.kayolo!.alpha ?? 1 });
        }
        const start = poses[0]!;
        const end = poses[poses.length - 1]!;
        const top = Math.min(start.y, end.y);
        for (const p of poses) if (p.a > 0) assert.ok(p.y >= top - lim - 0.01, `rose ${top - p.y} px over the higher roof (${vp.w})`);
        // A step a hop cannot make is a fade, never a flight.
        if (Math.abs(end.y - start.y) > lim) {
          for (const p of poses) {
            const onStart = Math.abs(p.x - start.x) < 0.01 && Math.abs(p.y - start.y) <= lim;
            const onEnd = Math.abs(p.x - end.x) < 0.01 && Math.abs(p.y - end.y) <= lim;
            assert.ok(onStart || onEnd || p.a <= 0.01, `in between roofs at ${p.x},${p.y}`);
          }
        }
      }
  }
});

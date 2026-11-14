import assert from "node:assert/strict";
import { test } from "node:test";
import { makeAct } from "./acts";
import { createChainSense } from "./chain-sense";
import type { KayoloEvent } from "./events";
import { react } from "./reactions";

const HAPPY = new Set(["happy", "pleased", "surprised"]);

test("the block matrix (§8.3): Б hops, Н nods, П looks; a quick second block nods; behind is one tier lower", () => {
  const b = (path: string, extra = {}) => react({ k: "chain:block", height: 10, txCount: 6, size: 4000, kind: "normal" }, { path, ...extra })!.offer.ladder[0].act;
  assert.equal(b("/blocks"), "hopGlance");
  assert.equal(b("/settings"), "nodGlance");
  assert.equal(b("/tx/abc"), "glance");
  assert.equal(b("/blocks", { quick: true }), "nodGlance");
  assert.equal(b("/blocks", { behind: true }), "nodGlance");
  assert.equal(b("/blocks", { door: true }), "glance");
});

test("E4: one act for N blocks, count ≤ 3; E6/E7: the first block after is relief + a happy hop", () => {
  const r = react({ k: "chain:catchup", from: 10, to: 15 }, { path: "/blocks" })!;
  assert.equal(r.n, 3);
  assert.equal(r.offer.key, "h15");
  assert.equal(r.offer.ladder[0].act, "catchUp");
  assert.equal(react({ k: "chain:catchup", from: 10, to: 12 }, { path: "/tx/a" })!.offer.ladder[0].act, "countNod");
  const after = react({ k: "chain:block", height: 20, txCount: 3, size: 1, kind: "normal", after: "wait" }, { path: "/tx/a" })!;
  assert.equal(after.offer.prio, 4);
  assert.equal(after.offer.ladder[0].act, "reliefHop");
});

test("page:* (P3): «твоя tx в блоке» is firm and takes the height; a favourite is louder", () => {
  const r = react({ k: "page:tx-confirmed", txId: "a", height: 100 }, { path: "/tx/a" })!;
  assert.equal(r.offer.prio, 3);
  assert.equal(r.offer.firm, true);
  assert.equal(r.height, 100);
  assert.equal(r.aim, "confirmations");
  assert.equal(r.aim2, "block-link");
  assert.equal(r.offer.ladder[0].act, "txConfirmed");
  assert.equal(react({ k: "page:tx-confirmed", txId: "a", height: 100, fav: true }, { path: "/tx/a" })!.offer.ladder[0].act, "txConfirmedBig");
  assert.equal(react({ k: "page:confirmations", n: 1, of: "block", height: 5 }, { path: "/block/5" })!.aim, "next");
  assert.equal(react({ k: "page:confirmations", n: 720, of: "block", height: 5 }, { path: "/block/5" })!.offer.ladder[0].act, "nodKnock");
  assert.equal(react({ k: "page:confirmations", n: 11, of: "tx", height: 5 }, { path: "/tx/a" }), null);
  assert.equal(react({ k: "page:rent", address: "x", tone: "later", blocks: 200_000 }, { path: "/address/x" }), null, "> 90 days: nothing");
  assert.equal(react({ k: "page:rent", address: "x", tone: "due", blocks: 0 }, { path: "/address/x" })!.offer.ladder[0].act, "knock2");
  assert.equal(react({ k: "page:data", what: "oracle", height: 9 }, { path: "/blocks" }), null, "E15 only on /oracles*");
  assert.equal(react({ k: "page:data", what: "oracle", height: 9 }, { path: "/oracles/ergusd" })!.aim, "oracle-price");
});

test("P4 order and the fee page: fees > surge > price > topic", () => {
  const ctx = { path: "/mempool" };
  const fee = react({ k: "chain:fee", state: "spike", p50: 9000, base: 2000 }, ctx)!;
  const pool = react({ k: "chain:pool", state: "surge", count: 400, base: 40 }, ctx)!;
  const price = react({ k: "price:move", usd: 1, pct: 2, windowMin: 1.5 }, ctx)!;
  const topic = react({ k: "chain:tx-topic", category: "nft", txId: "t", rare: true }, ctx)!;
  assert.deepEqual([fee, pool, price, topic].map((r) => r.offer.rank), [1, 2, 3, 4]);
  assert.equal(fee.offer.ladder[0].act, "hopSurprised");
  assert.equal(react({ k: "chain:fee", state: "spike", p50: 9000, base: 2000 }, { path: "/tx/a" })!.offer.ladder[0].act, "glance");
  assert.equal(react({ k: "chain:fee", state: "calm", p50: 2000, base: 2000 }, { path: "/mempool" }), null, "the calm nod is only on /fees");
  assert.ok(price.offer.yieldTo?.test("h12"));
});

test("24 h of price ticks: never a joy act, never a mood from the price", () => {
  const said: KayoloEvent[] = [];
  let t = 0;
  const s = createChainSense({ say: (e) => said.push(e), now: () => t, visible: () => true, setTimer: () => 0, clearTimer: () => {} });
  // A random walk with jumps (±4 % now and then), one poll every 90 s for 24 h.
  let usd = 1.2;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) % 10000) / 10000;
  for (let i = 0; i < (24 * 3600) / 90; i++) {
    t += 90_000;
    const jump = rnd() < 0.03 ? (rnd() < 0.5 ? -0.04 : 0.04) : (rnd() - 0.5) * 0.006;
    usd = Math.max(0.05, usd * (1 + jump));
    s.price(usd);
  }
  const moves = said.filter((e) => e.k === "price:move");
  assert.ok(moves.length > 10, `the walk moved the price (${moves.length})`);
  for (let i = 1; i < moves.length; i++) assert.ok((moves[i] as { k: string }).k === "price:move");
  for (const ev of moves) {
    for (const path of ["/", "/blocks", "/tx/a", "/address/x", "/settings"]) {
      const r = react(ev, { path });
      assert.ok(r, "a price move is a look");
      for (const st of r!.offer.ladder) {
        assert.equal(st.act, "priceLook");
        const act = makeAct(st.act as "priceLook", { reduce: false, rnd: Math.random, target: { x: 0.5, y: -0.5 } });
        for (let k = 0; k <= act.ms; k += 20) {
          const m = act.at(k).mood;
          assert.ok(!m || !HAPPY.has(m), `no joy in priceLook (${m})`);
        }
      }
    }
  }
});

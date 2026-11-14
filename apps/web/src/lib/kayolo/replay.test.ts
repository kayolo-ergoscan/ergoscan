/**
 * Replay (design/brand/kayolo-life.md §9.11): 30 minutes of the live stream (recorded read-only by
 * scripts/kayolo-record.mjs, fixtures/stream-30m.json) through chain-sense → the reaction matrix →
 * the scheduler, as the layer runs them, with a person who keeps him awake. Budget: T2 ≤ 10,
 * T3 ≤ 2, attention ≤ 6 %, nothing at all during a synthetic scroll.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createChainSense } from "./chain-sense";
import type { KayoloEvent } from "./events";
import { react } from "./reactions";
import { createScheduler, type Play } from "./scheduler";
import * as K from "./thresholds";

type Rec = { recorded: string; minutes: number; events: [number, string, Record<string, unknown>][] };
const REC: Rec = JSON.parse(readFileSync(new URL("./fixtures/stream-30m.json", import.meta.url), "utf8"));

type Played = Play & { t: number };

function replay(path: string, opt: { scroll?: [number, number]; person?: boolean } = {}) {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const said: { t: number; ev: KayoloEvent }[] = [];
  const sched = createScheduler(0);
  const held: { at: number; ev: KayoloEvent }[] = [];
  const offer = (ev: KayoloEvent) => {
    const r = react(ev, { path });
    if (r) sched.offer(r.offer, t);
  };
  const s = createChainSense({
    say: (ev) => {
      said.push({ t, ev });
      // Nobody re-reads in the replay: a held block reacts after 5 s as the layer does.
      if ((ev.k === "chain:block" || ev.k === "chain:catchup") && ev.hold) held.push({ at: t + K.HOLD_MS, ev });
      else offer(ev);
    },
    now: () => t,
    visible: () => true,
    wall: () => 1_794_639_262_000 + t,
    path: () => path,
    setTimer: (fn, ms) => {
      const x = { at: t + ms, fn };
      timers.push(x);
      return x;
    },
    clearTimer: (id) => {
      const i = timers.indexOf(id as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const plays: Played[] = [];
  const end = REC.minutes * 60_000;
  let busyUntil = -1;
  let k = 0;
  if (!REC.events.some((e) => e[1] === "socket")) s.socket(true);
  for (t = 0; t <= end; t += 100) {
    if (opt.person !== false && t % 5000 === 0) sched.input(t);
    if (opt.scroll && t >= opt.scroll[0] && t < opt.scroll[1] && t % 150 === 0) {
      busyUntil = t + K.SCROLL_BUSY_MS;
      sched.busy(busyUntil);
    }
    while (k < REC.events.length && REC.events[k][0] <= t) {
      const [, type, data] = REC.events[k++];
      if (type === "socket") s.socket(data.open === true);
      else s.feed({ type, data });
    }
    for (const x of [...timers].sort((a, b) => a.at - b.at)) {
      if (x.at <= t) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    }
    for (const h of [...held]) {
      if (h.at <= t) {
        held.splice(held.indexOf(h), 1);
        offer(h.ev);
      }
    }
    const p = sched.next(t);
    if (p) plays.push({ ...p, t });
  }
  return { plays, said, sched, busyUntil };
}

test("the fixture is a real stream of ≈ 30 min with blocks in it", () => {
  assert.ok(REC.minutes >= 30, `${REC.minutes} min`);
  const blocks = REC.events.filter((e) => e[1] === "block.sealed").length;
  assert.ok(blocks >= 8, `${blocks} blocks`);
  assert.ok(Buffer.byteLength(JSON.stringify(REC)) <= 60_000, "≤ 60 KB");
});

for (const path of ["/blocks", "/mempool", "/tx/abc", "/settings"]) {
  test(`replay on ${path}: T2 ≤ 10, T3 ≤ 2, attention ≤ 6 %`, () => {
    const { plays, said } = replay(path);
    const blocks = said.filter((s) => s.ev.k === "chain:block" || s.ev.k === "chain:catchup").length;
    assert.ok(blocks >= 8, `${blocks} block reactions offered`);
    const t2 = plays.filter((p) => p.step.tier === 2).length;
    const t3 = plays.filter((p) => p.step.tier === 3).length;
    const attn = plays.filter((p) => p.step.tier >= 1).reduce((a, p) => a + p.step.ms, 0);
    if (process.env.KAYOLO_REPLAY_LOG) console.log(`${path}: blocks ${blocks}, T2 ${t2}, T3 ${t3}, attention ${((attn / (REC.minutes * 60_000)) * 100).toFixed(2)} %`);
    assert.ok(t2 <= 10, `T2 ${t2}`);
    assert.ok(t3 <= 2, `T3 ${t3}`);
    assert.ok(attn / (REC.minutes * 60_000) <= 0.06, `attention ${((attn / (REC.minutes * 60_000)) * 100).toFixed(2)} %`);
    // No joy from money: no price act is ever a mood (priceLook is eyes only).
    for (const p of plays) if (p.key === "price") assert.equal(p.step.act, "priceLook");
  });
}

test("replay: nothing plays during a synthetic scroll", () => {
  const blocksAt = REC.events.filter((e) => e[1] === "block.sealed").map((e) => e[0]);
  assert.ok(blocksAt.length >= 4);
  // Scroll across two blocks.
  const from = Math.max(0, blocksAt[2] - 5000);
  const to = blocksAt[3] + 2000;
  const { plays, busyUntil } = replay("/blocks", { scroll: [from, to] });
  // While busy (the last scroll event + 600 ms) nothing; what waited may play right after.
  const during = plays.filter((p) => p.t >= from && p.t < busyUntil);
  assert.deepEqual(during.map((p) => `${p.key}@${p.t}`), [], `scroll ${from}–${to}`);
});

test("replay without a person: asleep after 3 min, the blocks only stir", () => {
  const { plays } = replay("/blocks", { person: false });
  const late = plays.filter((p) => p.t > 200_000);
  for (const p of late) assert.ok(p.step.act === "stir" || p.wake, `${p.key} ${p.step.act}`);
});

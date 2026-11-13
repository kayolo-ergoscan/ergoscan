import assert from "node:assert/strict";
import { test } from "node:test";
import { createScheduler, levelAt, type Offer, type Step } from "./scheduler";

const S = (tier: 0 | 1 | 2 | 3, act: string, ms: number): Step => ({ tier, act, ms });
const glance = S(0, "glance", 1000);
const nod = S(1, "nod", 360);
const hop = S(2, "hop", 860);
const big = S(3, "big", 1600);
const block = (key: string, prio: 3 | 4 | 5 = 5, ladder: Step[] = [hop, nod, glance]): Offer => ({ key, prio, ttlMs: 8000, ladder, stir: S(0, "stir", 300) });

/** Offer at t and settle the merge window; the play that comes out, or null. */
function run(s: ReturnType<typeof createScheduler>, o: Offer, t: number) {
  s.offer(o, t);
  assert.equal(s.next(t), null, "the merge window is open");
  return s.next(t + 400);
}

test("alertness: A0 0–8 s, A1 8–30 s, A2 30–90 s, A3 90–180 s, A4 after", () => {
  assert.deepEqual([0, 7_999, 8_000, 29_999, 30_000, 89_999, 90_000, 179_999, 180_000, 3_600_000].map(levelAt), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const s = createScheduler(0);
  assert.equal(s.level(100_000), 3);
  assert.equal(s.input(100_000), 3, "input tells the level he woke from");
  assert.equal(s.level(100_001), 0);
  assert.equal(s.nextDue(100_001), 108_000, "the next edge is A1");
});

test("merge window: the lower P wins, the rest are absorbed", () => {
  const s = createScheduler(0);
  s.offer(block("E1", 5), 1000);
  s.offer({ ...block("E3", 4, [big, hop, glance]) }, 1200);
  assert.equal(s.next(1300), null);
  const p = s.next(1400);
  assert.equal(p?.key, "E3");
  assert.equal(p?.step.act, "big");
  assert.equal(s.next(5000), null, "the absorbed one does not come later");
});

test("the ladder: a second block within 20 s nods instead of hopping", () => {
  const s = createScheduler(0);
  assert.equal(run(s, block("a"), 1000)?.step.act, "hop");
  assert.equal(run(s, block("b"), 10_000)?.step.act, "nod");
  assert.equal(run(s, block("c"), 25_000)?.step.act, "hop");
});

test("T2 at most 3 in 2 min, T3 at least 120 s apart", () => {
  const s = createScheduler(0);
  const acts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const t = 1000 + i * 21_000;
    s.input(t);
    acts.push(run(s, block(`b${i}`), t)?.step.act ?? "-");
  }
  assert.deepEqual(acts, ["hop", "hop", "hop", "nod"]);
  const s3 = createScheduler(0);
  assert.equal(run(s3, block("x", 4, [big, hop]), 1000)?.step.act, "big");
  assert.equal(run(s3, block("y", 4, [big, hop]), 60_000)?.step.act, "hop");
  assert.equal(run(s3, block("z", 4, [big, hop]), 125_000)?.step.act, "big");
});

test("T1 bucket: three gestures 6 s apart, then one per 15 s", () => {
  const s = createScheduler(0);
  const got: string[] = [];
  for (let i = 0; i < 6; i++) {
    const t = 1000 + i * 6_500;
    s.input(t);
    got.push(run(s, block(`n${i}`, 5, [nod, glance]), t)?.step.act ?? "-");
  }
  // The bucket refills one token 15 s after it was last full: the 4th nod at 20.9 s uses it.
  assert.deepEqual(got, ["nod", "nod", "nod", "nod", "glance", "nod"]);
});

test("attention: no more than 6 s of gestures in a minute", () => {
  const s = createScheduler(0);
  const long = S(1, "long", 2500);
  const got: string[] = [];
  for (const t of [1000, 8000, 15_000, 22_000, 70_000]) {
    s.input(t);
    got.push(run(s, block(`l${t}`, 5, [long, glance]), t)?.step.act ?? "-");
  }
  assert.deepEqual(got, ["long", "long", "glance", "glance", "long"]);
});

test("busy: the block waits, after 3 s it comes one tier lower, past its TTL it is gone", () => {
  const s = createScheduler(0);
  s.busy(2_000);
  s.offer(block("w"), 1000);
  assert.equal(s.next(1400), null);
  assert.equal(s.next(1900), null, "still scrolling");
  assert.equal(s.next(2000)?.step.act, "hop", "waited 1 s: as offered");
  s.busy(20_000);
  s.offer(block("v"), 2500);
  assert.equal(s.next(2900), null);
  assert.equal(s.next(9000), null);
  assert.equal(s.nextDue(9000), 10_500, "the TTL is the next thing that can change");
  assert.equal(s.next(11_000), null, "past its 8 s TTL");
  const late = createScheduler(0);
  late.busy(5_000);
  late.offer(block("d"), 1000);
  assert.equal(late.next(1400), null);
  late.input(5_000);
  assert.equal(late.next(5_000)?.step.act, "nod", "waited 4 s: one tier lower");
});

test("dozing and asleep: routine blocks only look or stir, big ones wake him first", () => {
  const s = createScheduler(0);
  assert.equal(run(s, block("A3", 5), 100_000)?.step.act, "glance");
  const p = run(s, block("A4", 5), 200_000);
  assert.equal(p?.step.act, "stir");
  const q = run(s, { ...block("E3", 4, [big, hop, glance]), wakes: true }, 400_000);
  assert.equal(q?.step.act, "big");
  assert.equal(q?.wake, true);
});

test("«Спит» and «Спрятан» are silent", () => {
  for (const m of ["asleep", "hidden", "off"] as const) {
    const s = createScheduler(0);
    s.mode(m);
    s.offer(block("x"), 1000);
    s.offer({ key: "poke", prio: 1, ttlMs: 1000, ladder: [hop] }, 1000);
    assert.equal(s.next(1400), null, m);
  }
});

test("a poke goes at once, interrupts an act and is never cut by the budget", () => {
  const s = createScheduler(0);
  assert.equal(run(s, block("a"), 1000)?.step.act, "hop");
  const poke = { key: "poke", prio: 1 as const, ttlMs: 1000, ladder: [hop] };
  s.offer(poke, 1100);
  assert.equal(s.next(1100)?.step.act, "hop", "no merge window, no T2 gap for a poke");
  s.offer(block("during"), 1300);
  assert.equal(s.next(1700), null, "a spontaneous offer during an act is dropped");
  s.input(5000);
  assert.equal(run(s, block("after"), 5000)?.step.act, "nod", "spontaneous T2 waits 10 s after a poke");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crateBulk,
  rentTone,
  rentToneInk,
  crateSlotLeft,
  crateStations,
  isClimb,
  minerPose,
  nextPatrol,
  patrolMs,
  planPatrolStep,
  poseKind,
  remapStationIndex,
  rentYardDemoPack,
  RENT_HOVER_SWING_MS,
  RENT_MINER,
  RENT_SLOT,
  RENT_STEP_OFF_MS,
  RENT_SWING_MS,
  type CrateStation,
  type PatrolCursor,
} from "./rent-miner-patrol";

const three: CrateStation[] = [
  { t: 0, y: 0.1, stack0: 0, stackN: 0, addresses: ["a"] },
  { t: 0.4, y: 0.1, stack0: 0, stackN: 0, addresses: ["b"] },
  { t: 0.9, y: 0.1, stack0: 0, stackN: 0, addresses: ["c"] },
];

const onB: PatrolCursor = { i: 1, dir: 1, phase: "on", prevT: 0.4, prevY: 0.1 };

test("rentTone spreads unique rents across six inks", () => {
  const pack = ["100", "200", "900"];
  assert.equal(rentTone("100", pack), 0);
  assert.equal(rentTone("200", pack), 3);
  assert.equal(rentTone("900", pack), 5);
  assert.equal(rentTone("0", pack), 0);
  assert.equal(rentToneInk("100", pack), "#c4b5fd");
  assert.equal(rentToneInk("900", pack), "#ebcb71");
  const six = ["10", "20", "30", "40", "50", "60"];
  assert.deepEqual(
    six.map((n) => rentTone(n, six)),
    [0, 1, 2, 3, 4, 5]
  );
  assert.equal(rentTone("80", ["80", "80"]), 5);
});

test("crateBulk is S/M/L by box count", () => {
  assert.equal(crateBulk(1), "s");
  assert.equal(crateBulk(2), "m");
  assert.equal(crateBulk(3), "m");
  assert.equal(crateBulk(4), "l");
  assert.equal(crateBulk(9), "l");
});

test("aisle pose sits on crate center, step-off beside the slot", () => {
  const st: CrateStation = { t: 0.5, y: 0.1, stack0: 0, stackN: 0, addresses: ["a"] };
  assert.equal(crateSlotLeft(0.5), `calc(0.5 * 100% - ${RENT_SLOT / 2}px)`);
  assert.equal(minerPose("on", st).left, `calc(0.5 * 100% - ${RENT_MINER / 2}px)`);
  assert.equal(
    minerPose("before", st).left,
    `max(0px, calc(0.5 * 100% - ${RENT_SLOT / 2 + RENT_MINER + 2}px))`
  );
  assert.equal(
    minerPose("after", st).left,
    `min(calc(100% - ${RENT_MINER}px), calc(0.5 * 100% + ${RENT_SLOT / 2 + 2}px))`
  );
  assert.match(minerPose("on", st).bottom, /0\.1 \* \(100%/);
});

test("isClimb is the terrace hop", () => {
  assert.equal(isClimb(0.08, 0.4), true);
  assert.equal(isClimb(0.4, 0.72), true);
  assert.equal(isClimb(0.08, 0.12), false);
});

test("crateStations keeps path order and groups same t+y", () => {
  const g = crateStations([
    { address: "a", t: 0, y: 0, stack: 0 },
    { address: "b", t: 0, y: 0, stack: 1 },
    { address: "c", t: 0.5, y: 0, stack: 0 },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0]?.addresses, ["a", "b"]);
  assert.equal(g[0]?.stackN, 1);
  assert.equal(g[1]?.t, 0.5);
});

test("crateStations does not sort by t — back terrace stays after the climb", () => {
  const g = crateStations([
    { address: "front", t: 0.8, y: 0.1, stack: 0 },
    { address: "back", t: 0.2, y: 0.56, stack: 0 },
  ]);
  assert.deepEqual(g.map((s) => s.addresses[0]), ["front", "back"]);
});

test("poseKind: walking right approaches from the left", () => {
  assert.equal(poseKind(1, "approach"), "before");
  assert.equal(poseKind(1, "on"), "on");
  assert.equal(poseKind(1, "leave"), "after");
  assert.equal(poseKind(-1, "approach"), "after");
  assert.equal(poseKind(-1, "leave"), "before");
});

test("nextPatrol ping-pongs at the ends", () => {
  assert.deepEqual(nextPatrol(0, 1, "approach", 3), { i: 0, dir: 1, phase: "on" });
  assert.deepEqual(nextPatrol(0, 1, "on", 3), { i: 0, dir: 1, phase: "leave" });
  assert.deepEqual(nextPatrol(0, 1, "leave", 3), { i: 1, dir: 1, phase: "approach" });
  assert.deepEqual(nextPatrol(2, 1, "leave", 3), { i: 2, dir: -1, phase: "approach" });
  assert.deepEqual(nextPatrol(0, -1, "leave", 3), { i: 0, dir: 1, phase: "approach" });
});

test("remapStationIndex keeps i when the crate is still there", () => {
  assert.equal(remapStationIndex(three, ["b"], 1), 1);
});

test("remapStationIndex follows an address when the index drifted", () => {
  const dropped = [three[0]!, three[2]!];
  assert.equal(remapStationIndex(dropped, ["c"], 2), 1);
});

test("planPatrolStep: empty shelf is idle", () => {
  assert.equal(planPatrolStep([], onB, null), null);
});

test("planPatrolStep: hover from the floor walks without a second step-off", () => {
  const cur: PatrolCursor = { i: 1, dir: 1, phase: "leave", prevT: 0.4, prevY: 0.1 };
  const step = planPatrolStep(three, cur, "c");
  assert.ok(step);
  assert.equal(step.i, 2);
  assert.equal(step.phase, "approach");
  assert.equal(step.gait, "walk");
  assert.ok(step.ms > RENT_STEP_OFF_MS);
});

test("planPatrolStep: hover another crate steps off first", () => {
  const step = planPatrolStep(three, onB, "c");
  assert.ok(step);
  assert.equal(step.phase, "leave");
  assert.equal(step.gait, "walk");
  assert.equal(step.ms, RENT_STEP_OFF_MS);
  assert.equal(step.after.i, 2);
  assert.equal(step.after.phase, "approach");
  assert.equal(step.after.dir, 1);
});

test("planPatrolStep: hover does not skip an in-flight approach", () => {
  const cur: PatrolCursor = { i: 2, dir: 1, phase: "approach", prevT: 0.4, prevY: 0.1 };
  const step = planPatrolStep(three, cur, "c");
  assert.ok(step);
  assert.equal(step.phase, "approach");
  assert.equal(step.gait, "walk");
  assert.equal(step.after.phase, "on");
  assert.equal(step.after.i, 2);
});

test("planPatrolStep: hover the crate we are leaving — get back on", () => {
  const cur: PatrolCursor = { i: 1, dir: 1, phase: "leave", prevT: 0.4, prevY: 0.1 };
  const step = planPatrolStep(three, cur, "b");
  assert.ok(step);
  assert.equal(step.phase, "on");
  assert.equal(step.gait, "swing");
  assert.equal(step.ms, RENT_HOVER_SWING_MS);
});

test("rentYardDemoPack holds one back and swaps one slot on odd ticks", () => {
  const rows = ["a", "b", "c", "d"];
  assert.deepEqual(rentYardDemoPack(rows, 0), ["a", "b", "c"]);
  assert.deepEqual(rentYardDemoPack(rows, 1), ["d", "b", "c"]);
  assert.deepEqual(rentYardDemoPack(rows, 2), ["a", "b", "c"]);
  assert.deepEqual(rentYardDemoPack(rows, 3), ["a", "d", "c"]);
});

test("patrolMs is half speed vs the first walk", () => {
  assert.equal(patrolMs(0.4, 0.4, 0.1, 0.1, true), 760);
  assert.equal(RENT_STEP_OFF_MS, 440);
  const far = patrolMs(0, 0.9, 0.1, 0.1, false);
  assert.equal(far, Math.min(2200, Math.max(840, Math.round(760 + 0.9 * 1560))));
});

test("planPatrolStep: autonomous on-crate then leave", () => {
  const step = planPatrolStep(three, onB, null);
  assert.ok(step);
  assert.equal(step.gait, "swing");
  assert.equal(step.ms, RENT_SWING_MS);
  assert.equal(step.after.phase, "leave");
  assert.equal(step.after.i, 1);
});

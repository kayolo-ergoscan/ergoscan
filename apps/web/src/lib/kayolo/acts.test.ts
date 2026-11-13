import assert from "node:assert/strict";
import { test } from "node:test";
import { ACT_MS, makeAct, pokeAct, resetVariants, step, type ActName } from "./acts";

const ALL = Object.keys(ACT_MS) as ActName[];

function seq(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s % 10000) / 10000;
  };
}

const rest = { x: 0.1, y: -0.2 };

test("every act ends in the resting pose", () => {
  for (const name of ALL) {
    for (const reduce of [false, true]) {
      const a = makeAct(name, { reduce, rnd: seq(7), rest, target: { x: -0.8, y: 0.6 }, face: -1 });
      const end = a.at(a.ms);
      assert.deepEqual(end, {}, `${name} after its end`);
      const last = a.at(a.ms - 1);
      if (last.gaze) {
        assert.ok(Math.abs(last.gaze.x - rest.x) < 0.02 && Math.abs(last.gaze.y - rest.y) < 0.02, `${name}: eyes back`);
      }
      for (const k of ["head", "squash", "pick"] as const) {
        const v = last[k];
        if (v != null) assert.ok(Math.abs(v) < 0.02, `${name}.${k} back to 0 (${v})`);
      }
      if (last.eyeScale != null) assert.ok(Math.abs(last.eyeScale - 1) < 0.08, `${name}: eyes open (${last.eyeScale})`);
    }
  }
});

test("lengths stay within ±20 % of the base", () => {
  for (const name of ALL) {
    for (let i = 1; i < 30; i++) {
      const a = makeAct(name, { reduce: false, rnd: seq(i * 97), rest });
      const base = ACT_MS[name];
      assert.ok(a.ms >= base * 0.75 && a.ms <= base * 1.25, `${name}: ${a.ms} vs ${base}`);
    }
  }
});

test("reduced motion: no tilts, no squash, no knock, no turn", () => {
  for (const name of ALL) {
    const a = makeAct(name, { reduce: true, rnd: seq(3), rest, target: { x: 0.5, y: 0.5 } });
    for (let t = 0; t <= a.ms; t += 10) {
      const d = a.at(t);
      for (const k of ["head", "squash", "pick", "shift"] as const) assert.ok(!d[k], `${name}.${k} at ${t}`);
      assert.ok(!d.flip, `${name} turns`);
    }
  }
});

test("an act with variants never plays the same one twice in a row", () => {
  resetVariants();
  for (const name of ["glance", "nod", "shrug", "pleased"] as ActName[]) {
    const rnd = seq(11);
    let prev = -1;
    for (let i = 0; i < 40; i++) {
      const v = makeAct(name, { reduce: false, rnd, rest }).variant;
      assert.notEqual(v, prev, `${name} #${i}`);
      prev = v;
    }
  }
});

test("hops are the happy or surprised face; pleased never hops", () => {
  const moods = (name: ActName) => {
    const a = makeAct(name, { reduce: false, rnd: seq(5), rest });
    const out = new Set<string>();
    for (let t = 0; t < a.ms; t += 10) out.add(String(a.at(t).mood));
    return out;
  };
  assert.ok(moods("hopHappy").has("happy"));
  assert.ok(moods("poke2").has("happy"));
  assert.ok(moods("hopSurprised").has("surprised"));
  assert.ok(moods("bigBlock").has("surprised"));
  assert.ok(!moods("pleased").has("happy"));
  assert.ok(!moods("poke1").has("happy"));
});

test("the poke ladder (§4.2): 1–9, the secret's place as 7, then 7 again", () => {
  const want: ActName[] = ["poke1", "poke2", "poke3", "poke4", "dizzy", "blink2", "enough", "blink1", "blink1", "enough", "enough", "enough"];
  want.forEach((name, i) => assert.equal(pokeAct(i + 1), name, `poke ${i + 1}`));
  assert.equal(pokeAct(0), "poke1");
  assert.equal(pokeAct(40), "enough");
});

test("poke 4 is a lower hop (6 px at most); under RM it is the pleased face", () => {
  const a = makeAct("poke4", { reduce: false, rnd: seq(2), rest });
  assert.equal(a.at(10).mood, "happy");
  assert.equal(a.at(10).hopMax, 6);
  assert.equal(makeAct("poke4", { reduce: true, rnd: seq(2), rest }).at(10).mood, "pleased");
});

test("knock and the look back turn toward an anchor behind him, never under RM", () => {
  const behind = { x: 0.8, y: 0 };
  const k = makeAct("knock", { reduce: false, rnd: seq(4), rest, target: behind, face: -1 });
  assert.ok(k.at(150).flip, "knock turns");
  assert.ok((k.at(200).pick ?? 0) > 0.5, "and knocks");
  const ahead = makeAct("knock", { reduce: false, rnd: seq(4), rest, target: { x: -0.8, y: 0 }, face: -1 });
  assert.ok(!ahead.at(150).flip, "no turn when it is in front");
  const back = makeAct("lookBack", { reduce: false, rnd: seq(4), rest, target: behind, face: -1 });
  assert.ok(back.at(100).flip && !back.at(400).flip, "300 ms the other way");
});

test("the hug looks at the heart, then at the second anchor", () => {
  const heart = { x: 0.4, y: 0.6 };
  const fav = { x: -0.9, y: 0.4 };
  const a = makeAct("hug", { reduce: false, rnd: seq(6), rest, target: heart, target2: fav, face: -1 });
  assert.deepEqual(a.at(300).gaze, heart);
  assert.deepEqual(a.at(800).gaze, fav);
  assert.equal(a.at(300).mood, "pleased");
});

test("Э3 answers are gestures or eyes, never a hop or a big act", () => {
  for (const name of ["lean", "knock", "hug", "sniff", "shrugBig", "tilt", "dizzy", "enough", "blink1", "blinkLong", "stretch", "lookBack", "here", "aside", "arrive", "sidestep", "railJolt", "readList", "runList", "tear", "tabLook"] as ActName[]) {
    assert.ok(step(name).tier <= 1, `${name} is T0–T1`);
  }
});

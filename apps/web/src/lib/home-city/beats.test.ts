import assert from "node:assert/strict";
import { test } from "node:test";
import { BEAT_MS, beatCue, bgCue, type CityBeatKind } from "./beats";
import { homeBeat, homeBg } from "./home-chain";

test("home beats are short and end by themselves; the price beat is never joy", () => {
  for (const kind of Object.keys(BEAT_MS) as CityBeatKind[]) {
    assert.ok(BEAT_MS[kind] <= 2600, `${kind} ≤ 2.6 s`);
    assert.ok(beatCue(kind, 0, { x: 0.5, y: -0.5 }, "b1"), `${kind} starts`);
    assert.equal(beatCue(kind, BEAT_MS[kind], null, "b1"), null, `${kind} ends`);
  }
  for (let t = 0; t < BEAT_MS.price; t += 20) {
    const c = beatCue("price", t, { x: 0, y: -1 }, null)!;
    assert.equal(c.mood, "look");
    assert.equal(c.hop, 0);
  }
});

test("home: E1–E4, E7, E20 stay with the city; Э4 events map to beats; «Тихий» drops the hops", () => {
  const o = { calm: false, epochShown: true };
  assert.equal(homeBeat({ k: "chain:block", height: 1, txCount: 1, size: 1, kind: "normal" }, o), null);
  assert.equal(homeBeat({ k: "chain:catchup", from: 1, to: 4 }, o), null);
  assert.equal(homeBeat({ k: "chain:tip-wait", level: 3, sinceMs: 1 }, o), null);
  assert.deepEqual(homeBeat({ k: "chain:tip-wait", level: 1, sinceMs: 1 }, o), { kind: "look-tip", to: "tip" });
  assert.deepEqual(homeBeat({ k: "chain:fee", state: "spike", p50: 1, base: 1 }, o), { kind: "fee", to: "yard" });
  assert.deepEqual(homeBeat({ k: "chain:fee", state: "spike", p50: 1, base: 1 }, { ...o, calm: true }), { kind: "look", to: "yard" });
  assert.deepEqual(homeBeat({ k: "chain:epoch", height: 1024 }, o), { kind: "epoch", to: "epoch" });
  assert.equal(homeBeat({ k: "chain:epoch", height: 1024 }, { ...o, epochShown: false }), null);
  assert.deepEqual(homeBeat({ k: "net:state", state: "live", downMs: 60_000, flapping: false, cheer: true }, o), { kind: "rejoin", to: "tip" });
  assert.deepEqual(homeBeat({ k: "net:state", state: "live", downMs: 10_000, flapping: false, cheer: true }, o), { kind: "nod", to: null });
});

test("home backgrounds by importance; a background is a still face", () => {
  const s = { net: "live" as const, downAt: null, behind: false, wait: 0 as const };
  assert.equal(homeBg(s, 0), null);
  assert.equal(homeBg({ ...s, net: "offline" }, 0), "sit");
  assert.equal(homeBg({ ...s, net: "down", downAt: 0 }, 30_000), "sit");
  assert.equal(homeBg({ ...s, net: "down", downAt: 0 }, 61_000), "sit-doze");
  assert.equal(homeBg({ ...s, net: "lost", behind: true }, 0), "think");
  assert.equal(homeBg({ ...s, wait: 2 }, 0), "think");
  assert.equal(homeBg({ ...s, wait: 3 }, 0), null, "8 min: the city's own doze");
  assert.equal(bgCue("think")?.mood, "think");
  assert.equal(bgCue("sit")?.px?.eyesApart, 0.18);
});

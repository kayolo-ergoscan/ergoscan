import assert from "node:assert/strict";
import { test } from "node:test";
import { onKayolo, type KayoloEvent } from "./events";
import { createRareSense, rareBetween, rareKind, RARE_WINDOW_MS } from "./rare";

/** The page bus in node: a bare EventTarget stands in for window, so say() really dispatches. */
const g = globalThis as { window?: unknown };
g.window = new EventTarget();

function memoryStore() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

/** One browser tab: a substituted clock and height, the real say() and bus. */
function tab(store: ReturnType<typeof memoryStore> | null, opts: { visible?: () => boolean; throws?: boolean } = {}) {
  let clock = 1_000;
  const heard: KayoloEvent[] = [];
  const off = onKayolo((ev) => heard.push(ev));
  const sense = createRareSense({
    now: () => clock,
    visible: opts.visible ?? (() => true),
    storage: () => {
      if (opts.throws) throw new Error("SecurityError");
      return store;
    },
  });
  const tip = (height: number) => sense.feed({ type: "chain.tip", data: { height, headerId: "x".repeat(64) } });
  const eta = (avgIntervalMs: number, tipAgeMs = 0) =>
    sense.feed({ type: "fees.histogram", data: { ts: 5_000_000 + tipAgeMs, eta: { avgIntervalMs, lastBlockTs: 5_000_000 } } });
  return { sense, heard, off, tip, eta, wait: (ms: number) => void (clock += ms) };
}

test("rare kinds: 10k, emission steps, 100k, the end of planned emission", () => {
  assert.equal(rareKind(1_920_000), "10k");
  assert.equal(rareKind(1_930_000), "10k");
  assert.equal(rareKind(1_951_200), "emission-step");
  assert.equal(rareKind(2_016_000), "emission-step");
  assert.equal(rareKind(2_000_000), "100k");
  assert.equal(rareKind(2_080_800), "emission-end");
  assert.equal(rareKind(1_920_001), null);
  assert.equal(rareKind(1_915_825), null);
  assert.deepEqual(rareBetween(1_919_998, 1_920_003), [1_920_000]);
  assert.deepEqual(rareBetween(1_920_000, 1_920_003), []);
  assert.deepEqual(rareBetween(1_940_000, 1_960_000), [1_950_000, 1_951_200, 1_960_000]);
});

test("catching up 1 919 998 → 1 920 003 celebrates once, through say()", () => {
  const store = memoryStore();
  const t = tab(store);
  t.eta(115_000);
  t.tip(1_919_998);
  t.wait(60_000);
  t.tip(1_920_003);
  t.tip(1_920_003);
  t.tip(1_920_004);
  t.sense.feed({ type: "block.sealed", data: { height: 1_920_005 } });
  assert.deepEqual(t.heard, [{ k: "chain:rare", height: 1_920_000, what: "10k" }]);
  assert.deepEqual(JSON.parse(store.map.get("kayolo.v1")!), { v: 1, rare: [1_920_000] });
  t.off();
});

test("F5 inside the window does not repeat it", () => {
  const store = memoryStore();
  const first = tab(store);
  first.tip(1_919_999);
  first.tip(1_920_000);
  assert.equal(first.heard.length, 1);
  first.off();

  const reload = tab(store);
  reload.eta(115_000);
  reload.tip(1_920_003);
  assert.equal(reload.heard.length, 0);
  reload.off();
});

test("someone who arrives within 30 min sees it; later, nobody does", () => {
  const soon = tab(memoryStore());
  soon.eta(115_000, 60_000);
  soon.tip(1_920_014); // 14 blocks ≈ 27 min + a 1 min old tip
  assert.equal(soon.heard.length, 1);
  soon.off();

  const late = tab(memoryStore());
  late.eta(115_000);
  late.tip(1_920_016); // ≈ 31 min
  assert.equal(late.heard.length, 0);
  late.off();

  const asleep = tab(memoryStore());
  asleep.eta(115_000);
  asleep.tip(1_919_990);
  asleep.tip(1_920_060); // the tab slept two hours: the moment is gone
  assert.equal(asleep.heard.length, 0);
  asleep.off();
});

test("a hidden tab waits and celebrates when shown, if the window is still open", () => {
  let shown = false;
  const t = tab(memoryStore(), { visible: () => shown });
  t.tip(1_919_999);
  t.tip(1_920_000);
  assert.equal(t.heard.length, 0);
  t.wait(10 * 60_000);
  shown = true;
  t.sense.resume();
  t.sense.resume();
  assert.equal(t.heard.length, 1);
  t.off();

  let back = false;
  const gone = tab(memoryStore(), { visible: () => back });
  gone.tip(1_919_999);
  gone.tip(1_920_000);
  gone.wait(RARE_WINDOW_MS + 1);
  back = true;
  gone.sense.resume();
  assert.equal(gone.heard.length, 0);
  gone.off();
});

test("no storage: once per session, and nothing throws", () => {
  const t = tab(null, { throws: true });
  t.tip(1_919_999);
  t.tip(1_920_000);
  t.tip(1_920_001);
  assert.equal(t.heard.length, 1);
  t.off();

  const broken = memoryStore();
  broken.map.set("kayolo.v1", "{not json");
  const b = tab(broken);
  b.tip(1_919_999);
  b.tip(1_920_000);
  assert.equal(b.heard.length, 1);
  assert.deepEqual(JSON.parse(broken.map.get("kayolo.v1")!).rare, [1_920_000]);
  b.off();
});

test("other tabs' fields stay; mock data and non-10k kinds stay quiet in Э0", () => {
  const store = memoryStore();
  store.map.set("kayolo.v1", JSON.stringify({ v: 1, pokes: 7, rare: [1_910_000] }));
  const t = tab(store);
  t.tip(1_919_999);
  t.tip(1_920_000);
  assert.deepEqual(JSON.parse(store.map.get("kayolo.v1")!), { v: 1, pokes: 7, rare: [1_910_000, 1_920_000] });
  t.off();

  const mock = tab(memoryStore());
  mock.sense.feed({ type: "hello", data: { version: "1.0.0", mock: true } });
  mock.tip(1_919_999);
  mock.tip(1_920_000);
  assert.equal(mock.heard.length, 0);
  mock.off();

  const step = tab(memoryStore());
  step.tip(1_951_199);
  step.tip(1_951_200);
  assert.equal(step.heard.length, 0);
  step.off();
});

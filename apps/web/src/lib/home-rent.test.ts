/**
 * The rent harbour: its pure geometry, its two palettes, and the engine's rule — frames only while
 * a moment plays, none at rest, none off screen, the final frame only under reduced motion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HARBOUR_PALETTES, harbourInk } from "./home-rent/palette";
import { CLAIM_MS, EPOCH_MS, harbourLights, harbourRows, paintHarbour, reefBoatX, reefGeo, reefMastTop, type HarbourBoat } from "./home-rent/scene";

/* ---------- a browser that draws nothing ---------- */

let clock = 1_000;
let frames: ((t: number) => void)[] = [];
let visible = "visible";
const docListeners: (() => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.devicePixelRatio = 1;
g.matchMedia = () => ({ matches: false });
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
g.document = {
  get visibilityState() {
    return visible;
  },
  documentElement: { dataset: {} },
  addEventListener(_: string, fn: () => void) {
    docListeners.push(fn);
  },
  removeEventListener() {},
};
g.requestAnimationFrame = (fn: (t: number) => void) => {
  frames.push(fn);
  return frames.length;
};
g.cancelAnimationFrame = () => {};
Object.defineProperty(performance, "now", { value: () => clock, configurable: true });

function nullCtx(canvas: unknown): CanvasRenderingContext2D {
  const noop = () => {};
  const target: Record<string, unknown> = { canvas };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key as string];
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: noop });
      return noop;
    },
    set(t, key, value) {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function el(w: number, h: number): HTMLCanvasElement {
  const e: Record<string, unknown> = { width: 0, height: 0, style: {}, parentElement: { clientWidth: w, clientHeight: h } };
  const ctx = nullCtx(e);
  e.getContext = () => ctx;
  return e as unknown as HTMLCanvasElement;
}

/** Runs the frames asked for at `t`, until none is asked; returns how many ran. */
function runTo(t: number): number {
  clock = t;
  let n = 0;
  for (let i = 0; i < 400 && frames.length; i++) {
    const run = frames;
    frames = [];
    for (const f of run) {
      n += 1;
      f(t);
    }
  }
  return n;
}

/** Runs a moment frame by frame, 16 ms apart, until no frame is asked: the frames it took. */
function playOut(from: number, limit = 10_000): number {
  let t = from;
  let n = 0;
  while (frames.length && t - from < limit) {
    const run = frames;
    frames = [];
    clock = t;
    for (const f of run) {
      n += 1;
      f(t);
    }
    t += 16;
  }
  return n;
}

const boats: HarbourBoat[] = Array.from({ length: 15 }, (_, i) => ({
  address: `9addr${i}`,
  boxCount: 1 + (i % 5),
  blocksUntilRent: i * 30,
  rentNano: "98750000",
  valueNano: "1000000000",
}));

const text = {
  head: () => ["2 min", " · 0.10 ERG"] as [string, string],
  lights: (n: number) => `${n} more`,
  claim: () => ["+3.83 ERG · 36 boxes", "block 1"] as [string, string],
  epoch: () => ["epoch 2", "3 120 boxes"] as [string, string],
};

async function rig(reduce = false) {
  const { HarbourEngine } = await import("./home-rent/engine");
  frames = [];
  const e = new HarbourEngine({ rent: el(470, 300), reef: el(470, 260), host: el(940, 400) as unknown as HTMLElement, reduce, text });
  return e;
}

test("palettes: every ink takes the night harbour; the light one keeps the scene's sky and fades the reef", () => {
  for (const ink of ["light", "day", "oled", null]) assert.equal(harbourInk(ink).name, "night", String(ink));
  // The light theme paints the dusk sky behind canvas[data-scene]: the harbour draws none of its own.
  assert.equal(harbourInk("light").sky, null);
  assert.equal(harbourInk("light").reefTextFade, true);
  assert.equal(harbourInk("oled").reefTextFade, false);
  assert.deepEqual(harbourInk("light").sea, HARBOUR_PALETTES.night.sea);
  assert.equal(harbourInk("day"), HARBOUR_PALETTES.nightOnLight);
});

test("boats: the tape in order, each row only as many as fit its width", () => {
  const wide = harbourRows(470, 300, boats, false);
  assert.equal(wide.shown, 13);
  assert.deepEqual(wide.rows.map((r) => r.items.length), [3, 4, 6]);
  assert.equal(wide.rows[0]!.items[0]!.address, "9addr0");
  const narrow = harbourRows(160, 300, boats, false);
  assert.ok(narrow.shown < 13);
  for (const r of narrow.rows) {
    const used = r.lens.reduce((a, b) => a + b, 0) + 4 * r.items.length;
    assert.ok(r.row.x0 + used <= 160 - 8);
  }
});

test("horizon lights: the epoch's boxes beyond the boats, one per 10", () => {
  assert.deepEqual(harbourLights(1574, boats.slice(0, 13)), { rest: 1574 - boats.slice(0, 13).reduce((s, b) => s + b.boxCount, 0), lights: 154 });
  assert.deepEqual(harbourLights(null, boats), { rest: 0, lights: 0 });
  assert.deepEqual(harbourLights(5, boats), { rest: 0, lights: 0 });
});

test("horizon lights: the tip's count is the one drawn (boats on the water, not every address)", () => {
  const scene = { boats, epochBoxes: 1574, phone: false, hover: null };
  const hits = paintHarbour(el(470, 300).getContext("2d")!, 470, 300, scene, null, HARBOUR_PALETTES.night, text, { sans: "", mono: "", label: "#fff" });
  const lights = hits.find((h) => h.kind === "lights");
  assert.ok(lights && lights.kind === "lights");
  const drawn = harbourRows(470, 300, boats, false).rows.flatMap((r) => r.items);
  assert.ok(drawn.length < boats.length);
  assert.equal(lights.rest, harbourLights(1574, drawn).rest);
  assert.notEqual(lights.rest, 1574 - boats.reduce((s, b) => s + b.boxCount, 0));
});

test("reef: boats nearer the reef the sooner they turn four, and lower the shorter they are", () => {
  const geo = reefGeo(470, false);
  const xs = [0, 30, 720, 2000, 5040, 9000].map((b) => reefBoatX(geo, b));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i]! >= xs[i - 1]!);
  assert.equal(xs[0], geo.x0);
  assert.ok(xs[4]! + geo.len <= geo.x1);
  assert.equal(xs[4], xs[5]);
  assert.ok(reefMastTop(26, 0.05, geo.s) > reefMastTop(26, 0.95, geo.s));
});

test("engine: one frame per change, none at rest", async () => {
  const e = await rig();
  e.setData({ boats, epochBoxes: 1574, height: 1_916_431, lanes: [], pitch: 26 });
  assert.equal(runTo(2_000), 1);
  assert.equal(runTo(3_000), 0);
  e.setData({ boats: boats.slice(1), epochBoxes: 1570, height: 1_916_432, lanes: [], pitch: 26 });
  assert.equal(runTo(4_000), 1);
  assert.equal(runTo(60_000), 0);
  e.destroy();
});

test("engine: rent collected plays once per block, then no frames", async () => {
  const e = await rig();
  e.setData({ boats, epochBoxes: 1574, height: 1_916_431, lanes: [], pitch: 26 });
  runTo(2_000);
  e.claim({ height: 1_916_432, boxes: 36, rentNano: "3825000000" });
  assert.ok(e.isPlaying());
  const n = playOut(2_100);
  assert.ok(n > 100 && n < Math.ceil(CLAIM_MS / 16) + 5, `frames ${n}`);
  assert.equal(e.isPlaying(), false);
  assert.equal(runTo(20_000), 0);
  // The same block again (a reconnect) or an older one: nothing.
  e.claim({ height: 1_916_432, boxes: 36, rentNano: "3825000000" });
  e.claim({ height: 1_916_400, boxes: 2, rentNano: null });
  assert.equal(frames.length, 0);
  e.destroy();
});

test("engine: a new epoch's lights come on when the snapshot refills its count", async () => {
  const e = await rig();
  e.setData({ boats, epochBoxes: 40, height: 1_916_927, lanes: [], pitch: 26 });
  runTo(2_000);
  // The tip crosses into the next epoch; the count has not refilled yet: a frame, no moment.
  e.setData({ boats, epochBoxes: 38, height: 1_916_928, lanes: [], pitch: 26 });
  runTo(2_100);
  assert.equal(e.isPlaying(), false);
  e.setData({ boats, epochBoxes: 3120, height: 1_916_929, lanes: [], pitch: 26 });
  assert.ok(e.isPlaying());
  const n = playOut(2_200);
  assert.ok(n > 50 && n < Math.ceil(EPOCH_MS / 16) + 5, `frames ${n}`);
  assert.equal(runTo(30_000), 0);
  e.destroy();
});

test("engine: reduced motion shows a moment's final frame only", async () => {
  const e = await rig(true);
  e.setData({ boats, epochBoxes: 1574, height: 1_916_431, lanes: [], pitch: 26 });
  runTo(2_000);
  e.claim({ height: 1_916_432, boxes: 36, rentNano: "3825000000" });
  assert.equal(runTo(2_100), 1);
  assert.equal(runTo(3_000), 0);
  assert.ok(e.isPlaying());
  e.destroy();
});

test("engine: reduced motion keeps one timer, however many moments come", async () => {
  const e = await rig(true);
  e.setData({ boats, epochBoxes: 1574, height: 1_916_431, lanes: [], pitch: 26 });
  runTo(2_000);
  const live = new Set<number>();
  let next = 0;
  const st = g.setTimeout;
  const ct = g.clearTimeout;
  g.setTimeout = () => {
    next += 1;
    live.add(next);
    return next;
  };
  g.clearTimeout = (id: number) => void live.delete(id);
  try {
    for (let i = 0; i < 50; i++) {
      e.claim({ height: 1_916_440 + i, boxes: 3, rentNano: "100" });
      runTo(2_100 + i);
    }
    assert.equal(next, 50);
    assert.equal(live.size, 1);
    e.destroy();
    assert.equal(live.size, 0);
  } finally {
    g.setTimeout = st;
    g.clearTimeout = ct;
  }
});

test("engine: a hidden tab sleeps — no moment, no frames", async () => {
  const e = await rig();
  e.setData({ boats, epochBoxes: 1574, height: 1_916_431, lanes: [], pitch: 26 });
  runTo(2_000);
  visible = "hidden";
  for (const fn of docListeners) fn();
  e.claim({ height: 1_916_433, boxes: 5, rentNano: "500000000" });
  e.setData({ boats: boats.slice(2), epochBoxes: 1500, height: 1_916_434, lanes: [], pitch: 26 });
  assert.equal(e.isPlaying(), false);
  assert.equal(runTo(5_000), 0);
  visible = "visible";
  for (const fn of docListeners) fn();
  // Back on screen: one frame with what is there now.
  assert.equal(runTo(6_000), 1);
  e.destroy();
});

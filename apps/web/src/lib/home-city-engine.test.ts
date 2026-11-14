/**
 * The city engine on `block.sealed`, driven frame by frame with a canvas that draws nothing:
 * two seals in one breath, a fork's block at the same height, a partial seal, the arrival clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sealPlan, type CityBlock, type CityTx, type YardTx } from "./home-city/common";
import { SEAL_QUEUE_MAX, arrivedAt, queueSeal, sealStoreys } from "./home-city/moment";

/* ---------- a browser that draws nothing ---------- */

let clock = 1_000;
let frames: ((t: number) => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.devicePixelRatio = 1;
g.matchMedia = () => ({ matches: false });
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
g.document = {
  visibilityState: "visible",
  documentElement: { dataset: {} },
  addEventListener() {},
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
  const e: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
    parentElement: { clientWidth: w, clientHeight: h },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h }),
  };
  const ctx = nullCtx(e);
  e.getContext = () => ctx;
  return e as unknown as HTMLCanvasElement;
}

/** Runs the frames asked for, at `t` (the moment clock), until none is asked. */
function runTo(t: number) {
  clock = t;
  for (let i = 0; i < 50 && frames.length; i++) {
    const run = frames;
    frames = [];
    for (const f of run) f(t);
  }
}

async function rig() {
  const { CityEngine } = await import("./home-city/engine");
  const built: ({ id: string; height: number } | null)[] = [];
  const storeys: number[] = [];
  const commits: (number | null)[] = [];
  const host = el(1200, 160) as unknown as HTMLElement;
  const e = new CityEngine({
    city: el(760, 116),
    yard: el(400, 116),
    fly: el(1200, 160),
    host,
    reduce: false,
    text: { turbo: "Turbo", normal: "Normal", more: (n: number) => `+${n}`, tag: (n: number) => `${n} tx` },
    cb: {
      onBuilt: (b) => {
        if ((built.at(-1)?.id ?? null) !== (b?.id ?? null)) built.push(b ? { id: b.id, height: b.height } : null);
        if (b) storeys.push(b.built);
      },
      onWaiting: () => {},
      onCommit: (h) => commits.push(h),
    },
  });
  return { e, built, commits, storeys };
}

function blk(height: number, o: Partial<CityBlock> = {}): CityBlock {
  return { id: `b${height}`.padEnd(64, "0"), height, ts: height * 1000, txCount: 3, size: 4000, flag: null, lithos: false, txs: null, ...o };
}

function ytx(id: string): YardTx {
  return { id, size: 400, fee: 1_000_000, feeRate: 2500, color: "#38bdf8", category: "transfer", firstSeen: 1 };
}

function seal(height: number, txIds: string[], o: Record<string, unknown> = {}) {
  return { blockId: `b${height}`.padEnd(64, "0"), height, timestamp: height * 1000, txIds, txCount: txIds.length, size: 4000, ...o };
}

const STREET = [blk(100), blk(99), blk(98)];

test("engine: two seals in one breath play one after the other, and both towers stand", async () => {
  frames = [];
  const { e, built, commits } = await rig();
  const mem = [ytx("a1"), ytx("a2"), ytx("b1"), ytx("x")];
  e.setData({ blocks: STREET, mem: { count: 4, txs: mem }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(2_000);
  assert.deepEqual(commits, [100]);

  // The stream brings both seals, both tape rows, and drops both blocks' txs, all at once.
  e.seal(seal(101, ["cb101", "a1", "a2"]));
  e.setData({ blocks: [blk(102), blk(101), ...STREET], mem: { count: 1, txs: [ytx("x")] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  e.seal(seal(102, ["cb102", "b1"]));
  const t0 = 2_000;
  runTo(t0 + 300);
  // The first moment is not cut short by the second seal.
  assert.deepEqual(commits, [100], "101 is not committed while its moment plays");
  runTo(t0 + 1_000);
  assert.equal(built.at(-1)?.height, 101, "the first moment builds 101");
  // The waiting block's crate stays in the yard during the first moment.
  assert.ok(e.hits.yard.some((h) => h.id === "b1"), "102's crate stays in the yard while 101 plays");

  const end1 = t0 + sealPlan(2).end;
  runTo(end1 + 5);
  assert.deepEqual(commits, [100, 101], "101 stands when its moment ends");
  assert.equal(built.at(-1)?.height, 102, "then 102 plays");
  const street = e.hits.city.map((h) => h.id.slice(0, 4));
  assert.ok(street.includes("b101"), "101 is on the street while 102 builds");

  runTo(end1 + 5 + sealPlan(1).end + 5);
  assert.deepEqual(commits, [100, 101, 102]);
  assert.equal(built.at(-1), null, "no moment left");
  const towers = e.hits.city.map((h) => h.id.slice(0, 4));
  assert.ok(towers.includes("b101") && towers.includes("b102"), "both towers stand");
  assert.equal(new Set(towers).size, towers.length, "one tower per block");
  e.destroy();
});

test("engine: a fork's block at the height just built replaces it: no second moment, no extra tower", async () => {
  frames = [];
  const { e, built, commits } = await rig();
  e.setData({ blocks: STREET, mem: { count: 1, txs: [ytx("a1")] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(2_000);
  e.seal(seal(101, ["cb", "a1"]));
  e.setData({ blocks: [blk(101), ...STREET], mem: { count: 0, txs: [] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(2_000 + sealPlan(1).end + 5);
  assert.deepEqual(commits, [100, 101]);
  const moments = built.filter(Boolean).length;
  // The other block at 101 comes (seal + tape row with its id).
  const fork = { ...seal(101, ["cb'"]), blockId: "f101".padEnd(64, "0") };
  e.seal(fork);
  e.setData({ blocks: [blk(101, { id: fork.blockId }), ...STREET], mem: { count: 0, txs: [] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(20_000);
  assert.equal(built.filter(Boolean).length, moments, "no moment for the same height");
  assert.deepEqual(commits, [100, 101]);
  const ids = e.hits.city.map((h) => h.id);
  assert.ok(ids.includes(fork.blockId) && !ids.includes(blk(101).id), "the tower at 101 is the fork's block");
  assert.equal(ids.filter((id) => id.startsWith("f101") || id.startsWith("b101")).length, 1);
  e.destroy();
});

test("engine: a partial seal (no tx list) still plays its moment; the read fills the storeys", async () => {
  frames = [];
  const { e, built, commits, storeys } = await rig();
  e.setData({ blocks: STREET, mem: { count: 0, txs: [] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(2_000);
  e.seal({ ...seal(101, []), txCount: 0, partial: true } as ReturnType<typeof seal>);
  runTo(2_400);
  assert.equal(built.at(-1)?.height, 101, "the moment plays with what it has");
  assert.equal(storeys.at(-1), 1, "a lobby until the read lands");
  const read: CityTx[] = [{ color: "#34D399", category: "coinbase" }, { color: "#38bdf8", category: "transfer" }];
  e.setData({ blocks: [blk(101, { txCount: 2, txs: read }), ...STREET], mem: { count: 0, txs: [] }, fees: null, avgBlockMs: 120_000, streamLive: true });
  runTo(2_700);
  assert.equal(storeys.at(-1), 2, "the read's txs stand as storeys");
  runTo(2_000 + sealPlan(0).end + 5);
  assert.deepEqual(commits, [100, 101]);
  e.destroy();
});

test("moment: a seal during a moment waits; past the cap the oldest waiting one just stands", () => {
  let q = queueSeal<number>([], 1);
  assert.deepEqual(q, { queue: [1], dropped: [] });
  q = queueSeal(q.queue, 2);
  assert.equal(SEAL_QUEUE_MAX, 2);
  assert.deepEqual(q, { queue: [1, 2], dropped: [] });
  q = queueSeal(q.queue, 3);
  assert.deepEqual(q, { queue: [2, 3], dropped: [1] });
});

test("moment: a partial seal's tower takes the block read whole; a full one keeps its crates", () => {
  const read: CityTx[] = [{ color: "#1", category: "coinbase" }, { color: "#2", category: "dex" }];
  assert.deepEqual(sealStoreys([], [], null), { txs: [], kinds: [] });
  assert.deepEqual(sealStoreys([], [], read), { txs: read, kinds: ["coinbase", "dex"] });
  const y = ytx("a");
  assert.deepEqual(sealStoreys(["cb", "a"], [y], read).kinds, ["coinbase", "yard"]);
});

test("moment: «no new block for a while» counts from the sighting, else the header time", () => {
  assert.equal(arrivedAt(undefined), 0);
  assert.equal(arrivedAt({ ts: 1_000 }), 1_000);
  assert.equal(arrivedAt({ ts: 1_000, seenAt: null }), 1_000);
  assert.equal(arrivedAt({ ts: 1_000, seenAt: 61_000 }), 61_000);
});

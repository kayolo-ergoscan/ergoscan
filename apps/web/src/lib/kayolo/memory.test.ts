import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMemory,
  dayKey,
  familiar,
  KEY_KEY,
  MEMORY_KEY,
  MEMORY_MAX,
  MODE_KEY,
  modeOf,
  readHome,
  readKeyOn,
  readMode,
  sectionOf,
  SESSION_KEY,
  welcomeFor,
  writeHome,
  writeKeyOn,
} from "./memory";
import { tourDue, type TourInput } from "./body";

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("mode and home: only known values; reduced motion defaults to «Тихий»", () => {
  const s = store({ [MODE_KEY]: "hidden", "kayolo.v1.home": "l" });
  assert.equal(readMode(() => s), "hidden");
  assert.equal(readHome(() => s), "l");
  assert.equal(readMode(() => store({ [MODE_KEY]: "loud" })), null);
  assert.equal(readMode(() => broken), null);
  assert.equal(modeOf(null, true), "calm");
  assert.equal(modeOf(null, false), "live");
  assert.equal(modeOf("live", true), "live", "a chosen «Живой» stands under reduced motion");
});

test("sections and sessions", () => {
  assert.equal(sectionOf("/block/123"), "block");
  assert.equal(sectionOf("/"), "");
  assert.equal(sectionOf("/tokens?q=x"), "tokens");
  let now = Date.UTC(2026, 10, 13, 12);
  const local = store();
  const session = store();
  const m = createMemory({ local: () => local, session: () => session, now: () => now });
  assert.equal(m.shown(), false);
  m.markShown();
  assert.equal(session.map.get(SESSION_KEY), "1");
  assert.equal(m.sectionSeenToday("blocks"), false);
  m.noteSection("blocks");
  assert.equal(m.sectionSeenToday("blocks"), true);
  m.flush(true);
  now += 86_400_000;
  assert.equal(m.sectionSeenToday("blocks"), false, "a new day");
});

test("≤ 2 KB after 100 pokes and every section; other fields (Э0's rare) stay", () => {
  const local = store({ [MEMORY_KEY]: JSON.stringify({ v: 1, rare: [1920000] }) });
  const now = Date.UTC(2026, 10, 13, 12);
  const m = createMemory({ local: () => local, session: () => null, now: () => now });
  for (let i = 0; i < 100; i++) m.poke();
  for (let i = 0; i < 60; i++) m.noteSection(`section-number-${i}`);
  m.noteTour();
  const raw = local.map.get(MEMORY_KEY)!;
  assert.ok(raw.length <= MEMORY_MAX, `${raw.length} B`);
  const v = JSON.parse(raw);
  assert.deepEqual(v.rare, [1920000]);
  assert.equal(v.pokes, 100);
  assert.equal(v.day, dayKey(now));
  assert.equal(v.tour, now);
});

test("two tabs write in turn: counters add up, nothing is wiped", () => {
  const local = store();
  const now = Date.UTC(2026, 10, 13, 12);
  const a = createMemory({ local: () => local, session: () => null, now: () => now });
  const b = createMemory({ local: () => local, session: () => null, now: () => now });
  a.poke();
  a.poke();
  a.noteSection("blocks");
  b.poke();
  b.noteSection("tx");
  a.flush(true);
  b.flush(true);
  a.poke();
  a.flush(true);
  const v = JSON.parse(local.map.get(MEMORY_KEY)!);
  assert.equal(v.pokes, 4);
  assert.deepEqual(new Set(v.secs), new Set(["blocks", "tx"]));
  assert.equal(v.days, 1);
});

test("broken JSON and a throwing storage give defaults, never an exception", () => {
  const bad = store({ [MEMORY_KEY]: "{not json" });
  const m = createMemory({ local: () => bad, session: () => broken, now: () => 1 });
  assert.equal(m.lastTour(), 0);
  m.noteSection("x");
  m.flush(true);
  assert.ok(JSON.parse(bad.map.get(MEMORY_KEY)!).v === 1);
  const off = createMemory({ local: () => broken, session: () => broken, now: () => 1 });
  off.markShown();
  assert.equal(off.shown(), true, "the session is remembered in memory");
  off.noteTour();
  off.flush(true);
});

test("the tour: first show or first entry today, 10 min apart, «Живой» only", () => {
  const base: TourInput = {
    path: "/blocks",
    mode: "live",
    reduce: false,
    shown: false,
    seenToday: false,
    lastTourMs: 0,
    nowMs: 10 * 60_000,
    pointerInHeader: false,
  };
  assert.equal(tourDue(base), true);
  assert.equal(tourDue({ ...base, path: "/" }), false, "never on home");
  assert.equal(tourDue({ ...base, lastTourMs: 1 }), false, "less than 10 min");
  assert.equal(tourDue({ ...base, shown: true, seenToday: true }), false, "seen section, same session");
  assert.equal(tourDue({ ...base, shown: true, seenToday: false }), true, "a new section today");
  assert.equal(tourDue({ ...base, mode: "calm" }), false);
  assert.equal(tourDue({ ...base, reduce: true }), false);
  assert.equal(tourDue({ ...base, pointerInHeader: true }), false);
});

test("Э2 choices: home, Shift+K (on unless switched off), every access survives a blocked store", () => {
  const s = store();
  assert.equal(readKeyOn(() => s), true);
  writeKeyOn(() => s, false);
  assert.equal(s.map.get(KEY_KEY), "0");
  assert.equal(readKeyOn(() => s), false);
  writeHome(() => s, "p");
  assert.equal(readHome(() => s), "p");
  assert.equal(readKeyOn(() => broken), true);
  assert.doesNotThrow(() => writeKeyOn(() => broken, false));
  assert.doesNotThrow(() => writeHome(() => broken, "l"));
});

test("known people get no introduction: any old site key counts", () => {
  assert.equal(familiar(() => store()), false);
  assert.equal(familiar(() => store({ favorites: "[]" })), true);
  assert.equal(familiar(() => store({ "lumen-stage-locale": "ru" })), true);
  assert.equal(familiar(() => broken), false);
});

test("welcome back: < 10 min nothing, then noticed, a hop, the big one after a week", () => {
  const now = Date.UTC(2026, 10, 13, 12);
  const ago = (s: number) => Math.floor(now / 1000) - s;
  assert.equal(welcomeFor(null, now), "none");
  assert.equal(welcomeFor(ago(5 * 60), now), "none");
  assert.equal(welcomeFor(ago(30 * 60), now), "notice");
  assert.equal(welcomeFor(ago(20 * 3600), now), "hop");
  assert.equal(welcomeFor(ago(9 * 86400), now), "big");
});

test("pets add up across tabs, the menu hint stops after 3, hello sticks; last-before is this load's", () => {
  let now = Date.UTC(2026, 10, 13, 12);
  const local = store({ [MEMORY_KEY]: JSON.stringify({ v: 1, last: Math.floor(now / 1000) - 7200, pets: 2 }) });
  const a = createMemory({ local: () => local, session: () => null, now: () => now });
  const b = createMemory({ local: () => local, session: () => null, now: () => now });
  assert.equal(a.lastBefore(), Math.floor(now / 1000) - 7200);
  a.pet();
  b.pet();
  b.pet();
  a.flush(true);
  b.flush(true);
  assert.equal(JSON.parse(local.map.get(MEMORY_KEY) ?? "{}").pets, 5);
  assert.equal(a.lastBefore(), Math.floor(now / 1000) - 7200, "a write does not move the greeting's clock");
  for (let i = 0; i < 5; i++) if (a.hintLeft()) a.noteHint();
  assert.equal(a.hintLeft(), false);
  assert.equal(JSON.parse(local.map.get(MEMORY_KEY) ?? "{}").hint, 3);
  assert.equal(b.hello(), false);
  a.noteHello();
  assert.equal(b.hello(), true, "another tab sees it");
  now += 1000;
  assert.ok((local.map.get(MEMORY_KEY) ?? "").length <= MEMORY_MAX);
});

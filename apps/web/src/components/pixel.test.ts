import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { adoptPixelState, drawPixel, pixelState, pixelWake, type PixelMood, type PixelPose } from "./pixel";

/**
 * Golden log (design/brand/kayolo-life.md §9.7): with the default flags drawPixel makes exactly the
 * canvas calls it made before Kayolo's additions. Each case runs at 60 fps and hashes the call log
 * of three moments. PIXEL_GOLDEN_WRITE=1 records the file again (only from the old pixel.ts).
 */

type Call = string;

/** A 2D context that only writes down what it is asked to do. */
function recorder() {
  const log: Call[] = [];
  const num = (n: unknown) => (typeof n === "number" ? n.toFixed(4) : String(n));
  const canvas = { width: 200, height: 200 };
  const ctx: Record<string, unknown> = { canvas };
  for (const m of ["save", "restore", "translate", "rotate", "fillRect", "beginPath", "moveTo", "lineTo", "closePath", "fill", "stroke", "ellipse", "arc", "clearRect", "setTransform"]) {
    ctx[m] = (...a: unknown[]) => {
      log.push(`${m}(${a.map(num).join(",")})`);
    };
  }
  for (const p of ["fillStyle", "strokeStyle", "globalAlpha", "lineWidth", "lineCap", "lineJoin"]) {
    let v: unknown;
    Object.defineProperty(ctx, p, {
      get: () => v,
      set: (x) => {
        v = x;
        log.push(`${p}=${num(x)}`);
      },
    });
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

const MOODS: PixelMood[] = ["idle", "look", "happy", "think", "surprised", "sleepy", "sad", "curious", "work"];
const MOMENTS = [0, 1500, 4000];
const T0 = 10_000;

type Case = { name: string; run: (draw: (pose: PixelPose) => void, t: number) => PixelPose };

const CASES: Case[] = [];
for (const mood of MOODS) {
  for (const reduce of [false, true]) {
    CASES.push({
      name: `${mood}${reduce ? ":reduce" : ""}`,
      run: (_d, t) => ({ x: 40, y: 60, scale: 0.86, color: "#ffd23c", mood, now: t, face: -1, reduce }),
    });
  }
}
// Mood switches: the hop and the eased face.
for (const [from, to] of [
  ["idle", "happy"],
  ["idle", "surprised"],
  ["happy", "sleepy"],
] as const) {
  CASES.push({
    name: `${from}>${to}`,
    run: (_d, t) => ({ x: 40, y: 60, scale: 0.86, mood: t - T0 < 900 ? from : to, now: t, face: 1 }),
  });
}
// A walk, a knock, a duck, a gaze: the pose fields HeaderScout uses.
CASES.push({
  name: "walk+pick+apart+gaze",
  run: (_d, t) => {
    const u = (t - T0) / 4000;
    return {
      x: 40 + u * 80,
      y: 60,
      scale: 0.86,
      mood: "look",
      now: t,
      face: 1,
      roll: u * 400,
      pick: Math.abs(Math.sin(u * 9)),
      eyesApart: u > 0.5 ? 1 : 0,
      head: 0.2,
      look: Math.sin(u * 7),
      eyeLift: 0.8,
      eyeScale: 1.2,
      pupil: u * 6,
      pupilOrbit: 0.5,
      gaze: u > 0.3 ? { x: 0.4, y: -0.2 } : null,
    };
  },
});

function hashes(c: Case): string[] {
  const { ctx, log } = recorder();
  const out: string[] = [];
  for (let ms = 0; ms <= MOMENTS[MOMENTS.length - 1]; ms += 16) {
    const t = T0 + ms;
    const from = log.length;
    drawPixel(ctx, c.run(() => {}, t));
    if (MOMENTS.some((m) => m >= ms && m < ms + 16)) {
      out.push(createHash("sha1").update(log.slice(from).join("\n")).digest("hex").slice(0, 16));
    }
  }
  return out;
}

const FILE = new URL("./pixel.golden.json", import.meta.url);

test("default flags draw byte for byte what pixel.ts drew before Kayolo", () => {
  const got: Record<string, string[]> = {};
  for (const c of CASES) got[c.name] = hashes(c);
  if (process.env.PIXEL_GOLDEN_WRITE === "1") {
    writeFileSync(FILE, JSON.stringify(got, null, 1) + "\n");
    return;
  }
  const want = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string[]>;
  assert.deepEqual(got, want);
});

/** Lift of the body in a frame: pose.y minus the translate of the body. */
function liftOf(log: Call[], from: number, y: number): number {
  const tr = log.slice(from).find((c) => c.startsWith("translate("));
  return tr ? y - Number(tr.slice(10, -1).split(",")[1]) : 0;
}

test("adoptPixelState carries the face to another canvas without a jump", () => {
  const pose = (t: number): PixelPose => ({ x: 40, y: 60, scale: 0.86, mood: t < T0 + 300 ? "idle" : "happy", now: t, face: -1 });
  const a = recorder();
  for (let ms = 0; ms <= 600; ms += 16) drawPixel(a.ctx, pose(T0 + ms));
  // The same run, but from 320 ms on another canvas that adopted the state.
  const b1 = recorder();
  const b2 = recorder();
  for (let ms = 0; ms <= 600; ms += 16) {
    if (ms === 320) adoptPixelState(b2.ctx, "main", pixelState(b1.ctx));
    drawPixel(ms < 320 ? b1.ctx : b2.ctx, pose(T0 + ms));
  }
  assert.deepEqual([...b1.log, ...b2.log], a.log);
  assert.equal(pixelState(recorder().ctx), null);
});

test("wobble, nod, breath and glances at 0 give a still frame that asks for nothing", () => {
  for (const mood of ["think", "sleepy", "idle", "work"] as PixelMood[]) {
    const { ctx, log } = recorder();
    const still = (t: number): PixelPose => ({
      x: 40,
      y: 60,
      scale: 0.86,
      mood,
      now: t,
      face: -1,
      wobble: 0,
      nod: 0,
      breath: 0,
      glances: false,
      zzz: false,
      gaze: { x: 0, y: 0.4 },
    });
    let t = T0;
    for (; t < T0 + 3000; t += 16) drawPixel(ctx, still(t));
    const last = t - 16;
    const wake = pixelWake(ctx);
    assert.ok(wake > last, `${mood}: the next change is in the future`);
    // Until that change, two frames apart draw the same thing.
    const a = Math.min(wake - 1, last + 200);
    const from = log.length;
    drawPixel(ctx, still(a - 100));
    const mid = log.length;
    drawPixel(ctx, still(a));
    assert.deepEqual(log.slice(mid), log.slice(from, mid), mood);
  }
});

test("sleep's frozen frame: one still square and closed eyes, no frames asked", () => {
  const { ctx, log } = recorder();
  const pose = (t: number): PixelPose => ({
    x: 40,
    y: 60,
    scale: 0.86,
    mood: "sleepy",
    now: t,
    face: -1,
    wobble: 0,
    nod: 0,
    breath: 0,
    glances: false,
    zzz: "one",
    eyeScale: 0.15,
    gaze: { x: 0, y: 0.4 },
  });
  for (let t = T0; t < T0 + 2000; t += 16) drawPixel(ctx, pose(t));
  const from = log.length;
  drawPixel(ctx, pose(T0 + 2000));
  const squares = log.slice(log.lastIndexOf("restore()", log.length - 2) + 1).filter((c) => c.startsWith("fillRect("));
  assert.equal(squares.length, 1, "one square");
  assert.ok(log.slice(from).length > 0);
  assert.ok(pixelWake(ctx) > T0 + 2000);
});

test("the phone hop stays at 6 px, the desktop hop as it was", () => {
  const peak = (extra: Partial<PixelPose>, to: PixelMood) => {
    const { ctx, log } = recorder();
    let best = 0;
    for (let ms = 0; ms < 1400; ms += 8) {
      const from = log.length;
      drawPixel(ctx, { x: 40, y: 60, scale: 0.86, mood: ms < 100 ? "idle" : to, now: T0 + ms, face: 1, breath: 0, ...extra });
      best = Math.max(best, liftOf(log, from, 60));
    }
    return best;
  };
  assert.ok(peak({}, "happy") > 6.5, "today's happy hop is about 6.9 px");
  assert.ok(peak({ hopScale: 0.8, hopMax: 6 }, "happy") <= 6.0001);
  assert.ok(peak({ hopScale: 0.8, hopMax: 6 }, "surprised") <= 6.0001);
  assert.ok(peak({ hopScale: 0.8, hopMax: 6 }, "surprised") > 5.5);
  assert.ok(peak({}, "pleased") < 0.01, "pleased smiles without a hop");
});

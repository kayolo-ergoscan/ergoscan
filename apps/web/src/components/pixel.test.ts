import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { drawPixel, type PixelMood, type PixelPose } from "./pixel";

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

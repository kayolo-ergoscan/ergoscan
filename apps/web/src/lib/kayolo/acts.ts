/**
 * Kayolo's acts for Э1b (design/brand/kayolo-life.md §2.7, §4.2): glance, shrug, nod, pleased,
 * hops, the big block, waking, a stir in his sleep, noticing, the first three pokes. Pure: an act is
 * a duration and a pose delta over time, laid on his resting pose by the layer. Every act ends in
 * the resting pose. Under reduced motion («Тихий») there are no hops, tilts or squash: eyes, blinks
 * and faces only (§10). Lengths vary ±20 %, and an act with variants never repeats one twice in a row.
 */

import type { PixelMood, PixelPose } from "@/components/pixel";
import type { Step, Tier } from "./scheduler";

export type ActName =
  | "glance"
  | "shrug"
  | "nod"
  | "pleased"
  | "hopHappy"
  | "hopSurprised"
  | "bigBlock"
  | "hopGlance"
  | "nodGlance"
  | "rare"
  | "wake"
  | "stir"
  | "wakeSmall"
  | "wakeDoze"
  | "wakeSleep"
  | "notice"
  | "poke1"
  | "poke2"
  | "poke3"
  | "blink2";

export type Vec = { x: number; y: number };

/** What an act changes for a frame. Missing fields keep the resting pose. */
export type PoseDelta = Partial<
  Pick<PixelPose, "mood" | "gaze" | "head" | "pick" | "eyeScale" | "eyeLift" | "squash" | "wink" | "doze" | "zzz">
> & { flip?: boolean };

export type Act = {
  name: ActName;
  ms: number;
  variant: number;
  /** Delta at t ms since the start (0 … ms). */
  at(t: number): PoseDelta;
};

export type ActInput = {
  reduce: boolean;
  /** Screen-space gaze toward the act's anchor (the tip, the person). */
  target?: Vec | null;
  /** The eyes when the act began: the act returns them there. */
  rest?: Vec;
  /** Facing: the eyes "at the person" cancel the facing offset. */
  face?: 1 | -1;
  rnd: () => number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0 over [a, b]. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));
const mix = (a: Vec, b: Vec, k: number): Vec => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
/** Eyes jump in about two frames (tau ≈ 40 ms, §2.6). */
const SACCADE = 40;

/** Base lengths, for the scheduler's ladders and budgets. */
export const ACT_MS: Record<ActName, number> = {
  glance: 1020,
  shrug: 700,
  nod: 360,
  pleased: 560,
  hopHappy: 860,
  hopSurprised: 840,
  bigBlock: 1600,
  hopGlance: 1200,
  nodGlance: 1100,
  rare: 1160,
  wake: 450,
  stir: 300,
  wakeSmall: 420,
  wakeDoze: 600,
  wakeSleep: 1400,
  notice: 1200,
  poke1: 1020,
  poke2: 700,
  poke3: 640,
  blink2: 300,
};

const TIER: Record<ActName, Tier> = {
  glance: 0,
  shrug: 0,
  nod: 1,
  pleased: 1,
  hopHappy: 2,
  hopSurprised: 2,
  bigBlock: 3,
  hopGlance: 2,
  nodGlance: 1,
  rare: 2,
  wake: 1,
  stir: 0,
  wakeSmall: 0,
  wakeDoze: 1,
  wakeSleep: 1,
  notice: 0,
  poke1: 1,
  poke2: 2,
  poke3: 2,
  blink2: 0,
};

const VARIANTS: Partial<Record<ActName, number>> = { glance: 3, nod: 3, shrug: 2, pleased: 2 };
const lastVariant = new Map<ActName, number>();

/** A scheduler step for an act. */
export function step(name: ActName): Step {
  return { tier: TIER[name], act: name, ms: ACT_MS[name] };
}

/** Variant index, never the same as the last one for this act. */
function pickVariant(name: ActName, rnd: () => number): number {
  const n = VARIANTS[name] ?? 1;
  if (n <= 1) return 0;
  const last = lastVariant.get(name);
  let v = Math.floor(rnd() * n) % n;
  if (v === last) v = (v + 1 + Math.floor(rnd() * (n - 1))) % n;
  lastVariant.set(name, v);
  return v;
}

/** Forget the variants (tests). */
export function resetVariants() {
  lastVariant.clear();
}

/** Eyes to the target and back: saccade, hold, return. */
function look(t: number, hold: number, back: number, rest: Vec, to: Vec, overshoot = 0): Vec {
  if (t < SACCADE) return mix(rest, { x: to.x * (1 + overshoot), y: to.y * (1 + overshoot) }, smooth(t / SACCADE));
  if (t < 120) return overshoot ? mix({ x: to.x * (1 + overshoot), y: to.y * (1 + overshoot) }, to, smooth((t - SACCADE) / (120 - SACCADE))) : to;
  if (t < 120 + hold) return to;
  return mix(to, rest, smooth((t - 120 - hold) / back));
}

/** Eyes closed for a moment: 0…1 of a blink at t inside [a, a + len]. */
function blinkAt(t: number, a: number, len: number) {
  return bump(t, a, a + len);
}

export function makeAct(name: ActName, input: ActInput): Act {
  const { reduce, rnd } = input;
  const rest = input.rest ?? { x: 0, y: 0 };
  const face = input.face ?? -1;
  const to = input.target ?? { x: -0.7, y: 0.5 };
  /** Straight at the person: cancels the facing offset of the eyes. */
  const person: Vec = { x: -face * 0.3, y: -0.05 };
  const vary = 0.8 + rnd() * 0.4;
  const variant = pickVariant(name, rnd);
  const act = (len: number, at: (t: number) => PoseDelta): Act => {
    const ms = Math.round(len);
    return { name, ms, variant, at: (t) => (t >= ms ? {} : at(Math.max(0, t))) };
  };
  const mood = (m: PixelMood, ms: number, extra?: (t: number) => PoseDelta) =>
    act(ms, (t) => ({ mood: m, ...(extra?.(t) ?? {}) }));

  switch (name) {
    case "glance": {
      const hold = 700 * vary;
      const over = variant === 1 ? 0.1 : 0;
      const ms = 120 + hold + 200;
      return act(ms, (t) => ({
        gaze: look(t, hold, 200, rest, to, over),
        eyeScale: variant === 2 ? 1 - 0.9 * blinkAt(t, ms - 170, 150) : undefined,
      }));
    }
    case "shrug": {
      const hold = 280 * vary;
      const ms = 120 + hold + 300 + 120;
      return act(ms, (t) => ({
        gaze: look(t, hold + 300, 120, rest, to),
        // «Хм»: a slow blink while looking.
        eyeScale: 1 - (variant === 1 ? 0.7 : 0.9) * blinkAt(t, 120 + hold * 0.5, 300),
      }));
    }
    case "nod": {
      const ms = 360 * vary;
      if (reduce) return act(ms, (t) => ({ eyeScale: 1 - 0.9 * blinkAt(t, 0, Math.min(150, ms)) }));
      const k = ms / 360;
      return act(ms, (t) => {
        const u = t / k;
        let head = 0;
        if (variant === 2) head = 0.16 * (bump(u, 0, 170) - 0.2 * bump(u, 150, 190)) + 0.16 * bump(u, 180, 350);
        else if (u < 140) head = 0.28 * smooth(u / 140);
        else if (u < 260) head = 0.28 + (-0.06 - 0.28) * smooth((u - 140) / 120);
        else head = -0.06 * (1 - smooth((u - 260) / 100));
        return {
          head,
          squash: -0.05 * bump(u, 60, 300),
          eyeLift: variant === 1 ? 1.2 * bump(u, 0, 360) : undefined,
        };
      });
    }
    case "pleased":
      // ^ ^ for 420–700 ms; one variant also looks at the person.
      return mood("pleased", 560 * vary, (t) => ({
        gaze: variant === 1 ? look(t, 560 * vary - 260, 140, rest, person) : undefined,
      }));
    case "hopHappy":
      return mood("happy", reduce ? 600 : 560 + 300 * vary);
    case "hopSurprised": {
      const ms = reduce ? 800 : 640 + 200 * vary;
      return mood("surprised", ms, (t) => ({ gaze: look(t, ms - 320, 200, rest, to) }));
    }
    case "bigBlock": {
      const hold = 460 * vary;
      const knockAt = 840 + hold;
      const ms = knockAt + 160 + 200;
      return act(ms, (t) => ({
        mood: t < 840 ? "surprised" : undefined,
        gaze: look(t, knockAt + 40, 200, rest, to),
        pick: reduce ? 0 : t < knockAt ? 0 : t < knockAt + 70 ? (t - knockAt) / 70 : Math.max(0, 1 - (t - knockAt - 70) / 90),
      }));
    }
    case "hopGlance": {
      const hold = 760 * vary;
      const ms = 120 + hold + 200;
      return act(ms, (t) => ({
        mood: t >= 100 && t < 100 + 860 ? "happy" : undefined,
        gaze: look(t, hold, 200, rest, to),
      }));
    }
    case "nodGlance": {
      const hold = 680 * vary;
      const ms = 120 + hold + 200;
      return act(ms, (t) => {
        const u = t - 260;
        let head = 0;
        if (!reduce && u > 0 && u < 360) head = u < 140 ? 0.28 * smooth(u / 140) : u < 260 ? 0.28 - 0.34 * smooth((u - 140) / 120) : -0.06 * (1 - smooth((u - 260) / 100));
        return {
          gaze: look(t, hold, 200, rest, to),
          head,
          squash: reduce ? 0 : -0.05 * bump(u, 60, 300),
          eyeScale: reduce ? 1 - 0.9 * blinkAt(t, 280, 150) : undefined,
        };
      });
    }
    case "rare": {
      // count(1): one jerk of the eyes toward the tip, then the happy hop.
      const ms = 300 + (reduce ? 600 : 860);
      return act(ms, (t) => ({
        gaze: t < 300 ? look(t, 140, 40, rest, to) : rest,
        mood: t >= 300 ? "happy" : undefined,
      }));
    }
    case "wake":
      return act(450, (t) => ({
        mood: "idle",
        doze: 0.84 * (1 - smooth(t / 200)),
        zzz: false,
        eyeScale: 1 + (reduce ? 0 : 0.34) * bump(t, 150, 450),
      }));
    case "stir":
      return act(300, (t) => ({
        squash: reduce ? 0 : -0.04 * bump(t, 0, 300),
        zzz: reduce ? "one" : true,
      }));
    case "wakeSmall":
      return act(420 * vary, (t) => ({ eyeScale: 1 + 0.3 * bump(t, 0, 420 * vary) }));
    case "wakeDoze":
      return act(600, (t) => ({
        mood: "idle",
        doze: 0.55 * (1 - smooth(t / 260)),
        eyeScale: 1 + (reduce ? 0.15 : 0.34) * bump(t, 260, 600),
      }));
    case "wakeSleep":
      // Squares pop, eyes open, a startled look, a shake, then «noticed»: a look at the person.
      return act(1400, (t) => ({
        mood: t < 300 ? "sleepy" : "idle",
        zzz: false,
        doze: t < 300 ? 0.84 * (1 - smooth(t / 300)) : undefined,
        eyeScale: t < 300 ? 0.15 + 0.85 * smooth(t / 300) : 1 + (reduce ? 0.15 : 0.34) * bump(t, 300, 640) + 0.06 * bump(t, 900, 1400),
        head: reduce ? 0 : 0.15 * Math.sin(((t - 640) / 260) * Math.PI * 2) * bump(t, 640, 900),
        gaze: t < 900 ? undefined : look(t - 900, 230, 140, rest, person),
      }));
    case "notice":
      return act(1200, (t) => {
        const k = smooth(t / 150) * (1 - smooth((t - 1050) / 150));
        return { head: reduce ? 0 : 0.12 * k, eyeScale: 1 + 0.1 * k, gaze: mix(rest, person, k) };
      });
    case "poke1":
      return act(420 + 600, (t) => ({
        mood: t < 420 ? "pleased" : undefined,
        gaze: t < 420 ? undefined : look(t - 420, 340, 140, rest, person),
      }));
    case "poke2":
      return mood("happy", reduce ? 600 : 700);
    case "poke3":
      return act(reduce ? 600 : 640, (t) => ({
        mood: "happy",
        flip: !reduce && t > 140 && t < 520,
      }));
    case "blink2":
      return act(300, (t) => ({ eyeScale: 1 - 0.9 * Math.max(blinkAt(t, 0, 120), blinkAt(t, 170, 120)) }));
  }
}

/**
 * Kayolo's acts (design/brand/kayolo-life.md §2.7, §4.2): glance, shrug, nod, pleased, hops, the
 * big block, waking, a stir in his sleep, noticing, the whole poke ladder, and Э3's answers to what a
 * person does (lean, knock, hug, sniff, shrugBig, tilt, dizzy, reading a list, the arrival, a look
 * back, the morning stretch). Pure: an act is
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
  | "blink2"
  /* Э2: his panel, the introduction, «welcome back», a wake from «Спит». */
  | "pet"
  | "intro"
  | "welcome1"
  | "welcome2"
  | "welcome3"
  | "wakeUp"
  /* Э3: answers to the page (§6.2), transitions (§7), the rest of the poke ladder (§4.2), morning (§2.3). */
  | "lean"
  | "knock"
  | "hug"
  | "sniff"
  | "shrugBig"
  | "tilt"
  | "dizzy"
  | "enough"
  | "poke4"
  | "blink1"
  | "blinkLong"
  | "stretch"
  | "lookBack"
  | "here"
  | "aside"
  | "arrive"
  | "sidestep"
  | "railJolt"
  | "readList"
  | "runList"
  | "tear"
  | "tabLook";

export type Vec = { x: number; y: number };

/** What an act changes for a frame. Missing fields keep the resting pose. */
export type PoseDelta = Partial<
  Pick<
    PixelPose,
    "mood" | "gaze" | "head" | "pick" | "eyeScale" | "eyeLift" | "squash" | "wink" | "doze" | "zzz" | "pupil" | "pupilOrbit" | "hopMax"
  >
> & {
  flip?: boolean;
  /** Sideways in his own canvas, CSS px (a side step that comes back, ≤ 8). */
  shift?: number;
};

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
  /** A second anchor, for acts that look at two things (the heart, then Favorites in the rail). */
  target2?: Vec | null;
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
  pet: 2700,
  intro: 2180,
  welcome1: 800,
  welcome2: 1420,
  welcome3: 2900,
  wakeUp: 900,
  lean: 440,
  knock: 400,
  hug: 1200,
  sniff: 600,
  shrugBig: 360,
  tilt: 1400,
  dizzy: 1100,
  enough: 700,
  poke4: 480,
  blink1: 150,
  blinkLong: 240,
  stretch: 900,
  lookBack: 1100,
  here: 900,
  aside: 1000,
  arrive: 760,
  sidestep: 520,
  railJolt: 900,
  readList: 1000,
  runList: 660,
  tear: 1200,
  tabLook: 1100,
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
  pet: 1,
  intro: 2,
  welcome1: 0,
  welcome2: 2,
  welcome3: 3,
  wakeUp: 1,
  lean: 0,
  knock: 1,
  hug: 1,
  sniff: 1,
  shrugBig: 1,
  tilt: 1,
  dizzy: 1,
  enough: 1,
  poke4: 2,
  blink1: 0,
  blinkLong: 1,
  stretch: 1,
  lookBack: 0,
  here: 0,
  aside: 0,
  arrive: 1,
  sidestep: 1,
  railJolt: 1,
  readList: 0,
  runList: 0,
  tear: 1,
  tabLook: 0,
};

/**
 * The poke ladder (§4.2): 1 pleased + a look, 2 a hop, 3 a hop with a turn, 4 a lower hop, 5 dizzy,
 * 6 a double blink, 7 «ну хватит», 8–9 a blink, 10 the secret (Э7; until then as 7), 11+ as 7.
 */
export function pokeAct(n: number): ActName {
  const ladder: ActName[] = ["poke1", "poke2", "poke3", "poke4", "dizzy", "blink2", "enough", "blink1", "blink1"];
  return n >= 1 && n <= ladder.length ? ladder[n - 1] : n < 1 ? "poke1" : "enough";
}

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

/**
 * Eyes at one anchor, then a second: rest → a (saccade), hold until `ta`, a → b, hold `tb`, back
 * to rest over `back`. Total ta + tb + back.
 */
function look2(t: number, rest: Vec, a: Vec, b: Vec, ta: number, tb: number, back: number): Vec {
  if (t < SACCADE) return mix(rest, a, smooth(t / SACCADE));
  if (t < ta) return a;
  if (t < ta + SACCADE) return mix(a, b, smooth((t - ta) / SACCADE));
  if (t < ta + tb) return b;
  return mix(b, rest, smooth((t - ta - tb) / back));
}

/** One knock: pick 0 → 1 in 70 ms, back to 0 in 90 (§2.7). */
function knockAt(t: number, at: number): number {
  const u = t - at;
  if (u <= 0 || u >= 160) return 0;
  return u < 70 ? u / 70 : 1 - (u - 70) / 90;
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
    case "pet":
      // ^ ^, then a purr: a 3 % squeeze wave at 2.5 Hz that fades out, then a happy blink (§4.3).
      return act(2700, (t) => {
        const purr = t < 600 ? 0 : t < 2100 ? 1 : 1 - smooth((t - 2100) / 300);
        return {
          mood: t < 2400 ? "pleased" : undefined,
          squash: reduce ? 0 : 0.03 * purr * Math.sin(((t - 600) / 400) * Math.PI * 2),
          eyeScale: t >= 2400 ? 1 - 0.9 * blinkAt(t, 2420, 160) : undefined,
        };
      });
    case "intro":
      // The introduction (§5): eyes open, the title, the person, ^ ^, a small hop. Without text.
      return act(2180, (t) => ({
        mood: t < 300 ? "sleepy" : t >= 1200 && t < 1620 ? "pleased" : t >= 1620 ? (reduce ? "pleased" : "happy") : "idle",
        doze: t < 300 ? 0.92 * (1 - smooth(t / 300)) : undefined,
        zzz: false,
        gaze: t < 300 ? undefined : t < 700 ? look(t - 300, 220, 60, rest, to) : t < 1200 ? look(t - 700, 320, 60, rest, person) : undefined,
      }));
    case "welcome1":
      // Back after 10 min – 8 h: «noticed», eyes +30 % for 300 ms and a look at the person.
      return act(800, (t) => ({
        eyeScale: 1 + 0.3 * bump(t, 0, 300),
        gaze: t < 300 ? undefined : look(t - 300, 300, 80, rest, person),
      }));
    case "welcome2":
      // Back after 8 h – 7 days: a happy hop, then ^ ^.
      return act(1420, (t) => ({ mood: t < 860 ? (reduce ? "pleased" : "happy") : "pleased" }));
    case "welcome3":
      // Back after more than a week: two hops, a turn, ^ ^, a look at the title.
      return act(2900, (t) => ({
        mood: reduce ? (t < 2300 ? "pleased" : undefined) : t < 600 ? "happy" : t < 760 ? "pleased" : t < 1500 ? "happy" : t < 2300 ? "pleased" : undefined,
        flip: !reduce && t >= 900 && t < 1300,
        gaze: t < 2300 ? undefined : look(t - 2300, 380, 100, rest, to),
      }));
    case "wakeUp":
      // A person woke him from «Спит»: squares pop, eyes open, a look at the person (900 ms).
      return act(900, (t) => ({
        mood: t < 240 ? "sleepy" : "idle",
        zzz: false,
        doze: t < 240 ? 0.92 * (1 - smooth(t / 240)) : undefined,
        eyeScale: t < 240 ? 0.15 + 0.85 * smooth(t / 240) : 1 + (reduce ? 0.1 : 0.25) * bump(t, 240, 520),
        gaze: t < 520 ? undefined : look(t - 520, 140, 118, rest, person),
      }));
    /* ---------------- Э3 ---------------- */
    case "lean": {
      // Toward what was clicked: eyes and a tilt of 0.28 in 160 ms, then back (§2.7). RM: eyes only.
      const ms = 440 * vary;
      const s = toward(to, face);
      return act(ms, (t) => ({
        gaze: look(t, ms - 120 - 240, 240, rest, to),
        head: reduce ? undefined : 0.28 * s * (t < 160 ? smooth(t / 160) : 1 - smooth((t - 160) / (ms - 160))),
      }));
    }
    case "knock": {
      // Faces the anchor (a turn if it is behind) and knocks once. RM: a look and a blink.
      const behind = to.x * face < -0.05;
      return act(400, (t) => ({
        gaze: look(t, 180, 100, rest, to),
        pick: reduce ? undefined : knockAt(t, 140),
        flip: !reduce && behind && t < 340,
        eyeScale: reduce ? 1 - 0.9 * blinkAt(t, 160, 150) : undefined,
      }));
    }
    case "hug": {
      // ^ ^ toward the heart with a squeeze, then a look at Favorites in the rail (§6.2).
      const s = toward(to, face);
      return act(1200, (t) => ({
        mood: t < 560 ? "pleased" : undefined,
        squash: reduce ? undefined : -0.12 * bump(t, 0, 560),
        head: reduce ? undefined : 0.2 * s * bump(t, 0, 560),
        gaze: look2(t, rest, to, input.target2 ?? to, 560, 480, 160),
      }));
    }
    case "sniff": {
      // Nothing found: three small dips with the eyes down at the field.
      const down = { x: to.x * 0.5, y: 0.9 };
      return act(600, (t) => ({
        gaze: look(t, 340, 140, rest, down),
        head: reduce ? undefined : 0.12 * Math.abs(Math.sin((t / 600) * Math.PI * 3)) * bump(t, 0, 600),
      }));
    }
    case "shrugBig":
      // Eyebrows up twice with the head side to side (2 × 180). RM: the eyes go up and come back.
      return act(360, (t) => ({
        eyeLift: 1.5 * (bump(t, 0, 180) + bump(t, 180, 360)),
        head: reduce ? undefined : 0.15 * (bump(t, 0, 180) - bump(t, 180, 360)),
        gaze: reduce ? look(t, 120, 120, rest, person) : undefined,
      }));
    case "tilt": {
      // Curious, head a little to the side, eyes on the chip that gave nothing.
      const s = toward(to, face);
      return act(1400, (t) => ({
        mood: t < 1240 ? "curious" : undefined,
        head: reduce ? undefined : 0.45 * s * smooth(t / 200) * (1 - smooth((t - 1150) / 250)),
        gaze: look(t, 1080, 200, rest, to),
      }));
    }
    case "dizzy": {
      // Poke 5: the pupils go round twice (orbit 1.6) and he sways. RM: the circles only.
      return act(1100, (t) => {
        const env = smooth(t / 150) * (1 - smooth((t - 950) / 150));
        return {
          pupil: (t / 1100) * Math.PI * 4,
          pupilOrbit: 1.6 * env,
          head: reduce ? undefined : 0.4 * Math.sin((t / 1100) * Math.PI * 4) * env,
        };
      });
    }
    case "enough": {
      // Poke 7, «ну хватит»: leans back, a work squint, no anger.
      return act(700, (t) => {
        const k = smooth(t / 140) * (1 - smooth((t - 520) / 180));
        return { mood: t < 560 ? "work" : undefined, head: reduce ? undefined : -0.4 * k };
      });
    }
    case "poke4":
      // Poke 4: a lower hop, 6 px at most.
      return reduce ? mood("pleased", 480) : act(480, () => ({ mood: "happy", hopMax: 6 }));
    case "blink1":
      return act(150, (t) => ({ eyeScale: 1 - 0.9 * blinkAt(t, 0, 140) }));
    case "blinkLong":
      // A long blink (the language changed): 240 ms.
      return act(240, (t) => ({ eyeScale: 1 - 0.92 * blinkAt(t, 0, 230) }));
    case "stretch":
      // Morning (§2.3): squash −0.12 → +0.16 → 0 over 900 ms and a double blink. RM: the blinks.
      return act(900, (t) => ({
        squash: reduce
          ? undefined
          : t < 250
            ? -0.12 * smooth(t / 250)
            : t < 550
              ? -0.12 + 0.28 * smooth((t - 250) / 300)
              : 0.16 * (1 - smooth((t - 550) / 300)),
        eyeScale: 1 - 0.9 * Math.max(blinkAt(t, 560, 120), blinkAt(t, 720, 120)),
      }));
    case "lookBack": {
      // Back / Forward (§7.2): 300 ms facing that way, then «I was here» at the title and a blink.
      const behind = to.x * face < -0.05;
      return act(1100, (t) => ({
        flip: !reduce && behind && t < 300,
        gaze: look2(t, rest, to, input.target2 ?? person, 300, 560, 240),
        eyeScale: 1 - 0.9 * blinkAt(t, 760, 150),
      }));
    }
    case "here":
      // The same URL clicked: «уже здесь», a look at the title and a blink.
      return act(900, (t) => ({ gaze: look(t, 480, 300, rest, to), eyeScale: 1 - 0.9 * blinkAt(t, 600, 150) }));
    case "aside": {
      // Ctrl/Cmd/middle click: a look at the link, then up toward the browser's tabs.
      const up = { x: to.x * 0.3, y: -1 };
      return act(1000, (t) => ({ gaze: look2(t, rest, to, up, 420, 400, 180) }));
    }
    case "arrive": {
      // §7.1: the eyes see the old title off upward (0.4 s), a nod at the new one (pick 0.6, 220 ms).
      const title = to;
      const next = input.target2 ?? to;
      const up = { x: title.x, y: -1 };
      return act(760, (t) => ({
        gaze:
          t < SACCADE
            ? mix(rest, title, smooth(t / SACCADE))
            : t < 400
              ? mix(title, up, smooth((t - SACCADE) / (400 - SACCADE)))
              : t < 440
                ? mix(up, next, smooth((t - 400) / 40))
                : t < 620
                  ? next
                  : mix(next, rest, smooth((t - 620) / 140)),
        pick: reduce ? undefined : 0.6 * bump(t, 400, 620),
        eyeScale: reduce ? 1 - 0.9 * blinkAt(t, 430, 150) : undefined,
      }));
    }
    case "sidestep": {
      // HopNav: a little step toward the neighbour and back, the eyes that way.
      const d = to.x >= 0 ? 1 : -1;
      return act(520, (t) => ({
        shift: reduce ? undefined : 6 * d * bump(t, 0, 520),
        squash: reduce ? undefined : -0.04 * (bump(t, 0, 130) + bump(t, 390, 520)),
        gaze: look(t, 200, 200, rest, { x: d * 0.6, y: 0 }),
      }));
    }
    case "railJolt": {
      // The rail folds (§3.5): a start, eyes on the rail with the head after it, then on the button.
      const s = toward(to, face);
      return act(900, (t) => ({
        eyeScale: 1 + 0.2 * bump(t, 0, 140),
        squash: reduce ? undefined : 0.06 * bump(t, 0, 140),
        head: reduce ? undefined : 0.15 * s * bump(t, 140, 700),
        gaze: look2(t, rest, to, input.target2 ?? to, 600, 180, 120),
      }));
    }
    case "readList": {
      // Hits came: the eyes read the list from the top down.
      const end = input.target2 ?? { x: to.x, y: clamp(to.y + 0.6, -1, 1) };
      return act(1000, (t) => ({
        gaze: t < SACCADE ? mix(rest, to, smooth(t / SACCADE)) : t < 800 ? mix(to, end, smooth((t - SACCADE) / (800 - SACCADE))) : mix(end, rest, smooth((t - 800) / 200)),
      }));
    }
    case "runList": {
      // A new sort: the eyes run the list in 500 ms (down for ↓, up for ↑).
      const end = input.target2 ?? { x: to.x, y: clamp(to.y + 0.6, -1, 1) };
      return act(660, (t) => ({
        gaze: t < SACCADE ? mix(rest, to, smooth(t / SACCADE)) : t < 540 ? mix(to, end, smooth((t - SACCADE) / 500)) : mix(end, rest, smooth((t - 540) / 120)),
      }));
    }
    case "tear":
      // The page did not come in 15 s: one tear, and he stays (§7.1). RM: the sad face.
      return act(1200, () => ({ mood: "sad" }));
    case "tabLook":
      // A tab: a look at it, then down into its panel.
      return act(1100, (t) => ({ gaze: look2(t, rest, to, input.target2 ?? to, 420, 520, 160) }));
  }
}

/** +1 leans toward the facing, −1 back: toward a screen-space gaze. */
function toward(to: Vec, face: 1 | -1): 1 | -1 {
  return to.x * face >= 0 ? 1 : -1;
}

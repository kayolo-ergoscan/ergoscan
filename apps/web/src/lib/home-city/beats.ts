/**
 * Kayolo Э4 on home (design/brand/kayolo-life.md §2.4, §8.3): the city Kayolo is the one body on
 * «/», so the chain's beats and backgrounds there are his. The city keeps its own seal moment for
 * E1–E4 and its own doze for E7; these are the rest. Pure: the engine asks for a cue at a time, the
 * tests read it. Every beat is short and ends by itself; a background is a face, not motion (no
 * frames once it is drawn). Nothing here is about money: the price beat is a neutral look.
 */
import type { PixelPose } from "@/components/pixel";

type Gaze = { x: number; y: number };

export type CityBeatKind =
  /** E5: one look at the newest tower. */
  | "look-tip"
  /** E6: a tilt «где же он» and a look down at the page's tail, once. */
  | "tilt-tail"
  /** E13 on home: fees spiked — surprised and a hop, eyes on the fees. */
  | "fee"
  /** E11: the pool surges — he reads fast (darting eyes), then a look. */
  | "surge"
  /** E14: a neutral look at the price, then the eyes along it. */
  | "price"
  /** E17: the feed is back after > 30 s — a hop and a look at the newest tower. */
  | "rejoin"
  /** E17 short drop or flapping: a nod (eyes down and back). */
  | "nod"
  /** E21: an epoch began — a happy hop and circling eyes toward the epoch bar. */
  | "epoch"
  /** «Тихий»: only a look where the loud beat would point. */
  | "look";

/** Backgrounds on home (§2.4), by importance: offline/feed down → sits; the site behind or the chain waiting → still think. */
export type CityBg = "sit" | "sit-doze" | "think" | null;

export const BEAT_MS: Record<CityBeatKind, number> = {
  "look-tip": 900,
  "tilt-tail": 1300,
  fee: 1300,
  surge: 2600,
  price: 2000,
  rejoin: 1300,
  nod: 600,
  epoch: 1700,
  look: 900,
};

/** Spontaneous beats keep the T2 interval between them (§2.8). */
export const BEAT_GAP_MS = 20_000;

/** The cue's extra pixel fields (the city's Kayolo draws them on top of its mood). */
export type CityPx = Partial<Pick<PixelPose, "eyesApart" | "squash" | "doze" | "eyeScale" | "pupil" | "pupilOrbit" | "head" | "blinkGap">>;

export type CityCue = {
  mood: "idle" | "look" | "happy" | "sleepy" | "pleased" | "think" | "surprised" | "work";
  /** A tower id to look at (the newest one for «tip»), or null. */
  at: string | null;
  /** 0…1 of a hop in place. */
  hop: number;
  /** A screen-space gaze that wins over `at`. */
  gaze?: Gaze | null;
  px?: CityPx;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

/** The beat at `t` ms after it began; null once it is over. `newest`: the newest tower's id. */
export function beatCue(kind: CityBeatKind, t: number, gaze: Gaze | null, newest: string | null): CityCue | null {
  if (t < 0 || t >= BEAT_MS[kind]) return null;
  const to = gaze ?? { x: 0.9, y: -0.2 };
  switch (kind) {
    case "look-tip":
      return { mood: "look", at: newest, hop: 0 };
    case "look":
      return { mood: "look", at: gaze ? null : newest, hop: 0, gaze: gaze ?? undefined };
    case "tilt-tail":
      return t < 500 ? { mood: "think", at: null, hop: 0, px: { head: 0.35 * bump(t, 0, 1000) } } : { mood: "look", at: null, hop: 0, gaze: { x: 0.6, y: 0.9 }, px: { head: 0.35 * bump(t, 0, 1000) } };
    case "fee":
      return t < 420 ? { mood: "surprised", at: null, hop: t / 420, gaze: to } : { mood: "look", at: null, hop: 0, gaze: to, px: { eyeScale: 1 + 0.2 * bump(t, 420, 1000) } };
    case "surge": {
      if (t < 2000) {
        // Reading fast: the eyes jump across the yard every 250 ms.
        const k = Math.floor(t / 250);
        const x = clamp(to.x + (k % 2 ? 0.35 : -0.35), -1.3, 1.3);
        return { mood: "work", at: null, hop: 0, gaze: { x, y: clamp(to.y + 0.1 * ((k % 3) - 1), -1, 1) } };
      }
      return { mood: "look", at: null, hop: 0, gaze: to };
    }
    case "price": {
      if (t < 800) return { mood: "look", at: null, hop: 0, gaze: to };
      const u = clamp((t - 800) / 1200, 0, 1);
      const x = u < 0.5 ? to.x - 0.35 * (u * 2) : to.x - 0.35 + 0.7 * ((u - 0.5) * 2);
      return { mood: "look", at: null, hop: 0, gaze: { x: clamp(x, -1.3, 1.3), y: to.y } };
    }
    case "rejoin":
      return t < 420 ? { mood: "happy", at: null, hop: t / 420 } : { mood: "look", at: newest, hop: 0 };
    case "nod":
      return { mood: "idle", at: null, hop: 0, gaze: { x: 0.4, y: 0.25 + 0.5 * bump(t, 0, 600) } };
    case "epoch": {
      if (t < 420) return { mood: "happy", at: null, hop: t / 420, gaze: to };
      // Circling eyes (two turns), toward the epoch bar.
      const u = (t - 420) / (BEAT_MS.epoch - 420);
      return { mood: "pleased", at: null, hop: 0, gaze: to, px: { pupil: u * Math.PI * 4, pupilOrbit: 1.2 * bump(u, 0, 1) } };
    }
  }
}

/** The background face on home; null for none. */
export function bgCue(bg: CityBg): CityCue | null {
  switch (bg) {
    case "sit":
      return { mood: "idle", at: null, hop: 0, gaze: { x: 0.2, y: 0.4 }, px: { eyesApart: 0.18, squash: -0.06, blinkGap: 1.6 } };
    case "sit-doze":
      return { mood: "idle", at: null, hop: 0, gaze: null, px: { eyesApart: 0.18, squash: -0.06, doze: 0.5, blinkGap: 1.6 } };
    case "think":
      return { mood: "think", at: null, hop: 0 };
    default:
      return null;
  }
}

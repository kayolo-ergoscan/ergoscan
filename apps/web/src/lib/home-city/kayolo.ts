/**
 * Kayolo in the city: the home's one body (design/brand/kayolo-life.md §3.3: the live-blocks tile is his
 * «Двор» station; before Э5 the header scout and the layer stay off on «/», so this is the only
 * Kayolo there, as the old crate row's Pixel was). Drawn with the site's own `drawPixel`; the scene
 * only says where he stands and what he feels. Hops are the scene's own arcs (hopScale 0), capped at
 * 9 px on a desktop and 6 px on a phone, so a still frame can be drawn at any point of a move. Nothing
 * that never ends (glances, breath, the sleepy nod, drifting squares): at rest he asks for no frames.
 */
import { drawPixel, type PixelMood } from "@/components/pixel";
import type { CityPx } from "./beats";

export type KayoloPose = {
  x: number;
  /** Ground under his feet. */
  y: number;
  mood: PixelMood;
  face: number;
  gaze: { x: number; y: number } | null;
  /** Fading out on one roof and in on another, when the step is more than a hop. */
  alpha?: number;
  /** Э4 faces on top of the mood (a sit, lids, wide eyes, circling eyes). */
  px?: CityPx;
};

export const KAYOLO_ID = "home-city";

export function kayoloScale(w: number): number {
  return w < 420 ? 0.62 : 0.8;
}

export function drawKayolo(ctx: CanvasRenderingContext2D, p: KayoloPose, opt: { now: number; color: string; scale: number; reduce: boolean }) {
  const a = p.alpha ?? 1;
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  drawPixel(ctx, {
    x: Math.round(p.x),
    y: Math.round(p.y),
    scale: opt.scale,
    color: opt.color,
    mood: p.mood,
    now: opt.now,
    face: p.face,
    gaze: p.gaze,
    reduce: opt.reduce,
    hopScale: 0,
    breath: 0,
    nod: 0,
    wobble: 0,
    zzz: "one",
    glances: false,
    ...p.px,
    id: KAYOLO_ID,
  });
  ctx.restore();
}

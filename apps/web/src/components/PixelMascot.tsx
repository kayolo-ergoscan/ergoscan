"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { drawPixel, pixelColor, type PixelInk, type PixelMood } from "./pixel";

/**
 * «Пиксель» on his own little canvas (loading overlay, error and miss pages).
 * The box is fixed (1.6 × 1.9 of the body) so hops and drifting squares never move
 * the layout. Stops drawing when the tab is hidden or the canvas is off screen.
 */
export function PixelMascot({
  mood,
  size = 48,
  ink = "brand",
  face = 1,
  className,
}: {
  mood: PixelMood;
  /** Body side in CSS px. */
  size?: number;
  ink?: PixelInk;
  face?: 1 | -1;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const w = Math.round(size * 1.6);
  const h = Math.round(size * 1.9);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    let color = pixelColor(ink);
    let raf = 0;
    let seen = true;
    let frame = 0;
    const paint = (now: number) => {
      raf = 0;
      if (!seen || document.hidden) return;
      if (++frame % 60 === 0) color = pixelColor(ink);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawPixel(ctx, {
        x: w / 2,
        y: h - size * 0.1,
        scale: size / 26,
        color,
        mood: moodRef.current,
        now,
        face,
        reduce,
      });
      raf = requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!raf && seen && !document.hidden) raf = requestAnimationFrame(paint);
    };
    const io = new IntersectionObserver((entries) => {
      seen = entries.some((e) => e.isIntersecting);
      kick();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [w, h, size, ink, face]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={clsx("pixel-mascot block shrink-0", className)}
      style={{ width: w, height: h }}
    />
  );
}

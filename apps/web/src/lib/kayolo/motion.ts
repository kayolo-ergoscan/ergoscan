"use client";

import { useEffect, useState } from "react";

export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
export const WIDE_QUERY = "(min-width: 1024px)";
export const COARSE_QUERY = "(pointer: coarse)";

/**
 * Counts changes of a media query after mount: a changed motion setting, a window crossing
 * 1024 px, a rotated phone. Put it in an effect's deps and read `matchMedia(query).matches`
 * inside, so the effect restarts with the live value. 0 on the server and on the first render.
 */
export function useMediaTick(query: string): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const m = window.matchMedia(query);
    const bump = () => setTick((n) => n + 1);
    m.addEventListener("change", bump);
    return () => m.removeEventListener("change", bump);
  }, [query]);
  return tick;
}

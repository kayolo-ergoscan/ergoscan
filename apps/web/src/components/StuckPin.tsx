"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The one sticky-head sensor. A 1px line sits right above a list head; once
 * it scrolls under the site header, the head is stuck and `onStuck(true)`
 * fires. It mounts and unmounts with its list, so it needs no dependencies.
 * `anchor` hands the line to a view that also scrolls back to it.
 */
export function StuckPin({
  onStuck,
  anchor,
}: {
  onStuck: (stuck: boolean) => void;
  anchor?: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onStuck);
  report.current = onStuck;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (anchor) anchor.current = el;
    const chrome = document.querySelector(".stage-frame header.sticky");
    const pin = (chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 64) + 8;
    const obs = new IntersectionObserver(([entry]) => report.current(!!entry && !entry.isIntersecting), {
      threshold: 1,
      rootMargin: `-${pin}px 0px 0px 0px`,
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (anchor && anchor.current === el) anchor.current = null;
      report.current(false);
    };
  }, [anchor]);
  return <div ref={ref} className="h-px w-full" aria-hidden />;
}

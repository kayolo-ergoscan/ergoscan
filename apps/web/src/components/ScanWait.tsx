"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { PixelMascot } from "./PixelMascot";

/** Same delay as menu hops: bar at once, pulsing mark after this. */
export const SCAN_WAIT_SLOW_MS = 500;

/**
 * Wait chrome: running top accent bar + «Пиксель» thinking after a delay.
 * Menu hops (`RouteNavProgress`) and in-page first packs share this paint.
 * Portaled to body so plane-stage perspective cannot trap `position: fixed`.
 */
export function ScanWait({
  slow,
  label,
}: {
  slow: boolean;
  label: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);

  const paint = (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-busy="true"
        aria-label={label}
      >
        <div
          className={clsx(
            "h-full w-full bg-accent",
            "motion-safe:animate-[route-nav-bar_2s_cubic-bezier(0.4,0,0.2,1)_infinite]"
          )}
        />
      </div>
      {slow ? (
        <div
          className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-black/25"
          aria-hidden
        >
          <PixelMascot mood="think" size={56} />
        </div>
      ) : null}
    </>
  );

  if (!host) return null;
  return createPortal(paint, host);
}

export function useScanWait(active: boolean, slowMs = SCAN_WAIT_SLOW_MS) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const overlay = window.setTimeout(() => setSlow(true), slowMs);
    return () => window.clearTimeout(overlay);
  }, [active, slowMs]);

  return { bar: active, slow: active && slow };
}

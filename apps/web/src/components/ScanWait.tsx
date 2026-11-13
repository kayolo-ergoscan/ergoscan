"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { say } from "@/lib/kayolo/events";

/**
 * Wait chrome: the running 2 px accent bar at the top. No dimming and no thinking mark in the middle
 * (§12.14, «да»): Kayolo shows the wait himself at home — think, then he knocks on the title frame.
 * In «Спит», «Спрятан» and «Выключен» only the bar is seen. Menu hops (`RouteNavProgress`, which
 * tells him itself) and in-page first packs (`kind="page"`: he thinks while it is up) share this paint.
 * Portaled to body so plane-stage perspective cannot trap `position: fixed`.
 */
export function ScanWait({ label, kind = "page" }: { label: string; kind?: "route" | "page" }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    if (kind !== "page") return;
    say({ k: "ui:wait", on: true });
    return () => say({ k: "ui:wait", on: false });
  }, [kind]);

  const paint = (
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
  );

  if (!host) return null;
  return createPortal(paint, host);
}

/** An in-page wait: the bar while `active` (Kayolo takes the long part, §7.3). */
export function useScanWait(active: boolean) {
  return { bar: active };
}

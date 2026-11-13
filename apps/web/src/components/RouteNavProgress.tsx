"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ScanWait } from "@/components/ScanWait";
import { useT } from "@/lib/i18n/I18nProvider";
import { say } from "@/lib/kayolo/events";
import {
  locKey,
  navArrived,
  navTargetOf,
  noteRouteNavigation,
  setRouteNavHandler,
} from "@/lib/route-nav";

type Pending = { from: string; to: string };

const MIN_MS = 220;
const KILL_MS = 15_000;

/**
 * AdaStat wait: previous page stays. Wide full-width top bar on every
 * internal route — home, favorites — not only slow RSC. No overlay: from 500 ms
 * Kayolo pushes the door at home (design/brand/kayolo-life.md §7.1, §12.14); he is
 * told when the wait starts and how it ends. One pending target (rapid hops
 * replace `to`, keep `from`).
 */
export function RouteNavProgress() {
  const path = usePathname();
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const [bar, setBar] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    setRouteNavHandler((href) => {
      const from = locKey(window.location.pathname, window.location.search);
      const to = navTargetOf(
        href,
        window.location.origin,
        window.location.pathname,
        window.location.search
      );
      if (!to) return;
      setPending((prev) => ({ from: prev?.from ?? from, to }));
    });
    return () => setRouteNavHandler(null);
  }, []);

  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as Element | null)?.closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href) return;
      noteRouteNavigation(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const check = () => {
      const here = locKey(window.location.pathname, window.location.search);
      if (!navArrived(here, pending.to, pending.from)) return;
      if (!bar) return;
      if (Date.now() - shownAt.current < MIN_MS) return;
      setPending(null);
      setBar(false);
      say({ k: "nav:end", ok: true });
    };
    check();
    const id = window.setInterval(check, 50);
    return () => window.clearInterval(id);
  }, [pending, path, bar]);

  useEffect(() => {
    if (!pending) {
      setBar(false);
      return;
    }
    shownAt.current = Date.now();
    setBar(true);
    say({ k: "nav:start", to: pending.to });
    const kill = window.setTimeout(() => {
      setPending(null);
      setBar(false);
      say({ k: "nav:end", ok: false });
    }, KILL_MS);
    return () => window.clearTimeout(kill);
  }, [pending]);

  if (!pending || !bar) return null;

  return <ScanWait kind="route" label={t("common.loading")} />;
}

"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTip } from "@/components/Tip";
import { pixelInkForPath } from "@/components/pixel";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useSiteHost } from "@/lib/site-host";
import { formatInt } from "@/lib/format";
import { isAddressHome } from "@/lib/header-scout";
import { say, onKayolo } from "@/lib/kayolo/events";
import { bodyOwner, currentMode, kayoloHolds, onOwner, setSlotPlace } from "@/lib/kayolo/body";
import { readHome } from "@/lib/kayolo/memory";
import { nookPoint } from "@/lib/kayolo/anchors";
import { chainNow } from "@/lib/kayolo/chain-sense";
import { KAYOLO_LAYER, NOTICE_MS, OFFLINE_MS, TIP_MS } from "@/lib/kayolo/thresholds";

/**
 * Kayolo's window (design/brand/kayolo-life.md §3.1, §4.1, §10): a 40×48 button in the middle cell of
 * the desktop header, a sibling of ChromeHeading, so Tab goes search → Kayolo → price. Home is the
 * niche right of the title. The body at rest is drawn on the small canvas inside (by the lazy layer);
 * while nobody draws him (no tour due and the layer not loaded yet, reduced motion before the layer
 * loads) a CSS still frame with the same pixels stands in. It is not in the server HTML: on a first
 * visit he falls in with the tour, and a still frame in the niche first would be a second body.
 * While he is away (the tour, the Addresses door) the window is a handle that calls him home; the
 * niche is empty.
 */

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const INK_VAR: Record<string, string> = {
  block: "var(--ent-block)",
  tx: "var(--ent-tx)",
  addr: "var(--ent-addr)",
  token: "var(--ent-token)",
  box: "var(--ent-box)",
  brand: "var(--brand-new)",
};

type Away = "tour" | "door" | null;

function awayNow(path: string): Away {
  const held = kayoloHolds();
  if (held === "door") return "door";
  if (bodyOwner() === "scout") return isAddressHome(path) ? "door" : "tour";
  return null;
}

export function KayoloSlot() {
  const path = usePathname();
  const { t, locale } = useI18n();
  const { api } = useSiteHost();
  const ref = useRef<HTMLButtonElement>(null);
  const [off, setOff] = useState(false);
  const [away, setAway] = useState<Away>(null);
  const shown = KAYOLO_LAYER && !api && path !== "/" && !off;

  useEffect(() => {
    setOff(currentMode() === "off");
  }, []);

  // Home in the niche: re-read on a new title, a new language, a resize and once the fonts are in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) {
      setSlotPlace(null);
      return;
    }
    let raf = 0;
    const place = () => {
      raf = 0;
      const cell = el.parentElement;
      const p = nookPoint(readHome(local) ?? "r");
      if (!cell || !p) return;
      const box = cell.getBoundingClientRect();
      const left = Math.round(p.x - box.left - 20);
      if (el.style.left !== `${left}px`) el.style.left = `${left}px`;
      setSlotPlace({ x: box.left + left + 20, y: p.y, face: p.face });
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    // ChromeHeading swaps the title with a 0.4 s crossfade: settle on the new one after it.
    const late = window.setTimeout(place, 450);
    window.addEventListener("resize", soon);
    void document.fonts?.ready.then(soon);
    const cell = el.parentElement;
    const ro = typeof ResizeObserver === "undefined" || !cell ? null : new ResizeObserver(soon);
    if (cell) ro?.observe(cell);
    return () => {
      window.clearTimeout(late);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", soon);
      ro?.disconnect();
    };
  }, [shown, path, locale]);

  // The still frame shows only while nobody draws him; the label follows where he is.
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const sync = () => {
      if (bodyOwner() === "none") el.setAttribute("data-still", "");
      else el.removeAttribute("data-still");
      setAway(awayNow(path));
    };
    sync();
    const offOwner = onOwner(sync);
    const offBus = onKayolo((ev) => {
      if (ev.k === "kayolo:took" || ev.k === "kayolo:release") sync();
    });
    return () => {
      offOwner();
      offBus();
    };
  }, [shown, path]);

  const status = () => {
    const c = chainNow();
    const now = performance.now();
    if (!c.live && c.downSince != null && now - c.downSince >= OFFLINE_MS) return t("kayolo.offline");
    if (c.height == null || c.at == null) return null;
    const s = Math.max(0, Math.round((now - c.at) / 1000));
    const age = s < 60 ? t("kayolo.sec").replace("{n}", String(s)) : t("kayolo.min").replace("{n}", String(Math.floor(s / 60)));
    const h = formatInt(c.height, locale);
    if (c.mempool == null) return t("kayolo.statusBlock").replace("{h}", h).replace("{age}", age);
    return t("kayolo.status").replace("{h}", h).replace("{age}", age).replace("{n}", formatInt(c.mempool, locale));
  };

  const label = away ? t("kayolo.slotAway").replace("{where}", t(`kayolo.where.${away}`)) : t("kayolo.slot");
  const tip = useTip(
    () => {
      const line = status();
      return (
        <span className="kayolo-tip">
          <span className="kayolo-tip-name">{away ? label : t("kayolo.name")}</span>
          {line ? <span className="kayolo-tip-line">{line}</span> : null}
        </span>
      );
    },
    { side: "bottom", delay: TIP_MS, tap: false }
  );

  // «Noticed»: the pointer rests on him 250 ms, or the window has focus.
  const noticeTimer = useRef(0);
  const noticeOn = useRef(false);
  const notice = (on: boolean) => {
    window.clearTimeout(noticeTimer.current);
    if (on) {
      noticeTimer.current = window.setTimeout(() => {
        noticeOn.current = true;
        say({ k: "ui:notice", on: true });
      }, NOTICE_MS);
    } else if (noticeOn.current) {
      noticeOn.current = false;
      say({ k: "ui:notice", on: false });
    }
  };
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  if (!shown) return null;
  const ink = INK_VAR[pixelInkForPath(path)] ?? INK_VAR.brand;

  return (
    <button
      ref={ref}
      type="button"
      className="kayolo-slot"
      data-away={away ?? undefined}
      aria-label={label}
      style={{ ["--still-ink" as string]: ink }}
      {...tip}
      onPointerEnter={(e) => {
        tip.onPointerEnter(e);
        if (e.pointerType !== "touch") notice(true);
      }}
      onPointerLeave={(e) => {
        tip.onPointerLeave(e);
        notice(false);
      }}
      onFocus={(e) => {
        tip.onFocus(e);
        say({ k: "ui:notice", on: true });
      }}
      onBlur={(e) => {
        tip.onBlur(e);
        say({ k: "ui:notice", on: false });
      }}
      onMouseDown={(e) => {
        // A double click pokes twice; it never selects the title next to him.
        if (e.detail > 1) e.preventDefault();
      }}
      onClick={() => {
        if (awayNow(path)) say({ k: "kayolo:call-home" });
        else say({ k: "ui:poke" });
      }}
    >
      <span className="kayolo-still" aria-hidden />
      <canvas className="kayolo-canvas" aria-hidden width={0} height={0} />
    </button>
  );
}

/** A chunk that fails to load (bad network, a deploy swapped the build) leaves the page as it is. */
const KayoloLayer = dynamic(
  () => import("./KayoloLayer").catch(() => ({ default: () => null })),
  { ssr: false }
);

/** He sits in the root layout: any throw of his must not reach global-error and blank the page. */
class KayoloGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[kayolo] layer", e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Loads the engine after the page settles (§9.4): idle callback, 2 s at most; Safari waits 1.2 s. */
export function KayoloBoot() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!KAYOLO_LAYER) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setOn(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setOn(true), 1200);
    return () => window.clearTimeout(id);
  }, []);
  return on ? (
    <KayoloGuard>
      <KayoloLayer />
    </KayoloGuard>
  ) : null;
}

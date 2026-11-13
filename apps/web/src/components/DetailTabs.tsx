"use client";

import clsx from "clsx";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { compactFigure } from "@/components/KpiGrid";
import { railScrollTarget, tabJumpDelta, tabRoom } from "@/lib/detail-tabs";

export type DetailTabItem<T extends string> = {
  id: T;
  label: string;
  /** Shown only when the page already has the figure. */
  count?: string | null;
};

const PHONE = "(max-width: 1023px)";

/** Where the strip would be if it did not stick (its mark plus its top margin), and its pin. */
function stripPlace(mark: HTMLElement, nav: HTMLElement): { at: number; pin: number } {
  const css = getComputedStyle(nav);
  return {
    at: mark.getBoundingClientRect().top + (parseFloat(css.marginTop) || 0),
    pin: parseFloat(css.top),
  };
}

/** A tab's count: the figure its KPI tile shows (short form from 100 000 up). */
export function tabCount(
  n: number | null | undefined,
  locale: string,
  plus = false
): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const shown = compactFigure(n) ?? n.toLocaleString(locale === "ru" ? "ru-RU" : "en-US");
  return plus ? `${shown}+` : shown;
}

/**
 * Detail pages on a phone (address, token, block): one strip of tabs between the
 * KPI tiles and the content it switches. It sticks under the header pill
 * (detail-phone.css), scrolls sideways when the words do not fit, keeps the open
 * tab in view, and a switch brings the start of the new content up under it.
 * Wider screens never draw it; their segment bars stay where they were.
 *
 * The links are the same `#tab` anchors as the desktop bars, and `onPick` is
 * the page's own switch, so the address bar and the hash behave the same.
 */
export function DetailTabs<T extends string>({
  tabs,
  active,
  onPick,
  label,
}: {
  tabs: DetailTabItem<T>[];
  active: T;
  onPick: (id: T) => void;
  label: string;
}) {
  const markRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  /** The tab the rail last settled on; null before the first paint. */
  const seen = useRef<T | null>(null);

  /* `data-stuck` while the strip rides under the header: hairline, and Pixel steps aside. */
  useEffect(() => {
    const mark = markRef.current;
    const nav = navRef.current;
    const rail = railRef.current;
    if (!mark || !nav || !rail) return;
    const mq = window.matchMedia(PHONE);
    let frame = 0;
    const sync = () => {
      frame = 0;
      const { at, pin } = stripPlace(mark, nav);
      const stuck = Number.isFinite(pin) && at <= pin + 0.5;
      if (stuck !== nav.hasAttribute("data-stuck")) {
        if (stuck) nav.setAttribute("data-stuck", "");
        else nav.removeAttribute("data-stuck");
      }
      const rest = rail.scrollWidth - rail.clientWidth - rail.scrollLeft;
      rail.dataset.fadeStart = rail.scrollLeft > 2 ? "1" : "0";
      rail.dataset.fadeEnd = rest > 2 ? "1" : "0";
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    let on = false;
    const ro = new ResizeObserver(kick);
    const arm = () => {
      if (mq.matches === on) return;
      on = mq.matches;
      if (on) {
        window.addEventListener("scroll", kick, { passive: true });
        window.addEventListener("resize", kick, { passive: true });
        rail.addEventListener("scroll", kick, { passive: true });
        ro.observe(rail);
        kick();
      } else {
        window.removeEventListener("scroll", kick);
        window.removeEventListener("resize", kick);
        rail.removeEventListener("scroll", kick);
        ro.disconnect();
        nav.removeAttribute("data-stuck");
      }
    };
    arm();
    mq.addEventListener("change", arm);
    return () => {
      mq.removeEventListener("change", arm);
      if (on) {
        window.removeEventListener("scroll", kick);
        window.removeEventListener("resize", kick);
        rail.removeEventListener("scroll", kick);
      }
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /* The open tab stays in the rail's view: on the first paint (a #hash tab), after a switch,
     and when the words change width (the Russian strings arrive after the first paint). */
  const words = tabs.map((tab) => `${tab.id}:${tab.label}:${tab.count ?? ""}`).join("|");
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || !window.matchMedia(PHONE).matches) return;
    const el = rail.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!el) return;
    const css = getComputedStyle(rail);
    const pad = parseFloat(css.scrollPaddingLeft) || parseFloat(css.paddingLeft) || 0;
    // In the rail's own coordinates (offsetLeft counts from the track, which is positioned).
    const box = el.getBoundingClientRect();
    const start = box.left - rail.getBoundingClientRect().left - rail.clientLeft + rail.scrollLeft;
    const to = railScrollTarget(start, start + box.width, rail.scrollLeft, rail.clientWidth, pad);
    if (to != null) {
      // Glide only for a switch the reader made; a first paint or new words just sit right.
      const glide =
        seen.current !== active &&
        seen.current !== null &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rail.scrollTo({ left: to, behavior: glide ? "smooth" : "auto" });
    }
    seen.current = active;
  }, [active, words]);

  /* After a switch the strip's box keeps a screen of room under the strip (detail-phone.css,
     `data-tab-room`): a short tab, or one still loading its rows (753 tokens), would let the
     browser clamp the page and the strip would drop off its pin. Gone with the page. */
  const roomBox = useRef<HTMLElement | null>(null);
  const clearRoom = () => {
    const box = roomBox.current;
    roomBox.current = null;
    if (!box) return;
    box.removeAttribute("data-tab-room");
    box.style.removeProperty("--detail-tabs-room");
  };
  const path = usePathname();
  useEffect(() => clearRoom, [path]);

  const pick = (id: T, e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onPick(id);
    const mark = markRef.current;
    const nav = navRef.current;
    if (!mark || !nav || !window.matchMedia(PHONE).matches) return;
    const { at, pin } = stripPlace(mark, nav);
    const box = nav.parentElement;
    const room = box ? tabRoom(at, pin, window.innerHeight, box.getBoundingClientRect().top) : null;
    if (box && room != null) {
      if (roomBox.current !== box) clearRoom();
      box.style.setProperty("--detail-tabs-room", `${room}px`);
      box.setAttribute("data-tab-room", "");
      roomBox.current = box;
    }
    const d = tabJumpDelta(at, pin);
    if (d != null) window.scrollTo(0, Math.round(window.scrollY + d));
  };

  return (
    <>
      <div ref={markRef} className="detail-tabs-mark lg:hidden" aria-hidden />
      <nav ref={navRef} className="detail-tabs lg:hidden" aria-label={label}>
        <div ref={railRef} className="detail-tabs-rail scrollbar-none">
          <div className="detail-tabs-track seg-paper">
            {tabs.map((tab) => {
              const on = tab.id === active;
              return (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  data-tab={tab.id}
                  aria-current={on ? "true" : undefined}
                  onClick={(e) => pick(tab.id, e)}
                  className={clsx("detail-tab chip-press", on && "seg-on is-pressed")}
                >
                  <span>{tab.label}</span>
                  {tab.count ? <span className="detail-tab-n">{tab.count}</span> : null}
                </a>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}

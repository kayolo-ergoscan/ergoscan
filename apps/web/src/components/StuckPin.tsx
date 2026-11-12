"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The one sticky-head mechanism.
 *
 * The pin is `--feed-pin` (feed.css): a registered length, so the CSS that
 * sticks a head and the check below read one number. On a desktop it is the
 * header's foot, on a phone the pill's foot.
 *
 * `StuckPin` is a 1px line above a list head; once it passes under the pin the
 * head is stuck and `onStuck(true)` fires. `useStuckPlate` hands a feed plate
 * to the same sensor: while its day card crosses the pin line the plate
 * carries `data-stuck` ("dock" when it can widen to the header, "free" when it
 * sits in a narrower column), the insets it widens by (`--dock-l`, `--dock-r`)
 * and how far through its day the reader is (`--seam-p`, 0–1).
 */

const PHONE = "(max-width: 1023px)";

export function readPin(): number {
  const own = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--feed-pin"));
  if (Number.isFinite(own)) return own;
  const chrome = document.querySelector(".stage-col > header.sticky");
  return chrome instanceof HTMLElement ? chrome.getBoundingClientRect().bottom : 72;
}

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
    const obs = new IntersectionObserver(([entry]) => report.current(!!entry && !entry.isIntersecting), {
      threshold: 1,
      rootMargin: `-${readPin()}px 0px 0px 0px`,
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

/* ── Plates: one observer for the page, a frame per scroll only while a card crosses the pin ── */

const seats = new Map<HTMLElement, HTMLElement>(); // day card → its plate
const crossing = new Set<HTMLElement>();
let line: IntersectionObserver | null = null;
let pin = 0;
let frame = 0;
let listening = false;

function bar(): DOMRect | null {
  const phone = window.matchMedia(PHONE).matches;
  const el = document.querySelector(phone ? ".stage-col > header.sticky .phone-toolbar" : ".stage-col > header.sticky");
  return el instanceof HTMLElement ? el.getBoundingClientRect() : null;
}

function release(plate: HTMLElement) {
  if (!plate.hasAttribute("data-stuck")) return;
  plate.removeAttribute("data-stuck");
  plate.style.removeProperty("--seam-p");
  plate.style.removeProperty("--dock-l");
  plate.style.removeProperty("--dock-r");
}

function paint() {
  frame = 0;
  const b = crossing.size ? bar() : null;
  const out: Array<{ plate: HTMLElement; stuck: boolean; dock: boolean; p: number; l: number; r: number }> = [];
  for (const card of crossing) {
    const plate = seats.get(card);
    if (!plate) continue;
    const cr = card.getBoundingClientRect();
    const pr = plate.getBoundingClientRect();
    const stuck = cr.top < pin - 0.5 && pr.top <= pin + 0.75;
    const span = cr.height - pr.height;
    const p = span > 0 ? Math.min(1, Math.max(0, (pin - cr.top) / span)) : 1;
    const l = b ? cr.left - b.left : -1;
    const r = b ? b.right - cr.right : -1;
    const dock = l >= -0.5 && r >= -0.5 && l <= 80 && r <= 80;
    out.push({ plate, stuck, dock, p, l: Math.max(0, l), r: Math.max(0, r) });
  }
  for (const o of out) {
    if (!o.stuck) {
      release(o.plate);
      continue;
    }
    const mode = o.dock ? "dock" : "free";
    if (o.plate.getAttribute("data-stuck") !== mode) o.plate.setAttribute("data-stuck", mode);
    o.plate.style.setProperty("--seam-p", o.p.toFixed(4));
    o.plate.style.setProperty("--dock-l", `${o.dock ? o.l.toFixed(1) : 0}px`);
    o.plate.style.setProperty("--dock-r", `${o.dock ? o.r.toFixed(1) : 0}px`);
  }
}

function schedule() {
  if (!frame && crossing.size) frame = requestAnimationFrame(paint);
}

function onCross(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    const card = e.target as HTMLElement;
    if (e.isIntersecting) {
      crossing.add(card);
    } else {
      crossing.delete(card);
      const plate = seats.get(card);
      if (plate) release(plate);
    }
  }
  schedule();
}

/** A 1px line across the page at the pin; a card that touches it is under the header. */
function watch() {
  line?.disconnect();
  crossing.clear();
  pin = readPin();
  const below = Math.max(0, window.innerHeight - pin - 1);
  line = new IntersectionObserver(onCross, { rootMargin: `-${pin}px 0px -${below}px 0px`, threshold: 0 });
  for (const card of seats.keys()) line.observe(card);
}

/** The bar or the pin moved: a fresh line reports every card again. */
function onResize() {
  watch();
}

function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  if (on) {
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    watch();
  } else {
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", onResize);
    line?.disconnect();
    line = null;
    crossing.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
}

/** Seat a feed plate in the sensor. The plate's parent is its day card. */
export function useStuckPlate(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const plate = ref.current;
    const card = plate?.parentElement;
    if (!plate || !card || typeof IntersectionObserver === "undefined") return;
    seats.set(card, plate);
    if (listening) line?.observe(card);
    else listen(true);
    return () => {
      if (seats.get(card) === plate) seats.delete(card);
      line?.unobserve(card);
      crossing.delete(card);
      release(plate);
      if (!seats.size) listen(false);
    };
  }, [ref]);
}

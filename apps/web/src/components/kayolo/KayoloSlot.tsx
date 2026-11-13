"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useFloatTip, useTip } from "@/components/Tip";
import { pixelInkForPath } from "@/components/pixel";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useSiteHost } from "@/lib/site-host";
import { formatInt } from "@/lib/format";
import { isAddressHome } from "@/lib/header-scout";
import { say, onKayolo } from "@/lib/kayolo/events";
import {
  bodyOwner,
  chooseDefaultMode,
  chooseMode,
  currentMode,
  introPendingNow,
  kayoloHolds,
  onChoice,
  onOwner,
  reduceNow,
  setSlotPlace,
  slotPlace,
} from "@/lib/kayolo/body";
import { pageMemory, readHome, readKeyOn, type Mode } from "@/lib/kayolo/memory";
import { nookPoint } from "@/lib/kayolo/anchors";
import { chainNow } from "@/lib/kayolo/chain-sense";
import { useMediaTick, WIDE_QUERY } from "@/lib/kayolo/motion";
import { KAYOLO_LAYER, NOTICE_MS, OFFLINE_MS, TIP_MS } from "@/lib/kayolo/thresholds";

/**
 * Kayolo's window (design/brand/kayolo-life.md §3.1, §3.2, §4, §10). Desktop: a 40×48 button in the
 * middle cell of the header, a sibling of ChromeHeading, so Tab goes search → Kayolo → price; home
 * is the niche by the title. Phone: a 32×44 button in the pill between the search and the price
 * (hit 44×44), so Tab goes brand → search → Kayolo → price. The body at rest is drawn on the small
 * canvas inside (by the lazy layer); while nobody draws him a CSS still frame with the same pixels
 * stands in (closed eyes before the introduction). It is not in the server HTML: on a first visit
 * he falls in with the tour, and a still frame first would be a second body.
 *
 * Click or tap: a poke (the phone shows the status for 2.4 s). Away (the tour, the Addresses door):
 * the window calls him home. Asleep or hidden: it wakes him or brings him back. Hold 500 ms, Enter,
 * Space, the context-menu key, Shift+F10 or Shift+K: his panel — a disclosure, not a menu (§4.5).
 */

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
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

/** Hold this long on his window (moving ≤ 6 px) for the panel (§4.1, §4.4). */
const HOLD_MS = 500;
const HOLD_SLOP = 6;
/** A tap on the phone shows the status this long (§4.4). */
const TAP_TIP_MS = 2400;
/** Petting (§4.3): turns of the pointer along x inside his window, within this long. */
const PET_TURNS_MOUSE = 3;
const PET_TURNS_TOUCH = 2;
const PET_WINDOW_MS = 1500;
/** One pet per stroke: the purr runs 2.7 s. */
const PET_REST_MS = 2700;

function editable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
}

type Said = "asleep" | "hidden" | "back" | "calm" | "live" | "pet" | "home";

export function KayoloSlot({ phone = false }: { phone?: boolean }) {
  const path = usePathname();
  const { t, locale } = useI18n();
  const { api } = useSiteHost();
  const ref = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("live");
  /** The system asks for less motion: «Живее» is only on /settings then (§10). */
  const [reduce, setReduce] = useState(false);
  const [choiceTick, setChoiceTick] = useState(0);
  const [away, setAway] = useState<Away>(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const [tipOn, setTipOn] = useState(false);
  const [, setTick] = useState(0);
  const wideTick = useMediaTick(WIDE_QUERY);
  const [active, setActive] = useState(false);
  const panelId = useId();
  const descId = useId();
  const shown = KAYOLO_LAYER && !api && path !== "/" && mode !== "off";

  // The mode and the other choices: this tab, other tabs (`storage`), the system motion setting.
  useEffect(() => {
    const read = () => {
      setMode(currentMode());
      setReduce(reduceNow());
      setChoiceTick((n) => n + 1);
    };
    read();
    return onChoice(read);
  }, []);

  // Only the window of the layout that is on places him (the other one is display:none).
  useEffect(() => {
    const wide = window.matchMedia(WIDE_QUERY).matches;
    setActive(phone ? !wide : wide);
  }, [phone, wideTick]);

  // Home: the niche by the title (desktop) or this window in the pill (phone). Re-read on a new
  // title, a new language, a resize, a new home on /settings and once the fonts are in.
  useLayoutEffect(() => {
    const el = ref.current;
    const mine = () => slotPlace()?.el === el;
    if (!shown || !el || !active) {
      if (el && mine()) setSlotPlace(null);
      return;
    }
    let raf = 0;
    const place = () => {
      raf = 0;
      if (phone) {
        const r = el.getBoundingClientRect();
        if (r.width < 2) return;
        // Ground 2 px below the window: 4 px above the pill's bottom, never outside it (§3.2).
        setSlotPlace({ x: r.left + r.width / 2, y: r.bottom + 2, face: -1, el });
        return;
      }
      const cell = el.parentElement;
      const p = nookPoint(readHome(local) ?? "r");
      if (!cell || !p) return;
      const box = cell.getBoundingClientRect();
      const left = Math.round(p.x - box.left - 20);
      if (el.style.left !== `${left}px`) el.style.left = `${left}px`;
      setSlotPlace({ x: box.left + left + 20, y: p.y, face: p.face, el });
    };
    const soon = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    // ChromeHeading swaps the title with a 0.4 s crossfade: settle on the new one after it.
    const late = window.setTimeout(place, 450);
    window.addEventListener("resize", soon);
    void document.fonts?.ready.then(soon);
    const host = phone ? el.parentElement : el.parentElement;
    const ro = typeof ResizeObserver === "undefined" || !host ? null : new ResizeObserver(soon);
    if (host) ro?.observe(host);
    return () => {
      window.clearTimeout(late);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", soon);
      ro?.disconnect();
    };
  }, [shown, active, phone, path, locale, choiceTick]);

  // The still frame shows only while nobody draws him; the label follows where he is.
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const sync = () => {
      if (bodyOwner() === "none") el.setAttribute("data-still", "");
      else el.removeAttribute("data-still");
      if (introPendingNow()) el.setAttribute("data-eyes", "closed");
      else el.removeAttribute("data-eyes");
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

  // While the tip is up its «{age} ago» ticks (once a second, only then).
  useEffect(() => {
    if (!tipOn && !open) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [tipOn, open]);

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

  const label =
    mode === "asleep"
      ? t("kayolo.asleep")
      : mode === "hidden"
        ? t("kayolo.hidden")
        : away
          ? t("kayolo.slotAway").replace("{where}", t(`kayolo.where.${away}`))
          : t("kayolo.slot");
  const hintLeft = typeof window !== "undefined" && pageMemory().hintLeft();
  const tipBody = () => {
    const line = status();
    const quiet = mode === "asleep" || mode === "hidden";
    return (
      <span className="kayolo-tip">
        <span className="kayolo-tip-name">{quiet || away ? label : t("kayolo.name")}</span>
        {line && !quiet ? <span className="kayolo-tip-line">{line}</span> : null}
        {hintLeft && !quiet && !away ? <span className="kayolo-tip-line">{t(phone ? "kayolo.hintTouch" : "kayolo.hint")}</span> : null}
      </span>
    );
  };
  const tip = useTip(tipBody, { side: "bottom", delay: TIP_MS, tap: false, disabled: open });
  const tapTip = useFloatTip({ side: "bottom" });
  const tapTimer = useRef(0);

  // «Noticed»: the pointer rests on him 250 ms, or the window has focus.
  const noticeTimer = useRef(0);
  const noticeOn = useRef(false);
  const hintTimer = useRef(0);
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
  /** The «hold for the menu» line counts once it was really on screen (the first 3 times). */
  const countHint = (on: boolean) => {
    window.clearTimeout(hintTimer.current);
    if (on && hintLeft) hintTimer.current = window.setTimeout(() => pageMemory().noteHint(), TIP_MS + 400);
  };
  useEffect(
    () => () => {
      window.clearTimeout(noticeTimer.current);
      window.clearTimeout(hintTimer.current);
      window.clearTimeout(tapTimer.current);
      window.clearTimeout(holdTimer.current);
    },
    []
  );

  /* ---------------- the panel (§4.5) ---------------- */

  /** The hover tip and the tap tip would sit over the panel's rows: they go (blur only hides). */
  const hideTips = () => {
    tip.onBlur(undefined as never);
    tapTip.hide();
    setTipOn(false);
  };
  const openPanel = (focusIn: boolean) => {
    hideTips();
    setOpen(true);
    if (focusIn) {
      // Asleep or hidden, «Погладить» is disabled: the first row that works takes the focus.
      window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    }
  };
  const closePanel = (refocus: boolean) => {
    setOpen(false);
    if (refocus) ref.current?.focus({ preventScroll: true });
  };
  const announce = (what: Said) => {
    // One polite announcement per choice; the same text twice still gets read.
    setSaid("");
    window.requestAnimationFrame(() => setSaid(t(`kayolo.said.${what}`)));
  };
  const pick = (what: "home" | "pet" | "calm" | "asleep" | "hidden") => {
    // Waking him, bringing him back and «Живее» drop the stored mode (the default rules again);
    // a stored «Живой» would override reduced motion, and only /settings may write that (§10).
    if (what === "home") {
      say({ k: "kayolo:call-home" });
      announce("home");
    } else if (what === "pet") {
      say({ k: "ui:pet" });
      announce("pet");
    } else if (what === "calm") {
      if (mode === "calm") chooseDefaultMode();
      else chooseMode("calm");
      announce(mode === "calm" ? "live" : "calm");
    } else if (what === "asleep") {
      if (mode === "asleep") chooseDefaultMode();
      else chooseMode("asleep");
      announce(mode === "asleep" ? "back" : "asleep");
    } else {
      if (mode === "hidden") chooseDefaultMode();
      else chooseMode("hidden");
      announce(mode === "hidden" ? "back" : "hidden");
    }
    closePanel(true);
  };

  // Open: no tip over it; Esc (with the focus on him or in it) closes it and gives the focus back to
  // his window; a press outside or the focus leaving (Tab past it) closes it; no system context
  // menu over it (the context-menu key fires `contextmenu` on key up, after the focus moved in).
  useEffect(() => {
    if (!open) return;
    hideTips();
    const inside = (n: EventTarget | null) =>
      n instanceof Node && !!(panelRef.current?.contains(n) || ref.current?.contains(n));
    const onKey = (e: KeyboardEvent) => {
      // Focus on him, in the panel, or nowhere (Safari does not focus a button on a mouse hold);
      // an Esc meant for something else that has the focus is left alone.
      const at = document.activeElement;
      const free = !at || at === document.body;
      if (e.key !== "Escape" || e.defaultPrevented || !(free || inside(at))) return;
      e.preventDefault();
      closePanel(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) closePanel(false);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) closePanel(false);
    };
    const onMenu = (e: MouseEvent) => {
      if (inside(e.target)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("contextmenu", onMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("contextmenu", onMenu, true);
    };
  }, [open]);

  // A new page or a layout change closes it.
  useEffect(() => {
    setOpen(false);
  }, [path, active]);

  // Shift+K (§4.5, §10): by the key's code, so it works in the Russian layout too; never in a field;
  // off when the person switched it off on /settings (WCAG 2.1.4).
  useEffect(() => {
    if (!shown || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyK" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.defaultPrevented || editable(e.target) || !readKeyOn(local)) return;
      // A sheet, the search or any other modal is open: the focus is theirs.
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      ref.current?.focus({ preventScroll: true });
      openPanel(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, active]);

  /* ---------------- hold for the panel ---------------- */

  const holdTimer = useRef(0);
  /** The last press's pointer: Safari's click is not a PointerEvent. */
  const pressedBy = useRef("");
  const holdFrom = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  /** When the press that the hold took ended (anywhere on the page); Infinity while still down. */
  const heldUpAt = useRef(Infinity);
  const cancelHold = () => {
    window.clearTimeout(holdTimer.current);
    holdFrom.current = null;
  };
  /** A hold (or a finger stroke) took this press: the click of its release is not also a poke.
   *  Released elsewhere, or ended by the system's long-press menu, it swallows nothing later. */
  const holdOn = () => {
    held.current = true;
    heldUpAt.current = Infinity;
    const up = () => {
      heldUpAt.current = performance.now();
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };

  /* ---------------- petting (§4.3) ---------------- */

  const rub = useRef<{ x: number; at: number; dir: number; turns: number[] } | null>(null);
  const pettedAt = useRef(-Infinity);
  /** Desktop: the cursor strokes him (no button, 20–400 px/s, 3 turns in 1.5 s). Phone: a finger
   *  strokes the window sideways (2 turns); the page still scrolls vertically (`pan-y`). */
  const stroke = (x: number, touch: boolean) => {
    const now = performance.now();
    const r = rub.current;
    if (!r || now - r.at > 400) {
      rub.current = { x, at: now, dir: 0, turns: [] };
      return;
    }
    const dx = x - r.x;
    if (Math.abs(dx) < 2) return;
    const speed = (Math.abs(dx) * 1000) / Math.max(1, now - r.at);
    r.x = x;
    r.at = now;
    if (!touch && (speed < 20 || speed > 400)) {
      r.dir = 0;
      r.turns = [];
      return;
    }
    const dir = Math.sign(dx);
    if (r.dir && dir !== r.dir) r.turns = [...r.turns.filter((at) => now - at <= PET_WINDOW_MS), now];
    r.dir = dir;
    if (r.turns.length < (touch ? PET_TURNS_TOUCH : PET_TURNS_MOUSE) || now - pettedAt.current < PET_REST_MS) return;
    r.turns = [];
    pettedAt.current = now;
    if (mode === "asleep" || mode === "hidden" || awayNow(path)) return;
    if (touch) {
      // The stroke is not also a tap or a hold.
      cancelHold();
      holdOn();
    }
    say({ k: "ui:pet" });
  };

  if (!shown) return null;
  const ink = INK_VAR[pixelInkForPath(path)] ?? INK_VAR.brand;

  /** A click, a tap, Enter: wake him, bring him back, call him home or poke him. */
  const act = (keyboard: boolean, touch: boolean) => {
    if (mode === "asleep" || mode === "hidden") {
      chooseDefaultMode();
      announce("back");
      return;
    }
    if (awayNow(path)) {
      say({ k: "kayolo:call-home" });
      return;
    }
    if (keyboard) {
      openPanel(true);
      return;
    }
    say({ k: "ui:poke" });
    if (touch && ref.current) {
      if (hintLeft) pageMemory().noteHint();
      const r = ref.current.getBoundingClientRect();
      tapTip.show({ left: r.left, top: r.top, width: r.width, height: r.height }, tipBody(), { tapped: true });
      window.clearTimeout(tapTimer.current);
      tapTimer.current = window.setTimeout(() => tapTip.hide(), TAP_TIP_MS);
    }
  };

  const kind = mode === "asleep" ? "asleep" : mode === "hidden" ? "hidden" : null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={phone ? "kayolo-slot is-phone" : "kayolo-slot"}
        data-away={away ?? undefined}
        data-mode={kind ?? undefined}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={descId}
        style={{ ["--still-ink" as string]: ink }}
        {...tip}
        onPointerEnter={(e) => {
          tip.onPointerEnter(e);
          if (e.pointerType !== "touch") {
            notice(true);
            countHint(!open);
            setTipOn(!open);
          }
        }}
        onPointerLeave={(e) => {
          tip.onPointerLeave(e);
          notice(false);
          countHint(false);
          setTipOn(false);
          cancelHold();
        }}
        onFocus={(e) => {
          tip.onFocus(e);
          // The tip (and its ticking age) only for keyboard focus, as the tip itself decides; the
          // focus given back after a tap or a click shows nothing and ticks nothing.
          setTipOn(!open && keyboardFocused(e.currentTarget));
          say({ k: "ui:notice", on: true });
        }}
        onBlur={(e) => {
          tip.onBlur(e);
          setTipOn(false);
          say({ k: "ui:notice", on: false });
        }}
        onPointerDown={(e) => {
          tip.onPointerDown(e);
          pressedBy.current = e.pointerType;
          if (e.button !== 0) return;
          held.current = false;
          holdFrom.current = { x: e.clientX, y: e.clientY };
          window.clearTimeout(holdTimer.current);
          holdTimer.current = window.setTimeout(() => {
            if (!holdFrom.current) return;
            holdOn();
            holdFrom.current = null;
            openPanel(false);
          }, HOLD_MS);
        }}
        onPointerMove={(e) => {
          const f = holdFrom.current;
          if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) > HOLD_SLOP) cancelHold();
          const touch = e.pointerType === "touch";
          if (touch ? e.buttons !== 0 : e.buttons === 0) stroke(e.clientX, touch);
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => {
          // A long press on a phone must not bring up the system menu over his panel.
          if (open || held.current || holdFrom.current) e.preventDefault();
        }}
        onMouseDown={(e) => {
          // A double click pokes twice; it never selects the title next to him.
          if (e.detail > 1) e.preventDefault();
        }}
        onKeyDown={(e) => {
          tip.onKeyDown(e);
          if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
            e.preventDefault();
            openPanel(true);
          }
        }}
        onClick={(e) => {
          if (held.current) {
            held.current = false;
            // The release that opened the panel is not also a poke (its click comes at once);
            // a later Enter or click is a new press.
            if (e.detail !== 0 && performance.now() - heldUpAt.current < 1000) return;
          }
          if (open) {
            closePanel(false);
            return;
          }
          const by = (e.nativeEvent as PointerEvent).pointerType || pressedBy.current;
          pressedBy.current = "";
          act(e.detail === 0, by === "touch");
        }}
      >
        <span className="kayolo-still" aria-hidden />
        <canvas className="kayolo-canvas" aria-hidden width={0} height={0} />
        <span id={descId} hidden>
          {t("kayolo.desc")}
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={t("kayolo.menu.label")}
          className={phone ? "kayolo-panel is-phone" : "kayolo-panel"}
          style={phone ? undefined : { left: `calc(${ref.current?.style.left || "50%"} + 20px)` }}
        >
          <p className="kayolo-panel-status">{status() ?? t("kayolo.name")}</p>
          {away ? (
            <button type="button" className="kayolo-panel-row" onClick={() => pick("home")}>
              {t("kayolo.menu.home")}
            </button>
          ) : null}
          <button type="button" className="kayolo-panel-row" disabled={mode === "asleep" || mode === "hidden"} onClick={() => pick("pet")}>
            {t("kayolo.menu.pet")}
          </button>
          {/* Each row names what it does next (Тише/Живее…), so no aria-pressed: a toggle's label
              must not change with its state. */}
          {mode === "calm" && reduce ? null : (
            <button type="button" className="kayolo-panel-row" onClick={() => pick("calm")}>
              {t(mode === "calm" ? "kayolo.menu.live" : "kayolo.menu.calm")}
            </button>
          )}
          <button type="button" className="kayolo-panel-row" onClick={() => pick("asleep")}>
            {t(mode === "asleep" ? "kayolo.menu.wake" : "kayolo.menu.sleep")}
          </button>
          <button type="button" className="kayolo-panel-row" onClick={() => pick("hidden")}>
            {t(mode === "hidden" ? "kayolo.menu.show" : "kayolo.menu.hide")}
          </button>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </>
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

/**
 * Loads the engine after the page settles (§9.4): idle callback, 2 s at most; Safari waits 1.2 s.
 * Not on the API host: there is no window for him there.
 */
export function KayoloBoot() {
  const { api } = useSiteHost();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!KAYOLO_LAYER || api) return;
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
  }, [api]);
  return on && !api ? (
    <KayoloGuard>
      <KayoloLayer />
    </KayoloGuard>
  ) : null;
}

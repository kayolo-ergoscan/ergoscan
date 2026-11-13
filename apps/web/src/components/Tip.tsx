"use client";

/**
 * One hover tip for the whole site. A trigger (an element, a canvas body, a
 * chart point) asks the single <TipHost> to show its content; the host puts it
 * on <body>, so no card with overflow hidden can clip it, and keeps it inside
 * the viewport (lib/tip-place). One tip at a time.
 *
 * Mouse: shows after a short delay, hides at once. Moving on to the next
 * trigger while a tip is up shows the next one at once, without the fade.
 * Keyboard: focus-visible shows it, Escape and blur hide it.
 * Touch: a tap shows it, a tap anywhere else hides it.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { placeTip, type TipRect, type TipSide } from "@/lib/tip-place";
import { say } from "@/lib/kayolo/events";

export type { TipSide, TipRect };

const TIP_ID = "site-tip";
/** First tip: wait this long so a passing cursor does not flash tips. */
const SHOW_DELAY_MS = 90;
/** A tip that closed less than this ago makes the next one show at once. */
const WARM_MS = 400;
/** Interactive tips: time to move the cursor from the anchor onto the tip. */
const GRACE_MS = 160;

type Anchor = Element | TipRect;

type TipReq = {
  owner: symbol;
  anchor: Anchor;
  /** Taps on this element count as taps on the trigger (a canvas). */
  within?: Element | null;
  content: ReactNode;
  side: TipSide;
  interactive: boolean;
  tapped: boolean;
  /** Fade in (first tip) or appear in place (moving between triggers). */
  enter: boolean;
};

/* ───────────────────────────── store ───────────────────────────── */

let cur: TipReq | null = null;
/** Last moment a tip was on screen: a tip shown soon after skips delay and fade. */
let seenAt = 0;
let showTimer = 0;
let pending: Omit<TipReq, "enter"> | null = null;
let graceTimer = 0;
const listeners = new Set<() => void>();
let place: (() => void) | null = null;

/** The owner Kayolo was last told about: he hears a tip open or go, not every content update. */
let toldOwner: symbol | null = null;

function emit() {
  for (const l of listeners) l();
  const owner = cur?.owner ?? null;
  if (owner === toldOwner) return;
  toldOwner = owner;
  if (!cur) say({ k: "ui:tip-close" });
  else if (cur.anchor instanceof Element) say({ k: "ui:tip-open", el: cur.anchor });
  else say({ k: "ui:tip-open", rect: cur.anchor });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getCur() {
  return cur;
}

function warm(): boolean {
  return cur != null || performance.now() - seenAt < WARM_MS;
}

function clearShow() {
  if (showTimer) window.clearTimeout(showTimer);
  showTimer = 0;
  pending = null;
}

function clearGrace() {
  if (graceTimer) window.clearTimeout(graceTimer);
  graceTimer = 0;
}

export const tipStore = {
  isOpen(owner: symbol): boolean {
    return cur?.owner === owner;
  },
  show(req: Omit<TipReq, "enter">, delay = SHOW_DELAY_MS) {
    clearGrace();
    if (cur?.owner === req.owner) {
      cur = { ...req, enter: cur.enter };
      emit();
      return;
    }
    // Same trigger still waiting out its delay (a cursor moving over a canvas): keep the clock.
    if (pending?.owner === req.owner && showTimer) {
      pending = req;
      return;
    }
    const open = () => {
      const next = pending ?? req;
      showTimer = 0;
      pending = null;
      cur = { ...next, enter: !warm() };
      seenAt = performance.now();
      emit();
    };
    clearShow();
    if (delay <= 0 || warm()) open();
    else {
      pending = req;
      showTimer = window.setTimeout(open, delay);
    }
  },
  /** New content or anchor for an open tip. Anchor moves skip React. */
  update(owner: symbol, patch: Partial<Pick<TipReq, "content" | "anchor">>) {
    if (pending?.owner === owner) pending = { ...pending, ...patch };
    if (cur?.owner !== owner) return;
    if (patch.content === undefined && patch.anchor) {
      cur.anchor = patch.anchor;
      place?.();
      return;
    }
    cur = { ...cur, ...patch };
    emit();
  },
  hide(owner?: symbol, grace = 0) {
    if (!owner || pending?.owner === owner) clearShow();
    if (!cur || (owner && cur.owner !== owner)) return;
    if (grace > 0) {
      clearGrace();
      graceTimer = window.setTimeout(() => {
        graceTimer = 0;
        tipStore.hide(owner);
      }, grace);
      return;
    }
    clearGrace();
    seenAt = performance.now();
    cur = null;
    emit();
  },
  hold() {
    clearGrace();
  },
};

/* ───────────────────────────── host ───────────────────────────── */

function rectOf(a: Anchor): TipRect | null {
  if (a instanceof Element) {
    if (!a.isConnected) return null;
    const r = a.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return a;
}

function offscreen(r: TipRect, vw: number, vh: number): boolean {
  return r.top + r.height < 0 || r.top > vh || r.left + r.width < 0 || r.left > vw;
}

/** Mounted once in Providers. Renders the one tip on <body>. */
export function TipHost() {
  const req = useSyncExternalStore(subscribe, getCur, () => null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    tipStore.hide();
  }, [pathname]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!req || !el) {
      place = null;
      return;
    }
    const position = () => {
      const now = cur;
      if (!now) return;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const r = rectOf(now.anchor);
      if (!r || (now.anchor instanceof Element && offscreen(r, vw, vh))) {
        tipStore.hide(now.owner);
        return;
      }
      const spot = placeTip(r, el.offsetWidth, el.offsetHeight, now.side, vw, vh);
      el.style.left = `${spot.x}px`;
      el.style.top = `${spot.y}px`;
      if (el.dataset.side !== spot.side) el.dataset.side = spot.side;
    };
    place = position;
    position();
    // Element anchors move with layout, scroll and live updates: follow them.
    let raf = 0;
    const follow = () => {
      position();
      raf = requestAnimationFrame(follow);
    };
    if (req.anchor instanceof Element) raf = requestAnimationFrame(follow);
    const onScroll = () => position();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [req]);

  // The trigger element is described by the tip while it is up.
  useEffect(() => {
    const a = req?.anchor;
    if (!(a instanceof Element)) return;
    const prev = a.getAttribute("aria-describedby");
    if (prev?.split(" ").includes(TIP_ID)) return;
    a.setAttribute("aria-describedby", prev ? `${prev} ${TIP_ID}` : TIP_ID);
    return () => {
      if (prev) a.setAttribute("aria-describedby", prev);
      else a.removeAttribute("aria-describedby");
    };
  }, [req?.anchor]);

  const open = req != null;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const now = cur;
      if (!now) return;
      const t = e.target as Node | null;
      if (t && ref.current?.contains(t)) return;
      if (t && now.anchor instanceof Element && now.anchor.contains(t)) return;
      if (t && now.within?.contains(t)) return;
      tipStore.hide();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") tipStore.hide();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted || !req) return null;
  return createPortal(
    <div
      ref={ref}
      id={TIP_ID}
      role="tooltip"
      className={clsx("tip", req.interactive && "is-interactive", req.tapped && "is-tapped")}
      data-side={req.side}
      data-enter={req.enter ? "" : undefined}
      onPointerEnter={req.interactive ? () => tipStore.hold() : undefined}
      onPointerLeave={
        req.interactive
          ? (e) => {
              if (e.pointerType !== "touch") tipStore.hide(req.owner, GRACE_MS);
            }
          : undefined
      }
    >
      {typeof req.content === "string" ? <p className="tip-text">{req.content}</p> : req.content}
    </div>,
    document.body
  );
}

/* ─────────────────────────── triggers ─────────────────────────── */

export type TipOptions = {
  side?: TipSide;
  /** Tap on a phone shows the tip. Off for buttons whose tap is the action. */
  tap?: boolean;
  /**
   * A link or button whose meaning is in the tip: on a phone the first tap shows
   * the tip, the second tap (tip up) does the action.
   */
  peek?: boolean;
  /** The tip holds links or buttons: it stays while the cursor moves onto it. */
  interactive?: boolean;
  delay?: number;
  disabled?: boolean;
};

type Content = ReactNode | (() => ReactNode);

function resolve(c: Content): ReactNode {
  return typeof c === "function" ? (c as () => ReactNode)() : c;
}

function useOwner(): symbol {
  const [owner] = useState(() => Symbol("tip"));
  return owner;
}

type TriggerProps = {
  onPointerEnter: (e: ReactPointerEvent<Element>) => void;
  onPointerLeave: (e: ReactPointerEvent<Element>) => void;
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onFocus: (e: FocusEvent<Element>) => void;
  onBlur: (e: FocusEvent<Element>) => void;
  onKeyDown: (e: KeyboardEvent<Element>) => void;
  onClickCapture: (e: ReactMouseEvent<Element>) => void;
};

/** Hover/focus/tap handlers for one element. Spread them, or use <Tip>. */
export function useTip(content: Content, opts: TipOptions = {}): TriggerProps {
  const owner = useOwner();
  const live = useRef({ content, opts });
  live.current = { content, opts };
  /** Peek: the click after a first tap only showed the tip. */
  const swallowAt = useRef(0);

  // Content that changes while the tip is up (a ticking age) follows.
  useEffect(() => {
    if (tipStore.isOpen(owner)) tipStore.update(owner, { content: resolve(content) });
  });
  useEffect(() => () => tipStore.hide(owner), [owner]);

  const request = (el: Element, tapped: boolean) => {
    const { content: c, opts: o } = live.current;
    return {
      owner,
      anchor: el,
      content: resolve(c),
      side: o.side ?? "top",
      interactive: !!o.interactive,
      tapped,
    };
  };

  return {
    onPointerEnter: (e) => {
      if (e.pointerType === "touch" || live.current.opts.disabled) return;
      tipStore.show(request(e.currentTarget, false), live.current.opts.delay);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === "touch") return;
      tipStore.hide(owner, live.current.opts.interactive ? GRACE_MS : 0);
    },
    onPointerDown: (e) => {
      const o = live.current.opts;
      swallowAt.current = 0;
      if (e.pointerType !== "touch" || o.disabled || (o.tap === false && !o.peek)) return;
      if (o.peek) {
        if (tipStore.isOpen(owner)) return;
        swallowAt.current = performance.now();
        tipStore.show(request(e.currentTarget, true), 0);
        return;
      }
      if (tipStore.isOpen(owner)) tipStore.hide(owner);
      else tipStore.show(request(e.currentTarget, true), 0);
    },
    onClickCapture: (e) => {
      const at = swallowAt.current;
      swallowAt.current = 0;
      if (!at || performance.now() - at > 1000) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onFocus: (e) => {
      if (live.current.opts.disabled) return;
      const el = e.currentTarget;
      if (el instanceof HTMLElement && !keyboardFocus(el)) return;
      tipStore.show(request(el, false), 0);
    },
    onBlur: () => tipStore.hide(owner),
    onKeyDown: (e) => {
      if (e.key === "Escape") tipStore.hide(owner);
    },
  };
}

/** Focus that came from the keyboard, on the element or inside it (a wrapped link). */
function keyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible") || el.matches(":has(:focus-visible)");
  } catch {
    return el.matches(":focus-visible");
  }
}

type AnyProps = Record<string, unknown> & { ref?: Ref<Element> };

function chain<E>(a: ((e: E) => void) | undefined, b: (e: E) => void) {
  return a ? (e: E) => {
    a(e);
    b(e);
  } : b;
}

/**
 * Wraps one element (a span, a link, a button) without adding a box around it.
 * `content` may be a function so a long list does not build tips nobody opens.
 */
export function Tip({
  content,
  children,
  ...opts
}: TipOptions & { content: Content | null | undefined; children: ReactElement }) {
  const off = content == null || content === "" || opts.disabled;
  const bind = useTip(content ?? null, { ...opts, disabled: off });
  const child = Children.only(children);
  if (off || !isValidElement(child)) return child;
  const p = child.props as AnyProps;
  return cloneElement(child as ReactElement<AnyProps>, {
    onPointerEnter: chain(p.onPointerEnter as never, bind.onPointerEnter),
    onPointerLeave: chain(p.onPointerLeave as never, bind.onPointerLeave),
    onPointerDown: chain(p.onPointerDown as never, bind.onPointerDown),
    onFocus: chain(p.onFocus as never, bind.onFocus),
    onBlur: chain(p.onBlur as never, bind.onBlur),
    onKeyDown: chain(p.onKeyDown as never, bind.onKeyDown),
    onClickCapture: chain(p.onClickCapture as never, bind.onClickCapture),
    // A tap here shows a tip: a row that opens on tap leaves this tap alone (Feed.tsx).
    "data-tip": opts.tap === false && !opts.peek ? undefined : "",
  });
}

/**
 * (i) for a finger. Shown only on coarse pointers (tip.css), beside a figure whose
 * own tap opens a page: the tap on (i) shows the same tip and goes nowhere.
 */
export function TipInfo({
  content,
  label,
  side = "top",
}: {
  content: Content;
  label: string;
  side?: TipSide;
}) {
  const bind = useTip(content, { side });
  return (
    <button
      type="button"
      className="tip-info"
      aria-label={label}
      {...bind}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 7.2v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
      </svg>
    </button>
  );
}

/**
 * A tip placed by hand: canvas bodies, chart points, a globe node. Call `show`
 * with a viewport rect (and again as the thing moves), `hide` when it leaves.
 */
export function useFloatTip(opts: { side?: TipSide; within?: () => Element | null } = {}) {
  const owner = useOwner();
  const live = useRef(opts);
  live.current = opts;
  useEffect(() => () => tipStore.hide(owner), [owner]);
  const api = useRef({
    show(rect: TipRect, content: ReactNode, o: { tapped?: boolean; delay?: number } = {}) {
      if (tipStore.isOpen(owner)) {
        tipStore.update(owner, { anchor: rect, content });
        return;
      }
      tipStore.show(
        {
          owner,
          anchor: rect,
          within: live.current.within?.() ?? null,
          content,
          side: live.current.side ?? "top",
          interactive: false,
          tapped: !!o.tapped,
        },
        o.tapped ? 0 : o.delay
      );
    },
    move(rect: TipRect) {
      tipStore.update(owner, { anchor: rect });
    },
    hide() {
      tipStore.hide(owner);
    },
    isOpen() {
      return tipStore.isOpen(owner);
    },
  });
  return api.current;
}

/* ─────────────────────────── content ─────────────────────────── */

/** Header line: a small chip in the entity colour, then a title. */
export function TipHead({
  chip,
  ink,
  children,
  mono = false,
  quiet = false,
}: {
  chip?: ReactNode;
  /** Chip colour (an entity colour); the chip ink stays black. */
  ink?: string;
  children?: ReactNode;
  mono?: boolean;
  /** A dateline above figures: muted, not bold. */
  quiet?: boolean;
}) {
  return (
    <div className="tip-head">
      {chip != null ? (
        <span
          className={clsx("tip-chip", ink && "is-ink")}
          style={ink ? ({ ["--tip-ink" as string]: ink } as CSSProperties) : undefined}
        >
          {chip}
        </span>
      ) : null}
      {children != null ? (
        <span className={clsx("tip-title", mono && "font-mono tabular-nums", quiet && "is-quiet")}>{children}</span>
      ) : null}
    </div>
  );
}

/** Label / figure lines. Figures right-aligned in tabular mono. */
export function TipRows({ children }: { children: ReactNode }) {
  return <dl className="tip-rows">{children}</dl>;
}

export function TipRow({
  label,
  children,
  ink,
  dot,
  text = false,
}: {
  label: ReactNode;
  children: ReactNode;
  ink?: string;
  /** A small colour dot before the label: the series it reads. */
  dot?: string;
  /** The value is a word (a name), not a figure: no mono. */
  text?: boolean;
}) {
  return (
    <>
      <dt>
        {dot ? <span className="tip-dot" style={{ background: dot }} aria-hidden /> : null}
        {label}
      </dt>
      <dd className={text ? "is-text" : "tabular-nums"} style={ink ? { color: ink } : undefined}>
        {children}
      </dd>
    </>
  );
}

/** One figure on its own line (a single-series chart point). */
export function TipFigure({ children, dot, ink }: { children: ReactNode; dot?: string; ink?: string }) {
  return (
    <p className="tip-figure">
      {dot ? <span className="tip-dot" style={{ background: dot }} aria-hidden /> : null}
      <span className="tabular-nums" style={ink ? { color: ink } : undefined}>
        {children}
      </span>
    </p>
  );
}

export function TipNote({ children }: { children: ReactNode }) {
  return <p className="tip-note">{children}</p>;
}

/** A full id or hash, wrapped, in mono. */
export function TipHash({ children }: { children: ReactNode }) {
  return <p className="tip-hash font-mono">{children}</p>;
}

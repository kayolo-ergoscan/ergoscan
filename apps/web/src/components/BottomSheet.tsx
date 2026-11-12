"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyEvent,
  type PointerEvent as ReactPointerEvent,
  type AnchorHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { useT } from "@/lib/i18n/I18nProvider";

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

type SheetState = { ergoSheet?: string } | null;

/** Markers of the sheets open in this page (a reload can leave a stale one in history). */
const liveMarkers = new Set<string>();

function sheetMarker(): string | undefined {
  try {
    return (window.history.state as SheetState)?.ergoSheet;
  } catch {
    return undefined;
  }
}

/**
 * One history entry per open sheet, so the phone Back button closes it.
 * Closing from the UI pops that entry again. A link that leaves from inside the
 * sheet calls `leave()` first and navigates with `replace`: the entry is
 * replaced by the new page, so Back then returns to the page under the sheet.
 */
export function useSheetHistory(open: boolean, onClose: () => void): { leave: () => void } {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const leaving = useRef(false);

  useEffect(() => {
    if (!open) return;
    leaving.current = false;
    const marker = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    try {
      window.history.pushState({ ergoSheet: marker }, "");
    } catch {
      return;
    }
    liveMarkers.add(marker);
    let popped = false;
    const onPop = () => {
      if (sheetMarker() === marker) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      liveMarkers.delete(marker);
      if (popped || leaving.current) return;
      if (sheetMarker() === marker) window.history.back();
    };
  }, [open]);

  const leave = useCallback(() => {
    leaving.current = true;
  }, []);
  return { leave };
}

/** True while an open sheet's history entry is the current one (links then use `replace`). */
export function sheetOnTop(): boolean {
  if (typeof window === "undefined") return false;
  const m = sheetMarker();
  return m != null && liveMarkers.has(m);
}

const LeaveCtx = createContext<() => void>(() => {});

/** Call before a link inside the sheet navigates away. */
export function useSheetLeave(): () => void {
  return useContext(LeaveCtx);
}

/**
 * A page link inside a sheet. A plain tap closes the sheet and swaps its history
 * entry for the page; modified clicks (new tab, …) keep the browser default.
 */
export function SheetNavLink({
  href,
  onDone,
  children,
  ...rest
}: {
  href: string;
  onDone: () => void;
  children: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const router = useRouter();
  const leave = useSheetLeave();
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const fromSheet = sheetOnTop();
        if (fromSheet) leave();
        onDone();
        if (fromSheet) router.replace(href);
        else router.push(href);
      }}
    >
      {children}
    </Link>
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Phone modal bottom sheet: scrim, grabber (drag down to close), × button,
 * Escape and Back close it, focus stays inside while it is open.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  head,
  children,
  bodyRef,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** Left side of the head row: a title, or a back button and title. */
  head: ReactNode;
  children: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const { leave } = useSheetHistory(open, onClose);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  const trap = (e: ReactKeyEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = panel.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0
    );
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    if ((e.target as HTMLElement).closest("button,a,input")) return;
    drag.start(e);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sheet-scrim"
          className="sheet-scrim fixed inset-0 z-[80] lg:hidden"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE }}
          onClick={onClose}
        />
      )}
      {open && (
        <motion.div
          key="sheet-panel"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={clsx(
            "bottom-sheet fixed inset-x-0 bottom-0 z-[81] mx-auto flex max-h-[85dvh] w-full max-w-[560px] flex-col outline-none lg:hidden",
            className
          )}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ duration: reduce ? 0.12 : 0.3, ease: EASE }}
          drag={reduce ? false : "y"}
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.85 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 96 || info.velocity.y > 640) onClose();
          }}
          onKeyDown={trap}
        >
          <div className="bottom-sheet-head shrink-0" onPointerDown={startDrag}>
            <span className="bottom-sheet-grabber" aria-hidden />
            <div className="flex min-h-[48px] items-center gap-1 pl-4 pr-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1">{head}</div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("nav.close")}
                className="chip-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <LeaveCtx.Provider value={leave}>
            <div
              ref={bodyRef}
              className="bottom-sheet-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
            >
              {children}
            </div>
          </LeaveCtx.Provider>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

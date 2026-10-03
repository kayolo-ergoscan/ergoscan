"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { RouteNavProgress } from "./RouteNavProgress";
import { IndexerStatus } from "./IndexerStatus";
import { ChromeHeading } from "./ChromeHeading";
import { MobileTabBar } from "./MobileTabBar";
import { NavBrand, SideNavDrawer, SideNavRail } from "./SideNav";
import { SyncChip, useKeepFresh } from "@/lib/page-sync";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { getGateway } from "@/lib/config";
import { fetchChainStats } from "@/lib/chain-stats";
import { formatCompact, formatUsd } from "@/lib/format";
import { HOME, INK } from "@/lib/palette";
import { HeaderScout } from "./HeaderScout";
import { SCOUT_CUES_EN, SCOUT_CUES_RU } from "@/lib/header-scout";

function SheetMark({ home }: { home: boolean }) {
  const prev = useRef(home);
  const [phase, setPhase] = useState<"hidden" | "arm" | "in" | "out">(home ? "hidden" : "in");
  const [front, setFront] = useState(false);

  useEffect(() => {
    if (prev.current === home) return;
    prev.current = home;
    if (home) {
      setPhase("out");
      setFront(true);
      const id = window.setTimeout(() => {
        setPhase("hidden");
        setFront(false);
      }, 760);
      return () => window.clearTimeout(id);
    }
    setPhase("arm");
    setFront(true);
    let inner = 0;
    let done = 0;
    const raf = requestAnimationFrame(() => {
      inner = window.setTimeout(() => {
        setPhase("in");
        done = window.setTimeout(() => setFront(false), 760);
      }, 30);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(inner);
      window.clearTimeout(done);
    };
  }, [home]);

  return (
    <div
      className={clsx(
        "sheet-spin",
        phase === "in" && "is-in",
        phase === "out" && "is-out",
        phase === "hidden" && "is-hidden",
        front && "is-front"
      )}
      aria-hidden
    >
      <span className="sheet-spin-drift">
        <img src="/ergoscan-mark.svg" alt="" />
      </span>
    </div>
  );
}

function openSearch() {
  window.dispatchEvent(new Event("lumen:open-search"));
}

const NestedShell = createContext(false);

export function Shell({
  children,
}: {
  children?: ReactNode;
  /** @deprecated chrome is layout-owned; ignored */
  status?: ReactNode;
}) {
  const nested = useContext(NestedShell);
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railReady, setRailReady] = useState(false);

  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem("lumen.rail") === "1");
    } catch {
      /* */
    }
    setRailReady(true);
  }, []);

  const toggleRail = useCallback(() => {
    setRailCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("lumen.rail", next ? "1" : "0");
      } catch {
        /* */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  if (nested) return <>{children}</>;

  return (
    <NestedShell.Provider value={true}>
      <CommandPalette />
      <RouteNavProgress />
      <SideNavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div
        className={
          railReady
            ? "stage-frame is-ready min-h-dvh lg:grid lg:grid-cols-[var(--rail)_minmax(0,1fr)]"
            : "stage-frame min-h-dvh lg:grid lg:grid-cols-[var(--rail)_minmax(0,1fr)]"
        }
        data-rail={railCollapsed ? "collapsed" : "open"}
      >
        <SideNavRail collapsed={railCollapsed} onToggle={toggleRail} />

        <div className="stage-col flex min-h-dvh min-w-0 flex-col max-lg:pb-[var(--tabbar)]">
          <SheetMark home={path === "/"} />
          <header className="sticky top-0 z-40 overflow-visible border-b border-[var(--border)] bg-[var(--bg)] pt-[env(safe-area-inset-top)]">
            <div className="stage-width hidden h-[var(--toolbar)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3 px-4 sm:px-6 lg:grid lg:px-8">
              <div className="flex h-full min-w-0 items-center gap-3">
                <SearchField />
              </div>

              <ChromeHeading />

              <div className="flex h-full min-w-0 items-center justify-end gap-3">
                <ErgPrice />
              </div>
            </div>
            <HeaderScout />

            <div className="stage-width flex h-[var(--toolbar)] items-center gap-2 px-4 sm:px-6 lg:hidden">
              <NavBrand compact />
              <SearchField phone />
              <ErgPrice compact />
            </div>
          </header>

          <main className="stage-main flex-1 py-5 pb-[max(2rem,env(safe-area-inset-bottom))] max-lg:pb-5 lg:py-5">
            <div className={clsx("stage-width plane-stage px-4 sm:px-6 lg:px-8", path === "/" && "home-stage")}>{children}</div>
          </main>

          <footer className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 max-lg:pb-4">
            <div className="stage-width flex flex-col gap-1.5 px-4 text-[11px] text-[var(--muted-2)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 lg:px-8">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-3">
                <span className="inline-flex items-baseline gap-[0.28em] font-semibold tracking-[0.06em]">
                  <span style={{ color: HOME.forming }}>ERGO</span>
                  <span style={{ color: INK.cyan }}>SCAN</span>
                  <span style={{ color: "var(--down)" }}>ME</span>
                </span>
                <SyncChip compact />
              </span>
              <IndexerStatus />
            </div>
          </footer>
        </div>
      </div>
      <MobileTabBar onMore={() => setMenuOpen(true)} />
    </NestedShell.Provider>
  );
}


function SearchField({ phone = false }: { phone?: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const cue = useSearchCue(locale === "ru" ? SCOUT_CUES_RU : SCOUT_CUES_EN);

  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label={t("nav.searchChain")}
      data-scout="search"
      className={
        phone
          ? "flex h-11 min-w-0 flex-1 items-center gap-2 bg-transparent text-left"
          : "hidden h-8 min-w-0 items-center gap-2 bg-transparent text-left lg:flex"
      }
    >
      <SearchSlashIcon />
      <span className="inline-flex min-w-0 items-baseline truncate text-[15px] font-medium tracking-tight text-[var(--text)]">
        <span className="truncate">{cue}</span>
        <span className="search-caret ml-0.5 text-[var(--accent)]" aria-hidden>
          _
        </span>
      </span>
    </button>
  );
}

function useSearchCue(words: string[]): string {
  const [text, setText] = useState("");
  const key = words.join("\n");
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(words[0] ?? "");
      return;
    }
    let dead = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push(window.setTimeout(resolve, ms));
      });
    const run = async () => {
      setText("");
      await wait(1200);
      let i = 0;
      while (!dead) {
        const word = words[i % words.length] ?? "";
        for (let c = 1; c <= word.length; c++) {
          if (dead) return;
          setText(word.slice(0, c));
          await wait(70);
        }
        await wait(1100);
        for (let c = word.length - 1; c >= 0; c--) {
          if (dead) return;
          setText(word.slice(0, c));
          await wait(32);
        }
        await wait(480);
        i += 1;
      }
    };
    void run();
    return () => {
      dead = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [key]);
  return text;
}

function SearchSlashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-[var(--accent)]">
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path className="search-slash" d="m13.5 8.5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ErgPrice({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [usd, setUsd] = useState<number | null>(null);
  const [circulating, setCirculating] = useState<number | null>(null);

  const load = useCallback(() => {
    void fetch(`${getGateway()}/v1/prices/erg`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        const price =
          p && typeof p === "object" && typeof (p as { usd?: number }).usd === "number"
            ? (p as { usd: number }).usd
            : null;
        setUsd(price != null && price > 0 ? price : null);
      })
      .catch(() => null);
    void fetchChainStats().then((s) => {
      if (!s) return;
      setCirculating(s.circulating != null && s.circulating > 0 ? s.circulating : null);
    });
  }, []);

  useKeepFresh(load);

  useEffect(() => {
    load();
  }, [load]);

  const mcap = usd != null && circulating != null ? usd * circulating : null;
  const priceText = usd != null ? formatUsd(usd, 2) : "—";
  const mcapText = mcap != null ? `$${formatCompact(mcap)}` : "—";
  return (
    <Link
      href="/"
      title={`${t("header.ergPrice")} ${priceText} · ${t("header.mcap")} ${mcapText}`}
      className={
        compact
          ? "flex h-11 shrink-0 items-center px-1"
          : "hidden h-8 items-center gap-1.5 sm:flex"
      }
    >
      {compact ? null : (
        <span data-scout="price-label" className="whitespace-nowrap text-[13px] text-[var(--muted)]">
          {t("header.ergPrice")}
        </span>
      )}
      <span
        data-scout="price"
        className="inline-block min-w-[3.25rem] text-[13px] font-medium tabular-nums"
        style={{ color: INK.violet }}
      >
        {priceText}
      </span>
      {compact ? null : (
        <>
          <span data-scout="mcap-label" className="ml-10 whitespace-nowrap text-[12px] text-[var(--muted)]">
            {t("header.mcap")}
          </span>
          <span
            data-scout="mcap"
            className="inline-block min-w-[4.25rem] text-[12px] font-medium tabular-nums"
            style={{ color: INK.violet }}
          >
            {mcapText}
          </span>
        </>
      )}
    </Link>
  );
}


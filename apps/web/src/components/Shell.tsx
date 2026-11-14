"use client";

import Link from "next/link";
import { Tip, TipRow, TipRows } from "./Tip";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "./CommandPalette";
import { RouteNavProgress } from "./RouteNavProgress";
import { SyncChip, useKeepFresh } from "@/lib/page-sync";
import { ChromeHeading } from "./ChromeHeading";
import { MobileTabBar } from "./MobileTabBar";
import { NavBrand, SideNavRail } from "./SideNav";
import { MoreSheet } from "./MoreSheet";
import { PriceSheet } from "./PriceSheet";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { fetchChainStats } from "@/lib/chain-stats";
import { formatCompact, formatUsdPrice } from "@/lib/format";
import { IndexerStatus } from "./IndexerStatus";
import { INK_TEXT } from "@/lib/palette";
import { BrandMark, BrandWord } from "./BrandMark";
import { HeaderScout } from "./HeaderScout";
import { KayoloBoot, KayoloSlot } from "./kayolo/KayoloSlot";
import { ErgUsdContext, PriceTape, useSiteMarket } from "./PriceTape";
import type { SiteMarket } from "@/lib/site-market";
import { SCOUT_CUES_EN, SCOUT_CUES_RU } from "@/lib/header-scout";

function registerRailLength() {
  if (typeof window === "undefined" || typeof CSS === "undefined" || !CSS.registerProperty) return;
  try {
    CSS.registerProperty({
      name: "--rail",
      syntax: "<length>",
      inherits: false,
      initialValue: "248px",
    });
  } catch {
    /* The stylesheet rule already registered it. */
  }
}

registerRailLength();

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
        <BrandMark size={64} />
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
  market = null,
}: {
  children?: ReactNode;
  /** @deprecated chrome is layout-owned; ignored */
  status?: ReactNode;
  market?: SiteMarket | null;
}) {
  const nested = useContext(NestedShell);
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
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
    setPriceOpen(false);
  }, [path]);

  // Phone sheets only. A window grown past the phone width closes them.
  useEffect(() => {
    if (!menuOpen && !priceOpen) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const shut = () => {
      if (!wide.matches) return;
      setMenuOpen(false);
      setPriceOpen(false);
    };
    shut();
    wide.addEventListener("change", shut);
    return () => wide.removeEventListener("change", shut);
  }, [menuOpen, priceOpen]);

  const openPrices = useCallback(() => {
    setMenuOpen(false);
    setPriceOpen(true);
  }, []);

  const live = useSiteMarket(!nested, market);

  if (nested) return <>{children}</>;

  return (
    <ErgUsdContext.Provider value={live.usd}>
    <NestedShell.Provider value={true}>
      <CommandPalette />
      <RouteNavProgress />
      <MoreSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} rows={live.rows} usd={live.usd} />
      <div
        className={
          railReady
            ? "stage-frame is-ready min-h-dvh lg:grid lg:grid-cols-[var(--rail)_minmax(0,var(--stage-max))]"
            : "stage-frame min-h-dvh lg:grid lg:grid-cols-[var(--rail)_minmax(0,var(--stage-max))]"
        }
        data-rail={railCollapsed ? "collapsed" : "open"}
      >
        <SideNavRail collapsed={railCollapsed} onToggle={toggleRail} />

        <div className={clsx("stage-col flex min-h-dvh min-w-0 flex-col", path !== "/" && "is-dockless")}>
          <SheetMark home={path === "/"} />
          <header className="sticky top-0 z-40 overflow-visible border-b border-[var(--border)] bg-[var(--bg)] pt-[env(safe-area-inset-top)] max-lg:border-transparent max-lg:bg-transparent max-lg:px-3 max-lg:pb-[0.4rem] max-lg:pt-[calc(0.45rem+env(safe-area-inset-top,0px))]">
            <div className="stage-width hidden h-[var(--toolbar)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3 px-4 sm:px-6 lg:grid lg:px-8">
              <div className="flex h-full min-w-0 items-center gap-3">
                <SearchField />
              </div>

              {/* Kayolo's window is ChromeHeading's sibling, between search and price in Tab order (§3.1). */}
              <div className="relative h-full">
                <ChromeHeading />
                <KayoloSlot />
              </div>

              <div className="flex h-full min-w-0 items-center justify-end gap-3">
                <ErgPrice />
              </div>
            </div>
            <HeaderScout />
            <KayoloBoot />

            <div className="phone-toolbar flex h-14 items-center gap-2 px-2.5 lg:hidden">
              <NavBrand compact />
              <SearchField />
              {/* His window in the pill: brand → search → Kayolo → price in Tab order (§3.2). */}
              <KayoloSlot phone />
              <ErgPrice compact onOpen={openPrices} />
            </div>
          </header>

          <main className="stage-main flex-1 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] max-lg:pb-5 lg:pt-2 lg:pb-5">
            <div className={clsx("stage-width plane-stage px-4 sm:px-6 lg:px-8", path === "/" && "home-stage")}>{children}</div>
          </main>

          <footer className="page-tail">
            <span className="inline-flex min-w-0 flex-wrap items-center gap-3">
              <span className="page-tail-brand">
                <BrandMark size={16} />
                <BrandWord />
              </span>
              <SyncChip compact />
            </span>
            <IndexerStatus />
          </footer>

          <footer className="explorer-dock">
            <PriceTape rows={live.rows} fresh={live.fresh} />
            <PricesHit onOpen={openPrices} />
          </footer>
        </div>
      </div>
      <MobileTabBar
        moreOpen={menuOpen}
        onMore={() => {
          setPriceOpen(false);
          setMenuOpen((v) => !v);
        }}
      />
    </NestedShell.Provider>
    </ErgUsdContext.Provider>
  );
}


function SearchField() {
  const t = useT();
  const { locale } = useI18n();
  const cue = useSearchCue(locale === "ru" ? SCOUT_CUES_RU : SCOUT_CUES_EN);

  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label={t("nav.searchChain")}
      data-scout="search"
      className="flex h-11 min-w-0 flex-1 items-center gap-2 bg-transparent px-0 text-left lg:h-8"
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
    // One step waits at a time: one timer to clear (a list would grow for as long as the tab is open).
    let timer = 0;
    let onShown: (() => void) | null = null;
    // A hidden tab types nothing: the next step waits until the tab is seen again.
    const shown = () =>
      document.visibilityState !== "hidden"
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            onShown = () => {
              if (document.visibilityState === "hidden") return;
              if (onShown) document.removeEventListener("visibilitychange", onShown);
              onShown = null;
              resolve();
            };
            document.addEventListener("visibilitychange", onShown);
          });
    const wait = async (ms: number) => {
      await shown();
      if (dead) return;
      await new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });
    };
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
      window.clearTimeout(timer);
      if (onShown) document.removeEventListener("visibilitychange", onShown);
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

/** Phone ticker (home only): one tap target over the moving strip opens the price sheet. */
function PricesHit({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="price-tape-hit lg:hidden"
      aria-haspopup="dialog"
      aria-label={t("price.open")}
      onClick={onOpen}
    />
  );
}

function ErgPrice({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const usd = useContext(ErgUsdContext);
  const [circulating, setCirculating] = useState<number | null>(null);

  const load = useCallback(() => {
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
  // Same four significant digits as the home price tile and the price sheet.
  const priceText = usd != null ? formatUsdPrice(usd, locale) : "—";
  const mcapText = mcap != null ? `$${formatCompact(mcap)}` : "—";
  if (compact && onOpen) {
    // Phone: the price opens the price sheet (ERG, market cap, the ticker list).
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${t("price.open")} · ${priceText}`}
        title={`${t("header.ergPrice")} ${priceText} · ${t("header.mcap")} ${mcapText}`}
        className="flex h-11 shrink-0 items-center px-1"
      >
        <span
          data-scout="price"
          className="inline-block min-w-[3.25rem] text-[13px] font-medium tabular-nums"
          style={{ color: INK_TEXT.violet }}
        >
          {priceText}
        </span>
      </button>
    );
  }
  return (
    <Tip
      side="bottom"
      tap={false}
      content={
        compact
          ? () => (
              <TipRows>
                <TipRow label={t("header.ergPrice")}>{priceText}</TipRow>
                <TipRow label={t("header.mcap")}>{mcapText}</TipRow>
              </TipRows>
            )
          : null
      }
    >
    <Link
      prefetch={false}
      href="/"
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
        style={{ color: INK_TEXT.violet }}
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
            style={{ color: INK_TEXT.violet }}
          >
            {mcapText}
          </span>
        </>
      )}
    </Link>
    </Tip>
  );
}


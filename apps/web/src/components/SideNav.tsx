"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useT } from "@/lib/i18n/I18nProvider";
import { explorerHref, useSiteHost } from "@/lib/site-host";
import { HOME, INK } from "@/lib/palette";
import { usePaperPress } from "@/lib/use-paper-press";
import { NavIcon, type NavIconId } from "./nav-icons";

type NavLeaf = {
  href: string;
  key: string;
  icon: NavIconId;
  match?: string[];
  exact?: boolean;
  /** Leaves the explorer. The wallet API lives on its own host. */
  external?: boolean;
};

type NavItem = NavLeaf & {
  children?: NavItem[];
  /** Name opens the page. The chevron only opens children. */
  linkLabel?: boolean;
};

const NAV_MAIN: NavItem[] = [
  { href: "/", key: "nav.home", icon: "home" },
  { href: "/blocks", key: "nav.blocks", icon: "blocks", match: ["/blocks", "/block/"] },
  { href: "/mempool", key: "nav.mempool", icon: "mempool", match: ["/mempool"] },
  { href: "/transactions", key: "nav.txs", icon: "txs", match: ["/transactions", "/tx/"] },
  { href: "/addresses", key: "nav.holders", icon: "holders", match: ["/addresses", "/richlist", "/address/"] },
  { href: "/names", key: "nav.names", icon: "names", match: ["/names"] },
  { href: "/favorites", key: "nav.favorites", icon: "favorites", match: ["/favorites"] },
  { href: "/tokens", key: "nav.tokens", icon: "tokens", match: ["/tokens", "/token/"] },
  { href: "/nfts", key: "nav.nfts", icon: "nfts", match: ["/nfts"] },
  {
    href: "/rent",
    key: "nav.rent",
    icon: "rent",
    match: ["/rent"],
    children: [
      { href: "/rent", key: "nav.rentUpcoming", icon: "rentSoon", exact: true },
      { href: "/rent/history", key: "nav.rentHistory", icon: "rentHist", exact: true },
    ],
  },
  {
    href: "/defi",
    key: "nav.defi",
    icon: "defi",
    match: ["/defi"],
    children: [
      {
        href: "/defi",
        key: "nav.defiDex",
        icon: "tape",
        match: ["/defi/lithos", "/defi/spectrum", "/defi/pool"],
        children: [
          { href: "/defi/lithos", key: "nav.defiLithos", icon: "lithos", exact: true },
          {
            href: "/defi/spectrum",
            key: "nav.defiSpectrum",
            icon: "spectrum",
            exact: true,
            linkLabel: true,
            children: [
              { href: "/defi/pool", key: "nav.defiPool", icon: "pool", match: ["/defi/pool"] },
            ],
          },
        ],
      },
      {
        href: "/defi/stable",
        key: "nav.defiStable",
        icon: "stable",
        match: ["/defi/stable"],
        children: [
          { href: "/defi/stable", key: "nav.defiAgeusd", icon: "ageusd", exact: true },
        ],
      },
      {
        href: "/defi/basis",
        key: "nav.defiBasis",
        icon: "basis",
        match: ["/defi/basis"],
      },
    ],
  },
  {
    href: "/oracles",
    key: "nav.oracles",
    icon: "oracles",
    match: ["/oracles"],
    children: [
      { href: "/oracles/ergusd", key: "nav.oraclesOfficial", icon: "oracleUsd", exact: true },
      {
        href: "/oracles/erg-usd",
        key: "nav.oraclesUsd",
        icon: "oracleUsdV2",
        exact: true,
        linkLabel: true,
        children: [{ href: "/oracles/erg-usd/dort", key: "nav.dort", icon: "dort", exact: true }],
      },
      {
        href: "/oracles/xau-erg",
        key: "nav.oraclesXau",
        icon: "oracleXau",
        exact: true,
        linkLabel: true,
        children: [{ href: "/oracles/xau-erg/gort", key: "nav.gort", icon: "gort", exact: true }],
      },
    ],
  },
  { href: "/rosen", key: "nav.rosen", icon: "rosen", match: ["/rosen"] },
  { href: "/lithos", key: "nav.lithosProtocol", icon: "lithosProtocol", match: ["/lithos"] },
];

const NAV_FOOT: NavItem[] = [
  {
    href: "/learn",
    key: "nav.guide",
    icon: "learn",
    match: ["/learn"],
    children: [
      { href: "/learn", key: "nav.learn", icon: "learn", exact: true },
      { href: "/learn/network", key: "nav.network", icon: "globe", exact: true },
    ],
  },
  { href: "/settings", key: "nav.settings", icon: "settings", match: ["/settings"] },
  { href: "/about", key: "nav.about", icon: "about", match: ["/about"] },
  { href: "https://api.ergoscan.me/docs", key: "nav.api", icon: "api", external: true },
  { href: "/status", key: "nav.status", icon: "status", match: ["/status"] },
];

function pathActive(
  path: string,
  item: { href: string; match?: string[]; exact?: boolean }
): boolean {
  if (item.exact) return path === item.href;
  if (item.href === "/") return path === "/";
  if (path === item.href) return true;
  return (item.match ?? [item.href]).some(
    (m) => m !== "/" && (path === m || path.startsWith(m.endsWith("/") ? m : `${m}/`))
  );
}

const pillEase: [number, number, number, number] = [0.4, 0, 0.2, 1];

const SCAN_CORNERS = [
  { key: "tl", d: "M18 10H10v8", viewBox: "8 8 12 12" },
  { key: "tr", d: "M46 10h8v8", viewBox: "44 8 12 12" },
  { key: "bl", d: "M10 46v8h8", viewBox: "8 44 12 12" },
  { key: "br", d: "M54 46v8h-8", viewBox: "44 44 12 12" },
] as const;

function NavChars({ text, from = 0 }: { text: string; from?: number }) {
  return Array.from(text).map((ch, n) => (
    <span key={from + n} className="nav-ch" style={{ "--i": from + n } as CSSProperties}>
      {ch === " " ? "\u00a0" : ch}
    </span>
  ));
}

export function NavBrand({
  compact,
  collapsed,
}: {
  compact?: boolean;
  collapsed?: boolean;
}) {
  const t = useT();
  return (
    <Link
      prefetch={false}
      href="/"
      aria-label={t("brand.aria")}
      className={clsx(
        "nav-brand flex shrink-0 items-center",
        compact
          ? "h-11 w-11 justify-center"
          : "nav-brand-row relative z-10 h-[var(--toolbar)] w-full justify-center px-0"
      )}
    >
      <span className={clsx("nav-scan", compact ? "h-7 w-7" : "h-8")}>
        {SCAN_CORNERS.map((corner) => (
          <svg
            key={corner.key}
            className={clsx("nav-scan-corner", corner.key)}
            viewBox={corner.viewBox}
            aria-hidden="true"
          >
            <path
              d={corner.d}
              fill="none"
              stroke="#4DB7F2"
              strokeWidth="4"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
        ))}
        {compact ? (
          <span className="nav-scan-e" style={{ color: HOME.forming }}>
            E
          </span>
        ) : (
          <>
          <span className="nav-scan-sizer" aria-hidden="true">ERGOSCANME</span>
          <span className="nav-label nav-scan-word" aria-hidden={collapsed || undefined}>
            <span className="nav-line items-baseline text-[15px] font-semibold uppercase leading-none">
              {[
                <span key="ergo" className="nav-line" style={{ color: HOME.forming }}>
                  <NavChars text="ERGO" />
                </span>,
                <span key="scan" className="nav-line" style={{ color: INK.cyan }}>
                  <NavChars text="SCAN" from={4} />
                </span>,
                <span key="me" className="nav-line" style={{ color: "var(--down)" }}>
                  <NavChars text="ME" from={8} />
                </span>,
              ]}
            </span>
          </span>
          </>
        )}
      </span>
    </Link>
  );
}

function rowPad(depth: number) {
  if (depth <= 0) return "nav-row-root";
  if (depth === 1) return "gap-2 py-[6px] pl-9 pr-[var(--nav-inset)]";
  if (depth === 2) return "gap-2 py-[5px] pl-12 pr-[var(--nav-inset)]";
  return "gap-2 py-[5px] pl-[4.75rem] pr-[var(--nav-inset)]";
}

function branchUnder(item: NavItem, path: string): boolean {
  if (pathActive(path, item)) return true;
  return (item.children ?? []).some((c) => branchUnder(c, path));
}

function NavRow({
  item,
  path,
  collapsed,
  onNavigate,
  depth = 0,
}: {
  item: NavLeaf;
  path: string;
  collapsed: boolean;
  onNavigate?: () => void;
  depth?: number;
}) {
  const t = useT();
  const { api } = useSiteHost();
  const href = api && item.key === "nav.api" ? "/" : explorerHref(item.href, api);
  const active =
    (api && item.key === "nav.api" && (path === "/" || path === "/docs")) ||
    pathActive(path, item);
  const label = t(item.key);
  const nested = depth > 0;
  const { armed, disarm, bind } = usePaperPress(true);
  const className = clsx(
    "nav-row nav-row--press plane-drop relative flex items-center overflow-hidden rounded-[10px]",
    rowPad(depth),
    armed && "is-armed",
    active && "is-pressed",
    active ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
  );
  const body = (
    <>
      <span className="nav-glyph relative z-[1] inline-flex shrink-0">
        <NavIcon id={item.icon} className={nested ? "size-[18px] text-accent" : "size-[22px] text-accent"} />
      </span>
      <span
        className={clsx(
          "nav-label relative z-[1] font-medium tracking-[-0.02em]",
          nested ? "text-[15px]" : "text-[17px]"
        )}
      >
        <span className="nav-line">
          <NavChars text={label} />
        </span>
      </span>
    </>
  );

  if (href.startsWith("http")) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={collapsed ? label : undefined}
        {...bind}
        onClick={() => {
          onNavigate?.();
          disarm();
        }}
        className={className}
      >
        {body}
      </a>
    );
  }

  return (
    <Link
      prefetch={false}
      href={href}
      data-scout={item.href === "/addresses" ? "addresses" : undefined}
      title={collapsed ? label : undefined}
      {...bind}
      onClick={() => {
        onNavigate?.();
        disarm();
      }}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {body}
    </Link>
  );
}

function NavBranch({
  item,
  path,
  collapsed,
  onNavigate,
  onExpandRail,
  transition,
  depth = 0,
}: {
  item: NavItem;
  path: string;
  collapsed: boolean;
  onNavigate?: () => void;
  onExpandRail?: () => void;
  transition: { duration: number; ease?: [number, number, number, number] };
  depth?: number;
}) {
  const t = useT();
  const { api } = useSiteHost();
  const href = explorerHref(item.href, api);
  const kids = item.children ?? [];
  const under = branchUnder(item, path);
  const [open, setOpen] = useState(under);
  // Open on the section; fold shut when the route leaves it (blocks, txs, …).
  useEffect(() => {
    setOpen(under);
  }, [path, under]);
  const label = t(item.key);
  const nested = depth > 0;
  const { armed, disarm, bind } = usePaperPress(true);
  const self = pathActive(path, item);
  const chevron = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={clsx(
        "relative z-[1] shrink-0 text-[var(--muted)] transition-transform duration-[400ms] ease-[var(--ease)]",
        open && "rotate-90"
      )}
    >
      <path
        d="M4.2 2.4 8 6l-3.8 3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const rowClass = clsx(
    "nav-row nav-row--press plane-drop relative flex w-full items-center overflow-hidden rounded-[10px]",
    rowPad(depth),
    armed && "is-armed",
    under ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
  );

  return (
    <div>
      {item.linkLabel ? (
        <div className={rowClass}>
          <Link
            prefetch={false}
            href={href}
            {...bind}
            onClick={(e) => {
              if (collapsed) {
                e.preventDefault();
                onExpandRail?.();
                setOpen(true);
              } else {
                onNavigate?.();
              }
              disarm();
            }}
            aria-current={self ? "page" : undefined}
            className={clsx(
              "relative z-[1] flex min-w-0 flex-1 items-center",
              depth <= 0 ? "gap-2.5" : "gap-2"
            )}
          >
            <span className="nav-glyph inline-flex shrink-0">
              <NavIcon
                id={item.icon}
                className={nested ? "size-[18px] text-accent" : "size-[22px] text-accent"}
              />
            </span>
            <span
              className={clsx(
                "nav-label text-left font-medium tracking-[-0.02em]",
                nested ? "text-[15px]" : "text-[17px]"
              )}
            >
              <span className="nav-line">
                <NavChars text={label} />
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("nav.collapse") : t("nav.expand")}
            onClick={() => setOpen((v) => !v)}
            className="nav-chevron relative z-[1] inline-flex shrink-0"
          >
            {chevron}
          </button>
        </div>
      ) : (
      <button
        type="button"
        title={collapsed ? label : undefined}
        aria-expanded={open}
        {...bind}
        onClick={() => {
          if (collapsed) onExpandRail?.();
          setOpen((v) => (collapsed ? true : !v));
          disarm();
        }}
        className={rowClass}
      >
        <span className="nav-glyph relative z-[1] inline-flex shrink-0">
          <NavIcon
            id={item.icon}
            className={nested ? "size-[18px] text-accent" : "size-[22px] text-accent"}
          />
        </span>
        <span
          className={clsx(
            "nav-label relative z-[1] text-left font-medium tracking-[-0.02em]",
            nested ? "text-[15px]" : "text-[17px]"
          )}
        >
          <span className="nav-line">
            <NavChars text={label} />
          </span>
          <span className="nav-ch inline-flex" style={{ "--i": label.length } as CSSProperties}>
            {chevron}
          </span>
        </span>
      </button>
      )}
      <div className={clsx("nav-kids", open && !collapsed && "is-open", transition.duration === 0 && "is-instant")}>
        <div className="nav-kids-clip">
          <div className="flex flex-col gap-px pb-1">
            {kids.map((child) =>
              child.children?.length ? (
                <NavBranch
                  key={child.href + child.key}
                  item={child}
                  path={path}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  onExpandRail={onExpandRail}
                  transition={transition}
                  depth={depth + 1}
                />
              ) : (
                <NavRow
                  key={child.href + child.key}
                  item={child}
                  path={path}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  depth={depth + 1}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavList({
  onNavigate,
  collapsed = false,
  onExpandRail,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onExpandRail?: () => void;
}) {
  const path = usePathname();
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : { duration: 0.4, ease: pillEase };

  const renderItem = (item: NavItem) => {
    if (item.children?.length) {
      return (
        <NavBranch
          key={item.href + item.key}
          item={item}
          path={path}
          collapsed={collapsed}
          onNavigate={onNavigate}
          onExpandRail={onExpandRail}
          transition={transition}
        />
      );
    }
    return (
      <NavRow
        key={item.href + item.key}
        item={item}
        path={path}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    );
  };

  return (
    <div className="plane-stage">
      <div className="flex flex-col gap-px">{NAV_MAIN.map(renderItem)}</div>
      <div
        className="nav-rule my-3 h-px bg-[var(--wash)]"
      />
      <div className="flex flex-col gap-px">{NAV_FOOT.map(renderItem)}</div>
    </div>
  );
}

function RailToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
      className={clsx(
        "rail-toggle chip-press absolute bottom-3 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center overflow-hidden rounded-[8px]",
        "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className={clsx(
          "transition-transform duration-[420ms] ease-[var(--ease)]",
          collapsed && "rotate-180"
        )}
      >
        <path
          d="M10.2 3.6 5.8 8l4.4 4.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function SideNavRail({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const t = useT();
  return (
      <aside
      className="nav-rail relative sticky top-0 z-30 hidden h-dvh w-full min-w-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] pt-[env(safe-area-inset-top,0px)] lg:flex"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={t("nav.menu")}
    >
      <div className="nav-rail-inner flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit]">
        <NavBrand collapsed={collapsed} />
        <nav className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-14 pt-5">
          <NavList
            collapsed={collapsed}
            onExpandRail={onToggle && collapsed ? onToggle : undefined}
          />
        </nav>
      </div>
      {onToggle ? <RailToggle collapsed={collapsed} onToggle={onToggle} /> : null}
    </aside>
  );
}

export function SideNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const t = useT();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label={t("nav.close")}
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="nav-drawer fixed z-50 flex w-[min(17.5rem,calc(100vw-1.5rem))] flex-col lg:hidden"
            initial={reduce ? false : { x: "-110%" }}
            animate={{ x: 0 }}
            exit={reduce ? undefined : { x: "-110%" }}
            transition={reduce ? { duration: 0 } : { duration: 0.32, ease: pillEase }}
            aria-label={t("nav.menu")}
          >
            <NavBrand />
            <nav className="scrollbar-none relative z-[1] min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-4 pt-2">
              <NavList onNavigate={onClose} />
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

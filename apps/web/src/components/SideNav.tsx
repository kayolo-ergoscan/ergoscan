"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { useT } from "@/lib/i18n/I18nProvider";
import { explorerHref, useSiteHost } from "@/lib/site-host";
import { usePaperPress } from "@/lib/use-paper-press";
import { BrandMark, BrandWord } from "./BrandMark";
import { NavIcon } from "./nav-icons";
import { NAV_FOOT, NAV_MAIN, type NavItem, type NavLeaf } from "@/lib/nav-tree";

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
      <span className={clsx("nav-lockup", compact && "nav-lockup--compact")}>
        <BrandMark size={24} className="nav-mark" />
        {compact ? null : (
          <span className="nav-brand-word" aria-hidden={collapsed || undefined}>
            <BrandWord />
          </span>
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
        <NavIcon id={item.icon} className={nested ? "ico-line size-[18px]" : "ico-line size-[22px]"} />
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
                className={nested ? "ico-line size-[18px]" : "ico-line size-[22px]"}
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
            className={nested ? "ico-line size-[18px]" : "ico-line size-[22px]"}
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

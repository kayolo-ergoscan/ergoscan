"use client";

import clsx from "clsx";
import Link from "next/link";
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { KpiMark } from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { HOME } from "@/lib/palette";

/**
 * A trailing unit after the figure ("1 218.13 ERG", "504 GH/s"). Phones set it
 * smaller and muted (globals.css `.kpi-unit`); wide screens leave it as it was.
 * Words such as "6 blocks" or "10 min ago" are not units and stay whole.
 */
const UNIT_TAIL = /^(.*\d[kMBT]?)(\s+)([A-Za-z$][A-Za-z0-9$/]{0,11})$/;

function splitUnit(children: ReactNode): ReactNode {
  if (typeof children !== "string") return children;
  const m = UNIT_TAIL.exec(children);
  if (!m || !/[A-Z$/]/.test(m[3])) return children;
  return (
    <>
      {m[1]}
      <span className="kpi-unit">
        {m[2]}
        {m[3]}
      </span>
    </>
  );
}

const COMPACT_STEPS: readonly [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/**
 * Phone short form of a figure of 100 000 or more: 141 892 → "141.9k",
 * 1 337 399.26 ERG → "1.34M ERG". Undefined below that, so the tile keeps the
 * exact figure. Block heights and ids are names, not amounts: never pass them.
 */
export function compactFigure(n: number | bigint | null | undefined, unit?: string): string | undefined {
  if (n == null) return undefined;
  const v = typeof n === "bigint" ? Number(n) : n;
  if (!Number.isFinite(v) || Math.abs(v) < 100_000) return undefined;
  const abs = Math.abs(v);
  for (let i = 0; i < COMPACT_STEPS.length; i++) {
    const [step, suffix] = COMPACT_STEPS[i];
    if (abs < step) continue;
    const x = abs / step;
    const fixed = x.toFixed(x < 10 ? 2 : x < 1000 ? 1 : 0);
    if (Number(fixed) >= 1000 && i > 0) {
      const [up, upSuffix] = COMPACT_STEPS[i - 1];
      const y = (abs / up).toFixed(2).replace(/\.?0+$/, "");
      return `${v < 0 ? "-" : ""}${y}${upSuffix}${unit ? ` ${unit}` : ""}`;
    }
    const body = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
    return `${v < 0 ? "-" : ""}${body}${suffix}${unit ? ` ${unit}` : ""}`;
  }
  return undefined;
}

/**
 * AdaStat `uk-animation-scale-up` on a page-enter figure. Live text swaps do not replay it.
 * `compact` is the short form phones show for figures of 100 000 and up ("1.34M ERG");
 * a tap there shows the exact figure, which is also the hint.
 */
export function KpiNum({
  children,
  className,
  compact,
}: {
  children: ReactNode;
  className?: string;
  compact?: string;
}) {
  const [exact, setExact] = useState(false);
  if (!compact) {
    return <span className={clsx("kpi-scale-up inline-block max-w-full", className)}>{splitUnit(children)}</span>;
  }
  return (
    <span
      className={clsx("kpi-scale-up kpi-has-compact inline-block max-w-full", exact && "is-exact", className)}
      onClick={(e) => {
        if ((e.currentTarget as HTMLElement).closest("a")) return;
        setExact((v) => !v);
      }}
    >
      <span className="kpi-full">{splitUnit(children)}</span>
      <span className="kpi-compact" aria-hidden>
        {splitUnit(compact)}
      </span>
    </span>
  );
}

/**
 * Phones show the tile's KPI icon at 18 px before the label instead of the
 * 44 px field at the side, so the figure gets the whole width. Concept icons
 * move everywhere; a token logo moves only in figure grids (`tokens`), lead
 * tiles keep their large logo or avatar.
 */
export function KpiLabelMark({ mark, color, tokens }: { mark?: ReactNode; color?: string; tokens?: boolean }) {
  if (!isValidElement(mark)) return null;
  const token = tokens && mark.type === TokenAvatar;
  if (mark.type !== KpiMark && !token) return null;
  return (
    <span className="kpi-mark-inline" style={color ? { color } : undefined} aria-hidden>
      {token ? cloneElement(mark as ReactElement<{ size?: number }>, { size: 18 }) : mark}
    </span>
  );
}

/**
 * Filter tiles that become one scrolling row of 36 px chips on phones
 * (globals.css `.kpi-chip-rail`); wider screens keep the grid in `className`.
 * The edge fade shows only on a side that still has chips to scroll to.
 */
export function KpiChipRail({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const rest = el.scrollWidth - el.clientWidth - el.scrollLeft;
      el.dataset.fadeStart = el.scrollLeft > 2 ? "1" : "0";
      el.dataset.fadeEnd = rest > 2 ? "1" : "0";
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={clsx("kpi-chip-rail", className)}>
      {children}
    </div>
  );
}

/** Kept in the tile. The ink field on the mark replaced the stripe. */
export function KpiTileRail() {
  return (
    <span className="kpi-tile-rail" aria-hidden>
      <span className="kpi-tile-rail-shift">
        <span className="kpi-tile-rail-ink" />
      </span>
    </span>
  );
}

export type KpiItem = {
  label: string;
  value: string;
  /** Short form for phones when the figure is 100 000 or more (`formatCompact`). */
  compact?: string;
  sub?: string;
  /** Missing KPI after settle — not a loading placeholder. */
  unavailable?: boolean;
  extra?: ReactNode;
  href?: string;
  mark?: ReactNode;
  /** Rail / stamp ink. Defaults to accent when omitted. */
  ink?: string;
  /** Home-style sheet enter. Omit on list pages that already animate rows. */
  enter?: number;
  /** Slow breath on the figure when the pool is short of posters. */
  pulse?: boolean;
  /** @deprecated Corner stamp is the default; kept so call sites compile. */
  markTop?: boolean;
};

/**
 * Columns per tile count. Below 640 px: two tiles side by side, three in
 * compact columns, and an odd last tile spans the row (no orphan half-tile).
 */
function colsFor(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "kpi-grid--3 grid-cols-3";
  if (n === 4) return "grid-cols-2 lg:grid-cols-4";
  if (n === 5) return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6";
}

export function KpiGrid({
  items,
  className,
  dense,
  before,
}: {
  items: KpiItem[];
  className?: string;
  /** Same chrome as address list tiles (`AddressStatTile`: 3 lines, `px-3 py-1.5`, 17px value). */
  dense?: boolean;
  /** First cell in the same equal-width row (search, etc.). On phones it takes the whole row. */
  before?: ReactNode;
}) {
  if (!items.length && !before) return null;
  const n = items.length + (before ? 1 : 0);
  const phoneCols = before ? items.length : n;
  return (
    <div
      className={clsx(
        "addr-drop grid items-stretch gap-2",
        before
          ? clsx(
              items.length === 3 ? "kpi-grid--3 grid-cols-3" : "grid-cols-2",
              "sm:grid-cols-2 lg:grid-cols-4"
            )
          : colsFor(n),
        phoneCols % 2 === 1 && phoneCols !== 3 && phoneCols > 1 && "kpi-grid--odd",
        className
      )}
    >
      {before ? <div className="kpi-grid-before grid min-w-0">{before}</div> : null}
      {items.map((k) => {
        const body = (
          <div className={clsx("kpi-tile-row flex w-full min-w-0 flex-1 justify-between", dense ? "gap-2" : "gap-3")}>
            <div className="min-w-0 flex-1">
              <div className="kpi-label-row">
                <KpiLabelMark mark={k.mark} tokens />
                <p
                  className={clsx("text-[13px]", dense && "leading-[1.15]")}
                  style={{ color: HOME.forming }}
                >
                  {k.label}
                </p>
              </div>
              <p
                className={clsx(
                  "kpi-value font-semibold tabular-nums tracking-tight",
                  dense
                    ? "mt-0.5 text-[17px] leading-[1.15]"
                    : "mt-1 truncate text-[22px]",
                  k.unavailable && "text-[var(--muted)]",
                  k.pulse && "oracle-kpi-short"
                )}
              >
                <KpiNum compact={k.compact}>{k.value}</KpiNum>
              </p>
              {k.sub || dense ? (
                <p
                  className={clsx(
                    "kpi-sub truncate text-[12px] text-[var(--muted-2)]",
                    dense ? "mt-0.5 leading-[1.15]" : "mt-0.5"
                  )}
                >
                  {k.sub || "\u00a0"}
                </p>
              ) : null}
              {k.extra ? <div className="mt-3">{k.extra}</div> : null}
            </div>
            {k.mark ? <div className="kpi-tile-mark">{k.mark}</div> : null}
          </div>
        );
        const tile = clsx(
          "kpi-tile overflow-visible rounded-[20px] border border-[var(--border)] bg-[var(--module)]",
          k.enter != null && "home-tile-enter",
          dense
            ? "kpi-tile--dense flex h-full min-w-0 px-3 py-1.5"
            : "px-4 py-4"
        );
        const inkStyle = {
          ...(k.ink ? { ["--kpi-ink" as string]: k.ink } : {}),
          ...(k.enter != null ? { ["--enter" as string]: k.enter } : {}),
        };
        return k.href ? (
          <Link
            prefetch={false}
            key={k.label}
            href={k.href}
            style={inkStyle}
            className={clsx(tile, "kpi-tile--press block")}
          >
            <KpiTileRail />
            {body}
          </Link>
        ) : (
          <div key={k.label} className={tile} style={inkStyle}>
            <KpiTileRail />
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-[9px] bg-[var(--wash)] p-0.5">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={String(o.id)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={clsx(
              "chip-press rounded-[7px] px-2.5 py-1 text-[12px] font-medium tabular-nums transition-colors",
              on
                ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

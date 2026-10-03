import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

/** AdaStat `uk-animation-scale-up` on a page-enter figure. Live text swaps do not replay it. */
export function KpiNum({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("kpi-scale-up inline-block max-w-full", className)}>{children}</span>;
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

function colsFor(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-1 sm:grid-cols-2";
  if (n === 3) return "grid-cols-1 sm:grid-cols-3";
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
  /** First cell in the same equal-width row (search, etc.). */
  before?: ReactNode;
}) {
  if (!items.length && !before) return null;
  const n = items.length + (before ? 1 : 0);
  return (
    <div
      className={clsx(
        "addr-drop grid items-stretch",
        dense ? "gap-2" : "gap-3",
        before ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" : colsFor(n),
        className
      )}
    >
      {before}
      {items.map((k) => {
        const body = (
          <div className={clsx("kpi-tile-row flex w-full min-w-0 flex-1 justify-between", dense ? "gap-2" : "gap-3")}>
            <div className="min-w-0 flex-1">
              <p className={clsx("text-[13px] text-[var(--muted)]", dense && "leading-[1.15]")}>
                {k.label}
              </p>
              <p
                className={clsx(
                  "font-semibold tabular-nums tracking-tight",
                  dense
                    ? "mt-0.5 text-[17px] leading-[1.15]"
                    : "mt-1 truncate text-[22px]",
                  k.unavailable && "text-[var(--muted)]",
                  k.pulse && "oracle-kpi-short"
                )}
              >
                <KpiNum>{k.value}</KpiNum>
              </p>
              {k.sub || dense ? (
                <p
                  className={clsx(
                    "truncate text-[12px] text-[var(--muted-2)]",
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

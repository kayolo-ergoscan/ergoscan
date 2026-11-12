"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { rentNanoToErg } from "@ergoscan/shared";
import { formatGroupedInt } from "@/lib/format";
import { enteringIds, useEnterIds } from "@/lib/keyed-enter";
import {
  RENT_POOL_ROW_CLASS,
  formatRentSharePct,
  hasRentMinerRows,
  mergeRentMinerPools,
  nameRentMinerPools,
  pickRentMinerPeriod,
  rentMinerPeriodsReady,
  type RentMinerPeriod,
  type RentMinerRow,
  type RentMinersPack,
} from "@/lib/rent-miner-pools";

const DonutChart = dynamic(() => import("@/components/DonutChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

const PERIODS: RentMinerPeriod[] = ["day", "month", "all"];

function PeriodTabs({
  className,
  period,
  t,
  onPeriod,
}: {
  className?: string;
  period: RentMinerPeriod;
  t: (k: string) => string;
  onPeriod: (id: RentMinerPeriod) => void;
}) {
  return (
    <div
      className={clsx("rounded-[9px] bg-[var(--wash)] p-0.5", className)}
      role="tablist"
      aria-label={t("rent.pools")}
    >
      {PERIODS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={period === id}
          className={clsx(
            "chip-press rounded-[7px] px-2.5 py-1 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            period === id
              ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]"
              : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
          onClick={() => onPeriod(id)}
        >
          {t(`rent.poolsPeriod.${id}`)}
        </button>
      ))}
    </div>
  );
}

function formatPoolErg(nano: string, locale: string): string {
  const erg = rentNanoToErg(nano);
  if (!Number.isFinite(erg) || erg <= 0) return "0";
  return formatGroupedInt(BigInt(Math.round(erg)), locale);
}

export function RentMinerPools({
  miners,
  minersDay,
  minersMonth,
  totalRentNano,
  locale,
  t,
  sheet,
}: {
  miners?: RentMinersPack | null;
  minersDay?: RentMinersPack | null;
  minersMonth?: RentMinersPack | null;
  totalRentNano: string;
  locale: string;
  t: (k: string) => string;
  sheet?: number;
}) {
  const canPick = rentMinerPeriodsReady({ minersDay, minersMonth });
  const [period, setPeriod] = useState<RentMinerPeriod>(() => {
    if (hasRentMinerRows(miners)) return "all";
    if (hasRentMinerRows(minersDay)) return "day";
    if (hasRentMinerRows(minersMonth)) return "month";
    return "all";
  });
  const picked = useMemo(
    () =>
      pickRentMinerPeriod(
        { rentNano: totalRentNano, miners, minersDay, minersMonth },
        canPick ? period : "all"
      ),
    [canPick, miners, minersDay, minersMonth, period, totalRentNano]
  );
  const rows = useMemo(() => {
    const covered = picked.miners.coveredRentNano;
    let shareTotal = picked.totalRentNano;
    try {
      if (BigInt(covered || "0") > 0n) shareTotal = covered;
    } catch {
      /* keep the window total */
    }
    return mergeRentMinerPools(
      nameRentMinerPools(picked.miners.pools),
      { boxes: 0, rentNano: "0" },
      shareTotal
    );
  }, [picked]);
  const enter = useEnterIds();
  const painted = useRef(false);
  const prev = useRef<RentMinerRow[]>([]);
  const [hover, setHover] = useState<{ label: string; pct: number } | null>(null);

  useEffect(() => {
    if (!painted.current) {
      painted.current = true;
      prev.current = rows;
      return;
    }
    enter.mark(
      enteringIds(
        prev.current.map((r) => ({ id: r.id })),
        rows.map((r) => ({ id: r.id }))
      )
    );
    prev.current = rows;
  }, [rows, enter.mark]);

  const lead = rows.find((r) => r.kind === "pool") ?? rows[0] ?? null;
  const hintKey =
    picked.period === "all" ? "rent.poolsHint" : `rent.poolsHint.${picked.period}`;
  const emptyKey = `rent.poolsEmpty.${picked.period}`;
  const caption = hover
    ? t("rent.poolsLead").replace("{name}", hover.label).replace("{pct}", formatRentSharePct(hover.pct))
    : lead
      ? t("rent.poolsLead").replace("{name}", lead.name).replace("{pct}", formatRentSharePct(lead.share))
      : rows.length === 0
        ? t(emptyKey)
        : t(hintKey);
  const slices = rows
    .filter((r) => r.share > 0)
    .map((r) => ({ label: r.name, value: rentNanoToErg(r.rentNano), color: r.ink }));

  return (
    <section
      className={clsx(
        "mod flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)]",
        sheet != null && "home-tile-enter"
      )}
      style={sheet != null ? ({ "--enter": sheet } as CSSProperties) : undefined}
      aria-labelledby="rent-pools-title"
    >
      <div className="flex min-w-0 flex-col overflow-hidden rounded-[20px] px-4 py-3 sm:px-5">
        <div className="mb-3 flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex h-[22px] min-w-0 items-center gap-3">
              <h2
                id="rent-pools-title"
                className="m-0 shrink-0 text-[17px] font-semibold leading-[1.15] tracking-tight"
              >
                {t("rent.pools")}
              </h2>
              <span className="hidden min-w-0 truncate text-[13px] leading-[1.15] text-[var(--muted)] lg:block">
                {t(hintKey)}
              </span>
            </div>
            <p className="mt-2 truncate text-[12px] leading-[1.15] text-[var(--muted)]">{caption}</p>
            {canPick ? (
              <PeriodTabs
                className="mt-2 flex lg:hidden"
                period={period}
                t={t}
                onPeriod={(id) => {
                  if (id === period) return;
                  setHover(null);
                  setPeriod(id);
                }}
              />
            ) : null}
          </div>
          {canPick ? (
            <PeriodTabs
              className="hidden shrink-0 self-center lg:flex"
              period={period}
              t={t}
              onPeriod={(id) => {
                if (id === period) return;
                setHover(null);
                setPeriod(id);
              }}
            />
          ) : null}
          <div
            className="relative h-[4.5rem] w-[4.5rem] shrink-0"
            role="img"
            aria-label={t("rent.pools")}
          >
            {slices.length >= 1 ? (
              <DonutChart
                data={slices}
                compact
                fill
                caption={false}
                formatValue={(v, pct) =>
                  `${formatGroupedInt(BigInt(Math.round(v)), locale)} ${t("rent.chartErg")} · ${formatRentSharePct(pct)}`
                }
                onHover={(s) => setHover(s ? { label: s.label, pct: s.pct } : null)}
              />
            ) : (
              <span className="absolute left-1/2 top-1/2 block h-[3.15rem] w-[3.15rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-[7px] border-[var(--wash)]" aria-hidden />
            )}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-[13px] leading-none text-[var(--muted)]">
            {t(emptyKey)}
          </p>
        ) : (
          <ul className="m-0 max-h-[12.5rem] list-none overflow-y-auto p-0">
            {rows.map((row) => (
              <PoolRow
                key={row.id}
                row={row}
                locale={locale}
                enterClass={enter.enterClass(row.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PoolRow({
  row,
  locale,
  enterClass,
}: {
  row: RentMinerRow;
  locale: string;
  enterClass?: string;
}) {
  const pct = formatRentSharePct(row.share);
  const erg = formatPoolErg(row.rentNano, locale);
  const inner = (
    <>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.ink }} aria-hidden />
          <span className="truncate text-[13px] font-medium leading-none">{row.name}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <span className="text-[13px] font-medium leading-none tracking-tight text-[var(--text)]">
            {erg}
          </span>
          <span className="min-w-[2.25rem] text-right text-[12px] leading-none text-[var(--muted)]">{pct}</span>
        </span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--wash)]" aria-hidden>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.max(0, row.share * 100))}%`,
            background: row.ink,
          }}
        />
      </div>
    </>
  );
  const cls = clsx(
    "flex h-full flex-col justify-center rounded-[10px] px-1 py-1 text-[var(--text)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    enterClass,
    row.address && "hover:bg-[var(--wash-faint)]"
  );
  return (
    <li className={clsx("list-none", RENT_POOL_ROW_CLASS)}>
      {row.address ? (
        <Link prefetch={false} href={`/address/${encodeURIComponent(row.address)}`} className={cls}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

"use client";

/**
 * Home «Network» block (prototype, `/?stats=a|b|c`): the eight home figures in one card.
 *   A «Пульт»   — the four week series as a switch beside ONE chart; the four facts in a footer row.
 *   B «Паспорт» — a spec sheet: two columns of label · figure · quiet spark/meter, no axis.
 *   C «Неделя»  — small multiples: the four series on one shared week axis, one crosshair for all.
 * Same data as the eight tiles; nothing new is fetched. SVG only (no chart engine), hover state
 * stays inside the block, nothing animates at rest.
 */
import { memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LinePoint } from "@lumen/amm-chart";
import type { PoolShare } from "@/lib/chain-stats";
import type { EvidenceKind } from "@/lib/trust-board";
import { HOME } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { ReelText } from "@/components/ReelText";
import {
  formatCompact,
  formatCompactNumber,
  formatDottedDay,
  formatH24,
  formatHashrate,
  formatUsdPrice,
} from "@/lib/format";
import {
  binActivity,
  cleanLine,
  dayTicks,
  netDomain,
  weekChange,
  type ActivityHour,
} from "@/lib/net-stats";
import { Delta, FactLabel, PoolBar, SERIES_INK, Spark, SupplyMeter, type SeriesKey, type SparkHover } from "./parts";
import { SeriesPlot, valueAt, type PlotData } from "./SeriesPlot";

export type NetVariant = "a" | "b" | "c";

export type NetStatsProps = {
  variant: NetVariant;
  price: readonly LinePoint[];
  spot: number | null;
  change24h: number | null;
  mcap: number | null;
  rank: number | null;
  vol24: number | null;
  circulating: number | null;
  maxSupply: number;
  holders: number | null;
  holdersMonth: number | null;
  scripts: number | null;
  pools: readonly PoolShare[];
  minerCount: number | null;
  hashrate: number | null;
  hashSeries: readonly LinePoint[];
  txDay: number | null;
  feeDay: number | null;
  activity: readonly ActivityHour[];
  enter?: number;
};

type Hover = { t: number; t1?: number; v: number; open?: boolean } | null;

type Series = {
  key: SeriesKey;
  name: string;
  /** What one point is: «hourly» / «per 6h». */
  grain: string;
  ink: string;
  data: PlotData;
  /** The figure now, and its unit. */
  now: string | null;
  unit?: string;
  /** A hovered point or column. */
  at: (h: NonNullable<Hover>) => string;
  /** The figure for a bare value (a cut column's label). */
  fmt: (v: number) => string;
  atUnit?: string;
  tick: (v: number, step: number) => string;
  delta: number | null;
  deltaSuffix: string;
  href?: string;
  ev?: EvidenceKind;
};

const CARD =
  "home-tile-enter mod relative flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]";
/** The block's one tag, in the network's colour (a card with tx/fee links would turn it orange). */
const CARD_TAG = { "--tag": "var(--f-net)", "--tag-ink": "var(--k-ink)" } as CSSProperties;

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="text-[13px] leading-none" style={{ color: HOME.forming }}>
      {children}
    </span>
  );
}

function stamp(h: NonNullable<Hover>): string {
  const d = formatDottedDay(h.t, "UTC");
  if (h.t1) return `${d} · ${formatH24(h.t, "UTC", false)}–${formatH24(h.t1, "UTC", false)}`;
  return `${d} · ${formatH24(h.t, "UTC", false)}`;
}

/** Decimals a tick step needs: 0.025 → 3, 0.5 → 1, 20 → 0. */
function decimalsOf(step: number): number {
  if (!(step > 0)) return 0;
  const s = String(Number(step.toPrecision(6)));
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

function feeFig(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100) return formatCompact(v, 1);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function useNetModel(p: NetStatsProps) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const shape = useMemo(() => {
    const pricePts = cleanLine(p.price);
    const hashPts = cleanLine(p.hashSeries);
    const txBins = binActivity(p.activity, "txs");
    const feeBins = binActivity(p.activity, "feesErg");
    const [t0, t1] = netDomain(pricePts, hashPts, p.activity);
    return { pricePts, hashPts, txBins, feeBins, t0, t1 };
  }, [p.price, p.hashSeries, p.activity]);

  const series = useMemo<Series[]>(() => {
    const { pricePts, hashPts, txBins, feeBins } = shape;
    const usd = (v: number) => formatUsdPrice(v, locale);
    const closedTx = txBins.filter((b) => !b.open);
    const closedFee = feeBins.filter((b) => !b.open && b.known);
    return [
      {
        key: "price",
        name: t("home.price"),
        grain: t("home.net.hourly"),
        ink: SERIES_INK.price,
        data: { kind: "line", pts: pricePts },
        now: p.spot != null ? usd(p.spot) : null,
        at: (h) => usd(h.v),
        fmt: usd,
        tick: (v, step) => `$${v.toFixed(Math.max(2, decimalsOf(step)))}`,
        delta: p.change24h,
        deltaSuffix: t("home.net.h24"),
        ev: "external",
      },
      {
        key: "hashrate",
        name: t("home.hashrate"),
        grain: t("home.net.hourly"),
        ink: SERIES_INK.hashrate,
        data: { kind: "line", pts: hashPts },
        now: p.hashrate != null ? formatHashrate(p.hashrate) : null,
        at: (h) => formatHashrate(h.v),
        fmt: formatHashrate,
        tick: (v) => `${Math.round(v / 1e9)} GH/s`,
        delta: (() => {
          const c = weekChange(hashPts);
          return c != null ? c * 100 : null;
        })(),
        deltaSuffix: t("home.net.week7"),
        ev: "decoded",
      },
      {
        key: "txs",
        name: t("home.txs"),
        grain: t("home.net.sum6h"),
        ink: SERIES_INK.txs,
        data: { kind: "bars", bins: txBins },
        now: p.txDay != null ? Math.round(p.txDay).toLocaleString(loc) : null,
        unit: t("home.net.perDay"),
        at: (h) => Math.round(h.v).toLocaleString(loc),
        fmt: (v) => Math.round(v).toLocaleString(loc),
        atUnit: t("home.net.per6h"),
        tick: (v) => formatCompact(v, 1, locale),
        delta: (() => {
          if (closedTx.length < 8) return null;
          const a = closedTx.slice(0, 4).reduce((s, b) => s + b.v, 0);
          const b = closedTx.slice(-4).reduce((s, x) => s + x.v, 0);
          return a > 0 ? ((b - a) / a) * 100 : null;
        })(),
        deltaSuffix: t("home.net.week7"),
        href: "/transactions",
      },
      {
        key: "fees",
        name: t("home.txChartFees"),
        grain: t("home.net.sum6h"),
        ink: SERIES_INK.fees,
        data: { kind: "bars", bins: feeBins },
        now: p.feeDay != null ? `${feeFig(p.feeDay)} ERG` : null,
        unit: t("home.net.per24h"),
        at: (h) => `${feeFig(h.v)} ERG`,
        fmt: (v) => `${feeFig(v)} ERG`,
        atUnit: t("home.net.per6h"),
        tick: (v, step) => v.toFixed(decimalsOf(step)),
        delta: (() => {
          if (closedFee.length < 8) return null;
          const a = closedFee.slice(0, 4).reduce((s, b) => s + b.v, 0);
          const b = closedFee.slice(-4).reduce((s, x) => s + x.v, 0);
          return a > 0 ? ((b - a) / a) * 100 : null;
        })(),
        deltaSuffix: t("home.net.week7"),
        href: "/fees",
      },
    ];
  }, [shape, p.spot, p.change24h, p.hashrate, p.txDay, p.feeDay, t, locale, loc]);

  const emitted =
    p.circulating != null && p.maxSupply > 0 ? Math.min(100, (p.circulating / p.maxSupply) * 100) : null;
  const lead = p.pools[0] ?? null;
  const total = p.pools.reduce((s, x) => s + x.blocks, 0);
  return {
    t,
    locale,
    loc,
    t0: shape.t0,
    t1: shape.t1,
    series,
    mcapText: p.mcap != null ? `$${formatCompactNumber(p.mcap, locale)}` : "—",
    mcapExact: p.mcap != null ? `$${Math.round(p.mcap).toLocaleString(loc)}` : "",
    volText: p.vol24 != null ? `$${formatCompact(p.vol24, 1, locale)}` : null,
    rank: p.rank,
    circText: p.circulating != null ? `${formatCompactNumber(p.circulating, locale)} ERG` : "—",
    circExact: p.circulating != null ? `${Math.round(p.circulating).toLocaleString(loc)} ERG` : "",
    maxText: `${formatCompactNumber(p.maxSupply, locale)}`,
    emitted,
    holdersText: p.holders != null ? p.holders.toLocaleString(loc) : "—",
    monthText:
      p.holdersMonth != null && p.holdersMonth > 0
        ? t("home.net.month").replace("{n}", p.holdersMonth.toLocaleString(loc))
        : null,
    scriptsText:
      p.scripts != null ? countText(t, locale, "home.net.scripts", p.scripts, p.scripts.toLocaleString(loc)) : null,
    pools: p.pools,
    minerText: p.minerCount != null ? p.minerCount.toLocaleString(loc) : "—",
    leadText:
      lead && total > 0
        ? t("home.net.lead")
            .replace("{name}", !lead.address && lead.name === "other" ? t("home.shareOther") : lead.name)
            .replace("{pct}", `${((lead.blocks / total) * 100).toFixed(0)}%`)
        : t("home.poolsHint"),
  };
}

type Model = ReturnType<typeof useNetModel>;

export const NetStats = memo(function NetStats(props: NetStatsProps) {
  const m = useNetModel(props);
  const style = { ...CARD_TAG, "--enter": props.enter ?? 2 } as CSSProperties;
  if (props.variant === "a") return <NetA m={m} style={style} />;
  if (props.variant === "b") return <NetB m={m} style={style} />;
  return <NetC m={m} style={style} />;
});

/* ───────────────────────────── shared bits ───────────────────────────── */

function Fig({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={clsx("whitespace-nowrap font-semibold leading-none tabular-nums tracking-tight", className)} title={title}>
      {children}
    </span>
  );
}

/** A figure that reels when the live value changes; a hovered value prints plain. */
function LiveFig({
  live,
  hover,
  className,
  title,
}: {
  live: string | null;
  hover?: string | null;
  className?: string;
  /** The exact figure behind a short one (hover title). */
  title?: string;
}) {
  return (
    <Fig className={clsx(className, live == null && !hover && "text-[var(--muted)]")} title={title || undefined}>
      {hover ? hover : live != null ? <ReelText text={live} /> : "—"}
    </Fig>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <path d="M3 9 9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The series' name; tx and fees link to their pages, as their cards did. */
function SeriesName({ s, className }: { s: Series; className?: string }) {
  const body = (
    <>
      <span className="inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ background: s.ink }} aria-hidden />
      <span className="truncate">{s.name}</span>
    </>
  );
  if (s.href) {
    return (
      <Link
        prefetch={false}
        href={s.href}
        className={clsx("group/sn inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none text-[var(--muted)] hover:text-[var(--text)]", className)}
      >
        {body}
        <span className="opacity-60 group-hover/sn:opacity-100">
          <Arrow />
        </span>
      </Link>
    );
  }
  return (
    <span className={clsx("inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none text-[var(--muted)]", className)}>
      {body}
    </span>
  );
}

function DayAxis({ t0, t1, every = 1, className }: { t0: number; t1: number; every?: number; className?: string }) {
  const ticks = dayTicks(t0, t1, every);
  return (
    <div className={clsx("relative h-4", className)} aria-hidden>
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] leading-none tabular-nums text-[var(--muted-2)]"
          style={{ left: `${((t - t0) / (t1 - t0)) * 100}%` }}
        >
          {formatDottedDay(t, "UTC")}
        </span>
      ))}
    </div>
  );
}

/** Market cap · circulating · holders · pools: the four figures that have no week series. */
const Facts = memo(function Facts({ m, layout }: { m: Model; layout: "row" | "column" }) {
  const [pool, setPool] = useState<{ name: string; share: number } | null>(null);
  const t = m.t;
  const cell = clsx("flex min-w-0 flex-col gap-1.5", layout === "column" && "lg:gap-[5px]");
  return (
    <div
      className={clsx(
        layout === "row"
          ? "grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-4 lg:gap-x-8"
          : "grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-1 lg:gap-y-3"
      )}
    >
      <div className={cell}>
        <FactLabel ev="external">{t("home.mcap")}</FactLabel>
        <div className="flex min-w-0 items-baseline gap-2">
          <LiveFig live={m.mcapText} title={m.mcapExact} className="text-[18px]" />
          {m.rank != null ? (
            <span className="mcap-rank shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums">
              #{m.rank}
            </span>
          ) : null}
        </div>
        {m.volText ? (
          <span className="truncate text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
            {t("home.net.vol").replace("{v}", m.volText)}
          </span>
        ) : null}
      </div>
      <div className={cell}>
        <FactLabel>{t("home.circulating")}</FactLabel>
        <div className="flex min-w-0 items-baseline gap-2">
          <LiveFig live={m.circText} title={m.circExact} className="text-[18px]" />
        </div>
        {m.emitted != null ? (
          <div className="flex min-w-0 items-center gap-2">
            <SupplyMeter pct={m.emitted} className="min-w-0 flex-1" />
            <span className="shrink-0 text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
              {m.emitted.toFixed(1)}% {t("home.net.ofMax").replace("{max}", m.maxText)}
            </span>
          </div>
        ) : null}
      </div>
      <Link prefetch={false} href="/addresses" className={clsx(cell, "group/h rounded-[8px]")}>
        <FactLabel>
          <span className="group-hover/h:text-[var(--text)]">{t("home.holdersCount")}</span>
        </FactLabel>
        <LiveFig live={m.holdersText} className="text-[18px]" />
        {/* Two short facts: side by side where they fit, one under the other on a phone. */}
        <span className="flex min-w-0 flex-wrap gap-x-1.5 gap-y-1 text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
          {m.monthText ? <span className="whitespace-nowrap text-up">{m.monthText}</span> : null}
          {m.monthText && m.scriptsText ? <span className="max-sm:hidden" aria-hidden>·</span> : null}
          {m.scriptsText ? <span className="whitespace-nowrap">{m.scriptsText}</span> : null}
        </span>
      </Link>
      <div className={cell}>
        <FactLabel ev="decoded">{t("home.poolsActive")}</FactLabel>
        <div className="flex min-w-0 items-baseline gap-2">
          <LiveFig live={m.minerText} className="text-[18px]" />
          <span className="min-w-0 truncate text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
            {pool ? `${pool.name} · ${(pool.share * 100).toFixed(1)}%` : m.leadText}
          </span>
        </div>
        <PoolBar pools={m.pools} onPick={setPool} otherLabel={t("home.shareOther")} />
      </div>
    </div>
  );
});

/** Pointer x over a plot column → time in the week; one reader for every plot that shares the axis. */
function useWeekPointer(t0: number, t1: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const rect = useRef<DOMRect | null>(null);
  const handlers = {
    // The plot column's box, read once per visit: a move then costs no layout read.
    onPointerEnter: () => {
      rect.current = ref.current?.getBoundingClientRect() ?? null;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const r = rect.current ?? (rect.current = ref.current?.getBoundingClientRect() ?? null);
      if (!r || r.width <= 0) return;
      const f = (e.clientX - r.left) / r.width;
      if (f < 0 || f > 1) {
        setHoverT(null);
        return;
      }
      // Snap to the hour: the plots and readouts only change on a new hour.
      const t = Math.floor((t0 + f * (t1 - t0)) / 3_600_000) * 3_600_000;
      setHoverT((prev) => (prev === t ? prev : t));
    },
    onPointerLeave: () => {
      rect.current = null;
      setHoverT(null);
    },
  };
  return { ref, hoverT, handlers };
}

/* ───────────────────────────── A · Пульт ───────────────────────────── */

function NetA({ m, style }: { m: Model; style: CSSProperties }) {
  const [pick, setPick] = useState<SeriesKey>("price");
  const { ref, hoverT, handlers } = useWeekPointer(m.t0, m.t1);
  const s = m.series.find((x) => x.key === pick) ?? m.series[0]!;
  const hv = valueAt(s.data, hoverT);
  return (
    <section className={clsx(CARD, "net-a px-4 pb-3.5 pt-3 sm:px-5")} style={style} aria-label={m.t("home.net.title")}>
      <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
        <Tag>{m.t("home.net.title")}</Tag>
        <span className="text-[12px] leading-none text-[var(--muted)]">{m.t("home.net.week")}</span>
      </div>
      <div className="grid min-w-0 gap-x-6 gap-y-3 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div role="tablist" aria-label={m.t("home.net.pick")} className="grid grid-cols-3 gap-1.5 lg:grid-cols-1 lg:content-start">
          {m.series.map((x) => {
            const on = x.key === pick;
            const hero = x.key === "price";
            return (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPick(x.key)}
                className={clsx(
                  "group/tab relative flex min-w-0 flex-col gap-1.5 rounded-[10px] px-3 text-left transition-colors duration-150",
                  hero ? "py-2 max-lg:col-span-3" : "py-2 max-lg:px-2.5 lg:flex-row lg:items-center lg:justify-between lg:py-[7px]",
                  on ? "bg-[var(--wash-strong)]" : "hover:bg-[var(--wash)]"
                )}
              >
                <span className={clsx("inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none max-sm:text-[11px]", on ? "text-[var(--text)]" : "text-[var(--muted)]")}>
                  <span className="inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ background: x.ink, opacity: on ? 1 : 0.55 }} aria-hidden />
                  <span className="truncate">{x.name}</span>
                </span>
                <span className="flex min-w-0 items-baseline gap-2">
                  <LiveFig
                    live={x.now}
                    hover={on && hv ? x.at(hv) : null}
                    className={hero ? "text-[28px]" : "text-[16px]"}
                  />
                  {hero && x.delta != null ? <Delta pct={x.delta} suffix={x.deltaSuffix} className="self-center" /> : null}
                  {!hero && x.unit && !(on && hv) ? (
                    <span className="shrink-0 text-[11px] leading-none text-[var(--muted-2)] max-lg:hidden">{x.unit}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex h-4 items-center justify-between gap-3 text-[12px] leading-none">
            <span className="inline-flex min-w-0 items-center gap-2 text-[var(--muted)]">
              <span className="truncate text-[var(--text)]">{s.name}</span>
              <span className="truncate">· {s.grain}</span>
              {s.href ? (
                <Link prefetch={false} href={s.href} className="inline-flex shrink-0 items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]">
                  {m.t("home.viewAll")} <Arrow />
                </Link>
              ) : null}
            </span>
            {hv ? (
              <span className="shrink-0 tabular-nums text-[var(--muted)]">
                {stamp(hv)}
                {hv.open ? ` · ${m.t("home.net.soFar")}` : ""}
              </span>
            ) : s.delta != null && s.key !== "price" ? (
              <Delta pct={s.delta} suffix={s.deltaSuffix} />
            ) : null}
          </div>
          <div className="pr-[4.25rem]">
            <div ref={ref} {...handlers} className="cursor-crosshair touch-pan-y">
              <SeriesPlot
                data={s.data}
                t0={m.t0}
                t1={m.t1}
                ink={s.ink}
                height={124}
                hoverT={hoverT}
                yTicks={3}
                formatTick={s.tick}
                formatValue={s.fmt}
                grid
              />
            </div>
            <DayAxis t0={m.t0} t1={m.t1} className="mt-1.5 max-sm:hidden" />
            <DayAxis t0={m.t0} t1={m.t1} every={2} className="mt-1.5 sm:hidden" />
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-[var(--wash-mid)] pt-3">
        <Facts m={m} layout="row" />
      </div>
    </section>
  );
}

/* ───────────────────────────── B · Паспорт ───────────────────────────── */

function SheetRow({
  name,
  value,
  sub,
  aside,
  hero,
  href,
}: {
  name: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  hero?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <span className="min-w-0 self-center">{name}</span>
      <span className="flex min-w-0 flex-col justify-center gap-1">
        <span className="flex min-w-0 items-baseline gap-2">{value}</span>
        {sub ? <span className="truncate text-[12px] leading-none tabular-nums text-[var(--muted-2)]">{sub}</span> : null}
      </span>
      <span className="flex min-w-0 items-center justify-end">{aside}</span>
    </>
  );
  const cls = clsx(
    "grid min-w-0 items-center gap-x-3 border-t border-[var(--wash)] first:border-t-0",
    "grid-cols-[6.25rem_minmax(0,1fr)_6.5rem] sm:grid-cols-[8rem_minmax(0,1fr)_14rem]",
    hero ? "min-h-[62px] py-2" : "min-h-[50px] py-1.5"
  );
  if (href) {
    return (
      <Link prefetch={false} href={href} className={clsx(cls, "group/row hover:bg-[var(--wash-faint)]")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function SparkCell({ s, m, onHover }: { s: Series; m: Model; onHover: (h: SparkHover) => void }) {
  return (
    <Spark
      pts={s.data.kind === "line" ? s.data.pts : undefined}
      bins={s.data.kind === "bars" ? s.data.bins : undefined}
      t0={m.t0}
      t1={m.t1}
      ink={s.ink}
      onHover={onHover}
      label={`${s.name} · ${m.t("home.net.week")}`}
      className="w-full"
    />
  );
}

function NetB({ m, style }: { m: Model; style: CSSProperties }) {
  const [hov, setHov] = useState<Partial<Record<SeriesKey, SparkHover>>>({});
  const t = m.t;
  const [price, hash, txs, fees] = m.series as [Series, Series, Series, Series];
  const [pool, setPool] = useState<{ name: string; share: number } | null>(null);
  const on = (k: SeriesKey) => (h: SparkHover) => setHov((prev) => (prev[k] === h ? prev : { ...prev, [k]: h }));
  const seriesRow = (s: Series, hero = false) => {
    const h = hov[s.key] ?? null;
    return (
      <SheetRow
        key={s.key}
        hero={hero}
        href={s.href}
        name={<FactLabel ev={s.ev}>{s.name}</FactLabel>}
        value={
          <>
            <LiveFig live={s.now} hover={h ? s.at(h) : null} className={hero ? "text-[24px] sm:text-[28px]" : "text-[18px]"} />
            {h ? null : hero && s.delta != null ? <Delta pct={s.delta} suffix={s.deltaSuffix} className="self-center max-sm:hidden" /> : s.unit ? (
              <span className="shrink-0 text-[11px] leading-none text-[var(--muted-2)]">{s.unit}</span>
            ) : null}
          </>
        }
        sub={
          h ? (
            `${stamp(h)}${s.atUnit ? ` · ${s.atUnit}` : ""}${h.open ? ` · ${t("home.net.soFar")}` : ""}`
          ) : hero && s.delta != null ? (
            // A phone has no room for the chip beside the figure: it goes under it.
            <Delta pct={s.delta} suffix={s.deltaSuffix} className="sm:hidden" />
          ) : null
        }
        aside={<SparkCell s={s} m={m} onHover={on(s.key)} />}
      />
    );
  };
  return (
    <section className={clsx(CARD, "net-b px-4 pb-2 pt-3 sm:px-5")} style={style} aria-label={t("home.net.title")}>
      <div className="grid min-w-0 gap-x-10 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 flex h-[22px] items-center justify-between gap-3">
            <Tag>{t("home.net.market")}</Tag>
            <span className="text-[12px] leading-none text-[var(--muted)]">{t("home.net.week")}</span>
          </div>
          {seriesRow(price, true)}
          <SheetRow
            name={<FactLabel ev="external">{t("home.mcap")}</FactLabel>}
            value={
              <>
                <LiveFig live={m.mcapText} title={m.mcapExact} className="text-[18px]" />
                {m.rank != null ? (
                  <span className="mcap-rank shrink-0 self-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums">#{m.rank}</span>
                ) : null}
              </>
            }
            aside={m.volText ? <span className="text-[12px] tabular-nums text-[var(--muted-2)]">{t("home.net.vol").replace("{v}", m.volText)}</span> : null}
          />
          <SheetRow
            name={<FactLabel>{t("home.circulating")}</FactLabel>}
            value={<LiveFig live={m.circText} title={m.circExact} className="text-[18px]" />}
            sub={
              m.emitted != null ? (
                <>
                  {m.emitted.toFixed(1)}%<span className="max-sm:hidden"> {t("home.net.ofMax").replace("{max}", m.maxText)}</span>
                </>
              ) : null
            }
            aside={m.emitted != null ? <SupplyMeter pct={m.emitted} className="w-full" /> : null}
          />
          <SheetRow
            href="/addresses"
            name={<FactLabel>{t("home.holdersCount")}</FactLabel>}
            value={<LiveFig live={m.holdersText} className="text-[18px]" />}
            sub={m.scriptsText}
            aside={m.monthText ? <span className="text-[12px] tabular-nums text-up">{m.monthText}</span> : null}
          />
        </div>
        <div className="min-w-0 max-lg:mt-2">
          <div className="mb-1 flex h-[22px] items-center justify-between gap-3">
            <Tag>{t("home.net.title")}</Tag>
            <span className="text-[12px] leading-none text-[var(--muted)] lg:invisible">{t("home.net.week")}</span>
          </div>
          {seriesRow(hash)}
          <SheetRow
            name={<FactLabel ev="decoded">{t("home.poolsActive")}</FactLabel>}
            value={<LiveFig live={m.minerText} className="text-[18px]" />}
            sub={pool ? `${pool.name} · ${(pool.share * 100).toFixed(1)}%` : m.leadText}
            aside={<PoolBar pools={m.pools} onPick={setPool} otherLabel={t("home.shareOther")} />}
          />
          {seriesRow(txs)}
          {seriesRow(fees)}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── C · Неделя ───────────────────────────── */

function NetC({ m, style }: { m: Model; style: CSSProperties }) {
  const { ref, hoverT, handlers } = useWeekPointer(m.t0, m.t1);
  const t = m.t;
  return (
    <section className={clsx(CARD, "net-c px-4 pb-3.5 pt-3 sm:px-5")} style={style} aria-label={t("home.net.title")}>
      <div className="mb-3 flex h-[22px] items-center justify-between gap-3">
        <Tag>{t("home.net.title")}</Tag>
        <span className="text-[12px] leading-none tabular-nums text-[var(--muted)]">
          {hoverT != null ? stamp({ t: hoverT, v: 0 }) : t("home.net.week")}
        </span>
      </div>
      <div className="grid min-w-0 gap-x-7 gap-y-5 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <div className="min-w-0 lg:border-r lg:border-[var(--wash-mid)] lg:pr-6">
          <Facts m={m} layout="column" />
        </div>
        <div className="flex min-w-0 flex-col max-lg:order-first" {...handlers}>
          {m.series.map((s) => {
            const hero = s.key === "price";
            const hv = valueAt(s.data, hoverT);
            const unit = hv ? (s.atUnit ? `${s.atUnit}${hv.open ? ` · ${t("home.net.soFar")}` : ""}` : null) : s.unit;
            return (
              <div
                key={s.key}
                className={clsx(
                  "grid min-w-0 items-center gap-x-6 gap-y-1.5 lg:grid-cols-[13rem_minmax(0,1fr)]",
                  hero ? "mb-3" : "mb-2.5"
                )}
              >
                <div
                  className={clsx(
                    "flex min-w-0 justify-between gap-2",
                    hero ? "items-baseline lg:flex-col lg:items-start lg:gap-2" : "items-center"
                  )}
                >
                  <SeriesName s={s} />
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <LiveFig live={s.now} hover={hv ? s.at(hv) : null} className={hero ? "text-[24px] lg:text-[28px]" : "text-[16px]"} />
                    {!hv && hero && s.delta != null ? (
                      <Delta pct={s.delta} suffix={s.deltaSuffix} className="self-center" />
                    ) : unit ? (
                      <span className="shrink-0 text-[11px] leading-none text-[var(--muted-2)]">{unit}</span>
                    ) : null}
                  </span>
                </div>
                <div className="cursor-crosshair touch-pan-y" ref={hero ? ref : undefined}>
                  <SeriesPlot data={s.data} t0={m.t0} t1={m.t1} ink={s.ink} height={hero ? 58 : 38} hoverT={hoverT} />
                </div>
              </div>
            );
          })}
          <div className="grid min-w-0 gap-x-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <span className="max-lg:hidden" />
            <DayAxis t0={m.t0} t1={m.t1} className="max-sm:hidden" />
            <DayAxis t0={m.t0} t1={m.t1} every={2} className="sm:hidden" />
          </div>
        </div>
      </div>
    </section>
  );
}

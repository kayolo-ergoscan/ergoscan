"use client";

/**
 * Home «Сеть» (concept C «Неделя», chosen by the operator 14.11.2026): the eight home figures in one
 * card. Price, hashrate, transactions and fees as small multiples on one shared UTC week with one
 * crosshair; market cap, circulating, holders and pools (no week series) in a row under them.
 * Same data as /v1/page/home sends; nothing new is fetched. SVG only, hover state stays inside the
 * card, nothing animates at rest. Each series is its own memo: a block that moves only the
 * transactions redraws only their columns.
 */
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { LinePoint } from "@lumen/amm-chart";
import type { PoolShare } from "@/lib/chain-stats";
import type { EvidenceKind } from "@/lib/trust-board";
import { HOME } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { ReelText } from "@/components/ReelText";
import { Tip } from "@/components/Tip";
import { formatCompact, formatCompactNumber, formatDottedDay, formatH24, formatHashrate, formatUsdPrice } from "@/lib/format";
import { binActivity, binHours, cleanLine, dayTicks, netDomain, weekLine, type ActivityHour } from "@/lib/net-stats";
import { Delta, EvDot, FactLabel, PoolBar, SERIES_INK, SupplyMeter, type SeriesKey } from "./parts";
import { SeriesPlot, valueAt, type PlotData, type PlotValue } from "./SeriesPlot";

export type NetStatsProps = {
  price: readonly LinePoint[];
  /** Why the price band is empty (loading, unavailable); null when it has a week. */
  priceNote: string | null;
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
  /** The hour the activity's snapshot was made in (asOfHour): a 6 h column that ends after it is still filling. */
  activityAt: number | null;
  enter?: number;
};

/** What a band prints: its name, links and formats. Built once per language. */
type Band = {
  key: SeriesKey;
  name: string;
  ink: string;
  /** A level (price, hashrate) is a line and taller for the price; a sum is 6 h columns. */
  height: number;
  /** The hovered point or column. */
  at: (v: number) => string;
  /** The unit after the figure at rest (a hovered column names its UTC hours instead). */
  unit?: string;
  href?: string;
  ev?: EvidenceKind;
};

const CARD =
  "home-tile-enter mod relative flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]";
/** The card's one tag, in the network's colour (a card with tx/fee links would turn it orange). */
const CARD_TAG = { "--tag": "var(--f-net)", "--tag-ink": "var(--k-ink)" } as const;

const HOUR_MS = 3_600_000;

function stamp(t: number): string {
  return `${formatDottedDay(t, "UTC")} · ${formatH24(t, "UTC", false)} UTC`;
}

function feeFig(v: number, locale: string): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100) return formatCompact(v, 1, locale);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export const NetStats = memo(function NetStats(p: NetStatsProps) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";

  // One memo per series: an array the page kept (nothing changed) keeps its plot as it is.
  const pricePts = useMemo(() => cleanLine(p.price), [p.price]);
  const hashPts = useMemo(() => cleanLine(p.hashSeries), [p.hashSeries]);
  const [t0, t1] = useMemo(() => netDomain(pricePts, hashPts, p.activity), [pricePts, hashPts, p.activity]);
  const data = useMemo(() => {
    const price: PlotData = { kind: "line", ...weekLine(pricePts, t0) };
    const hashrate: PlotData = { kind: "line", ...weekLine(hashPts, t0) };
    return { price, hashrate };
  }, [pricePts, hashPts, t0]);
  const sums = useMemo(() => {
    const txs: PlotData = { kind: "bars", bins: binActivity(p.activity, "txs", p.activityAt) };
    const fees: PlotData = { kind: "bars", bins: binActivity(p.activity, "feesErg", p.activityAt) };
    return { txs, fees };
  }, [p.activity, p.activityAt]);

  const bands = useMemo<Band[]>(() => {
    const usd = (v: number) => formatUsdPrice(v, locale);
    return [
      { key: "price", name: t("home.price"), ink: SERIES_INK.price, height: 56, at: usd, ev: "external" },
      { key: "hashrate", name: t("home.hashrate"), ink: SERIES_INK.hashrate, height: 38, at: formatHashrate, ev: "decoded" },
      {
        key: "txs",
        name: t("home.txs"),
        ink: SERIES_INK.txs,
        height: 38,
        at: (v) => Math.round(v).toLocaleString(loc),
        unit: t("home.net.per24h"),
        href: "/transactions",
      },
      {
        key: "fees",
        name: t("home.txChartFees"),
        ink: SERIES_INK.fees,
        height: 38,
        at: (v) => `${feeFig(v, locale)} ERG`,
        unit: t("home.net.per24h"),
        href: "/fees",
      },
    ];
  }, [t, locale, loc]);

  const now: Record<SeriesKey, string | null> = {
    price: p.spot != null ? formatUsdPrice(p.spot, locale) : null,
    hashrate: p.hashrate != null ? formatHashrate(p.hashrate) : null,
    txs: p.txDay != null ? Math.round(p.txDay).toLocaleString(loc) : null,
    fees: p.feeDay != null ? `${feeFig(p.feeDay, locale)} ERG` : null,
  };
  const plot: Record<SeriesKey, PlotData> = { ...data, ...sums };
  const warm = t("home.chartWarm");
  const note = (k: SeriesKey): string | null =>
    k === "price" ? p.priceNote : k === "hashrate" ? (hashPts.length < 2 ? warm : null) : p.activity.length < 2 ? warm : null;

  const { ref, box, hoverT, handlers } = useWeekPointer(t0, t1);
  const style = { ...CARD_TAG, "--enter": p.enter ?? 2 } as CSSProperties;
  const titleId = useId();

  return (
    <section className={clsx(CARD, "net-card h-full px-4 pb-3.5 pt-3 sm:px-5")} style={style} aria-labelledby={titleId}>
      <div className="mb-3 flex h-[22px] shrink-0 items-center justify-between gap-3">
        <h2 id={titleId} className="text-[13px] leading-none" style={{ color: HOME.forming }}>
          {t("home.net.title")}
        </h2>
        <span className="text-[12px] leading-none tabular-nums text-[var(--muted)]">
          {hoverT != null ? stamp(hoverT) : t("home.net.week")}
        </span>
      </div>
      <div ref={box} className="flex min-w-0 flex-col gap-2.5" {...handlers}>
        {bands.map((b, i) => (
          <BandRow
            key={b.key}
            band={b}
            data={plot[b.key]}
            now={now[b.key]}
            note={note(b.key)}
            delta={b.key === "price" ? p.change24h : null}
            t0={t0}
            t1={t1}
            hoverT={hoverT}
            plotRef={i === 0 ? ref : undefined}
          />
        ))}
        {/* The bands' name column (net-band, globals.css): the plots and the day axis share the rest. */}
        <div className="net-band">
          <span className="net-axis-pad" />
          <DayAxis t0={t0} t1={t1} />
        </div>
      </div>
      <div className="mt-auto pt-3">
        <div className="border-t border-[var(--wash-mid)] pt-3">
          <Facts
            mcap={p.mcap}
            rank={p.rank}
            vol24={p.vol24}
            circulating={p.circulating}
            maxSupply={p.maxSupply}
            holders={p.holders}
            holdersMonth={p.holdersMonth}
            scripts={p.scripts}
            pools={p.pools}
            minerCount={p.minerCount}
          />
        </div>
      </div>
    </section>
  );
});

/* ───────────────────────────── the bands ───────────────────────────── */

function Fig({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("whitespace-nowrap font-semibold leading-none tabular-nums tracking-tight", className)}>{children}</span>;
}

/** A figure that reels when the live value changes; a hovered value prints plain. */
function LiveFig({ live, hover, className }: { live: string | null; hover?: string | null; className?: string }) {
  return (
    <Fig className={clsx(className, live == null && !hover && "text-[var(--muted)]")}>
      {hover ? hover : live != null ? <ReelText text={live} /> : "—"}
    </Fig>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden>
      <path d="M3 9 9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The series' name in its ink's key (a heading under the card's); transactions and fees link to their pages. */
function BandName({ band }: { band: Band }) {
  return <h3 className="flex min-w-0">{bandName(band)}</h3>;
}

function bandName(band: Band) {
  const body = (
    <>
      <span className="inline-block h-[3px] w-3 shrink-0 rounded-full" style={{ background: band.ink }} aria-hidden />
      <span className="truncate">{band.name}</span>
    </>
  );
  if (band.href) {
    return (
      <Link
        prefetch={false}
        href={band.href}
        className="group/sn inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none text-[var(--muted)] hover:text-[var(--text)]"
      >
        {body}
        <span className="text-[var(--muted-2)] group-hover/sn:text-[var(--text)]">
          <Arrow />
        </span>
      </Link>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none text-[var(--muted)]">
      {body}
      {band.ev ? <EvDot kind={band.ev} /> : null}
    </span>
  );
}

const BandRow = memo(function BandRow({
  band,
  data,
  now,
  note,
  delta,
  t0,
  t1,
  hoverT,
  plotRef,
}: {
  band: Band;
  data: PlotData;
  now: string | null;
  note: string | null;
  delta: number | null;
  t0: number;
  t1: number;
  hoverT: number | null;
  plotRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useT();
  const hv: PlotValue | null = valueAt(data, hoverT);
  const hero = band.key === "price";
  // A hovered column is a 6 h sum: it names its UTC hours (the header names the hour of the lines).
  const unit = hv ? (hv.t1 != null ? binUnit(hv, t) : null) : band.unit;
  return (
    <div className="net-band">
      {/* A narrow card: name and figure on one line over the plot. A wide one: a column beside it. */}
      <div className="net-band-head">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <BandName band={band} />
          {hero && delta != null && !hv ? <Delta pct={delta} suffix={t("home.net.h24")} /> : null}
        </div>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <LiveFig live={now} hover={hv ? band.at(hv.v) : null} className={hero ? "text-[22px]" : "text-[16px]"} />
          {unit ? <span className="truncate text-[11px] leading-none text-[var(--muted-2)]">{unit}</span> : null}
        </span>
      </div>
      <div className="relative cursor-crosshair touch-pan-y" ref={plotRef} data-net-plot="">
        <SeriesPlot data={data} t0={t0} t1={t1} ink={band.ink} height={band.height} hoverT={hoverT} />
        {note ? (
          <span className="pointer-events-none absolute inset-0 flex items-center text-[12px] text-[var(--muted-2)]">{note}</span>
        ) : null}
      </div>
    </div>
  );
});

/** "12–18 UTC" for a closed column; "since 12 UTC" for the one still filling. */
function binUnit(v: PlotValue, t: (k: string) => string): string {
  const [a, b] = binHours(v.t, v.t1!);
  return v.open ? t("home.net.since").replace("{h}", a) : `${a}–${b} UTC`;
}

/** UTC midnights under the plots: every day, every other day under a narrow plot. */
function DayAxis({ t0, t1 }: { t0: number; t1: number }) {
  const ticks = dayTicks(t0, t1);
  const first = ticks[0] ?? 0;
  return (
    <div className="relative h-4" aria-hidden>
      {ticks.map((d) => (
        <span
          key={d}
          className={clsx(
            "absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] leading-none tabular-nums text-[var(--muted-2)]",
            Math.round((d - first) / (24 * HOUR_MS)) % 2 === 1 && "net-day-odd"
          )}
          style={{ left: `${((d - t0) / (t1 - t0)) * 100}%` }}
        >
          {formatDottedDay(d, "UTC")}
        </span>
      ))}
    </div>
  );
}

/**
 * Pointer x over the plots → the hour in the week; one reader for every band on the axis.
 * A mouse reads while it hovers. A finger taps a plot to read that hour (or drags along it) and the
 * readout stays until a tap elsewhere; a vertical swipe still scrolls the page (touch-pan-y), and a
 * swipe that becomes a scroll clears it.
 */
function useWeekPointer(t0: number, t1: number) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const rect = useRef<DOMRect | null>(null);
  const read = () => (rect.current = ref.current?.getBoundingClientRect() ?? null);
  const pick = (clientX: number) => {
    const r = rect.current ?? read();
    if (!r || r.width <= 0) return;
    const f = (clientX - r.left) / r.width;
    if (f < 0 || f > 1) {
      setHoverT(null);
      return;
    }
    // Snap to the hour: the plots and readouts only change on a new hour.
    const at = Math.floor((t0 + f * (t1 - t0)) / HOUR_MS) * HOUR_MS;
    setHoverT((prev) => (prev === at ? prev : at));
  };
  const clear = () => {
    setPinned(false);
    setHoverT(null);
  };
  const onPlot = (e: React.PointerEvent) => e.target instanceof Element && e.target.closest("[data-net-plot]") != null;
  const finger = (e: React.PointerEvent) => e.pointerType === "touch";

  // A pinned readout goes on the next tap outside the plots.
  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (e.target instanceof Node && box.current?.contains(e.target)) return;
      setPinned(false);
      setHoverT(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [pinned]);

  const handlers = {
    // The plot column's box, read once per visit: a move then costs no layout read.
    onPointerEnter: () => {
      read();
    },
    onPointerDown: (e: React.PointerEvent) => {
      // A finger: the page may have scrolled since the last touch.
      if (finger(e)) read();
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (finger(e) && !onPlot(e) && hoverT == null) return;
      pick(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!finger(e)) return;
      if (!onPlot(e)) {
        clear();
        return;
      }
      pick(e.clientX);
      setPinned(true);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (finger(e)) clear();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      rect.current = null;
      // A finger lifts out of the plots after every tap: its readout stays.
      if (!finger(e)) clear();
    },
  };
  return { ref, box, hoverT, handlers };
}

/* ───────────────────────────── the facts ───────────────────────────── */

/** Market cap · circulating · holders · pools: the four figures that have no week series. */
const Facts = memo(function Facts(p: {
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
}) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const [pool, setPool] = useState<{ name: string; share: number } | null>(null);
  const emitted = p.circulating != null && p.maxSupply > 0 ? Math.min(100, (p.circulating / p.maxSupply) * 100) : null;
  const lead = p.pools[0] ?? null;
  const other = t("home.shareOther");
  const leadText = lead
    ? t("home.net.lead")
        .replace("{name}", !lead.address && lead.name === "other" ? other : lead.name)
        .replace("{pct}", sharePct(lead.share))
    : t("home.poolsHint");
  const cell = "flex min-w-0 flex-col gap-1.5";
  const fig = "text-[17px]";
  return (
    <div className="net-facts">
      <div className={cell}>
        <FactLabel ev="external">{t("home.mcap")}</FactLabel>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <Tip content={p.mcap != null ? `$${Math.round(p.mcap).toLocaleString(loc)}` : null}>
            <span className="min-w-0">
              <LiveFig live={p.mcap != null ? `$${formatCompactNumber(p.mcap, locale)}` : null} className={fig} />
            </span>
          </Tip>
          {p.rank != null ? (
            <span className="mcap-rank shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums">#{p.rank}</span>
          ) : null}
        </div>
        {p.vol24 != null ? (
          <Tip content={`$${Math.round(p.vol24).toLocaleString(loc)}`}>
            <span className="min-w-0 self-start truncate text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
              {t("home.net.vol").replace("{v}", `$${formatCompact(p.vol24, 1, locale)}`)}
            </span>
          </Tip>
        ) : null}
      </div>
      <div className={cell}>
        <FactLabel>{t("home.circulating")}</FactLabel>
        <Tip content={p.circulating != null ? `${Math.round(p.circulating).toLocaleString(loc)} ERG` : null}>
          <span className="min-w-0 self-start">
            <LiveFig live={p.circulating != null ? `${formatCompactNumber(p.circulating, locale)} ERG` : null} className={fig} />
          </span>
        </Tip>
        {emitted != null ? (
          <div className="flex min-w-0 items-center gap-2">
            <SupplyMeter pct={emitted} className="min-w-6 flex-1" />
            <span className="shrink-0 text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
              {emitted.toFixed(1)}% {t("home.net.ofMax").replace("{max}", formatCompactNumber(p.maxSupply, locale))}
            </span>
          </div>
        ) : null}
      </div>
      <Link prefetch={false} href="/addresses" className={clsx(cell, "group/h rounded-[8px]")}>
        {/* What counts as a holder, and as a script: each on its own words (a tap opens the list). */}
        <Tip content={t("home.holdersHint")} tap={false}>
          <span className="flex min-w-0 flex-col gap-1.5 self-start">
            <FactLabel>
              <span className="group-hover/h:text-[var(--text)]">{t("home.holdersCount")}</span>
            </FactLabel>
            <LiveFig live={p.holders != null ? p.holders.toLocaleString(loc) : null} className={fig} />
          </span>
        </Tip>
        {/* Two short facts, one under the other (side by side they read as one). */}
        <span className="flex min-w-0 flex-col items-start gap-1 text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
          {p.holdersMonth != null && p.holdersMonth > 0 ? (
            <span className="max-w-full truncate text-up">{t("home.net.month").replace("{n}", p.holdersMonth.toLocaleString(loc))}</span>
          ) : null}
          {p.scripts != null ? (
            <Tip content={t("home.scriptHint")} tap={false}>
              <span className="max-w-full truncate">{countText(t, locale, "home.net.scripts", p.scripts, p.scripts.toLocaleString(loc))}</span>
            </Tip>
          ) : null}
        </span>
      </Link>
      <div className={cell}>
        <FactLabel ev="decoded">{t("home.poolsActive")}</FactLabel>
        <div className="flex min-w-0 items-baseline gap-2">
          <LiveFig live={p.minerCount != null ? p.minerCount.toLocaleString(loc) : null} className={fig} />
          <span className="min-w-0 truncate text-[12px] leading-none tabular-nums text-[var(--muted-2)]">
            {pool ? `${pool.name} · ${sharePct(pool.share)}` : leadText}
          </span>
        </div>
        <PoolBar pools={p.pools} onPick={setPool} otherLabel={other} />
      </div>
    </div>
  );
});

/** A pool's share of the day's blocks, as prod printed it: one decimal. */
function sharePct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

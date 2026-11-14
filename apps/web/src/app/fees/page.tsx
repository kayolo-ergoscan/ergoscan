"use client";

import { useMemo, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { useErgUsd } from "@/components/PriceTape";
import { Tip, TipHead, TipRow, TipRows } from "@/components/Tip";
import { useMempool } from "@/lib/useMempool";
import { formatEtaLeft, useNextBlockLeft } from "@/lib/block-eta";
import { blocksToWait, levelCostNano, medianOf } from "@/lib/fee-levels";
import { formatFeeRate, formatInt, formatPct, formatScaledAmount, formatUsd, nanoToUsd } from "@/lib/format";
import { INK } from "@/lib/palette";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import {
  Feed,
  FeedAmount,
  FeedBoard,
  FeedCount,
  FeedField,
  FeedFields,
  FeedPlate,
  FeedRow,
  feedLoc,
  type FeedKind,
} from "@/components/feed/Feed";

export default function FeesPage() {
  const { t, locale } = useI18n();
  const { fees, balls } = useMempool();
  const max = Math.max(1, ...(fees?.buckets.map((b) => b.count) ?? [1]));
  const rates = useMemo(() => balls.map((b) => b.feeRate).filter(Number.isFinite), [balls]);
  const sizes = useMemo(
    () => balls.map((b) => b.size).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b),
    [balls]
  );

  // Counts down every second; past the average interval the block is due («any moment», not «0s»).
  const etaLeft = useNextBlockLeft(fees?.eta);
  const etaText = etaLeft == null ? "—" : formatEtaLeft(etaLeft) ?? t("fees.etaDue");

  const txsKpi = {
    label: t("fees.kpiTxs"),
    value: formatInt(balls.length, locale),
    mark: <KpiMark id="mempool" tone={INK.cyan} />,
    enter: 0,
  };
  const etaKpi = {
    label: t("fees.kpiEta"),
    value: etaText,
    mark: <KpiMark id="interval" tone={INK.teal} />,
    enter: 3,
  };
  const kpis = [
    txsKpi,
    {
      label: t("fees.kpiP50"),
      value: fees ? formatFeeRate(fees.p50) : "—",
      mark: <KpiMark id="fee-rate" tone={INK.teal} />,
      enter: 1,
    },
    {
      label: t("fees.kpiP90"),
      value: fees ? formatFeeRate(fees.p90) : "—",
      mark: <KpiMark id="fee-rate" tone={INK.teal} />,
      enter: 2,
    },
    etaKpi,
  ];
  // The mempool can empty out right after a block; the last median keeps the prices up.
  const lastMedian = useRef<number | null>(null);
  const median = medianOf(sizes) ?? lastMedian.current;
  lastMedian.current = median;

  return (
    <Shell>
      <div className="mb-5 flex justify-end">
        <Link
          prefetch={false}
          href="/mempool"
          className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--wash)]"
        >
          {t("live.openMempool")}
        </Link>
      </div>
      <KpiGrid items={kpis} className="mb-6 max-md:hidden" />
      {/* Phone: the three levels say what a typical transaction costs; p50 and p90 are their n/B lines. */}
      <KpiGrid items={[txsKpi, { ...etaKpi, enter: 1 }]} className="mb-3 md:hidden" />
      <FeeLevelPills
        rates={fees?.recommend}
        median={median}
        balls={balls}
        allRates={rates}
        className="mb-6 md:hidden"
      />

      <div className="feed-sheet mb-10 max-md:hidden">
        <Feed className="is-rank" busy={!fees}>
          <FeedBoard
            plate={
              <FeedPlate
                tag={t("feed.fees.title")}
                now
                count={<FeedCount k="feed.txCount" n={balls.length} />}
              />
            }
          >
            {LEVELS.map((level, i) => (
              <FeeLevelRow
                key={level}
                level={level}
                rank={i + 1}
                rate={fees?.recommend[level]}
                rates={rates}
                sizes={sizes}
              />
            ))}
          </FeedBoard>
        </Feed>
      </div>

      <div className="glass-static rounded-[20px] p-6">
        <p className="mb-4 text-[12px] uppercase tracking-wider text-[var(--muted)]">
          {t("fees.distribution")} · {balls.length} {t("home.txUnit")} · p50{" "}
          {fees ? formatFeeRate(fees.p50) : "—"} · p90 {fees ? formatFeeRate(fees.p90) : "—"}
        </p>
        <div className="flex h-40 items-end gap-1">
          {(fees?.buckets ?? []).map((b, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
              <div
                className="w-full rounded-t bg-accent/80"
                style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 4 : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

const LEVELS = ["economy", "normal", "turbo"] as const;
type Level = (typeof LEVELS)[number];

/** Dot per level: the same calm grey, miner gold and rent orange as the level tiles. */
const LEVEL_DOT: Record<Level, string> = {
  economy: "var(--muted)",
  normal: "var(--ink-gold, var(--warning))",
  turbo: "var(--k-rent-text, var(--down))",
};

/**
 * Phone: one row of three level pills. Each prices a median-size transaction in ERG and $,
 * says when it lands (blocks fill by rate), and keeps its n/B on the last line.
 * A tap shows what the level is pinned to.
 */
function FeeLevelPills({
  rates,
  median,
  balls,
  allRates,
  className,
}: {
  rates: Record<Level, number> | undefined;
  median: number | null;
  balls: { feeRate: number; size: number }[];
  allRates: number[];
  className?: string;
}) {
  const { t, locale } = useI18n();
  const usd = useErgUsd();
  return (
    <section className={className} aria-label={t("feed.fees.title")}>
      <p className="mb-2 px-1 text-[12px] text-[var(--muted)]">
        {median != null
          ? t("feed.fees.forTx").replace("{n}", formatInt(median, locale))
          : t("feed.fees.title")}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {LEVELS.map((level, i) => {
          const rate = rates?.[level];
          const known = rate != null && Number.isFinite(rate);
          const nano = levelCostNano(rate, median);
          const cost = nano != null ? formatScaledAmount(nano, 9, locale, 4) : null;
          const usdCost = nano != null ? nanoToUsd(nano, usd) : null;
          const wait = known ? blocksToWait(rate, balls, median ?? 0) : null;
          const ahead = known ? allRates.filter((r) => r > rate).length : 0;
          const below =
            known && allRates.length
              ? Math.round((allRates.filter((r) => r < rate).length / allRates.length) * 100)
              : null;
          const tip = known ? (
            <>
              <TipHead>{t(`fees.${level}`)}</TipHead>
              <TipRows>
                <TipRow label={t("feed.fees.basis")}>{t(`feed.fees.basis.${level}`)}</TipRow>
                <TipRow label={t("feed.fees.rate")}>{formatFeeRate(rate)}</TipRow>
                {allRates.length ? (
                  <TipRow label={t("fees.kpiTxs")}>
                    {countText(t, locale, "feed.fees.ahead", ahead, formatInt(ahead, locale))}
                  </TipRow>
                ) : null}
                {below != null ? (
                  <TipRow label="%">{t("feed.fees.above").replace("{pct}", formatPct(below, locale, 0, 0))}</TipRow>
                ) : null}
              </TipRows>
            </>
          ) : null;
          return (
            <Tip key={level} content={tip}>
              <div
                className="home-tile-enter mod flex min-w-0 flex-col rounded-[16px] border border-[var(--border)] bg-[var(--module)] px-2.5 py-2.5"
                style={{ "--enter": i + 2 } as CSSProperties}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium leading-none text-[var(--text)]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL_DOT[level] }} aria-hidden />
                  <span className="truncate">{t(`fees.${level}`)}</span>
                </span>
                <span className="mt-2 truncate font-mono text-[16px] font-semibold leading-tight tabular-nums text-[var(--text)]">
                  {cost != null ? `≈${cost}` : "—"}
                </span>
                <span className="mt-0.5 truncate text-[11px] leading-tight tabular-nums text-[var(--muted)]">
                  {usdCost != null ? `ERG · ${formatUsd(usdCost)}` : "ERG"}
                </span>
                <span
                  className="mt-1.5 truncate text-[11px] font-medium leading-tight"
                  style={{ color: wait == null ? "var(--muted-2)" : wait <= 1 ? "var(--up)" : "var(--warning)" }}
                >
                  {wait == null
                    ? "—"
                    : wait <= 1
                      ? t("fees.pillNext")
                      : t("fees.pillBlocks").replace("{n}", formatInt(wait, locale))}
                </span>
                <span className="mt-1.5 truncate border-t border-[var(--border-soft)] pt-1.5 font-mono text-[10px] leading-none tabular-nums text-[var(--muted-2)]">
                  {known ? formatFeeRate(rate) : "—"}
                </span>
              </div>
            </Tip>
          );
        })}
      </div>
    </section>
  );
}

/** Tile colour per level: a calm grey, the miner gold, the rent orange for "now". */
const LEVEL_KIND: Record<Level, FeedKind> = { economy: "quiet", normal: "block", turbo: "rent" };

/**
 * One fee level. The figure is the rate; the facts say what it is pinned to and how much
 * of the mempool pays more; the detail prices a median-size transaction at that rate.
 */
function FeeLevelRow({
  level,
  rank,
  rate,
  rates,
  sizes,
}: {
  level: Level;
  rank: number;
  rate: number | undefined;
  rates: number[];
  sizes: number[];
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const known = rate != null && Number.isFinite(rate);
  const ahead = known ? rates.filter((r) => r > rate).length : 0;
  const below = known && rates.length ? Math.round((rates.filter((r) => r < rate).length / rates.length) * 100) : null;
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)]! : null;
  const feeNano = known && median != null ? BigInt(Math.round(rate * median)) : null;
  return (
    <FeedRow
      k={LEVEL_KIND[level]}
      glyph="fee"
      lead={{ rank: rank.toLocaleString(tag) }}
      title={<span className="feed-name font-semibold">{t(`fees.${level}`)}</span>}
      facts={
        <>
          <span className="feed-kind feed-wrap">{t(`feed.fees.basis.${level}`)}</span>
          {known && rates.length ? (
            <span className="feed-mid tabular-nums">
              {countText(t, locale, "feed.fees.ahead", ahead, ahead.toLocaleString(tag))}
            </span>
          ) : null}
        </>
      }
      value={<FeedAmount raw={known ? BigInt(Math.round(rate)) : null} decimals={0} unit="n/B" />}
      sub={below != null ? t("feed.fees.above").replace("{pct}", `${below}%`) : undefined}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("feed.fees.rate")}>
            <span className="tabular-nums">{known ? formatFeeRate(rate) : "—"}</span>
          </FeedField>
          <FeedField label={t("feed.fees.basis")}>
            <span>{t(`feed.fees.basis.${level}`)}</span>
          </FeedField>
          {median != null ? (
            <FeedField label={t("feed.fees.forTx").replace("{n}", median.toLocaleString(tag))}>
              <span className="tabular-nums">
                {feeNano != null ? `${formatScaledAmount(feeNano, 9, tag, 9)} ERG` : "—"}
              </span>
            </FeedField>
          ) : null}
          {known && rates.length ? (
            <FeedField label={t("fees.kpiTxs")}>
              <span className="tabular-nums">
                {countText(t, locale, "feed.fees.ahead", ahead, ahead.toLocaleString(tag))}
              </span>
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { useMempool } from "@/lib/useMempool";
import { formatFeeRate, formatScaledAmount } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
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

function formatEta(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function FeesPage() {
  const t = useT();
  const { fees, balls } = useMempool();
  const max = Math.max(1, ...(fees?.buckets.map((b) => b.count) ?? [1]));
  const rates = useMemo(() => balls.map((b) => b.feeRate).filter(Number.isFinite), [balls]);
  const sizes = useMemo(
    () => balls.map((b) => b.size).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b),
    [balls]
  );

  const kpis = [
    { label: t("fees.kpiTxs"), value: balls.length.toLocaleString(), enter: 0 },
    { label: t("fees.kpiP50"), value: fees ? formatFeeRate(fees.p50) : "—", enter: 1 },
    { label: t("fees.kpiP90"), value: fees ? formatFeeRate(fees.p90) : "—", enter: 2 },
    { label: t("fees.kpiEta"), value: formatEta(fees?.eta?.nextEtaSec), enter: 3 },
  ];

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
      <KpiGrid items={kpis} className="mb-6" />

      <div className="feed-sheet mb-10">
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
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
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

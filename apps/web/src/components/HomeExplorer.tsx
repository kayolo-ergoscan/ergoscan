"use client";

/**
 * Explorer home — chain dashboard.
 * KPI + ERG/USD from the indexer snapshot. `/chain-stats` is not on this path.
 * Block and tx lists live on /blocks and /transactions.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { getGateway } from "@/lib/config";
import { patchHomeStats, type ChainStats, type PoolShare } from "@/lib/chain-stats";
import { KpiNum } from "@/components/KpiGrid";
import { ReelText } from "@/components/ReelText";
import { HOME } from "@/lib/palette";
import { fetchErgChart } from "@/lib/price-history";
import type { ErgMarket } from "@/lib/list-snapshots";
import {
  formatBytes,
  formatCompact,
  formatDottedDate,
  formatDottedDay,
  formatErgPrecise,
  formatH24,
  formatHashrate,
  formatUsd,
} from "@/lib/format";
import { useReducedMotion } from "framer-motion";
import { lineChange, type LinePoint } from "@lumen/amm-chart";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync, useStreamMempool } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, snapshotPath } from "@/lib/keyed-enter";
import { majorityColorInk, majorityTxInk } from "@/lib/block-ink";
import {
  parseRentTape,
  parseRentEpochNano,
  type RentTapeRow,
} from "@ergoscan/shared";
import { HomeRentTape } from "@/components/HomeRentTape";
import { HomeMempoolStage } from "@/components/HomeMempoolStage";
import { CadenceYard, type CadenceYardBlock } from "@/components/CadenceYard";
import { ERGO_MAX_BLOCK_SIZE } from "@/lib/ergo-emission";
import { isSupplyDigit, zipSupplyGlyphs } from "@/lib/supply-flip";

function ChartSparkSlot() {
  return <div className="h-9 w-full" />;
}

function OrbitSlot() {
  return (
    <section className="min-w-0 max-lg:order-5 lg:h-full">
      <div className="mod grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-3 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:grid-rows-[auto_minmax(0,1fr)] sm:px-5">
        <div className="flex h-[22px] shrink-0 items-center justify-between gap-3 sm:col-span-2 sm:row-start-1">
          <div className="h-4 w-24 rounded-[6px] bg-[var(--wash-faint)]" />
          <div className="h-5 w-10 rounded-[6px] bg-[var(--wash-faint)]" />
        </div>
        <div className="flex min-h-0 min-w-0 items-center justify-center sm:col-start-1 sm:row-start-2">
          <div className="relative aspect-square w-full max-w-[15rem]" />
        </div>
        <div className="h-[8.5rem] w-full sm:col-start-2 sm:row-start-2 sm:w-[11rem] sm:self-center" />
      </div>
    </section>
  );
}

const AreaChart = dynamic(() => import("@/components/AreaChart"), {
  ssr: false,
  loading: ChartSparkSlot,
});
const DualLineChart = dynamic(() => import("@/components/DualLineChart"), {
  ssr: false,
  loading: () => <div className="h-full min-h-0 w-full" />,
});
const DonutChart = dynamic(() => import("@/components/DonutChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});
const NetworkOrbit = dynamic(() => import("@/components/NetworkOrbit"), {
  ssr: false,
  loading: OrbitSlot,
});

type BlockRow = {
  id: string;
  height: number;
  timestamp: number;
  txCount: number | null;
  size: number;
  color?: string | null;
};

function mergeBlockRow(prev: BlockRow[], row: BlockRow): BlockRow[] {
  if (!row.id || !Number.isFinite(row.height)) return prev;
  const i = prev.findIndex((b) => b.id === row.id || b.height === row.height);
  const stub = !(row.size > 0) && row.txCount == null;
  if (i >= 0) {
    const old = prev[i]!;
    if (stub) {
      if (row.id.length >= 16 && row.id !== old.id) {
        const next = prev.slice();
        next[i] = { ...old, id: row.id };
        return next.sort((a, b) => b.height - a.height).slice(0, CADENCE + 1);
      }
      return prev;
    }
    const next = prev.slice();
    next[i] = {
      id: row.id.length >= 16 ? row.id : old.id,
      height: row.height,
      timestamp: row.timestamp > 0 ? row.timestamp : old.timestamp,
      txCount: row.txCount != null ? row.txCount : old.txCount,
      size: row.size > 0 ? row.size : old.size,
      color: row.color || old.color,
    };
    return next.sort((a, b) => b.height - a.height).slice(0, CADENCE + 1);
  }
  return [row, ...prev].sort((a, b) => b.height - a.height).slice(0, CADENCE + 1);
}

function mergeBlockRows(prev: BlockRow[], incoming: readonly BlockRow[]): BlockRow[] {
  let next = prev;
  for (const row of incoming) next = mergeBlockRow(next, row);
  return next;
}

type TxActivityPoint = { t: number; txs: number; feesErg: number; feesKnown?: boolean };

const TX_LINE = "#8ec8ff";
const FEE_LINE = "#f472b6";

function formatFeeAxis(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
const CADENCE = 7;
const PRICE_UP = "#3dd68c";
const PRICE_DOWN = "#ff5a6a";

function pctLabel(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function HomeExplorer({
  initialMempool = null,
  initialBlocks = [],
  initialErgUsd = null,
  initialMarket = null,
  initialUpdatedAt = null,
  initialStats = null,
  initialHashRateSeries = [],
  initialTxActivity = [],
  initialPrice = [],
  initialVolume = [],
  initialChartError = false,
  initialRentTape = [],
  initialRentEpochNano = null,
  previewShare = false,
}: {
  initialMempool?: number | null;
  initialBlocks?: BlockRow[];
  initialErgUsd?: number | null;
  initialMarket?: ErgMarket | null;
  initialUpdatedAt?: string | null;
  initialStats?: ChainStats | null;
  initialHashRateSeries?: LinePoint[];
  initialTxActivity?: TxActivityPoint[];
  initialPrice?: LinePoint[];
  initialVolume?: LinePoint[];
  initialChartError?: boolean;
  initialRentTape?: RentTapeRow[];
  initialRentEpochNano?: string | null;
  /** Local `/?preview=share` — keep fixture rows, don't overwrite from stage. */
  previewShare?: boolean;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const priceLen = useRef(initialPrice.length);
  const oracleSpark = useRef(initialPrice.length >= 2);
  const [price, setPrice] = useState<LinePoint[]>(initialPrice);
  const [chartVol, setChartVol] = useState<number | null>(() => {
    const last = initialVolume.at(-1)?.v;
    return last != null && last > 0 ? last : null;
  });
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(initialChartError || initialPrice.length < 2);
  const [priceHover, setPriceHover] = useState<number | null>(null);
  const [priceAt, setPriceAt] = useState<number | null>(null);
  const [ergUsd, setErgUsd] = useState<number | null>(initialErgUsd);
  const [market, setMarket] = useState<ErgMarket | null>(initialMarket);
  const [stats, setStats] = useState<ChainStats | null>(initialStats);
  const [mempool, setMempool] = useState<number | null>(initialMempool);
  const [blocks, setBlocks] = useState<BlockRow[]>(initialBlocks);
  const [hashRateSeries, setHashRateSeries] = useState<LinePoint[]>(initialHashRateSeries);
  const [hrHover, setHrHover] = useState<number | null>(null);
  const [hrAt, setHrAt] = useState<number | null>(null);
  const [txScrub, setTxScrub] = useState<TxActivityPoint | null>(null);
  const [feeScrub, setFeeScrub] = useState<TxActivityPoint | null>(null);
  const [txActivity, setTxActivity] = useState<TxActivityPoint[]>(initialTxActivity);
  const [poolHover, setPoolHover] = useState<{ label: string; pct: number } | null>(null);
  const [rentTape, setRentTape] = useState<RentTapeRow[]>(initialRentTape);
  const [rentEpochNano, setRentEpochNano] = useState<string | null>(initialRentEpochNano);
  const snapRetry = useRef(0);
  const snapTries = useRef(0);
  const loadSnapRef = useRef<() => void>(() => {});

  const loadChart = useCallback(() => {
    if (oracleSpark.current || priceLen.current >= 2) return;
    setPriceHover(null);
    setPriceAt(null);
    setChartLoading(true);
    void fetchErgChart(getGateway(), 1)
      .then((c) => {
        if (oracleSpark.current || priceLen.current >= 2) return;
        if (c.price.length >= 2) {
          priceLen.current = c.price.length;
          setPrice(c.price);
          const last = c.volume.at(-1)?.v;
          setChartVol(last != null && last > 0 ? last : null);
          setChartError(false);
          return;
        }
        setPrice([]);
        setChartVol(null);
        setChartError(true);
      })
      .catch(() => {
        if (oracleSpark.current || priceLen.current >= 2) return;
        setPrice([]);
        setChartVol(null);
        setChartError(true);
      })
      .finally(() => setChartLoading(false));
  }, []);

  const loadSnapshot = useCallback(() => {
    const gw = getGateway();
    void fetch(`${gw}${snapshotPath("/v1/page/home", tipRef.current?.height)}`, SNAPSHOT_FETCH)
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<{
          height?: number | null;
          blocks?: BlockRow[];
          mempool?: { count?: number };
          updatedAt?: string | null;
          stale?: boolean;
          hashRate?: number | null;
          hashRateSeries?: LinePoint[];
          txPerDay?: number | null;
          txActivity?: TxActivityPoint[];
          pools?: PoolShare[];
          holderCount?: number | null;
          holdersMonth?: number | null;
          minerCount?: number | null;
          avgBlockMs?: number | null;
          circulating?: number | null;
          ergUsd?: number | null;
          ergUsdSource?: string | null;
          priceSeries?: LinePoint[];
          rank?: number | null;
          volume24h?: number | null;
          change24h?: number | null;
          rentTape?: unknown;
          rentEpochNano?: unknown;
        }>;
      })
      .then((j) => {
        if (!j || j.stale) {
          if (snapTries.current < 12) {
            snapTries.current += 1;
            window.clearTimeout(snapRetry.current);
            snapRetry.current = window.setTimeout(() => loadSnapRef.current(), 1200);
          }
          return;
        }
        const mempoolN =
          j.mempool?.count != null && Number.isFinite(Number(j.mempool.count))
            ? Number(j.mempool.count)
            : null;
        if (mempoolN != null) setMempool(mempoolN);
        if (Array.isArray(j.blocks) && j.blocks.length) {
          setBlocks((prev) => mergeBlockRows(prev, j.blocks!.slice(0, CADENCE)));
        }
        if (Array.isArray(j.hashRateSeries) && j.hashRateSeries.length >= 2) {
          setHashRateSeries(
            j.hashRateSeries.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0)
          );
        }
        if (Array.isArray(j.txActivity) && j.txActivity.length >= 2) {
          setTxActivity(
            j.txActivity.filter(
              (p) =>
                p &&
                Number.isFinite(p.t) &&
                Number.isFinite(p.txs) &&
                p.txs >= 0 &&
                Number.isFinite(p.feesErg) &&
                p.feesErg >= 0
            ).map((p) => ({
              t: p.t,
              txs: p.txs,
              feesErg: p.feesErg,
              feesKnown: p.feesKnown !== false,
            }))
          );
        }
        const hs =
          j.hashRate != null && Number.isFinite(Number(j.hashRate)) ? Number(j.hashRate) : null;
        const txn =
          j.txPerDay != null && Number.isFinite(Number(j.txPerDay))
            ? Math.round(Number(j.txPerDay))
            : null;
        const pools = previewShare
          ? null
          : Array.isArray(j.pools)
            ? parseHomePools(j.pools)
            : null;
        const holderCount =
          j.holderCount != null && Number.isFinite(Number(j.holderCount))
            ? Math.round(Number(j.holderCount))
            : null;
        const holdersMonth =
          j.holdersMonth != null && Number.isFinite(Number(j.holdersMonth))
            ? Math.max(0, Math.round(Number(j.holdersMonth)))
            : null;
        const minerCount =
          j.minerCount != null && Number.isFinite(Number(j.minerCount))
            ? Math.round(Number(j.minerCount))
            : null;
        const height =
          j.height != null && Number.isFinite(Number(j.height)) ? Number(j.height) : null;
        const avgBlockMs =
          j.avgBlockMs != null && Number.isFinite(Number(j.avgBlockMs)) && Number(j.avgBlockMs) > 0
            ? Number(j.avgBlockMs)
            : null;
        const circulating =
          j.circulating != null && Number.isFinite(Number(j.circulating)) && Number(j.circulating) > 0
            ? Number(j.circulating)
            : null;
        const lastBlockSize =
          Array.isArray(j.blocks) && j.blocks[0]?.size != null && Number.isFinite(Number(j.blocks[0].size))
            ? Number(j.blocks[0].size)
            : null;
        const usd =
          j.ergUsd != null && Number.isFinite(Number(j.ergUsd)) && Number(j.ergUsd) > 0
            ? Number(j.ergUsd)
            : null;
        const rank =
          j.rank != null && Number.isFinite(Number(j.rank)) && Number(j.rank) >= 1
            ? Math.round(Number(j.rank))
            : null;
        const volume24h =
          j.volume24h != null && Number.isFinite(Number(j.volume24h)) && Number(j.volume24h) > 0
            ? Number(j.volume24h)
            : null;
        const change24h =
          j.change24h != null && Number.isFinite(Number(j.change24h)) ? Number(j.change24h) : null;
        if (usd != null) setErgUsd(usd);
        if (usd != null || rank != null || volume24h != null || change24h != null) {
          setMarket((prev) => {
            const nextUsd = usd != null && usd > 0 ? usd : prev?.usd;
            if (nextUsd == null || !(nextUsd > 0)) return prev;
            return {
              usd: nextUsd,
              source:
                typeof j.ergUsdSource === "string" && j.ergUsdSource.trim()
                  ? j.ergUsdSource.trim()
                  : prev?.source ?? "coingecko",
              rank: rank ?? prev?.rank ?? null,
              volume24h: volume24h ?? prev?.volume24h ?? null,
              change24h: change24h ?? prev?.change24h ?? null,
            };
          });
        }
        if (Array.isArray(j.priceSeries) && j.priceSeries.length >= 2) {
          const pts = j.priceSeries.filter(
            (p) => p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0
          );
          if (pts.length >= 2) {
            oracleSpark.current = true;
            priceLen.current = pts.length;
            setPrice(pts);
            setChartError(false);
          }
        }
        setStats((prev) =>
          patchHomeStats(prev, {
            hashRate: hs,
            txPerDay: txn,
            pools,
            holderCount,
            holdersMonth,
            minerCount,
            height,
            circulating,
            avgBlockMs,
            mempool: mempoolN,
            lastBlockSize,
          })
        );
        if (!previewShare) {
          const tape = parseRentTape(j.rentTape);
          if (tape) setRentTape(tape);
          const epochNano = parseRentEpochNano(j.rentEpochNano);
          if (epochNano != null) setRentEpochNano(epochNano);
        }
        markSynced(j.updatedAt);
        const gotH =
          height ??
          (Array.isArray(j.blocks) && j.blocks[0]?.height != null ? Number(j.blocks[0].height) : null);
        const wantH = tipRef.current?.height;
        if (wantH != null && gotH != null && gotH < wantH && snapTries.current < 12) {
          snapTries.current += 1;
          window.clearTimeout(snapRetry.current);
          snapRetry.current = window.setTimeout(() => loadSnapRef.current(), 1200);
        } else if (gotH == null || wantH == null || gotH >= wantH) {
          snapTries.current = 0;
        }
      })
      .catch(() => null);
  }, [markSynced, previewShare]);
  loadSnapRef.current = loadSnapshot;

  useEffect(() => {
    if (initialPrice.length >= 2) return;
    loadChart();
    const id = window.setInterval(loadChart, 120_000);
    return () => window.clearInterval(id);
  }, [loadChart, initialPrice.length]);

  useEffect(() => {
    if (previewShare) return;
    const thin =
      !initialStats ||
      (initialStats.hashRate == null &&
        initialStats.circulating == null &&
        initialStats.txPerDay == null &&
        initialStats.height == null);
    if (thin) loadSnapshot();
  }, [initialStats, loadSnapshot, previewShare]);

  useEffect(() => {
    if (initialBlocks.length) markSynced(initialUpdatedAt);
    loadSnapshot();
    return () => window.clearTimeout(snapRetry.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSnapshot, markSynced]);

  useEffect(() => {
    if (!tip) return;
    setBlocks((prev) =>
      mergeBlockRow(prev, {
        id: tip.headerId,
        height: tip.height,
        timestamp: tip.updatedAt ? Date.parse(tip.updatedAt) || Date.now() : Date.now(),
        txCount: null,
        size: 0,
      })
    );
  }, [tip]);

  useChainTipRefresh(true, loadSnapshot);

  const sparkChange = useMemo(() => lineChange(price), [price]);
  const lastPx = price.length ? price[price.length - 1]!.v : null;
  const spotPx =
    ergUsd != null && ergUsd > 0 ? ergUsd : lastPx != null && lastPx > 0 ? lastPx : null;
  const spotPrice = priceHover != null && priceHover > 0 ? priceHover : spotPx;
  const chartBusy = chartLoading && price.length < 2;
  const changePct =
    market?.change24h != null && Number.isFinite(market.change24h)
      ? market.change24h
      : sparkChange != null
        ? sparkChange * 100
        : null;

  const emitted =
    stats?.circulating != null && stats.maxSupply > 0
      ? Math.min(100, (stats.circulating / stats.maxSupply) * 100)
      : null;
  const mcap =
    stats?.circulating != null && spotPrice != null && spotPrice > 0
      ? stats.circulating * spotPrice
      : null;
  const mcapMiss =
    spotPx == null && stats?.circulating == null
      ? `${t("home.mcapNeedPrice")} · ${t("home.mcapNeedCirc")}`
      : spotPx == null
        ? t("home.mcapNeedPrice")
        : t("home.mcapNeedCirc");
  const vol24 = market?.volume24h ?? chartVol;

  const pools = stats?.pools ?? [];
  const lead = pools[0] ?? null;
  const shareSlices = pools.map((p) => ({
    label: !p.address && p.name === "other" ? t("home.shareOther") : p.name,
    value: p.blocks,
  }));
  const miss = t("home.unavailable");
  const spotHash = hrHover != null && hrHover > 0 ? hrHover : stats?.hashRate;
  const hashrateSpark = hashRateSeries.length >= 2;
  const txDay = stats?.stats24h?.txs ?? stats?.txPerDay ?? null;
  const feeDay = stats?.stats24h?.feesErg ?? null;
  const showTxChart = txActivity.length >= 2;
  const showFeeLine = txActivity.some((p) => p.feesKnown !== false && p.feesErg > 0);
  const holderCount = stats?.holderCount ?? null;
  const holdersMonth = stats?.holdersMonth ?? null;
  const minerCount =
    stats?.minerCount != null && stats.minerCount > 0
      ? stats.minerCount
      : pools.filter((p) => p.name !== "other").length || null;
  const tipHeight = stats?.height ?? blocks[0]?.height ?? null;
  const avgBlockMs = stats?.stats24h?.avgBlockMs ?? null;
  const loc = locale === "ru" ? "ru-RU" : "en-US";

  return (
    <Shell>
      <HomeLiveStrip
        blocks={blocks}
        mempoolCount={mempool ?? 0}
        title={t("home.cadence")}
        mempoolTitle={t("home.mempool")}
        all={t("home.viewAll")}
        txUnit={t("home.txUnit")}
      />

      <div className="home-bento mt-3 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:grid-rows-[22.5rem_22.5rem]">
        <div className="home-bento-top contents gap-3 lg:col-span-2 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-subgrid lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="home-kpi grid min-h-0 grid-cols-2 gap-3 sm:grid-cols-3 max-lg:order-1 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-full lg:grid-rows-2">
          <article className={TILE} style={enterAt(2)}>
            <div className="flex shrink-0 items-center justify-between gap-2">
              <p className="text-[13px] text-[var(--muted)]">{t("home.price")}</p>
              {changePct != null ? <PriceChangeChip pct={changePct} /> : null}
            </div>
            <div className="flex shrink-0 items-baseline justify-between gap-2">
              <KpiValue>
                <ReelText text={formatUsd(spotPrice, 4)} />
              </KpiValue>
              {priceAt != null ? (
                <span key={priceAt} className="hover-stamp shrink-0 text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]">
                  {formatHoverWhen(priceAt, locale)}
                </span>
              ) : null}
            </div>
            <div className="mt-auto h-9">
              {chartBusy ? (
                <div className="h-full rounded-[8px] bg-[var(--wash-faint)] motion-safe:animate-pulse" />
              ) : price.length >= 2 ? (
                <AreaChart
                  points={price}
                  height={36}
                  compact
                  glow
                  showTip={false}
                  color={changePct != null && changePct < 0 ? PRICE_DOWN : PRICE_UP}
                  lineWidth={1.75}
                  formatValue={(v) => formatUsd(v, 4)}
                  onHover={(v, t) => {
                    const on = v != null && v > 0;
                    setPriceHover(on ? v : null);
                    setPriceAt(on && t != null ? t : null);
                  }}
                />
              ) : (
                <p className="pt-2 text-[12px] text-[var(--muted-2)]">
                  {chartError ? t("home.chartError") : t("home.chartWarm")}
                </p>
              )}
            </div>
          </article>

          <article className={TILE} style={enterAt(3)}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-[var(--muted)]">{t("home.mcap")}</p>
              {market?.rank != null ? (
                <span className="mcap-rank shrink-0 rounded-[8px] px-1.5 py-0.5 text-[12px] font-semibold tabular-nums leading-none">
                  #{market.rank}
                </span>
              ) : null}
            </div>
            <KpiValue muted={mcap == null}>
              {mcap != null ? <ReelText text={`$${formatCompact(mcap)}`} /> : mcapMiss}
            </KpiValue>
            <p className="mt-auto flex h-9 items-end gap-1.5 pb-1 text-[12px]">
              <span className="text-[var(--muted-2)]">{t("home.volume24h")}</span>
              <span className="mcap-vol font-medium tabular-nums">
                {vol24 != null ? <ReelText text={`$${formatCompact(vol24)}`} /> : "—"}
              </span>
            </p>
          </article>

          <Link href="/addresses" className={clsx(TILE, "kpi-tile--press relative")} style={enterAt(4)}>
            <HoldersMark />
            <p className="pr-7 text-[13px] text-[var(--muted)]">{t("home.holdersCount")}</p>
            <KpiValue muted={holderCount == null}>
              <ReelText text={holderCount != null ? holderCount.toLocaleString(loc) : miss} />
            </KpiValue>
            <p className="mt-auto flex h-9 items-end pb-1">
              {holdersMonth != null ? (
                <span className="holders-month">
                  <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
                    <path d="M6 9.5V2.5M6 2.5 3 5.5M6 2.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <ReelText text={holdersMonth.toLocaleString(loc)} />
                </span>
              ) : null}
            </p>
          </Link>

          <article className={clsx(TILE, "group relative max-lg:hidden")} style={enterAt(6)}>
            <p className="text-[13px] text-[var(--muted)]">
              <SwapLine idle={t("home.circulating")} hover={t("home.maxSupply")} />
            </p>
            <p
              className={clsx(
                "mt-1 whitespace-nowrap text-[22px] font-semibold tabular-nums tracking-tight",
                stats?.circulating == null && "text-[var(--muted)]"
              )}
            >
              <KpiNum>
                {stats?.circulating != null ? (
                  <SupplyFlip from={stats.circulating} to={stats.maxSupply} />
                ) : (
                  miss
                )}
              </KpiNum>
            </p>
            <div className="mt-auto flex h-9 items-end justify-between gap-2 pb-1">
              <p className="min-w-0 truncate text-[12px] tabular-nums text-[var(--muted-2)]">
                <SwapLine
                  idle={
                    emitted != null
                      ? `${emitted.toFixed(1)}% ${t("home.circOf")}`
                      : t("home.circOf")
                  }
                  hover={t("home.maxSupplyHint")}
                />
              </p>
              {emitted != null ? <SupplyCapsule pct={emitted} /> : null}
            </div>
          </article>

          <article className={clsx(TILE, "relative max-lg:hidden")} style={enterAt(7)}>
            <div className={clsx("min-w-0", shareSlices.length >= 1 && "pr-[6.75rem]")}>
              <p className="text-[13px] text-[var(--muted)]">{t("home.poolsActive")}</p>
              <KpiValue muted={minerCount == null}>
                <ReelText text={minerCount != null ? minerCount.toLocaleString(loc) : miss} />
              </KpiValue>
            </div>
            {shareSlices.length >= 1 ? (
              <div
                className="absolute right-3 top-1/2 aspect-square h-[calc(100%-10px)] -translate-y-1/2"
                role="img"
                aria-label={t("home.miners")}
              >
                <DonutChart
                  data={shareSlices}
                  compact
                  fill
                  caption={false}
                  formatValue={(v, pct) => `${v.toLocaleString()} · ${pctLabel(pct)}`}
                  onHover={(s) => setPoolHover(s ? { label: s.label, pct: s.pct } : null)}
                />
              </div>
            ) : null}
            <p className={clsx("mt-auto flex h-9 items-end pb-1 truncate text-[12px] text-[var(--muted-2)]", shareSlices.length >= 1 && "pr-[6.75rem]")}>
              {poolHover
                ? `${poolHover.label} · ${pctLabel(poolHover.pct)}`
                : lead
                  ? `${!lead.address && lead.name === "other" ? t("home.shareOther") : lead.name} · ${pctLabel(lead.share)}`
                  : t("home.poolsHint")}
            </p>
          </article>

          <article className={TILE} style={enterAt(8)}>
            <p className="shrink-0 text-[13px] text-[var(--muted)]">{t("home.hashrate")}</p>
            <div className="mt-1 flex shrink-0 items-baseline justify-between gap-2">
              <KpiValue muted={spotHash == null}>
                <ReelText text={spotHash != null ? formatHashrate(spotHash) : miss} />
              </KpiValue>
              {hrAt != null ? (
                <span key={hrAt} className="hover-stamp shrink-0 text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]">
                  {formatHoverWhen(hrAt, locale)}
                </span>
              ) : null}
            </div>
            {hashrateSpark ? (
              <div className="mt-auto h-9">
                <AreaChart
                  points={hashRateSeries}
                  height={36}
                  compact
                  glow
                  showTip={false}
                  color={HOME.hashrate}
                  lineWidth={1.75}
                  formatValue={formatHashrate}
                  onHover={(v, t) => {
                    const on = v != null && v > 0;
                    setHrHover(on ? v : null);
                    setHrAt(on && t != null ? t : null);
                  }}
                  locale={loc}
                />
              </div>
            ) : (
              <p className="mt-auto flex h-9 items-end pb-1 text-[12px] text-[var(--muted-2)]">
                {t("home.share24h")}
              </p>
            )}
          </article>
        </div>
        <div className="flex max-lg:order-2 max-lg:min-h-[22.5rem] flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-subgrid">
          <HomeActivityTile
            enter={5}
            title={t("home.txs")}
            href="/transactions"
            viewAll={t("home.viewAll")}
            kpiLabel={t("home.txDay")}
            kpi={
              txScrub
                ? Math.round(txScrub.txs).toLocaleString(loc)
                : txDay != null
                  ? Math.round(txDay).toLocaleString(loc)
                  : null
            }
            when={txScrub ? formatHoverWhen(txScrub.t, locale) : null}
          >
            {showTxChart ? (
              <DualLineChart
                points={txActivity}
                compact
                glow
                showTip={false}
                onHover={setTxScrub}
                series="txs"
                colorTxs={TX_LINE}
                colorFees={FEE_LINE}
                nameTxs={t("home.txs")}
                nameFees={t("home.txChartFees")}
                locale={loc}
                formatTxs={(v) => formatCompact(v, 1)}
                formatFees={formatFeeAxis}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
                {t("home.chartWarm")}
              </p>
            )}
          </HomeActivityTile>
          <HomeActivityTile
            enter={10}
            title={t("home.txChartFees")}
            href="/fees"
            viewAll={t("home.viewAll")}
            kpiLabel={t("home.fees24h")}
            kpi={
              feeScrub && feeScrub.feesKnown !== false
                ? `${formatFeeKpi(feeScrub.feesErg)} ERG`
                : feeDay != null
                  ? `${formatFeeKpi(feeDay)} ERG`
                  : null
            }
            when={feeScrub ? formatHoverWhen(feeScrub.t, locale) : null}
          >
            {showTxChart && showFeeLine ? (
              <DualLineChart
                points={txActivity}
                compact
                glow
                showTip={false}
                onHover={setFeeScrub}
                series="fees"
                colorTxs={TX_LINE}
                colorFees={FEE_LINE}
                nameTxs={t("home.txs")}
                nameFees={t("home.txChartFees")}
                locale={loc}
                formatTxs={(v) => formatCompact(v, 1)}
                formatFees={formatFeeAxis}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
                {t("home.chartWarm")}
              </p>
            )}
          </HomeActivityTile>
        </div>

        <EpochBar
          height={tipHeight}
          avgBlockMs={avgBlockMs}
          t={t}
          locale={locale}
          className="home-tile-enter max-lg:order-4 lg:col-start-1 lg:row-start-3"
          style={enterAt(9)}
        />
        <section
          className="home-tile-enter home-meet-right mod flex h-full min-h-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3 max-lg:order-3 lg:col-start-2 lg:row-start-3"
          style={enterAt(11)}
        >
          <p className="text-[17px] font-semibold tracking-tight">{t("home.versionNodes")}</p>
        </section>
        </div>

        <HomeRentTape
          rows={rentTape}
          epochRentNano={rentEpochNano}
          previewShare={previewShare}
          enter={12}
        />

        <NetworkOrbit enter={13} />
      </div>
    </Shell>
  );
}

const TILE =
  "home-tile-enter mod flex h-full min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3";

function enterAt(i: number): CSSProperties {
  return { "--enter": i } as CSSProperties;
}

function HomeActivityTile({
  enter,
  title,
  href,
  viewAll,
  kpiLabel,
  kpi,
  when,
  children,
}: {
  enter: number;
  title: string;
  href: string;
  viewAll: string;
  kpiLabel: string;
  kpi: string | null;
  when?: string | null;
  children: ReactNode;
}) {
  return (
    <section
      className="home-tile-enter home-meet-right mod flex h-full min-h-0 flex-1 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]"
      style={enterAt(enter)}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] px-4 py-2.5 sm:px-5">
        <div className="relative mb-1 flex h-[22px] shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="m-0 text-[17px] font-semibold leading-none tracking-tight">{title}</h2>
            <Link href={href} className="text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
              {viewAll}
            </Link>
          </div>
          <span
            className={clsx("activity-when", when && "is-on")}
            aria-hidden={!when}
          >
            {when ?? ""}
          </span>
          {kpi != null ? (
            <p className="m-0 flex h-[22px] shrink-0 flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
              <span className="text-[12px] leading-none text-[var(--muted)]">{kpiLabel}</span>
              <KpiNum className="max-w-none shrink-0 tabular-nums text-[22px] font-semibold leading-none tracking-tight text-[var(--text)]">
                <ReelText text={kpi} />
              </KpiNum>
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

function formatHoverWhen(t: number, _locale: string): string {
  return `${formatDottedDay(t, "UTC")} · ${formatH24(t, "UTC", false)}`;
}

function formatFeeKpi(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 10_000) return formatCompact(v);
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1);
}

function HoldersMark() {
  return (
    <svg className="holders-mark" viewBox="0 0 24 24" aria-hidden>
      <path className="holders-mark-back" d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="4.2" className="holders-mark-head" />
    </svg>
  );
}

function PriceChangeChip({ pct }: { pct: number }) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-[8px] px-1.5 py-0.5 text-[12px] font-medium tabular-nums",
        pct >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"
      )}
    >
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function KpiValue({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <p className={clsx("mt-1 truncate text-[22px] font-semibold tabular-nums tracking-tight", muted && "text-[var(--muted)]")}>
      <KpiNum>{children}</KpiNum>
    </p>
  );
}

const SWAP =
  "transition-opacity duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-0";

function SupplyFlip({ from, to }: { from: number; to: number }) {
  const glyphs = zipSupplyGlyphs(from, to);
  const idle = glyphs.map((g) => g.idle).join("");
  return (
    <span className="inline-flex items-baseline">
      <span className="sr-only">{idle} ERG</span>
      <span aria-hidden className="inline-flex items-baseline">
        {glyphs.map((g, i) => (
          <SupplyGlyph key={i} idle={g.idle} hover={g.hover} delay={glyphs.length - 1 - i} />
        ))}
      </span>
      <span aria-hidden className="ml-[0.32em]">
        ERG
      </span>
    </span>
  );
}

function SupplyGlyph({ idle, hover, delay }: { idle: string; hover: string; delay: number }) {
  if (!isSupplyDigit(idle) && !isSupplyDigit(hover)) {
    return <span className="inline-block">{idle}</span>;
  }
  const from = isSupplyDigit(idle) ? Number(idle) : 0;
  const to = isSupplyDigit(hover) ? Number(hover) : 0;
  return (
    <span className="supply-reel relative inline-block h-[1em] w-[1ch] overflow-hidden align-[-0.12em]">
      <span
        className="supply-reel-strip flex flex-col"
        style={
          {
            ["--from" as string]: from,
            ["--to" as string]: to,
            ["--i" as string]: delay,
          } as CSSProperties
        }
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span key={n} className="block h-[1em] leading-none">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Stadium track — share of max supply, sits under the figure on the right. */
function SupplyCapsule({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const w = 62;
  const h = 26;
  const sw = 2.35;
  const x = sw / 2;
  const y = sw / 2;
  const r = (h - sw) / 2;
  const path = `M ${w / 2} ${y} H ${w - x - r} A ${r} ${r} 0 0 1 ${w - x} ${h / 2} A ${r} ${r} 0 0 1 ${w - x - r} ${h - y} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${h / 2} A ${r} ${r} 0 0 1 ${x + r} ${y} H ${w / 2}`;
  return (
    <div
      className="relative h-[26px] w-[62px] shrink-0"
      role="img"
      aria-label={`${p.toFixed(0)}%`}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0" aria-hidden>
        <path d={path} fill="none" stroke="var(--border)" strokeWidth={sw} />
        <path
          d={path}
          fill="none"
          strokeWidth={sw}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          className="circ-ring-arc"
          style={{
            ["--circ-off" as string]: 100 - p,
            ["--circ-from" as string]: HOME.erg,
          }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums leading-none">
        <span className={clsx(SWAP, "group-hover:opacity-0")}>{p.toFixed(0)}%</span>
        <span className={clsx("absolute opacity-0", SWAP, "group-hover:opacity-100")}>100%</span>
      </span>
    </div>
  );
}

function SwapLine({ idle, hover }: { idle: string; hover: string }) {
  return (
    <span className="relative block">
      <span className={clsx("block truncate", SWAP, "group-hover:opacity-0")}>{idle}</span>
      <span
        className={clsx(
          "absolute inset-0 block truncate opacity-0",
          SWAP,
          "group-hover:opacity-100"
        )}
      >
        {hover}
      </span>
    </span>
  );
}

/** Ergo header epoch = floor(height / 1024). ~2 min × 1024 ≈ 34h. */
const ERGO_EPOCH_LEN = 1024;
const ERGO_BLOCK_MS = 120_000;

function EpochClock() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden>
      <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 3.6V6.2L7.7 7.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EpochFlag() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden>
      <path d="M3.2 10.4V1.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3.2 2.1h5.4L7.2 4.1l1.4 2H3.2" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}

function formatRemain(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

function EpochBar({
  height,
  avgBlockMs,
  t,
  locale,
  className,
  style,
}: {
  height: number | null;
  avgBlockMs: number | null;
  t: (k: string) => string;
  locale: string;
  className?: string;
  style?: CSSProperties;
}) {
  if (height == null || height < 0) return null;
  const n = Math.floor(height / ERGO_EPOCH_LEN);
  const slot = height % ERGO_EPOCH_LEN;
  const pct = (slot / ERGO_EPOCH_LEN) * 100;
  const leftMs = (ERGO_EPOCH_LEN - slot) * (avgBlockMs && avgBlockMs > 0 ? avgBlockMs : ERGO_BLOCK_MS);
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  return (
    <section
      className={clsx("mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3", className)}
      style={style}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="shrink-0 text-[17px] font-semibold leading-none tracking-tight tabular-nums">
          {t("home.epoch")} <ReelText text={n.toLocaleString(loc)} />
        </p>
        <div className="flex min-w-0 items-center gap-3 text-[12px] leading-none tabular-nums">
          <span className="epoch-slot inline-flex min-w-0 items-baseline gap-1 font-semibold">
            <ReelText text={slot.toLocaleString(loc)} />
            <span className="font-medium opacity-70">/ {ERGO_EPOCH_LEN.toLocaleString(loc)}</span>
          </span>
          <span className="epoch-slot inline-flex shrink-0 items-center gap-1 font-semibold">
            <EpochClock />
            <ReelText text={`${pct.toFixed(0)}%`} />
          </span>
          <span className="epoch-left inline-flex shrink-0 items-center gap-1 font-medium">
            <EpochFlag />
            <ReelText text={formatRemain(leftMs)} />
            <span className="font-normal opacity-80">{t("home.epochLeft")}</span>
          </span>
        </div>
      </div>
      <div
        className="epoch-tape mt-2 h-2 overflow-hidden rounded-full bg-[var(--wash)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("home.epoch")}
      >
        <div
          className="epoch-tape-fill h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: HOME.epoch }}
        />
      </div>
    </section>
  );
}

const CADENCE_TRACK = 52;
const CADENCE_HEAD = 32;
const MEMPOOL_HTTP_MS = 8_000;
/** Tip can move before block.sealed brings the tx list. Don't close the slot on that gap. */
const SEAL_LIST_WAIT_MS = 16_000;
/** Backup if the pour canvas never calls done. Longer than the pour itself. */
const ASSEMBLE_FAILSAFE_MS = 20_000;

function barWeight(b: BlockRow): number {
  if (b.txCount != null && b.txCount > 0) return b.txCount;
  if (b.size > 0) return Math.max(1, Math.round(b.size / 400));
  return 1;
}

function barInk(b: BlockRow, fetched: Record<string, string>): string {
  return fetched[b.id] || b.color || HOME.txs;
}

function useCadenceInk(blocks: readonly BlockRow[]): { ink: Record<string, string>; ready: boolean } {
  const [ink, setInk] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const cache = useRef<Record<string, string>>({});
  const opened = useRef(false);
  const key = blocks.map((b) => b.id).join(",");
  useEffect(() => {
    let dead = false;
    const ids = key.split(",").filter((id) => id.length >= 16 && !id.startsWith("seal-"));
    const missing = ids.filter((id) => !cache.current[id]);
    const paint = () => {
      if (dead) return;
      const next: Record<string, string> = {};
      for (const id of ids) {
        const c = cache.current[id];
        if (c) next[id] = c;
      }
      setInk(next);
    };
    const finish = () => {
      if (dead) return;
      opened.current = true;
      setReady(true);
    };
    if (!missing.length) {
      paint();
      finish();
      return;
    }
    if (!opened.current) setReady(false);
    void Promise.all(
      missing.map(async (id) => {
        try {
          const r = await fetch(
            `${getGateway()}/v1/blocks/${encodeURIComponent(id)}?limit=80&offset=0`,
            SNAPSHOT_FETCH
          );
          if (!r.ok) return;
          const j = (await r.json()) as { txs?: Array<{ category?: string; color?: string }> };
          cache.current[id] = majorityTxInk(Array.isArray(j.txs) ? j.txs : []);
        } catch {
          /* keep fallback cyan */
        }
      })
    ).then(() => {
      paint();
      finish();
    });
    return () => {
      dead = true;
    };
  }, [key]);
  return { ink, ready };
}

function collectClock(ts: number, now: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

function FormingAge({ ts }: { ts: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ts == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ts]);
  if (ts == null) return <span className="tabular-nums">—</span>;
  return (
    <span suppressHydrationWarning className="tabular-nums">
      {collectClock(ts, now)}
    </span>
  );
}

function fmtCreated(ts: number, _locale: string): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = formatDottedDate(ms);
  const time = formatH24(ms, undefined, false);
  if (date === "—" || time === "—") return "—";
  return `${date}, ${time}`;
}

type HomeMempoolBall = {
  id: string;
  size: number;
  fee: number;
  feeRate: number;
  color: string;
  firstSeen: number;
  category: string;
  platform: string | null;
  value: number;
};

function readHomeBalls(
  raw: Array<{
    id?: string;
    txId?: string;
    size?: number;
    fee?: number;
    feeRate?: number;
    color?: string;
    firstSeen?: number;
    category?: string;
    platform?: string | null;
    value?: number;
  }>
): HomeMempoolBall[] {
  const next: HomeMempoolBall[] = [];
  for (const b of raw) {
    const id = String(b.txId || b.id || "").trim();
    if (!id) continue;
    const size = Number(b.size) || 0;
    const fee = Number(b.fee) || 0;
    const rate =
      typeof b.feeRate === "number" && Number.isFinite(b.feeRate) && b.feeRate > 0
        ? b.feeRate
        : size > 0
          ? fee / size
          : 0;
    next.push({
      id,
      size,
      fee,
      feeRate: rate,
      color: typeof b.color === "string" && b.color ? b.color : HOME.txs,
      firstSeen: Number(b.firstSeen) || 0,
      category: typeof b.category === "string" && b.category ? b.category : "unknown",
      platform: typeof b.platform === "string" && b.platform ? b.platform : null,
      value: Number.isFinite(Number(b.value)) ? Number(b.value) : 0,
    });
  }
  return next;
}

function applyHomeSnapshot(
  s: {
    count?: number;
    totalSize?: number;
    totalFees?: number;
    balls?: Array<{
      id?: string;
      txId?: string;
      size?: number;
      fee?: number;
      feeRate?: number;
      color?: string;
      firstSeen?: number;
      category?: string;
      platform?: string | null;
      value?: number;
    }>;
  },
  setBalls: (rows: HomeMempoolBall[]) => void,
  setHttpPool: (n: number) => void,
  setTotalSize: (n: number) => void,
  setTotalFees: (n: number) => void
) {
  const next = readHomeBalls(Array.isArray(s?.balls) ? s.balls : []);
  setBalls(next);
  const n = typeof s?.count === "number" && Number.isFinite(s.count) ? s.count : next.length;
  setHttpPool(n);
  setTotalSize(
    typeof s?.totalSize === "number" && Number.isFinite(s.totalSize)
      ? s.totalSize
      : next.reduce((sum, row) => sum + row.size, 0)
  );
  setTotalFees(
    typeof s?.totalFees === "number" && Number.isFinite(s.totalFees)
      ? s.totalFees
      : next.reduce((sum, row) => sum + row.fee, 0)
  );
}

function useHomeMempool(initialCount: number) {
  const stream = useStreamMempool();
  const [httpPool, setHttpPool] = useState<number | null>(null);
  const [httpBalls, setHttpBalls] = useState<HomeMempoolBall[]>([]);
  const [httpSize, setHttpSize] = useState(0);
  const [httpFees, setHttpFees] = useState(0);

  useEffect(() => {
    let dead = false;
    const tick = () => {
      void fetch(`${getGateway()}/v1/mempool`, SNAPSHOT_FETCH)
        .then((r) => r.json())
        .then((s) => {
          if (dead) return;
          applyHomeSnapshot(s, setHttpBalls, setHttpPool, setHttpSize, setHttpFees);
        })
        .catch(() => {});
    };
    tick();
    if (stream.streamLive) {
      return () => {
        dead = true;
      };
    }
    const interval = window.setInterval(tick, MEMPOOL_HTTP_MS);
    return () => {
      dead = true;
      window.clearInterval(interval);
    };
  }, [stream.streamLive]);

  const live = stream.streamLive && stream.mempoolCount != null;
  const balls = live
    ? stream.balls.map((b) => ({
        id: b.id,
        size: b.size,
        fee: b.fee,
        feeRate: b.feeRate > 0 ? b.feeRate : b.size > 0 ? b.fee / b.size : 0,
        color: b.color || HOME.txs,
        firstSeen: b.firstSeen,
        category: b.category,
        platform: b.platform,
        value: b.value,
      }))
    : httpBalls;
  const pool = (live ? stream.mempoolCount : null) ?? httpPool ?? initialCount;
  const totalSize = (live ? stream.totalSize : null) ?? httpSize;
  const totalFees = (live ? stream.totalFees : null) ?? httpFees;
  const seal = live ? stream.seal : null;
  return { pool, balls, totalSize, totalFees, seal };
}

function HomeLiveStrip({
  blocks,
  mempoolCount,
  title,
  mempoolTitle,
  all,
  txUnit,
}: {
  blocks: BlockRow[];
  mempoolCount: number;
  title: string;
  mempoolTitle: string;
  all: string;
  txUnit: string;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const { tip } = usePageSync();
  const mp = useHomeMempool(mempoolCount);
  const [tape, setTape] = useState(blocks);
  const [commitH, setCommitH] = useState<number | null>(() => blocks[0]?.height ?? null);
  const [grow, setGrow] = useState<{ n: number; total: number; ink: string } | null>(null);
  const [formSince, setFormSince] = useState<number | null>(null);
  const formKey = useRef<string | null>(null);
  const newestH = tape[0]?.height ?? null;
  const holding = Boolean(!reduce && commitH != null && newestH != null && newestH !== commitH);
  const assembling = Boolean(holding && grow && (grow.total === 0 || grow.n > 0));
  const cadenceBlocks = useMemo(() => {
    if (!holding || assembling || commitH == null) return tape;
    const kept = tape.filter((b) => b.height <= commitH);
    return kept.length ? kept : tape;
  }, [assembling, commitH, holding, tape]);

  useEffect(() => {
    if (commitH == null && newestH != null) setCommitH(newestH);
  }, [commitH, newestH]);

  useEffect(() => {
    setTape((prev) => mergeBlockRows(prev, blocks));
  }, [blocks]);

  useEffect(() => {
    const s = mp.seal;
    if (!s || !Number.isFinite(s.height)) return;
    const id = typeof s.blockId === "string" && s.blockId.length >= 16 ? s.blockId : `seal-${s.height}`;
    setTape((prev) =>
      mergeBlockRow(prev, {
        id,
        height: s.height,
        timestamp: s.timestamp || Date.now(),
        txCount: s.txCount ?? (Array.isArray(s.txIds) ? s.txIds.length : null),
        size: s.size ?? 0,
      })
    );
  }, [mp.seal]);

  const commitAssemble = useCallback(() => {
    if (newestH != null) setCommitH(newestH);
    setGrow(null);
  }, [newestH]);

  useEffect(() => {
    const s = mp.seal;
    if (!s || !Number.isFinite(s.height)) return;
    const key = `${s.height}:${s.blockId || ""}`;
    if (formKey.current === key) return;
    formKey.current = key;
    const raw = s.timestamp || 0;
    const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : 0;
    const fresh = ms > 0 && Math.abs(Date.now() - ms) < 20_000;
    setFormSince(fresh ? ms : Date.now());
  }, [mp.seal]);

  useEffect(() => {
    if (!holding) return;
    const waiting = !grow || (grow.total > 0 && grow.n === 0);
    const wait = window.setTimeout(
      () => commitAssemble(),
      waiting ? SEAL_LIST_WAIT_MS : ASSEMBLE_FAILSAFE_MS
    );
    return () => window.clearTimeout(wait);
  }, [holding, grow, commitAssemble]);

  return (
    <div className="relative">
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        {tape.length > 0 ? (
          <BlockCadence
            blocks={cadenceBlocks}
            title={title}
            all={all}
            txUnit={txUnit}
            holding={assembling}
            grow={grow}
            onAssembleDone={commitAssemble}
          />
        ) : null}
        <HomeMempoolTile
          pool={mp.pool}
          balls={mp.balls}
          totalSize={mp.totalSize}
          totalFees={mp.totalFees}
          title={mempoolTitle}
          all={all}
          txUnit={txUnit}
          reduce={!!reduce}
          pitLabel={t("home.mempoolPit")}
          formingHeight={(tip?.height ?? tape[0]?.height ?? 0) + 1}
          formingSince={formSince ?? tape[0]?.timestamp ?? null}
          onSealPour={(seeds) => {
            const ink = seeds.length
              ? majorityColorInk(
                  seeds.map((s) => s.color),
                  HOME.txs
                )
              : HOME.txs;
            if (!seeds.length) {
              setGrow({ n: 1, total: 0, ink });
              return;
            }
            setGrow((prev) => prev ?? { n: 0, total: seeds.length, ink });
          }}
          onSealArrive={(hit) => {
            setGrow((prev) => ({
              n: hit.n,
              total: hit.total,
              ink: prev?.ink || hit.color || HOME.txs,
            }));
          }}
        />
      </div>
    </div>
  );
}

function HomeMempoolTile({
  pool,
  balls,
  totalSize,
  totalFees,
  title,
  all,
  txUnit,
  reduce,
  pitLabel,
  formingHeight,
  formingSince,
  onSealPour,
  onSealArrive,
}: {
  pool: number;
  balls: HomeMempoolBall[];
  totalSize: number;
  totalFees: number;
  title: string;
  all: string;
  txUnit: string;
  reduce: boolean;
  pitLabel: string;
  formingHeight: number;
  formingSince: number | null;
  onSealPour?: (seeds: { id: string; color: string; r: number; delayMs: number }[]) => void;
  onSealArrive?: (hit: { id: string; color: string; n: number; total: number }) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const [pitCount, setPitCount] = useState(0);
  const shown = Math.max(pool, pitCount);
  const fill = totalSize > 0 ? Math.min(100, Math.round((totalSize / ERGO_MAX_BLOCK_SIZE) * 100)) : 0;
  const foot =
    shown <= 0 && balls.length === 0
      ? t("mempool.empty")
      : [fill > 0 ? `${fill}%` : null, totalSize > 0 ? formatBytes(totalSize) : null, totalFees > 0 ? formatErgPrecise(totalFees, locale) : null]
          .filter(Boolean)
          .join(" · ") || t("mempool.kpiWaitSub");

  return (
    <section
      className="home-tile-enter home-meet-right mod flex h-full min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3 sm:px-5"
      style={enterAt(1)}
    >
      <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <h2 className="m-0 shrink-0 text-[17px] font-semibold leading-none tracking-tight">{title}</h2>
          <span
            className={clsx("mb-px inline-block h-1.5 w-1.5 shrink-0 rounded-full", !reduce && "cadence-live-dot")}
            style={{ background: HOME.forming }}
          />
          <span className="min-w-0 truncate text-[13px] font-semibold tabular-nums leading-[1.15] tracking-tight text-[var(--text)]">
            <ReelText text={formingHeight > 1 ? formingHeight.toLocaleString(loc) : "—"} />
          </span>
          <KpiNum className="max-w-none shrink-0 text-[13px] font-semibold tabular-nums leading-none tracking-tight">
            <ReelText text={shown.toLocaleString(loc)} />
            <span className="ml-0.5 text-[12px] font-medium text-[var(--muted-2)]">{txUnit}</span>
          </KpiNum>
          <span className="shrink-0 text-[12px] leading-none text-[var(--muted)]">
            <FormingAge ts={formingSince} />
          </span>
        </div>
        <Link href="/mempool" className="text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
          {all}
        </Link>
      </div>
      <div className="home-pit relative" style={{ height: CADENCE_TRACK + CADENCE_HEAD }}>
        <HomeMempoolStage
          balls={balls}
          ariaLabel={pitLabel}
          moreTitle={(n) => t("mempool.more").replace("{n}", String(n))}
          onDyingCount={setPitCount}
          onSealPour={onSealPour}
          onSealArrive={onSealArrive}
        />
      </div>
      <p className="mt-1.5 truncate text-[12px] tabular-nums leading-[1.15] text-[var(--muted-2)]">{foot}</p>
    </section>
  );
}

function BlockCadence({
  blocks,
  title,
  all,
  txUnit,
  holding,
  grow,
  onAssembleDone,
}: {
  blocks: BlockRow[];
  title: string;
  all: string;
  txUnit: string;
  holding: boolean;
  grow: { n: number; total: number; ink: string } | null;
  onAssembleDone: () => void;
}) {
  const { locale } = useI18n();
  const reduce = useReducedMotion();
  const [hoverId, setHoverId] = useState<string | null>(null);

  const slots = useMemo(() => [...blocks].slice(0, CADENCE).reverse(), [blocks]);
  const { ink: inkById, ready: inkReady } = useCadenceInk(blocks);
  const last = slots[slots.length - 1];
  const confirmed = useMemo(
    () => (holding && last ? slots.slice(0, -1) : slots),
    [holding, last, slots]
  );
  const yard = useMemo(() => {
    const rows: CadenceYardBlock[] = confirmed.map((b) => ({
      id: b.id,
      height: b.height,
      weight: barWeight(b),
      ink: barInk(b, inkById),
      frac: 1,
    }));
    if (holding && last && grow && (grow.total === 0 || grow.n > 0)) {
      rows.push({
        id: last.id,
        height: last.height,
        weight: barWeight(last),
        ink: grow.ink || barInk(last, inkById),
        frac: grow.total <= 0 ? 1 : Math.min(1, grow.n / grow.total),
      });
    }
    return rows;
  }, [confirmed, grow, holding, inkById, last]);
  const full = Boolean(holding && grow && (grow.total <= 0 || grow.n >= grow.total));
  useEffect(() => {
    if (!full) return;
    const t = window.setTimeout(() => onAssembleDone(), reduce ? 0 : 480);
    return () => window.clearTimeout(t);
  }, [full, onAssembleDone, reduce]);

  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const active =
    yard.find((b) => b.id === hoverId) ??
    yard[yard.length - 1] ??
    null;
  const activeRow = active ? slots.find((b) => b.id === active.id) ?? null : null;
  const activeTxs =
    active && grow && last && active.id === last.id && grow.total > 0 ? grow.n : (activeRow?.txCount ?? 0);

  return (
    <section
      className="home-tile-enter mod h-full min-w-0 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 sm:px-5"
      style={enterAt(0)}
    >
      <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <h2 className="m-0 shrink-0 text-[17px] font-semibold leading-none tracking-tight">{title}</h2>
          {active ? (
            <>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums leading-none tracking-tight">
                <ReelText text={active.height.toLocaleString(loc)} />
              </span>
              <span className="shrink-0 text-[12px] font-medium leading-none text-[var(--muted-2)]">
                <ReelText text={activeTxs.toLocaleString(loc)} />
                <span className="ml-0.5">{txUnit}</span>
              </span>
              {activeRow ? (
                <span
                  key={activeRow.timestamp}
                  className="hover-stamp min-w-0 truncate text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]"
                >
                  {fmtCreated(activeRow.timestamp, locale)}
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <Link href="/blocks" className="shrink-0 text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
          {all}
        </Link>
      </div>

      <div className="relative w-full" style={{ height: CADENCE_TRACK + CADENCE_HEAD }}>
        <CadenceYard
          blocks={yard}
          reduce={!!reduce}
          colorsReady={inkReady}
          label={title}
          onHover={(id) => setHoverId((cur) => (cur === id ? cur : id))}
        />
      </div>
      <div className="sr-only">
        {yard.map((b) => (
          <Link key={b.id} href={`/block/${encodeURIComponent(b.id)}`}>
            {b.height.toLocaleString(loc)}
          </Link>
        ))}
      </div>
    </section>
  );
}

function parseHomePools(raw: PoolShare[]): PoolShare[] {
  const pools: PoolShare[] = [];
  for (const row of raw) {
    if (!row || !Number.isFinite(row.blocks) || row.blocks <= 0) continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : "—";
    const share = Number.isFinite(row.share) && row.share >= 0 ? row.share : 0;
    const address =
      typeof row.address === "string" && row.address.trim() ? row.address.trim() : undefined;
    pools.push({ name, blocks: row.blocks, share, ...(address ? { address } : {}) });
  }
  return pools;
}

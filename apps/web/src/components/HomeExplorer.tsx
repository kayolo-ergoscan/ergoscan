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
import { KpiMark } from "@/components/kpi-marks";
import { ReelText } from "@/components/ReelText";
import { DONUT_SLICES, HOME } from "@/lib/palette";
import { lookInk, onScene } from "@/lib/look";
import { fetchErgChart } from "@/lib/price-history";
import type { ErgMarket } from "@/lib/list-snapshots";
import {
  formatCompact,
  formatGroupedNumber,
  formatDottedDay,
  formatH24,
  formatHashrate,
  formatInt,
  formatUsdPrice,
} from "@/lib/format";
import { lineChange, type LinePoint } from "@lumen/amm-chart";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { fromGatewayClock, useChainTipRefresh, usePageSync, useStreamMempool } from "@/lib/page-sync";
import type { SealEvent } from "@ergoscan/shared";
import { SNAPSHOT_FETCH, snapshotPath } from "@/lib/keyed-enter";
import {
  parseLithosHome,
  parseRentTape,
  parseRentEpochBoxes,
  parseRentEpochNano,
  parseRentEpochCollected,
  type RentEpochCollected,
  type LithosHome,
  type RentTapeRow,
} from "@ergoscan/shared";
import { HomeLithos } from "@/components/HomeLithos";
import { HomeRentHarbour } from "@/components/HomeRentHarbour";
import { parseRentDanger, type RentDangerRow } from "@/lib/rent-danger";
import { HomeCityPair } from "@/components/HomeCity";
import { formingAfterSeal, mergeBlockRow, mergeBlockRows, type BlockRow } from "@/lib/home-tape";
import { Tip, TipInfo } from "@/components/Tip";
import { HomeVersionNodes } from "@/components/HomeVersionNodes";
import { isSupplyDigit, zipSupplyGlyphs } from "@/lib/supply-flip";
import { NetStats, type NetVariant } from "@/components/net-stats/NetStats";

function ChartSparkSlot() {
  return <div className="h-9 w-full" />;
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

/** When the gateway saw the block, on this browser's clock; null from a gateway without `seenAt`. */
function sealSeenMs(s: SealEvent): number | null {
  const at = s.seenAt;
  return typeof at === "number" && Number.isFinite(at) && at > 1e12 ? fromGatewayClock(at) : null;
}

/**
 * «Forming since» before this page saw a seal: the gateway's last sighting (`eta.lastBlockTs`), never
 * earlier than the newest block's own sighting or header time.
 */
function formingFallback(lastBlockMs: number | null, top: BlockRow | null): number | null {
  const own = top ? (top.seenAt ?? (top.timestamp > 1e12 ? top.timestamp : top.timestamp > 0 ? top.timestamp * 1000 : null)) : null;
  if (lastBlockMs == null) return own;
  const last = fromGatewayClock(lastBlockMs);
  return own == null ? last : Math.max(last, own);
}

type TxActivityPoint = { t: number; txs: number; feesErg: number; feesKnown?: boolean };

const TX_LINE = "#86a6f0";
const FEE_LINE = "#e799b7";

function formatFeeAxis(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "0";
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
/** Blocks on the street: all the home snapshot gives (10); the tape keeps one more from a seal. */
const CADENCE = 10;
/** Tape rows kept: the cadence and the block before it. */
const TAPE_KEEP = CADENCE + 1;
/** No live stream: one empty seal list, so the strip's effects do not run on every render. */
const NO_SEALS: readonly SealEvent[] = [];
/** No pools yet: one array, so the city's roof-flag memo does not change on every render. */
const NO_POOLS: PoolShare[] = [];
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
  initialRentEpochBoxes = null,
  initialRentEpochCollected = null,
  initialRentDanger = null,
  initialLithos = null,
  previewShare = false,
  statsVariant = null,
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
  /** Boxes that turn four years old before this header epoch ends. */
  initialRentEpochBoxes?: number | null;
  /** Rent collected since this header epoch began (the snapshot's exact sum). */
  initialRentEpochCollected?: RentEpochCollected | null;
  /** Tokens short on ERG, from the rent snapshot. Null until that field arrives. */
  initialRentDanger?: RentDangerRow[] | null;
  /** Home «Lithos» card from the Lithos snapshot. Null until the indexer writes its stats. */
  initialLithos?: LithosHome | null;
  /** Local `/?preview=share` — keep fixture rows, don't overwrite from stage. */
  previewShare?: boolean;
  /** Prototype `/?stats=a|b|c`: the eight figures as one «Network» block. */
  statsVariant?: NetVariant | null;
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
  const [rentEpochBoxes, setRentEpochBoxes] = useState<number | null>(initialRentEpochBoxes);
  const [rentEpochCollected, setRentEpochCollected] = useState<RentEpochCollected | null>(initialRentEpochCollected);
  const [rentDanger, setRentDanger] = useState<RentDangerRow[]>(initialRentDanger ?? []);
  const [rentDangerReady, setRentDangerReady] = useState(initialRentDanger != null);
  const [lithos, setLithos] = useState<LithosHome | null>(initialLithos);
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
          scriptCount?: number | null;
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
          rentEpochBoxes?: unknown;
          rentEpochCollected?: unknown;
          rentDanger?: unknown;
          lithos?: unknown;
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
          setBlocks((prev) => mergeBlockRows(prev, j.blocks!.slice(0, CADENCE), TAPE_KEEP));
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
        const scriptCount =
          j.scriptCount != null &&
          Number.isFinite(Number(j.scriptCount)) &&
          Number(j.scriptCount) >= 0
            ? Math.round(Number(j.scriptCount))
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
            scriptCount,
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
          const epochBoxes = parseRentEpochBoxes(j.rentEpochBoxes);
          if (epochBoxes != null) setRentEpochBoxes(epochBoxes);
          // Absent when the snapshot's sum is from another epoch: then nothing, not last epoch's.
          setRentEpochCollected(parseRentEpochCollected(j.rentEpochCollected));
          const danger = parseRentDanger(j.rentDanger);
          setRentDanger(danger ?? []);
          setRentDangerReady(true);
        }
        // A home without the field (older gateway) keeps what the card already shows.
        if (j.lithos !== undefined) setLithos(parseLithosHome(j.lithos));
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
      }, TAPE_KEEP)
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

  const pools = stats?.pools ?? NO_POOLS;
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
  const scriptCount = stats?.scriptCount ?? null;
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
        pools={pools}
        avgBlockMs={avgBlockMs}
        title={t("home.cadence")}
        mempoolTitle={t("home.mempool")}
        all={t("home.viewAll")}
        txUnit={t("home.txUnit")}
      />

      <div
        className={clsx(
          "home-bento grid items-stretch gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]",
          statsVariant ? "lg:grid-rows-[auto_22.5rem]" : "lg:grid-rows-[22.5rem_22.5rem]"
        )}
      >
        <div
          className={clsx(
            "home-bento-top contents gap-2 lg:col-span-2 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-subgrid",
            statsVariant ? "lg:grid-rows-[auto_auto]" : "lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          )}
        >
        {statsVariant ? (
          <div className="min-w-0 max-lg:order-1 lg:col-span-2 lg:row-start-1">
            <NetStats
              variant={statsVariant}
              price={price}
              spot={spotPx}
              change24h={changePct}
              mcap={mcap}
              rank={market?.rank ?? null}
              vol24={vol24}
              circulating={stats?.circulating ?? null}
              maxSupply={stats?.maxSupply ?? 97_739_924}
              holders={holderCount}
              holdersMonth={stats?.holdersMonth ?? null}
              scripts={scriptCount}
              pools={pools}
              minerCount={minerCount}
              hashrate={stats?.hashRate ?? null}
              hashSeries={hashRateSeries}
              txDay={txDay}
              feeDay={feeDay}
              activity={txActivity}
              enter={2}
            />
          </div>
        ) : (
        <>
        <div className="home-kpi grid min-h-0 grid-cols-2 gap-2 sm:grid-cols-3 max-lg:order-1 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-full lg:grid-rows-2">
          <article className={TILE} style={enterAt(2)}>
            <div className="flex shrink-0 items-end justify-between gap-2">
              <TileName>{t("home.price")}</TileName>
              {changePct != null ? <PriceChangeChip pct={changePct} /> : null}
            </div>
            <div className="flex shrink-0 items-baseline justify-between gap-2">
              <KpiValue flush>
                <ReelText text={formatUsdPrice(spotPrice, locale)} />
              </KpiValue>
              {priceAt != null ? (
                <span key={priceAt} className="hover-stamp shrink-0 text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]">
                  {formatHoverWhen(priceAt, locale)}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              {chartBusy ? (
                <div className="h-full rounded-[8px] bg-[var(--wash-faint)] motion-safe:animate-pulse" />
              ) : price.length >= 2 ? (
                <AreaChart
                  points={price}
                  fill
                  compact
                  glow
                  activity
                  showTip={false}
                  color={changePct != null && changePct < 0 ? PRICE_DOWN : PRICE_UP}
                  lineWidth={2}
                  formatValue={(v) => formatUsdPrice(v, locale)}
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
              <TileName>{t("home.mcap")}</TileName>
              {market?.rank != null ? (
                <span className="mcap-rank shrink-0 rounded-[8px] px-1.5 py-0.5 text-[12px] font-semibold tabular-nums leading-none">
                  #{market.rank}
                </span>
              ) : null}
            </div>
            <KpiValue flush full muted={mcap == null}>
              {mcap != null ? (
                <ReelText text={`$${formatGroupedNumber(Math.round(mcap), 0, 0, locale)}`} />
              ) : (
                mcapMiss
              )}
            </KpiValue>
            <div className="mt-auto">
              <TileName>{t("home.volume24h")}</TileName>
              <KpiValue flush full muted={vol24 == null}>
                {vol24 != null ? (
                  <ReelText text={`$${formatGroupedNumber(Math.round(vol24), 0, 0, locale)}`} />
                ) : (
                  "—"
                )}
              </KpiValue>
            </div>
          </article>

          <Link prefetch={false} href="/addresses" className={clsx(TILE, "kpi-tile--press relative")} style={enterAt(4)}>
            <HoldersMark />
            <TileFact hint={t("home.holdersHint")}>
              <TileName className="pr-14">
                {t("home.holdersCount")} <TipInfo content={t("home.holdersHint")} label={t("home.holdersHint")} side="bottom" />
              </TileName>
              <KpiValue flush muted={holderCount == null}>
                <ReelText text={holderCount != null ? holderCount.toLocaleString(loc) : miss} />
              </KpiValue>
            </TileFact>
            <TileFact className="mt-auto" place="above" hint={t("home.scriptHint")}>
              <TileName className="pr-14">
                {t("home.script")} <TipInfo content={t("home.scriptHint")} label={t("home.scriptHint")} />
              </TileName>
              <KpiValue flush full muted={scriptCount == null}>
                <ReelText
                  text={scriptCount != null ? scriptCount.toLocaleString(loc) : miss}
                />
              </KpiValue>
            </TileFact>
          </Link>

          <article className={clsx(TILE, "group relative max-lg:hidden")} style={enterAt(6)}>
            <TileName>
              <SwapLine idle={t("home.circulating")} hover={t("home.maxSupply")} />
            </TileName>
            <p
              className={clsx(
                "whitespace-nowrap text-[22px] font-semibold leading-none tabular-nums tracking-tight",
                stats?.circulating == null && "text-[var(--muted)]"
              )}
            >
              <KpiNum>
                {stats?.circulating != null ? (
                  <SupplyFlip from={stats.circulating} to={stats.maxSupply} locale={locale} />
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
              <TileName>{t("home.poolsActive")}</TileName>
              <KpiValue flush muted={minerCount == null}>
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
                  formatValue={(v, pct) => `${formatInt(v, locale)} · ${pctLabel(pct)}`}
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
            <TileName className="shrink-0">{t("home.hashrate")}</TileName>
            <div className="flex shrink-0 items-baseline justify-between gap-2">
              <KpiValue flush muted={spotHash == null}>
                <ReelText text={spotHash != null ? formatHashrate(spotHash) : miss} />
              </KpiValue>
              {hrAt != null ? (
                <span key={hrAt} className="hover-stamp shrink-0 text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]">
                  {formatHoverWhen(hrAt, locale)}
                </span>
              ) : null}
            </div>
            {hashrateSpark ? (
              <div className="min-h-0 flex-1">
                <AreaChart
                  points={hashRateSeries}
                  fill
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
        <div className="flex max-lg:order-2 max-lg:min-h-[22.5rem] flex-col gap-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid lg:h-full lg:min-h-0 lg:grid-rows-subgrid">
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
                formatTxs={(v) => formatCompact(v, 1, locale)}
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
                formatTxs={(v) => formatCompact(v, 1, locale)}
                formatFees={formatFeeAxis}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
                {t("home.chartWarm")}
              </p>
            )}
          </HomeActivityTile>
        </div>
        </>
        )}

        <EpochBar
          height={tipHeight}
          avgBlockMs={avgBlockMs}
          t={t}
          locale={locale}
          className={clsx("home-tile-enter max-lg:order-4 lg:col-start-1", statsVariant ? "lg:row-start-2" : "lg:row-start-3")}
          style={enterAt(9)}
        />
        <HomeVersionNodes
          className={clsx("home-tile-enter home-meet-right h-full min-h-0 max-lg:order-3 lg:col-start-2", statsVariant ? "lg:row-start-2" : "lg:row-start-3")}
          style={enterAt(11)}
        />
        </div>

        <HomeRentHarbour
          rows={rentTape}
          epochRentNano={rentEpochNano}
          epochBoxes={rentEpochBoxes}
          epochCollected={rentEpochCollected}
          height={tipHeight}
          avgBlockMs={avgBlockMs}
          danger={rentDanger}
          dangerReady={rentDangerReady}
          previewShare={previewShare}
          enter={12}
        />

        <HomeLithos data={lithos} tipHeight={blocks[0]?.height ?? lithos?.tip.height ?? null} enter={13} />
      </div>
    </Shell>
  );
}

const TILE =
  "home-tile-enter mod flex h-full min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3";

function TileName({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={clsx("text-[13px]", className)} style={{ color: HOME.forming }}>
      {children}
    </p>
  );
}

function TileFact({
  hint,
  className,
  place = "below",
  children,
}: {
  hint: string;
  className?: string;
  place?: "above" | "below";
  children: ReactNode;
}) {
  // Inside a link tile: a tap opens the page, so the tip is for hover and keyboard.
  return (
    <Tip content={hint} side={place === "above" ? "top" : "bottom"} tap={false}>
      <div className={clsx("relative", className)}>{children}</div>
    </Tip>
  );
}

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
            <h2 className="m-0 text-[13px] leading-none" style={{ color: HOME.forming }}>{title}</h2>
            <Link prefetch={false} href={href} className="tap-44 text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
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
              {when ? null : (
                <span className="text-[12px] leading-none text-[var(--muted)]">{kpiLabel}</span>
              )}
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

/** The holders tile wears the same field and glyph as every KPI tile. */
function HoldersMark() {
  return (
    <span className="holders-mark" aria-hidden>
      <KpiMark id="holders" />
    </span>
  );
}

function PriceChangeChip({ pct }: { pct: number }) {
  return (
    <span
      className={clsx(
        "shrink-0 rounded-[8px] px-1.5 py-0.5 text-[12px] font-medium leading-none tabular-nums",
        pct >= 0 ? "bg-up/15 text-up" : "bg-down/15 text-down"
      )}
    >
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function KpiValue({
  children,
  muted,
  flush,
  full,
}: {
  children: ReactNode;
  muted?: boolean;
  flush?: boolean;
  full?: boolean;
}) {
  return (
    <p
      className={clsx(
        "text-[22px] font-semibold tabular-nums tracking-tight",
        full ? "whitespace-nowrap" : "truncate",
        flush ? "leading-none" : "mt-1",
        muted && "text-[var(--muted)]"
      )}
    >
      <KpiNum>{children}</KpiNum>
    </p>
  );
}

const SWAP =
  "transition-opacity duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-0";

function SupplyFlip({ from, to, locale }: { from: number; to: number; locale: string }) {
  const glyphs = zipSupplyGlyphs(from, to, locale);
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

/** Time left in the epoch: `13h 29m` / `13 ч 29 мин` (the same units as the relative ages). */
function formatRemain(ms: number, locale: string): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ru = locale === "ru";
  if (h >= 48) return ru ? `${Math.round(h / 24)}\u00a0дн.` : `${Math.round(h / 24)}d`;
  if (h >= 1) return ru ? `${h}\u00a0ч ${m}\u00a0мин` : `${h}h ${m}m`;
  return ru ? `${m}\u00a0мин` : `${m}m`;
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
      {/* The figures drop under the label when the row does not fit (a 360 px phone in Russian). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="shrink-0 text-[13px] leading-none tabular-nums" style={{ color: HOME.forming }}>
          {t("home.epoch")} <ReelText text={n.toLocaleString(loc)} />
        </p>
        <div className="flex min-w-0 items-center gap-3 text-[12px] leading-none tabular-nums">
          <span className="epoch-slot inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap font-semibold">
            <ReelText text={slot.toLocaleString(loc)} />
            {/* A phone keeps the slot and the %; the epoch length is the same every time. */}
            <span className="font-medium opacity-70 max-sm:hidden">/ {ERGO_EPOCH_LEN.toLocaleString(loc)}</span>
          </span>
          <span className="epoch-slot inline-flex shrink-0 items-center gap-1 font-semibold">
            <EpochClock />
            <ReelText text={`${pct.toFixed(0)}%`} />
          </span>
          <span className="epoch-left inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
            <EpochFlag />
            <ReelText text={formatRemain(leftMs, locale)} />
            <span className="font-normal opacity-80">{t("home.epochLeft")}</span>
          </span>
        </div>
      </div>
      <div
        className="epoch-tape mt-2 h-2 rounded-full bg-[var(--wash)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("home.epoch")}
      >
        <div
          className="epoch-tape-fill h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </section>
  );
}

const MEMPOOL_HTTP_MS = 8_000;

type HomeMempoolBall = {
  id: string;
  size: number;
  fee: number;
  feeRate: number;
  color: string;
  firstSeen: number;
  category: string;
  platform: string | null;
  action: string | null;
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
    action?: string | null;
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
      action: typeof b.action === "string" && b.action ? b.action : null,
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
      action?: string | null;
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
  // One array per stream update, not per render: the yard's memos (and its frames) hang on it.
  const balls = useMemo(
    () =>
      live
        ? stream.balls.map((b) => ({
            id: b.id,
            size: b.size,
            fee: b.fee,
            feeRate: b.feeRate > 0 ? b.feeRate : b.size > 0 ? b.fee / b.size : 0,
            color: b.color || HOME.txs,
            firstSeen: b.firstSeen,
            category: b.category,
            platform: b.platform,
            action: b.action ?? null,
            value: b.value,
          }))
        : httpBalls,
    [live, stream.balls, httpBalls]
  );
  const pool = (live ? stream.mempoolCount : null) ?? httpPool ?? initialCount;
  const totalSize = (live ? stream.totalSize : null) ?? httpSize;
  const totalFees = (live ? stream.totalFees : null) ?? httpFees;
  const seal = live ? stream.seal : null;
  const seals = live ? stream.seals : NO_SEALS;
  const fees = live ? stream.fees : null;
  return { pool, balls, totalSize, totalFees, seal, seals, fees, streamLive: live };
}

function HomeLiveStrip({
  blocks,
  mempoolCount,
  pools,
  avgBlockMs,
  title,
  mempoolTitle,
  all,
  txUnit,
}: {
  blocks: BlockRow[];
  mempoolCount: number;
  pools: readonly PoolShare[];
  avgBlockMs: number | null;
  title: string;
  mempoolTitle: string;
  all: string;
  txUnit: string;
}) {
  const { tip } = usePageSync();
  const mp = useHomeMempool(mempoolCount);
  const [tape, setTape] = useState(blocks);
  const [formSince, setFormSince] = useState<{ height: number; at: number } | null>(null);

  useEffect(() => {
    setTape((prev) => mergeBlockRows(prev, blocks, TAPE_KEEP));
  }, [blocks]);

  // Every seal joins the tape once (two can come in one breath). Seals the stream held before this
  // strip mounted are history: only the newest of them joins, as before.
  const taped = useRef<WeakSet<SealEvent> | null>(null);
  useEffect(() => {
    const list = mp.seals;
    if (!taped.current) {
      taped.current = new WeakSet(list.slice(0, -1));
    }
    const done = taped.current;
    const fresh = list.filter((s) => !done.has(s) && Number.isFinite(s.height));
    if (!fresh.length) return;
    for (const s of fresh) done.add(s);
    setTape((prev) => {
      let next = prev;
      for (const s of fresh) {
        const id = typeof s.blockId === "string" && s.blockId.length >= 16 ? s.blockId : `seal-${s.height}`;
        // A partial seal (the gateway could not read the block) knows its id and height only.
        next = mergeBlockRow(next, {
          id,
          height: s.height,
          timestamp: s.timestamp || Date.now(),
          txCount: s.partial ? null : (s.txCount ?? (Array.isArray(s.txIds) ? s.txIds.length : null)),
          size: s.partial ? 0 : (s.size ?? 0),
          seenAt: sealSeenMs(s),
        }, TAPE_KEEP);
      }
      return next;
    });
  }, [mp.seals]);

  // «Forming since»: from when the gateway saw the newest block, not its header time (the miner's
  // template start, a minute or more earlier). A fork's block at the same height does not restart it,
  // also when it is the first seal this page sees: the tape's top as it was before the seal counts.
  const lastBlockMs = mp.fees?.lastBlockMs ?? null;
  const formedAt = useRef(0);
  const before = useRef({ top: tape[0], lastBlockMs });
  before.current = { top: tape[0], lastBlockMs };
  useEffect(() => {
    const s = mp.seal;
    if (!s || !Number.isFinite(s.height) || s.height <= formedAt.current) return;
    const { top, lastBlockMs: last } = before.current;
    const next = formingAfterSeal(s, top, sealSeenMs(s) ?? Date.now(), formingFallback(last, top ?? null));
    if (!next) return;
    formedAt.current = next.height;
    setFormSince(next);
  }, [mp.seal]);

  // A pool's roof flag is its slice ink on the «Mining pools» donut; the last (grey) slice and solo miners stay grey.
  const poolInk = useMemo(() => {
    const out: Record<string, string> = {};
    pools.forEach((p, i) => {
      if (!p.address) return;
      const raw = DONUT_SLICES[i % DONUT_SLICES.length]!;
      if (!raw.startsWith("rgba(255")) out[p.address] = onScene(() => lookInk(raw));
    });
    return out;
  }, [pools]);

  return (
    <HomeCityPair
      blocks={tape}
      balls={mp.balls}
      pool={mp.pool}
      totalSize={mp.totalSize}
      totalFees={mp.totalFees}
      streamFees={mp.fees}
      streamLive={mp.streamLive}
      seals={mp.seals}
      poolInk={poolInk}
      avgBlockMs={avgBlockMs}
      title={title}
      mempoolTitle={mempoolTitle}
      all={all}
      txUnit={txUnit}
      formingHeight={Math.max(tip?.height ?? 0, mp.seal?.height ?? 0, tape[0]?.height ?? 0) + 1}
      formingSince={
        // A seal the stream missed (the tape has a newer block): the fallback, not the old seal.
        formSince && formSince.height >= (tape[0]?.height ?? 0)
          ? formSince.at
          : formingFallback(lastBlockMs, tape[0] ?? null)
      }
      enter={[enterAt(0), enterAt(1)]}
    />
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

"use client";

/**
 * Explorer home — chain dashboard.
 * KPI + ERG/USD from the indexer snapshot. `/chain-stats` is not on this path.
 * Block and tx lists live on /blocks and /transactions.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { getGateway } from "@/lib/config";
import { CHAIN_MAX_SUPPLY, patchHomeStats, type ChainStats, type PoolShare } from "@/lib/chain-stats";
import { ReelText } from "@/components/ReelText";
import { DONUT_SLICES, HOME } from "@/lib/palette";
import { lookInk, onScene } from "@/lib/look";
import { fetchErgChart } from "@/lib/price-history";
import type { ErgMarket } from "@/lib/list-snapshots";
import type { LinePoint } from "@lumen/amm-chart";
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
import { HomeVersionNodes } from "@/components/HomeVersionNodes";
import { NetStats } from "@/components/net-stats/NetStats";
import { asOfHour, cleanLine, dayChange, sameRows } from "@/lib/net-stats";

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

/** Blocks on the street: all the home snapshot gives (10); the tape keeps one more from a seal. */
const CADENCE = 10;
/** Tape rows kept: the cadence and the block before it. */
const TAPE_KEEP = CADENCE + 1;
/** No live stream: one empty seal list, so the strip's effects do not run on every render. */
const NO_SEALS: readonly SealEvent[] = [];
/** No pools yet: one array, so the city's roof-flag memo does not change on every render. */
const NO_POOLS: PoolShare[] = [];
/** The cards under the street; each re-renders only when its own props change (a block moves a few). */
const Lithos = memo(HomeLithos);
const RentHarbour = memo(HomeRentHarbour);
const VersionNodes = memo(HomeVersionNodes);
const ENTER_NET = 2;
const ENTER_EPOCH = enterAt(5);
const ENTER_VERSIONS = enterAt(6);

/**
 * The page's state lives under the Shell: a snapshot (one per block) re-renders the home cards,
 * not the header and the rail around them.
 */
export function HomeExplorer(props: Parameters<typeof HomeBody>[0]) {
  return (
    <Shell>
      <HomeBody {...props} />
    </Shell>
  );
}

function HomeBody({
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
  const [ergUsd, setErgUsd] = useState<number | null>(initialErgUsd);
  const [market, setMarket] = useState<ErgMarket | null>(initialMarket);
  const [stats, setStats] = useState<ChainStats | null>(initialStats);
  const [mempool, setMempool] = useState<number | null>(initialMempool);
  const [blocks, setBlocks] = useState<BlockRow[]>(initialBlocks);
  const [hashRateSeries, setHashRateSeries] = useState<LinePoint[]>(initialHashRateSeries);
  const [txActivity, setTxActivity] = useState<TxActivityPoint[]>(initialTxActivity);
  // The hour the activity's snapshot was made in: the 6 h column that ends after it is still filling.
  const [activityAt, setActivityAt] = useState<number | null>(() => asOfHour(initialUpdatedAt));
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
    setChartLoading(true);
    void fetchErgChart(getGateway(), 7)
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
          stats24h?: { feesErg?: number | null } | null;
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
          const next = j.hashRateSeries.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
          setHashRateSeries((prev) => sameRows(prev, next, ["t", "v"]));
        }
        if (Array.isArray(j.txActivity) && j.txActivity.length >= 2) {
          const next = j.txActivity.filter(
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
          }));
          setTxActivity((prev) => sameRows(prev, next, ["t", "txs", "feesErg", "feesKnown"]));
          const at = asOfHour(j.updatedAt);
          if (at != null) setActivityAt(at);
        }
        const hs =
          j.hashRate != null && Number.isFinite(Number(j.hashRate)) ? Number(j.hashRate) : null;
        const fees24 = j.stats24h?.feesErg;
        const feesErg = fees24 != null && Number.isFinite(Number(fees24)) && Number(fees24) >= 0 ? Number(fees24) : null;
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
            setPrice((prev) => sameRows(prev, pts, ["t", "v"]));
            setChartError(false);
          }
        }
        setStats((prev) =>
          patchHomeStats(prev, {
            hashRate: hs,
            txPerDay: txn,
            pools: pools && prev ? sameRows(prev.pools, pools, ["name", "blocks", "share", "address"]) : pools,
            holderCount,
            scriptCount,
            holdersMonth,
            minerCount,
            height,
            circulating,
            avgBlockMs,
            mempool: mempoolN,
            lastBlockSize,
            feesErg,
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

  // Without the market's 24 h change: the line's own, from its point a day back (null without one).
  const sparkChange = useMemo(() => dayChange(cleanLine(price)), [price]);
  const lastPx = price.length ? price[price.length - 1]!.v : null;
  const spotPx =
    ergUsd != null && ergUsd > 0 ? ergUsd : lastPx != null && lastPx > 0 ? lastPx : null;
  const priceNote =
    price.length >= 2 ? null : chartLoading ? t("home.chartWarm") : chartError ? t("home.chartError") : t("home.chartWarm");
  const changePct =
    market?.change24h != null && Number.isFinite(market.change24h)
      ? market.change24h
      : sparkChange != null
        ? sparkChange * 100
        : null;

  const mcap =
    stats?.circulating != null && spotPx != null && spotPx > 0
      ? stats.circulating * spotPx
      : null;
  const vol24 = market?.volume24h ?? chartVol;

  const pools = stats?.pools ?? NO_POOLS;
  const txDay = stats?.stats24h?.txs ?? stats?.txPerDay ?? null;
  const feeDay = stats?.stats24h?.feesErg ?? null;
  const minerCount =
    stats?.minerCount != null && stats.minerCount > 0
      ? stats.minerCount
      : pools.filter((p) => p.name !== "other").length || null;
  const tipHeight = stats?.height ?? blocks[0]?.height ?? null;
  const avgBlockMs = stats?.stats24h?.avgBlockMs ?? null;

  return (
    <>
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

      {/* The street's two columns, row by row: the week | Lithos, the harbour | the reef, epoch | nodes.
          A phone reads them in this order, one under the other. */}
      <div className="home-bento grid items-stretch gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:grid-rows-[auto_22.5rem_auto]">
        <NetStats
          price={price}
          priceNote={priceNote}
          spot={spotPx}
          change24h={changePct}
          mcap={mcap}
          rank={market?.rank ?? null}
          vol24={vol24}
          circulating={stats?.circulating ?? null}
          maxSupply={stats?.maxSupply ?? CHAIN_MAX_SUPPLY}
          holders={stats?.holderCount ?? null}
          holdersMonth={stats?.holdersMonth ?? null}
          scripts={stats?.scriptCount ?? null}
          pools={pools}
          minerCount={minerCount}
          hashrate={stats?.hashRate ?? null}
          hashSeries={hashRateSeries}
          txDay={txDay}
          feeDay={feeDay}
          activity={txActivity}
          activityAt={activityAt}
          enter={ENTER_NET}
        />

        <Lithos data={lithos} tipHeight={blocks[0]?.height ?? lithos?.tip.height ?? null} enter={3} />

        <RentHarbour
          rows={rentTape}
          epochRentNano={rentEpochNano}
          epochBoxes={rentEpochBoxes}
          epochCollected={rentEpochCollected}
          height={tipHeight}
          avgBlockMs={avgBlockMs}
          danger={rentDanger}
          dangerReady={rentDangerReady}
          previewShare={previewShare}
          enter={4}
        />

        <EpochBar
          height={tipHeight}
          avgBlockMs={avgBlockMs}
          t={t}
          locale={locale}
          className="home-tile-enter"
          style={ENTER_EPOCH}
        />
        <VersionNodes className="home-tile-enter home-meet-right h-full min-h-0" style={ENTER_VERSIONS} />
      </div>
    </>
  );
}

function enterAt(i: number): CSSProperties {
  return { "--enter": i } as CSSProperties;
}

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
            <span className="word-dim font-medium opacity-70 max-sm:hidden">/ {ERGO_EPOCH_LEN.toLocaleString(loc)}</span>
          </span>
          <span className="epoch-slot inline-flex shrink-0 items-center gap-1 font-semibold">
            <EpochClock />
            <ReelText text={`${pct.toFixed(0)}%`} />
          </span>
          <span className="epoch-left inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
            <EpochFlag />
            <ReelText text={formatRemain(leftMs, locale)} />
            <span className="word-dim font-normal opacity-80">{t("home.epochLeft")}</span>
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

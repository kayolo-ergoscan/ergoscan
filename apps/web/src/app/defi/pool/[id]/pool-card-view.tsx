"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiNum } from "@/components/KpiGrid";
import { SegBar, segItem } from "@/components/SegBar";
import {
  KpiMarkBadgePercent,
  KpiMarkCalendar,
  KpiMarkFootprints,
  KpiMarkHandCoins,
  KpiMarkScrollText,
  KpiMarkVault,
  KpiMarkTrendingUp,
} from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { PrettyPrice } from "@/components/PrettyNum";
import { RankWindow } from "@/components/RankWindow";
import { HOME, INK } from "@/lib/palette";
import {
  formatGroupedNumber,
  formatRelTime,
  relAgeTone,
  relAgeToneClass,
  shortId,
} from "@/lib/format";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useFavoriteOf } from "@/lib/favorites";
import { SNAPSHOT_FETCH, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate, FeedSkeleton, FeedSort } from "@/components/feed/Feed";
import { FeedLpRow, LP_SORT_LABEL, type FeedLpHolder, type FeedLpSort } from "@/components/feed/FeedPoolRow";
import { FeedSwapTape, swapEventId } from "@/components/feed/FeedSwapRow";
import { getGateway } from "@/lib/config";
import { defiVenueCaption, isErgBase, type PoolBoardRow } from "@/lib/defi-pools";

const PACK = 25;
const LP_SORTS: LpSort[] = ["share", "tvl", "txs", "last", "first"];

type ViewId = "trades" | "lp" | "deposit" | "withdraw";
type TradeSort = "time" | "amount";
type LpSort = FeedLpSort;
type Dir = "asc" | "desc";

type Trade = {
  txId: string;
  time: number | null;
  side: string;
  tokenId: string;
  tokenName?: string | null;
  baseId: string | null;
  baseName?: string | null;
  tokenAmount: number;
  baseAmount: number;
  trader: string | null;
};

type LpRow = FeedLpHolder;

type PoolHead = PoolBoardRow & {
  feePct?: number | null;
  income30Erg?: number | null;
  apr30Pct?: number | null;
};

type Card = {
  ok?: boolean;
  pool?: PoolHead;
  view?: ViewId;
  events?: Trade[];
  tradesCount?: number | null;
  lps?: LpRow[];
  lpTotal?: number | null;
  offset?: number;
};

function flowSide(side: string, view: ViewId): boolean {
  const sid = side.toLowerCase();
  if (view === "deposit") return sid === "mint" || sid === "deposit";
  if (view === "withdraw") return sid === "redeem" || sid === "withdraw";
  return sid === "buy" || sid === "sell";
}

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}



function fmtErgFull(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2)} ERG`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const s = (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

function pairLabel(p: PoolBoardRow): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

export function PoolCardView({
  poolId,
  initial,
}: {
  poolId: string;
  initial: Card | null;
}) {
  const t = useT();
  const poolFav = useFavoriteOf("pools", poolId);
  const { locale } = useI18n();
  const miss = t("home.unavailable");
  const [view, setView] = useState<ViewId>("trades");
  const [card, setCard] = useState<Card | null>(initial);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<TradeSort>("time");
  const [dir, setDir] = useState<Dir>("desc");
  const [lpSort, setLpSort] = useState<LpSort>("share");
  const [lpDir, setLpDir] = useState<Dir>("desc");
  const [pending, setPending] = useState(false);
  const enter = useEnterIds(
    undefined,
    (initial?.events ?? []).map((row) => swapEventId(row))
  );

  const load = useCallback(
    (nextView: ViewId, nextOffset: number, nextSort: TradeSort, nextDir: Dir) => {
      setPending(true);
      const q = new URLSearchParams({
        view: nextView,
        offset: String(nextOffset),
        sort: nextSort,
        dir: nextDir,
      });
      void fetch(
        `${getGateway()}${snapshotPath(`/v1/defi/pool/${poolId}?${q}`)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<Card>;
        })
        .then((j) => {
          if (!j?.ok || !j.pool) return;
          const ids =
            nextView === "lp"
              ? (j.lps ?? []).slice(0, PACK).map((row) => row.address)
              : (j.events ?? []).map((row) => swapEventId(row));
          enter.mark(ids);
          setCard(j);
        })
        .catch(() => {})
        .finally(() => setPending(false));
    },
    [enter, poolId]
  );

  useEffect(() => {
    if (initial?.ok && initial.pool) return;
    load("trades", 0, "time", "desc");
  }, [initial, load]);

  const pool = card?.pool ?? null;
  const rawEvents = card?.events ?? [];
  const events = view === "lp" ? rawEvents : rawEvents.filter((row) => flowSide(row.side, view));
  const flowAligned =
    view !== "lp" && card?.view === view && rawEvents.every((row) => flowSide(row.side, view));
  const lps = card?.lps ?? [];
  const sortedLps = useMemo(() => {
    const mul = lpDir === "asc" ? 1 : -1;
    const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);
    return [...lps].sort((a, b) => {
      const av =
        lpSort === "tvl"
          ? num(a.tvlErg)
          : lpSort === "txs"
            ? num(a.txCount)
            : lpSort === "first"
              ? num(a.firstTs)
              : lpSort === "last"
                ? num(a.lastTs)
                : num(a.share);
      const bv =
        lpSort === "tvl"
          ? num(b.tvlErg)
          : lpSort === "txs"
            ? num(b.txCount)
            : lpSort === "first"
              ? num(b.firstTs)
              : lpSort === "last"
                ? num(b.lastTs)
                : num(b.share);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * mul;
    });
  }, [lps, lpSort, lpDir]);
  const lpPage = sortedLps.slice(offset, offset + PACK);

  const name = pool ? pairLabel(pool) : shortId(poolId, 4);
  const quoteId = pool?.tokenId;

  return (
    <Shell>
      <div className="addr-lane pool-head">
        <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
          <AddrFactCard
            className="h-auto min-h-0 flex-1"
            enter={0}
            label={t("pool.colPair")}
            ink={INK.violet}
            mark={quoteId ? <TokenAvatar tokenId={quoteId} symbol={pool?.symbol} size={40} /> : null}
          >
            <h1 className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[17px] font-semibold leading-[1.15] tracking-tight">
              <span className="shrink-0" style={quoteId ? { color: tokenTickerInk(quoteId) } : undefined}>
                {name}
              </span>
              <span className="min-w-0 truncate text-[12px] font-normal text-[var(--muted-2)]">
                {(pool ? defiVenueCaption(pool.venue, t) : null) || "\u00a0"}
              </span>
            </h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1">
              <Link
                prefetch={false}
                href={`/token/${poolId}`}
                className="shrink-0 whitespace-nowrap font-mono text-[12px] leading-[1.15] text-accent hover:underline"
              >
                {shortId(poolId, 8)}
              </Link>
              <FavoriteHeart
                on={poolFav.on}
                ready={poolFav.ready}
                title={poolFav.on ? t("favorites.remove") : t("favorites.add")}
                onToggle={poolFav.toggle}
              />
            </p>
          </AddrFactCard>
          <SegBar cols={2} className="addr-seg shrink-0 self-end">
            <button
              type="button"
              className={segItem(view === "trades")}
              onClick={() => {
                setView("trades");
                setOffset(0);
                load("trades", 0, sort, dir);
              }}
            >
              {t("pool.tapeTrades")}
            </button>
            <button
              type="button"
              className={segItem(view === "lp")}
              onClick={() => {
                setView("lp");
                setOffset(0);
                if (!card?.lps) load("lp", 0, "time", "desc");
              }}
            >
              {t("pool.tapeLp")}
            </button>
          </SegBar>
        </div>

        <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
        <AddrFactCard
          className="h-auto min-h-0 flex-1 overflow-hidden"
          enter={1}
          label={t("spectrum.tvl")}
          ink={INK.gold}
          mark={<KpiMarkVault className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>{pool && pool.tvlErg > 0 ? fmtErgFull(pool.tvlErg) : miss}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15]">
            <span className="capitalize" style={{ color: HOME.forming }}>{t("pool.fee")}</span>{" "}
            <span className="font-semibold tabular-nums" style={{ color: "var(--up)" }}>
              {pool?.feePct != null ? fmtPct(pool.feePct) : miss}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15]">
            <span style={{ color: HOME.forming }}>{t("defi.price")}</span>{" "}
            <span className="font-semibold tabular-nums" style={{ color: INK.violet }}>
              {pool?.priceErg != null && pool.priceErg > 0 ? (
                <>
                  <PrettyPrice n={pool.priceErg} /> ERG
                </>
              ) : (
                miss
              )}
            </span>
          </p>
        </AddrFactCard>
        <SegBar cols={2} className="addr-seg shrink-0 self-end">
          <button
            type="button"
            className={segItem(view === "deposit")}
            onClick={() => {
              setView("deposit");
              setOffset(0);
              load("deposit", 0, sort, dir);
            }}
          >
            {t("pool.tapeDeposit")}
          </button>
          <button
            type="button"
            className={segItem(view === "withdraw")}
            onClick={() => {
              setView("withdraw");
              setOffset(0);
              load("withdraw", 0, sort, dir);
            }}
          >
            {t("pool.tapeWithdraw")}
          </button>
        </SegBar>
        </div>

        <AddrFactCard
          enter={2}
          label={t("pool.apr")}
          ink={INK.green}
          mark={<KpiMarkBadgePercent className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>{pool?.apr30Pct != null ? fmtPct(pool.apr30Pct) : miss}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("pool.aprSub")}
          </p>
        </AddrFactCard>

        <AddrFactCard
          enter={3}
          label={t("spectrum.volume")}
          ink={INK.cyan}
          mark={<KpiMarkTrendingUp className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>
              {pool?.volErg != null && pool.volErg > 0 ? fmtErgFull(pool.volErg) : miss}
            </KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("spectrum.volumeSub")}
          </p>
        </AddrFactCard>

        <AddrFactCard
          enter={4}
          label={t("spectrum.trades")}
          ink={INK.gold}
          mark={<KpiMarkScrollText className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>
              {pool?.trades != null ? pool.trades.toLocaleString(loc(locale)) : miss}
            </KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("spectrum.tradesSub")}
          </p>
        </AddrFactCard>

        <AddrFactCard
          enter={5}
          label={t("pool.income")}
          ink={INK.cyan}
          mark={<KpiMarkHandCoins className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>
              {pool?.income30Erg != null ? fmtErgFull(pool.income30Erg) : miss}
            </KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("pool.incomeSub")}
          </p>
        </AddrFactCard>

        <AddrFactCard
          enter={6}
          label={t("pool.colFirst")}
          ink={INK.teal}
          mark={<KpiMarkCalendar className="h-9 w-9" />}
        >
          <p className={clsx("mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight", relAgeToneClass(relAgeTone(pool?.firstTs)))}>
            <KpiNum>{pool?.firstTs ? formatRelTime(pool.firstTs, locale) : miss}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("pool.colFirst")}
          </p>
        </AddrFactCard>

        <AddrFactCard
          enter={7}
          label={t("pool.colLast")}
          ink={INK.teal}
          mark={<KpiMarkFootprints className="h-9 w-9" />}
        >
          <p className={clsx("mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight", relAgeToneClass(relAgeTone(pool?.lastTs)))}>
            <KpiNum>{pool?.lastTs ? formatRelTime(pool.lastTs, locale) : miss}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("pool.colLast")}
          </p>
        </AddrFactCard>
      </div>

      <div className="feed-sheet mt-2">
        {view === "lp" ? (
          !sortedLps.length ? (
            pending || !card?.lps ? (
              <Feed>
                <FeedSkeleton />
              </Feed>
            ) : (
              <Feed>
                <FeedEmpty k="addr" title={t("pool.lpEmpty")} />
              </Feed>
            )
          ) : (
            <>
              <Feed busy={pending} className="is-rank">
                <FeedBoard
                  plate={
                    <FeedPlate
                      tag={t("pool.tapeLp")}
                      count={<FeedCount k="feed.holders" n={sortedLps.length} />}
                      end={
                        <FeedSort
                          label={t("feed.sort.label")}
                          options={LP_SORTS.map((key) => ({ key, label: t(LP_SORT_LABEL[key]) }))}
                          active={lpSort}
                          dir={lpDir}
                          disabled={pending}
                          onSort={(k) => {
                            if (lpSort === k) setLpDir((d) => (d === "desc" ? "asc" : "desc"));
                            else {
                              setLpSort(k);
                              setLpDir(k === "first" ? "asc" : "desc");
                            }
                            setOffset(0);
                          }}
                        />
                      }
                    />
                  }
                >
                  {lpPage.map((row, i) => (
                    <FeedLpRow key={row.address} row={row} rank={offset + i + 1} enterClass={enter.enterClass(row.address)} />
                  ))}
                </FeedBoard>
              </Feed>
              <RankWindow
                offset={offset}
                pageSize={PACK}
                shown={lpPage.length}
                total={sortedLps.length}
                hasMore={offset + PACK < sortedLps.length}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("pool.tapeLp")}
                hint={t("spectrum.packHint")}
                disabled={pending}
                onOffset={setOffset}
              />
            </>
          )
        ) : (
          <>
            {!events.length ? (
              pending || !card ? (
                <Feed>
                  <FeedSkeleton />
                </Feed>
              ) : (
                <Feed>
                  <FeedEmpty
                    k={view === "trades" ? "swap" : view === "deposit" ? "mint" : "burn"}
                    title={t(view === "deposit" ? "feed.poolNoDeposits" : view === "withdraw" ? "feed.poolNoWithdrawals" : "feed.poolNoTrades")}
                  />
                </Feed>
              )
            ) : (
              <Feed busy={pending} className={sort === "time" ? undefined : "is-rank"}>
                <FeedSwapTape
                  rows={events}
                  tag={t(view === "deposit" ? "pool.tapeDeposit" : view === "withdraw" ? "pool.tapeWithdraw" : "pool.tapeTrades")}
                  total={flowAligned ? (card?.tradesCount ?? null) : events.length}
                  sort={sort}
                  dir={dir}
                  timeKey="time"
                  sorts={
                    view === "trades"
                      ? [
                          { key: "time", label: t("defi.time") },
                          { key: "amount", label: t("defi.amount") },
                        ]
                      : [{ key: "time", label: t("defi.time") }]
                  }
                  onSort={(k) => {
                    const nextDir = sort === k ? (dir === "desc" ? "asc" : "desc") : "desc";
                    setSort(k);
                    setDir(nextDir);
                    setOffset(0);
                    load(view, 0, k, nextDir);
                  }}
                  pending={pending}
                  offset={offset}
                  enterClass={enter.enterClass}
                />
              </Feed>
            )}
            <RankWindow
              offset={offset}
              pageSize={PACK}
              shown={events.length}
              total={flowAligned ? (card?.tradesCount ?? null) : events.length}
              hasMore={flowAligned && offset + PACK < (card?.tradesCount ?? 0)}
              loc={loc(locale)}
              ofLabel={t("addresses.packOf")}
              prevLabel={t("addresses.packPrev")}
              nextLabel={t("addresses.packNext")}
              tapeLabel={t(view === "deposit" ? "pool.tapeDeposit" : view === "withdraw" ? "pool.tapeWithdraw" : "pool.tapeTrades")}
              hint={t("spectrum.packHint")}
              disabled={pending}
              onOffset={(next) => {
                setOffset(next);
                load(view, next, sort, dir);
              }}
            />
          </>
        )}
      </div>
    </Shell>
  );
}

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
import { AddressActivityWhen } from "@/components/AddressTapeRow";
import { TokenAvatar } from "@/components/TokenBadge";
import { PrettyPrice } from "@/components/PrettyNum";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
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
import { getGateway } from "@/lib/config";
import { noteRouteNavigation } from "@/lib/route-nav";
import { isErgBase, type PoolBoardRow } from "@/lib/defi-pools";

const PACK = 25;
const ERG_ZERO = "0".repeat(64);

type ViewId = "trades" | "lp";
type TradeSort = "time" | "amount";
type LpSort = "share" | "tvl" | "txs" | "first" | "last";
type Dir = "asc" | "desc";

type Trade = {
  txId: string;
  time: number | null;
  side: string;
  tokenId: string;
  baseId: string | null;
  tokenAmount: number;
  baseAmount: number;
  trader: string | null;
};

type LpRow = {
  address: string;
  share: number | null;
  tvlErg: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
};

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

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function shortHash(id: string): string {
  if (!id || id.length <= 10) return id;
  return `${id.slice(0, 5)}..${id.slice(-5)}`;
}

function fmtAmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return formatGroupedNumber(n, 2, 2);
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
    (initial?.events ?? []).map((row) => row.txId)
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
              : (j.events ?? []).map((row) => row.txId);
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
  const events = card?.events ?? [];
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
  const when = {
    locale: loc(locale),
    openLabel: t("addresses.openTx"),
    copyLabel: t("tx.copy"),
    copiedLabel: t("tx.copied"),
  };

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
            <h1
              className="mt-0.5 min-w-0 truncate text-[17px] font-semibold leading-[1.15] tracking-tight"
              style={quoteId ? { color: tokenTickerInk(quoteId) } : undefined}
            >
              {name}
            </h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1">
              <Link
                href={`/token/${poolId}`}
                className="min-w-0 truncate font-mono text-[12px] leading-[1.15] text-accent hover:underline"
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
            <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
              {pool?.venue || "\u00a0"}
            </p>
          </AddrFactCard>
          <SegBar cols={2} className="shrink-0">
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

        <AddrFactCard
          className="col-span-2 h-full lg:col-span-1 lg:row-span-2"
          enter={1}
          label={t("spectrum.tvl")}
          ink={INK.gold}
          mark={<KpiMarkVault className="h-9 w-9" />}
        >
          <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>{pool && pool.tvlErg > 0 ? fmtErgFull(pool.tvlErg) : miss}</KpiNum>
          </p>
          <p className="truncate text-[13px] font-normal uppercase leading-[1.15]">FEE</p>
          <p
            className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight"
            style={{ color: "var(--up)" }}
          >
            <KpiNum>{pool?.feePct != null ? fmtPct(pool.feePct) : miss}</KpiNum>
          </p>
          <p className="mt-3 truncate text-[13px] font-normal uppercase leading-[1.15]">
            {t("defi.price")}
          </p>
          <p
            className="mt-0.5 truncate text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight"
            style={{ color: INK.violet }}
          >
            <KpiNum>
              {pool?.priceErg != null && pool.priceErg > 0 ? (
                <>
                  <PrettyPrice n={pool.priceErg} /> ERG
                </>
              ) : (
                miss
              )}
            </KpiNum>
          </p>
        </AddrFactCard>

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
            <KpiNum>{pool?.firstTs ? formatRelTime(pool.firstTs) : miss}</KpiNum>
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
            <KpiNum>{pool?.lastTs ? formatRelTime(pool.lastTs) : miss}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {t("pool.colLast")}
          </p>
        </AddrFactCard>
      </div>

      <div className="addr-sheet mt-6">
          <div className={clsx("addr-pan kpi-tape transition-opacity duration-[400ms]", pending && "opacity-60")}>
            {view === "trades" ? (
              <TradesTape
                rows={events}
                locale={locale}
                t={t}
                sort={sort}
                dir={dir}
                enterClass={enter.enterClass}
                onSort={(k) => {
                  const nextDir = sort === k ? (dir === "desc" ? "asc" : "desc") : "desc";
                  setSort(k);
                  setDir(nextDir);
                  setOffset(0);
                  load("trades", 0, k, nextDir);
                }}
              />
            ) : (
              <LpTape
                rows={lpPage}
                locale={locale}
                t={t}
                miss={miss}
                when={when}
                sort={lpSort}
                dir={lpDir}
                enterClass={enter.enterClass}
                onSort={(k) => {
                  if (lpSort === k) setLpDir((d) => (d === "desc" ? "asc" : "desc"));
                  else {
                    setLpSort(k);
                    setLpDir(k === "first" ? "asc" : "desc");
                  }
                  setOffset(0);
                }}
              />
            )}
          </div>
        {view === "trades" ? (
          <RankWindow
            offset={offset}
            pageSize={PACK}
            shown={events.length}
            total={card?.tradesCount ?? null}
            hasMore={offset + PACK < (card?.tradesCount ?? 0)}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("pool.tapeTrades")}
            hint={t("spectrum.packHint")}
            disabled={pending}
            onOffset={(next) => {
              setOffset(next);
              load("trades", next, sort, dir);
            }}
          />
        ) : card?.view === "lp" && !pending && sortedLps.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-[var(--muted)]">{t("pool.lpEmpty")}</p>
        ) : sortedLps.length ? (
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
        ) : null}
      </div>
    </Shell>
  );
}

function SortBtn({
  label,
  on,
  dir,
  align,
  onClick,
  edge = false,
}: {
  label: string;
  on: boolean;
  dir: Dir;
  align: "left" | "right";
  onClick: () => void;
  /** Sit on the tile edge, same inset as the row text. */
  edge?: boolean;
}) {
  return (
    <div className={clsx("flex h-full min-w-0 items-center", edge && "px-3", align === "right" && "justify-end")}>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "chip-press inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
          edge && "-mx-2",
          on ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]" : "text-[var(--muted)]"
        )}
      >
        {align === "right" ? (
          <>
            <Caret on={on} dir={dir} />
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            <Caret on={on} dir={dir} />
          </>
        )}
      </button>
    </div>
  );
}

function Caret({ on, dir }: { on: boolean; dir: Dir }) {
  return (
    <span className="sort-mark" aria-hidden>
      <span className={clsx("sort-caret sort-caret-up", on && dir === "asc" && "is-on")} />
      <span className={clsx("sort-caret sort-caret-dn", on && dir === "desc" && "is-on")} />
    </span>
  );
}

function TradesTape({
  rows,
  locale,
  t,
  sort,
  dir,
  enterClass,
  onSort,
}: {
  rows: Trade[];
  locale: string;
  t: (k: string) => string;
  sort: TradeSort;
  dir: Dir;
  enterClass: (id: string) => string | undefined;
  onSort: (k: TradeSort) => void;
}) {
  return (
    <>
      <div className="addr-head addr-lane addr-lane-x pool-tape text-[12px] font-medium">
        <div className="flex min-w-0 items-center px-3 text-[var(--muted)]">{t("defi.token")}</div>
        <div className="pool-split">
          <div className="flex h-full min-w-0 items-center px-3 text-[12px] font-medium leading-none text-[var(--muted)]">{t("defi.side")}</div>
          <div className="flex h-full min-w-0 items-center justify-end px-3 text-right text-[12px] font-medium leading-none text-[var(--muted)]">{t("defi.price")}</div>
        </div>
        <div className="pool-split">
          <SortBtn label={t("defi.amount")} on={sort === "amount"} dir={dir} align="left" edge onClick={() => onSort("amount")} />
          <div className="flex h-full min-w-0 items-center justify-end px-3 text-right text-[12px] font-medium leading-none text-[var(--muted)]">{t("defi.paid")}</div>
        </div>
        <div className="pool-split">
          <SortBtn label={t("defi.time")} on={sort === "time"} dir={dir} align="left" edge onClick={() => onSort("time")} />
          <div className="flex h-full min-w-0 items-center justify-end px-3 text-right text-[12px] font-medium leading-none text-[var(--muted)]">{t("defi.trader")}</div>
        </div>
        <div className="flex min-w-0 items-center justify-end px-3 text-[var(--muted)]">{t("detail.tx")}</div>
      </div>
      {rows.map((row) => (
        <TradeTapeRow key={row.txId} row={row} locale={locale} t={t} enterClass={enterClass(row.txId)} />
      ))}
    </>
  );
}

function TradeTapeRow({
  row,
  locale,
  t,
  enterClass,
}: {
  row: Trade;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const meta = row.tokenId ? resolveTokenMeta(row.tokenId, null) : null;
  const label = meta?.symbol || (row.tokenId ? shortId(row.tokenId, 4) : "—");
  const sid = row.side.toLowerCase();
  const sideKey = `defi.side.${sid}`;
  const side = t(sideKey) !== sideKey ? t(sideKey) : row.side;
  const buy = sid === "buy";
  const sell = sid === "sell";
  const ergoPaid = isErgBase(row.baseId, null);
  const price = row.tokenAmount > 0 && row.baseAmount > 0 ? row.baseAmount / row.tokenAmount : null;
  return (
    <div className={clsx("addr-lane addr-lane-x pool-tape border-t border-[var(--border-soft)] text-[13px]", enterClass)}>
      <div className="flex min-w-0 items-center px-3">
        {row.tokenId ? (
          <Link href={`/token/${row.tokenId}`} className="flex min-w-0 items-center gap-2">
            <TokenAvatar tokenId={row.tokenId} symbol={meta?.symbol} size={22} />
            <span className="truncate font-semibold" style={{ color: tokenTickerInk(row.tokenId) }}>
              {label}
            </span>
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
      <div className="pool-split">
        <div className="flex h-full min-w-0 items-center px-3">
          <p className={clsx("font-medium lowercase leading-none", buy && "text-[var(--up)]", sell && "text-[#FF4D6D]", !buy && !sell && "text-[var(--muted)]")}>
            {side}
          </p>
        </div>
        <div className="flex h-full min-w-0 items-center justify-end px-3 text-right tabular-nums">
          <PrettyPrice n={price} />
        </div>
      </div>
      <div className="pool-split">
        <div className="min-w-0 px-3 tabular-nums">{fmtAmt(row.tokenAmount)}</div>
        <div className="min-w-0 px-3 text-right tabular-nums text-[var(--up)]">
          {row.baseAmount ? (ergoPaid ? fmtErgFull(row.baseAmount) : fmtAmt(row.baseAmount)) : "—"}
        </div>
      </div>
      <div className="pool-split">
        <AddressActivityWhen ts={row.time} align="left" locale={locale} openLabel={t("addresses.openTx")} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
        <div className="min-w-0 px-3 text-right">
          {row.trader ? (
            <Link href={`/address/${encodeURIComponent(row.trader)}`} className="block truncate font-mono text-[12px] text-accent hover:underline">
              {shortHash(row.trader)}
            </Link>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end px-3">
        <Link href={`/tx/${row.txId}`} className="inline-block whitespace-nowrap font-mono text-accent hover:underline">
          {shortHash(row.txId)}
        </Link>
      </div>
    </div>
  );
}

function LpTape({
  rows,
  locale,
  t,
  miss,
  when,
  sort,
  dir,
  enterClass,
  onSort,
}: {
  rows: LpRow[];
  locale: string;
  t: (k: string) => string;
  miss: string;
  when: { locale: string; openLabel: string; copyLabel: string; copiedLabel: string };
  sort: LpSort;
  dir: Dir;
  enterClass: (id: string) => string | undefined;
  onSort: (k: LpSort) => void;
}) {
  return (
    <>
      <div className="addr-head addr-lane addr-lane-x block-tx-pairs text-[12px] font-medium">
        <div className="block-lane-pair">
          <div className="min-w-0 text-[var(--muted)]">{t("addresses.colAddress")}</div>
          <SortBtn label={t("pool.share")} on={sort === "share"} dir={dir} align="right" onClick={() => onSort("share")} />
        </div>
        <div className="block-lane-pair">
          <SortBtn label={t("pool.implied")} on={sort === "tvl"} dir={dir} align="left" onClick={() => onSort("tvl")} />
          <div className="min-w-0" aria-hidden />
        </div>
        <div className="block-lane-pair">
          <SortBtn label={t("pool.colFirst")} on={sort === "first"} dir={dir} align="left" onClick={() => onSort("first")} />
          <div className="min-w-0" aria-hidden />
        </div>
        <div className="block-lane-pair">
          <SortBtn label={t("pool.lpTxs")} on={sort === "txs"} dir={dir} align="left" onClick={() => onSort("txs")} />
          <SortBtn label={t("pool.colLast")} on={sort === "last"} dir={dir} align="right" onClick={() => onSort("last")} />
        </div>
      </div>
      {rows.map((row) => (
        <div
          key={row.address}
          className={clsx("addr-lane addr-lane-x block-tx-pairs border-t border-[var(--border-soft)] py-2.5 text-[13px]", enterClass(row.address))}
        >
          <div className="block-lane-pair">
            <div className="min-w-0 px-3">
              <Link href={`/address/${encodeURIComponent(row.address)}`} className="block truncate font-mono text-[12px] text-accent hover:underline">
                {shortHash(row.address)}
              </Link>
            </div>
            <div className="px-3 text-right tabular-nums">
              {row.share != null ? `${row.share.toLocaleString(loc(locale), { maximumFractionDigits: 2 })}%` : miss}
            </div>
          </div>
          <div className="block-lane-pair">
            <div className="min-w-0 px-3 tabular-nums font-semibold" style={{ color: INK.gold }}>
              {row.tvlErg != null && row.tvlErg > 0 ? fmtErgFull(row.tvlErg) : miss}
            </div>
            <div className="min-w-0" aria-hidden />
          </div>
          <div className="block-lane-pair addr-act-pair">
            <AddressActivityWhen ts={row.firstTs} align="left" {...when} />
            <div className="min-w-0" aria-hidden />
          </div>
          <div className="block-lane-pair addr-act-pair">
            <div className="px-3 tabular-nums font-semibold" style={{ color: INK.gold }}>
              {row.txCount != null ? row.txCount.toLocaleString(loc(locale)) : miss}
            </div>
            <AddressActivityWhen ts={row.lastTs} align="right" {...when} />
          </div>
        </div>
      ))}
    </>
  );
}

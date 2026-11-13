"use client";

import Link from "next/link";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { TokenLogo } from "@/components/TokenBadge";
import { defiVenueCaption, isErgBase, type PoolBoardRow, type PoolBoardSort } from "@/lib/defi-pools";
import { formatCompact, formatGroupedNumber, formatPct, formatRelTime, formatTs, shortId } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { noteRouteNavigation } from "@/lib/route-nav";
import { resolveTokenMeta } from "@/lib/token-meta";
import { FeedAmount, FeedCount, FeedField, FeedFields, FeedIdLine, FeedPhrase, FeedRow, feedLoc } from "./Feed";

/** «SigUSD/ERG»: the token, then what it trades against. */
export function poolLabel(p: PoolBoardRow): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

function ergText(n: number | null | undefined, tag: string): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return formatGroupedNumber(n, 2, 2, tag);
}

/** Board sort key → the label under the figure. */
export const POOL_SORT_LABEL: Record<PoolBoardSort, string> = {
  tvl: "defi.tvl",
  vol: "spectrum.volume",
  vol24: "feed.sort.vol24",
  trades: "spectrum.trades",
  first: "feed.sort.first",
  last: "feed.sort.last",
};

/**
 * One DEX pool: pair and venue. The figure is always TVL with the 24h volume under it;
 * the key the board is sorted by shows in the facts line.
 */
export function FeedPoolRow({
  row,
  rank,
  sort = "tvl",
  enterClass,
  fav,
}: {
  row: PoolBoardRow;
  rank: number;
  sort?: PoolBoardSort;
  enterClass?: string;
  fav?: { on: boolean; ready: boolean; title: string; toggle: () => void };
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const href = `/defi/pool/${row.poolId}`;
  const venue = defiVenueCaption(row.venue, t);
  const tvl = row.tvlErg > 0 ? ergText(row.tvlErg, tag) : null;
  const vol = ergText(row.volErg, tag);
  const day = row.vol24h != null && row.vol24h > 0 ? ergText(row.vol24h, tag) : null;
  const last = row.lastTs && row.lastTs > 0 ? formatRelTime(row.lastTs, locale) : null;
  const first = row.firstTs && row.firstTs > 0 ? formatRelTime(row.firstTs, locale) : null;
  const tvlNano = row.tvlErg > 0 && Number.isFinite(row.tvlErg) ? BigInt(Math.round(row.tvlErg * 1e9)) : null;
  const day24 =
    row.vol24h != null && row.vol24h > 0
      ? Math.abs(row.vol24h) >= 10_000
        ? formatCompact(row.vol24h, 2, tag)
        : ergText(row.vol24h, tag)
      : null;
  return (
    <FeedRow
      k="defi"
      tile={<TokenLogo tokenId={row.tokenId} size={22} />}
      tileTitle={venue ?? undefined}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        <>
          <Link
            prefetch={false}
            href={href}
            onClick={() => noteRouteNavigation(href)}
            className="feed-name font-semibold hover:underline"
          >
            {poolLabel(row)}
          </Link>
          {fav ? <FavoriteHeart size="sm" on={fav.on} ready={fav.ready} title={fav.title} onToggle={fav.toggle} /> : null}
        </>
      }
      facts={
        <>
          {venue ? <span className="feed-kind">{venue}</span> : null}
          {sort === "vol" && vol ? (
            <span>
              {t("spectrum.volume")} <span className="tabular-nums">{vol}</span>
            </span>
          ) : null}
          {row.trades != null ? (
            <FeedCount k="feed.trades" n={row.trades} className={sort === "trades" ? undefined : "feed-mid"} />
          ) : null}
          {sort === "first" && first ? (
            <span suppressHydrationWarning>
              <FeedPhrase text={t("feed.first")} value={first} />
            </span>
          ) : null}
          {last ? (
            <span className={sort === "last" ? undefined : "feed-wide"} suppressHydrationWarning>
              <FeedPhrase text={t("feed.active")} value={last} />
            </span>
          ) : null}
        </>
      }
      value={<FeedAmount raw={tvlNano} cents />}
      sub={
        <span className="tabular-nums">
          <FeedPhrase text={t("feed.vol24")} value={day24 ?? "—"} slot="{v}" />
        </span>
      }
      detail={() => (
        <FeedFields>
          <FeedField label={t("pool.colPair")} wide>
            <FeedIdLine href={href} id={row.poolId} />
          </FeedField>
          <FeedField label={t("defi.tvl")}>
            <span className="tabular-nums">{tvl ? `${tvl} ERG` : "—"}</span>
          </FeedField>
          <FeedField label={t("spectrum.volume")}>
            <span className="tabular-nums">
              {vol ? `${vol} ERG` : "—"}
              {day ? <span className="text-[var(--muted-2)]"> · {t("pool.colDay")} {day} ERG</span> : null}
            </span>
          </FeedField>
          <FeedField label={t("spectrum.trades")}>
            <span className="tabular-nums">
              {row.trades != null ? row.trades.toLocaleString(tag) : "—"}
              {row.traders != null ? (
                <span className="text-[var(--muted-2)]">
                  {" · "}
                  <FeedCount k="feed.traders" n={row.traders} />
                </span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("pool.colFirst")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.firstTs && row.firstTs > 0 ? formatTs(row.firstTs) : "—"}
              {first ? <span className="text-[var(--muted-2)]"> · {first}</span> : null}
            </span>
          </FeedField>
          <FeedField label={t("pool.colLast")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.lastTs && row.lastTs > 0 ? formatTs(row.lastTs) : "—"}
              {last ? <span className="text-[var(--muted-2)]"> · {last}</span> : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

/** One liquidity provider of a pool, as the pool card's LP tab lists them. */
export type FeedLpHolder = {
  address: string;
  share: number | null;
  tvlErg: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
};

export type FeedLpSort = "share" | "tvl" | "txs" | "first" | "last";

/** LP sort key → its chip label. */
export const LP_SORT_LABEL: Record<FeedLpSort, string> = {
  share: "feed.sort.share",
  tvl: "pool.implied",
  txs: "pool.lpTxs",
  last: "pool.colLast",
  first: "pool.colFirst",
};

/**
 * An LP holder: the address; the share of the pool leads the facts, then LP
 * transactions and when they came in and last moved. The figure is what the share is worth in ERG.
 */
export function FeedLpRow({ row, rank, enterClass }: { row: FeedLpHolder; rank: number; enterClass?: string }) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const href = `/address/${encodeURIComponent(row.address)}`;
  const share =
    row.share != null && Number.isFinite(row.share)
      ? formatPct(row.share, tag)
      : null;
  const erg = row.tvlErg != null && row.tvlErg > 0 ? ergText(row.tvlErg, tag) : null;
  const first = row.firstTs && row.firstTs > 0 ? formatRelTime(row.firstTs, locale) : null;
  const last = row.lastTs && row.lastTs > 0 ? formatRelTime(row.lastTs, locale) : null;
  return (
    <FeedRow
      k="addr"
      glyph="holder"
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        <Link prefetch={false} href={href} title={row.address} className="feed-name font-mono tabular-nums hover:underline">
          {shortId(row.address, 8)}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">
            {t("pool.share")} <span className="tabular-nums">{share ?? "—"}</span>
          </span>
          {row.txCount != null ? (
            <span className="feed-narrow-off">
              {t("pool.lpTxs")} <span className="tabular-nums">{row.txCount.toLocaleString(tag)}</span>
            </span>
          ) : null}
          {last ? (
            <span className="feed-mid" suppressHydrationWarning>
              <FeedPhrase text={t("feed.active")} value={last} />
            </span>
          ) : null}
          {first ? (
            <span className="feed-wide" suppressHydrationWarning>
              <FeedPhrase text={t("feed.first")} value={first} />
            </span>
          ) : null}
        </>
      }
      value={
        <span className="feed-amt tabular-nums">
          {erg ?? "—"}
          {erg ? <span className="feed-unit">ERG</span> : null}
        </span>
      }
      sub={t("pool.implied")}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("addresses.colAddress")} wide>
            <FeedIdLine href={href} id={row.address} />
          </FeedField>
          <FeedField label={t("pool.share")}>
            <span className="tabular-nums">{share ?? "—"}</span>
          </FeedField>
          <FeedField label={t("pool.implied")}>
            <span className="tabular-nums">{erg ? `${erg} ERG` : "—"}</span>
          </FeedField>
          <FeedField label={t("pool.lpTxs")}>
            <span className="tabular-nums">{row.txCount != null ? row.txCount.toLocaleString(tag) : "—"}</span>
          </FeedField>
          <FeedField label={t("pool.colFirst")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.firstTs && row.firstTs > 0 ? formatTs(row.firstTs) : "—"}
              {first ? <span className="text-[var(--muted-2)]"> · {first}</span> : null}
            </span>
          </FeedField>
          <FeedField label={t("pool.colLast")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.lastTs && row.lastTs > 0 ? formatTs(row.lastTs) : "—"}
              {last ? <span className="text-[var(--muted-2)]"> · {last}</span> : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

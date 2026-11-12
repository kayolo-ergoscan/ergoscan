"use client";

import Link from "next/link";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { TokenLogo } from "@/components/TokenBadge";
import { defiVenueCaption, isErgBase, type PoolBoardRow } from "@/lib/defi-pools";
import { formatRelTime, formatTs, shortId } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { noteRouteNavigation } from "@/lib/route-nav";
import { resolveTokenMeta } from "@/lib/token-meta";
import { FeedCount, FeedField, FeedFields, FeedIdLine, FeedPhrase, FeedRow, feedLoc } from "./Feed";

/** «SigUSD/ERG»: the token, then what it trades against. */
export function poolLabel(p: PoolBoardRow): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

function ergText(n: number | null | undefined, tag: string): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** One DEX pool: pair and venue; TVL is the figure, trading is the facts line. */
export function FeedPoolRow({
  row,
  rank,
  enterClass,
  fav,
}: {
  row: PoolBoardRow;
  rank: number;
  enterClass?: string;
  fav?: { on: boolean; ready: boolean; title: string; toggle: () => void };
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const href = `/defi/pool/${row.poolId}`;
  const venue = defiVenueCaption(row.venue, t);
  const tvl = row.tvlErg > 0 ? ergText(row.tvlErg, tag) : null;
  const vol = ergText(row.volErg, tag);
  const day = ergText(row.vol24h, tag);
  const last = row.lastTs && row.lastTs > 0 ? formatRelTime(row.lastTs, locale) : null;
  const first = row.firstTs && row.firstTs > 0 ? formatRelTime(row.firstTs, locale) : null;
  return (
    <FeedRow
      k="defi"
      tile={<TokenLogo tokenId={row.tokenId} size={22} />}
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
          {day ? (
            <span>
              {t("pool.colDay")} <span className="tabular-nums">{day}</span>
            </span>
          ) : null}
          {row.trades != null ? <FeedCount k="feed.trades" n={row.trades} className="feed-mid" /> : null}
          {row.traders != null ? <FeedCount k="feed.traders" n={row.traders} className="feed-wide" /> : null}
          {last ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.active")} value={last} />
            </span>
          ) : null}
        </>
      }
      value={
        <span className="feed-amt tabular-nums" title={tvl ? `${tvl} ERG` : undefined}>
          {tvl ?? "—"}
          {tvl ? <span className="feed-unit">ERG</span> : null}
        </span>
      }
      sub={t("defi.tvl")}
      subMinor
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

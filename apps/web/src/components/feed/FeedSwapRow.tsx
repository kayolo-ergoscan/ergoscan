"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PrettyPrice } from "@/components/PrettyNum";
import { isErgBase } from "@/lib/defi-pools";
import { formatCompact, formatGroupedNumber, formatRelTime, formatTs, shortId } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { resolveTokenMeta } from "@/lib/token-meta";
import {
  FeedAmount,
  FeedBoard,
  FeedCount,
  FeedDays,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedIdLink,
  FeedPlate,
  FeedRow,
  FeedSort,
  feedLoc,
  type FeedKind,
  type FeedLead,
} from "./Feed";
import type { FeedGlyphId } from "./FeedGlyph";

/** One fill on a DEX tape, an LP move or an AgeUSD bank mint/redeem (all share this shape). */
export type FeedSwapEvent = {
  txId: string;
  height?: number | null;
  time: number | null;
  side: string;
  tokenId: string;
  tokenName?: string | null;
  tokenAmount: number;
  baseAmount: number;
  trader: string | null;
  baseId?: string | null;
  baseName?: string | null;
};

export function swapEventId(row: FeedSwapEvent): string {
  return `${row.txId}:${row.side}:${row.tokenId}`;
}

type Side = "buy" | "sell" | "in" | "out" | "other";

function sideOf(raw: string): Side {
  const s = raw.toLowerCase();
  if (s === "buy") return "buy";
  if (s === "sell") return "sell";
  if (s.startsWith("mint") || s === "deposit" || s === "add") return "in";
  if (s.startsWith("redeem") || s === "withdraw" || s === "remove") return "out";
  return "other";
}

const TILE: Record<Side, [FeedKind, FeedGlyphId]> = {
  buy: ["in", "swap"],
  sell: ["out", "swap"],
  in: ["mint", "mint"],
  out: ["burn", "burn"],
  other: ["quiet", "none"],
};

/** Side word: a bank mints and redeems; on a DEX a mint is an LP deposit. */
function sideKey(raw: string, bank: boolean): string {
  const s = raw.toLowerCase();
  const side = sideOf(raw);
  if (bank && side === "in") return "defi.side.mint";
  if (bank && side === "out") return "defi.side.redeem";
  if (s === "mint") return "defi.side.deposit";
  if (s === "redeem") return "defi.side.withdraw";
  return `defi.side.${s}`;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Fixed two decimals; above a million the figure goes compact. */
function amt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 1_000_000 ? formatCompact(n, 2) : formatGroupedNumber(n, 2, 2);
}

function symOf(id: string | null | undefined, name: string | null | undefined): string {
  if (!id || isErgBase(id, null)) return "ERG";
  return resolveTokenMeta(id, name)?.symbol || shortId(id, 4);
}

/** A float amount as nano units, for FeedAmount. */
function nanoOf(n: number): bigint | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 1e9));
}

/**
 * One fill. The side is the tile and the first fact; the counterparty (who traded with
 * the pool or the bank) is the title. What was paid (ERG on most pools) is the figure,
 * the price and how long ago sit under it; the token leg is the second fact.
 */
export function FeedSwapRow({
  row,
  lead,
  bank = false,
  enterClass,
}: {
  row: FeedSwapEvent;
  lead: FeedLead | { rank: ReactNode };
  /** AgeUSD bank words: mint / redeem. */
  bank?: boolean;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const side = sideOf(row.side);
  const [k, glyph] = TILE[side];
  const key = sideKey(row.side, bank);
  const word = cap(t(key) !== key ? t(key) : row.side);
  const sym = symOf(row.tokenId, row.tokenName);
  const baseSym = symOf(row.baseId ?? null, row.baseName ?? null);
  const price = row.tokenAmount > 0 && row.baseAmount > 0 ? row.baseAmount / row.tokenAmount : null;
  const ago = row.time != null ? formatRelTime(row.time, locale) : null;
  const who = row.trader
    ? { href: `/address/${encodeURIComponent(row.trader)}`, id: row.trader }
    : { href: `/tx/${row.txId}`, id: row.txId };
  return (
    <FeedRow
      k={k}
      glyph={glyph}
      tileTitle={word}
      lead={lead}
      enterClass={enterClass}
      title={
        <Link
          prefetch={false}
          href={who.href}
          title={who.id}
          className="feed-name font-mono tabular-nums hover:underline"
        >
          {shortId(who.id, 6)}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">{word}</span>
          {row.tokenAmount > 0 ? (
            <span className="tabular-nums" title={`${formatGroupedNumber(row.tokenAmount, 0, 9)} ${sym}`}>
              {amt(row.tokenAmount)}{" "}
              {row.tokenId ? (
                <Link prefetch={false} href={`/token/${row.tokenId}`} className="hover:underline">
                  {sym}
                </Link>
              ) : (
                sym
              )}
            </span>
          ) : null}
          {row.trader ? (
            <span className="feed-mid">
              <FeedIdLink href={`/tx/${row.txId}`} id={row.txId} />
            </span>
          ) : null}
          {row.height != null ? (
            <Link prefetch={false} href={`/block/${row.height}`} className="feed-wide tabular-nums">
              {row.height.toLocaleString(tag)}
            </Link>
          ) : null}
        </>
      }
      value={<FeedAmount raw={nanoOf(row.baseAmount)} unit={baseSym} glance />}
      sub={
        price != null || ago ? (
          <span className="tabular-nums" suppressHydrationWarning>
            {price != null ? <PrettyPrice n={price} /> : null}
            {price != null && ago ? " · " : null}
            {ago}
          </span>
        ) : null
      }
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.tx")} wide>
            <FeedIdLine href={`/tx/${row.txId}`} id={row.txId} />
          </FeedField>
          {row.trader ? (
            <FeedField label={t("defi.trader")} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(row.trader)}`} id={row.trader} />
            </FeedField>
          ) : null}
          {row.tokenId ? (
            <FeedField label={t("defi.token")} wide>
              <FeedIdLine href={`/token/${row.tokenId}`} id={row.tokenId} />
            </FeedField>
          ) : null}
          <FeedField label={t("defi.amount")}>
            <span className="tabular-nums">
              {formatGroupedNumber(row.tokenAmount, 0, 9)} {sym}
            </span>
          </FeedField>
          <FeedField label={t("defi.paid")}>
            <span className="tabular-nums">
              {row.baseAmount > 0 ? `${formatGroupedNumber(row.baseAmount, 0, 9)} ${baseSym}` : "—"}
            </span>
          </FeedField>
          <FeedField label={t("defi.price")}>
            <span className="tabular-nums">
              {price != null ? (
                <>
                  <PrettyPrice n={price} /> {baseSym}
                </>
              ) : (
                "—"
              )}
            </span>
          </FeedField>
          <FeedField label={t("defi.time")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.time != null ? formatTs(row.time) : "—"}
              {row.height != null ? (
                <span className="text-[var(--muted-2)]">
                  {" · "}
                  <Link prefetch={false} href={`/block/${row.height}`} className="hover:underline">
                    {row.height.toLocaleString(tag)}
                  </Link>
                </span>
              ) : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

/** A top trader: the address, how many fills, the ERG they moved. Narrow enough for a side column. */
export function FeedTraderRow({
  trader,
  erg,
  deals,
  rank,
  enterClass,
}: {
  trader: string;
  erg: number;
  deals?: number | null;
  rank: number;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const href = `/address/${encodeURIComponent(trader)}`;
  const figure = Number.isFinite(erg) ? (Math.abs(erg) >= 10_000 ? formatCompact(erg, 2) : formatGroupedNumber(erg, 2, 2)) : "—";
  return (
    <FeedRow
      k="addr"
      glyph="holder"
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        <Link prefetch={false} href={href} title={trader} className="feed-name font-mono tabular-nums hover:underline">
          {shortId(trader, 6)}
        </Link>
      }
      facts={deals != null ? <FeedCount k="feed.trades" n={deals} /> : undefined}
      value={
        <span className="feed-amt tabular-nums" title={`${formatGroupedNumber(erg, 2, 9)} ERG`}>
          {figure}
          <span className="feed-unit">ERG</span>
        </span>
      }
      detail={() => (
        <FeedFields>
          <FeedField label={t("defi.trader")} wide>
            <FeedIdLine href={href} id={trader} />
          </FeedField>
          <FeedField label={t("stable.topSum")}>
            <span className="tabular-nums">{formatGroupedNumber(erg, 2, 9)} ERG</span>
          </FeedField>
          {deals != null ? (
            <FeedField label={t("spectrum.trades")}>
              <span className="tabular-nums">{deals.toLocaleString(tag)}</span>
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

/**
 * A tape of fills. By time it reads as days with clock leads (the sort chips ride on the
 * first day plate); by any other key it is one ranked board.
 */
export function FeedSwapTape<K extends string>({
  rows,
  tag,
  total,
  sort,
  dir,
  timeKey,
  sorts,
  onSort,
  pending = false,
  offset = 0,
  bank = false,
  enterClass,
}: {
  rows: FeedSwapEvent[];
  tag: string;
  total?: number | null;
  sort: K;
  dir: "asc" | "desc";
  timeKey: K;
  sorts: { key: K; label: string }[];
  onSort: (key: K) => void;
  pending?: boolean;
  offset?: number;
  bank?: boolean;
  enterClass: (id: string) => string | undefined;
}) {
  const { t, locale } = useI18n();
  const chips = (
    <FeedSort label={t("feed.sort.label")} options={sorts} active={sort} dir={dir} onSort={onSort} disabled={pending} />
  );
  if (sort === timeKey) {
    return (
      <FeedDays
        items={rows}
        msOf={(row) => row.time}
        seconds
        countOf={(n) => <FeedCount k="feed.trades" n={n} />}
        totalOf={(day) => (day[0] === rows[0] ? chips : undefined)}
        render={(row, lead) => (
          <FeedSwapRow
            key={swapEventId(row)}
            row={row}
            lead={lead}
            bank={bank}
            enterClass={enterClass(swapEventId(row))}
          />
        )}
      />
    );
  }
  return (
    <FeedBoard
      plate={
        <FeedPlate
          tag={tag}
          now
          count={total != null ? <FeedCount k="feed.trades" n={total} /> : undefined}
          end={chips}
        />
      }
    >
      {rows.map((row, i) => (
        <FeedSwapRow
          key={swapEventId(row)}
          row={row}
          lead={{ rank: (offset + i + 1).toLocaleString(feedLoc(locale)) }}
          bank={bank}
          enterClass={enterClass(swapEventId(row))}
        />
      ))}
    </FeedBoard>
  );
}

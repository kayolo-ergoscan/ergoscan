"use client";

import { pageInk } from "@/lib/look";
import { isLightInk } from "@/lib/skin-ink";
import { useInk } from "@/lib/use-ink";
import type { CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { collectableRentNano } from "@ergoscan/shared";
import { TokenLogo } from "@/components/TokenBadge";
import { lookupAddress } from "@/lib/address-book";
import { formatRelTime, formatScaledAmount, formatTs, shortId, toBigIntAmt, toEpochMs } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import type { RentBoxRow, RentPageData } from "@/lib/list-snapshots";
import { dangerHoldingUsd, type RentDangerRow } from "@/lib/rent-danger";
import { formatRentSharePct, type RentMinerRow } from "@/lib/rent-miner-pools";
import { rentRowTone } from "@/lib/rent-row-tone";
import { resolveTokenMeta, tokenAtRisk } from "@/lib/token-meta";
import {
  FeedAmount,
  FeedCount,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedIdLink,
  FeedPhrase,
  FeedRow,
  FeedTokenChips,
  feedLoc,
  type FeedKind,
  type FeedLead,
} from "./Feed";

type Lead = FeedLead | { rank: string };

/** Due now · soon · later: the tile says how close the collector is. */
const TONE_KIND: Record<ReturnType<typeof rentRowTone>, FeedKind> = {
  due: "rent",
  soon: "reward",
  later: "in",
};

function bigOf(v: string | number | null | undefined): bigint {
  try {
    return toBigIntAmt(v ?? "0");
  } catch {
    return 0n;
  }
}

function dueText(blocks: number, due: boolean, t: (k: string) => string, locale: string): string {
  if (due || blocks <= 0) return t("rent.status.waiting");
  return countText(t, locale, "rent.status.inBlocks", blocks, blocks.toLocaleString(feedLoc(locale)));
}

/** Tokens that go with the box when rent eats it: logo and ticker, no amounts (the list has none). */
function RiskChips({ tokens }: { tokens: { tokenId: string; name: string | null }[] }) {
  if (!tokens.length) return null;
  return (
    <span className="feed-chip-run">
      {tokens.slice(0, 2).map((tok, i) => {
        const meta = resolveTokenMeta(tok.tokenId, null, tok.name);
        return (
          <Link
            prefetch={false}
            key={tok.tokenId}
            href={`/token/${encodeURIComponent(tok.tokenId)}`}
            title={meta.name}
            className={clsx("feed-chip", i > 0 && "feed-chip-2")}
          >
            <TokenLogo tokenId={tok.tokenId} size={16} />
            <span className="feed-chip-sym">{meta.symbol}</span>
          </Link>
        );
      })}
      {tokens.length > 2 ? (
        <span className="feed-chip is-plain feed-more-wide tabular-nums">+{tokens.length - 2}</span>
      ) : null}
      {tokens.length > 1 ? (
        <span className="feed-chip is-plain feed-more-narrow tabular-nums">+{tokens.length - 1}</span>
      ) : null}
    </span>
  );
}

/** The node takes the whole box, tokens too, when it holds no more than its fee (value ≤ fee). */
function cannotPay(row: RentBoxRow): boolean {
  return bigOf(row.valueNano) <= bigOf(row.rentNano);
}

/**
 * A box the storage-rent collector reaches soonest. The figure is the rent it gives up;
 * what it holds is under it, and the tokens it loses are chips.
 */
export function FeedRentRow({
  row,
  rank,
  enterClass,
}: {
  row: RentBoxRow;
  rank: number;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const name = row.address ? lookupAddress(row.address)?.name?.trim() || null : null;
  const href = row.address ? `/address/${encodeURIComponent(row.address)}` : `/box/${row.boxId}`;
  const status = dueText(row.blocksUntilRent, row.rentDue, t, locale);
  const rent = bigOf(collectableRentNano(row.rentNano, row.valueNano));
  const held = bigOf(row.valueNano);
  const risk = cannotPay(row) ? (row.tokens ?? []).filter((tok) => tokenAtRisk(tok.tokenId, tok.priceUsd)) : [];
  const created = row.creationTs != null ? formatRelTime(row.creationTs, locale) : null;
  return (
    <FeedRow
      k={TONE_KIND[rentRowTone(row)]}
      glyph="rent"
      tileTitle={status}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        <Link
          prefetch={false}
          href={href}
          title={row.address || row.boxId}
          className={clsx("feed-name hover:underline", name ? "font-semibold" : "font-mono tabular-nums")}
        >
          {name ?? (row.address ? shortId(row.address, 8) : shortId(row.boxId, 8))}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">{status}</span>
          {name && row.address ? (
            <span className="feed-narrow-off font-mono tabular-nums" title={row.address}>
              {shortId(row.address, 6)}
            </span>
          ) : null}
          <span className="feed-mid">
            {t("tx.box")} <FeedIdLink href={`/box/${row.boxId}`} id={row.boxId} />
          </span>
          {created ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.created")} value={created} />
            </span>
          ) : null}
        </>
      }
      chips={risk.length ? <RiskChips tokens={risk} /> : null}
      value={<FeedAmount raw={rent} />}
      sub={
        <>
          {t("rent.colValue")} <span className="tabular-nums">{formatScaledAmount(held, 9, tag)}</span>
        </>
      }
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.box")} wide>
            <FeedIdLine href={`/box/${row.boxId}`} id={row.boxId} />
          </FeedField>
          {row.address ? (
            <FeedField label={t("detail.address")} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(row.address)}`} id={row.address} />
            </FeedField>
          ) : null}
          <FeedField label={t("rent.colStatus")}>
            <span className="tabular-nums">{status}</span>
          </FeedField>
          <FeedField label={t("rent.colRent")}>
            <span className="tabular-nums">{formatScaledAmount(rent, 9, tag, 9)} ERG</span>
          </FeedField>
          <FeedField label={t("rent.colValue")}>
            <span className="tabular-nums">{formatScaledAmount(held, 9, tag, 9)} ERG</span>
          </FeedField>
          <FeedField label={t("rent.colCreated")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.creationTs != null ? formatTs(row.creationTs) : "—"}
              <span className="text-[var(--muted-2)]">
                {" · "}
                <Link prefetch={false} href={`/block/${row.creationHeight}`} className="hover:underline">
                  {row.creationHeight.toLocaleString(tag)}
                </Link>
              </span>
            </span>
          </FeedField>
          {risk.length ? (
            <FeedField label={t("rent.colSeized")} wide>
              <span className="feed-id-run">
                {risk.map((tok) => {
                  const meta = resolveTokenMeta(tok.tokenId, null, tok.name);
                  return (
                    <Link
                      prefetch={false}
                      key={tok.tokenId}
                      href={`/token/${encodeURIComponent(tok.tokenId)}`}
                      className="hover:underline"
                      title={tok.tokenId}
                    >
                      {meta.symbol}
                    </Link>
                  );
                })}
              </span>
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

/** A token that leaves with a box that cannot pay its rent: dollars at risk on the right. */
export function FeedRentDangerRow({
  row,
  rank,
  enterClass,
}: {
  row: RentDangerRow;
  rank: number;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const meta = resolveTokenMeta(row.tokenId, null, row.name);
  const usd = dangerHoldingUsd(row);
  const usdText = !Number.isFinite(usd) || usd <= 0
    ? "—"
    : usd >= 1000
      ? `$${Math.round(usd).toLocaleString(tag)}`
      : usd >= 1
        ? `$${usd.toFixed(2)}`
        : `$${usd.toFixed(4)}`;
  const status = dueText(row.blocksUntilRent, false, t, locale);
  /* Two short lines that fit a 360 px phone in Russian: name · "in N blocks" | short X ERG. */
  const soon =
    row.blocksUntilRent > 0
      ? countText(t, locale, "feed.rent.inBlocks", row.blocksUntilRent, row.blocksUntilRent.toLocaleString(tag))
      : t("rent.status.waiting");
  const short = bigOf(row.shortfallNano);
  const amount = bigOf(row.amount);
  const dec = row.decimals ?? 0;
  const project = meta.name && meta.name !== meta.symbol ? meta.name : null;
  const [riskPre = "", riskPost = ""] = t("rent.danger.usd").split("{n}");
  return (
    <FeedRow
      k={TONE_KIND[rentRowTone({ rentDue: false, blocksUntilRent: row.blocksUntilRent })]}
      tile={<TokenLogo tokenId={row.tokenId} size={22} />}
      tileTitle={meta.name}
      lead={{ rank: rank.toLocaleString(tag) }}
      className="is-danger"
      enterClass={enterClass}
      title={
        <Link
          prefetch={false}
          href={`/token/${row.tokenId}`}
          title={meta.name ? `${meta.name} · ${row.tokenId}` : row.tokenId}
          className="feed-name font-semibold hover:underline"
        >
          {meta.symbol}
        </Link>
      }
      facts={
        <>
          {project ? <span>{project}</span> : null}
          <Link prefetch={false} href={`/box/${row.boxId}`} title={status} className="feed-kind feed-wrap tabular-nums hover:underline">
            {soon}
          </Link>
          <span className="feed-wide tabular-nums" title={formatScaledAmount(amount, dec, tag, dec)}>
            {formatScaledAmount(amount, dec, tag)}
          </span>
        </>
      }
      value={
        <span className="feed-amt is-down tabular-nums">
          {riskPre.trim() ? <span className="feed-unit">{riskPre.trim()} </span> : null}
          {usdText}
          {riskPost.trim() ? <span className="feed-unit">{riskPost.trim()}</span> : null}
        </span>
      }
      sub={t("rent.danger.short").replace("{n}", formatScaledAmount(short, 9, tag))}
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.token")} wide>
            <FeedIdLine href={`/token/${row.tokenId}`} id={row.tokenId} />
          </FeedField>
          <FeedField label={t("detail.box")} wide>
            <FeedIdLine href={`/box/${row.boxId}`} id={row.boxId} />
          </FeedField>
          {row.address ? (
            <FeedField label={t("detail.address")} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(row.address)}`} id={row.address} />
            </FeedField>
          ) : null}
          <FeedField label={t("address.colAmount")}>
            <span className="tabular-nums">{formatScaledAmount(amount, dec, tag, dec)}</span>
          </FeedField>
          <FeedField label={t("rent.colRent")}>
            <span className="tabular-nums">{formatScaledAmount(bigOf(row.rentNano), 9, tag, 9)} ERG</span>
          </FeedField>
          <FeedField label={t("rent.colValue")}>
            <span className="tabular-nums">
              {formatScaledAmount(bigOf(row.valueNano), 9, tag, 9)} ERG
              <span className="text-[var(--muted-2)]"> · {t("rent.danger.short").replace("{n}", formatScaledAmount(short, 9, tag, 9))}</span>
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

export type RentClaim = NonNullable<NonNullable<RentPageData["collected"]>["recent"]>[number];

/** Who collected (or renewed) a rent box, newest first: the rent taken is the figure. */
export function FeedRentClaimRow({
  row,
  lead,
  enterClass,
}: {
  row: RentClaim;
  lead: Lead;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const collector = row.collector?.trim() || "";
  const owner = row.owner?.trim() || "";
  const who = collector || owner || null;
  const renewed = !collector && !!owner;
  const name = who ? lookupAddress(who)?.name?.trim() || null : null;
  const status = renewed ? t("rent.status.renewed") : t("rent.status.collected");
  const taken = (row.tokens ?? [])
    .filter((tok) => tokenAtRisk(tok.tokenId))
    .map((tok) => [tok.tokenId.toLowerCase(), bigOf(tok.amount)] as [string, bigint])
    .filter(([, n]) => n !== 0n);
  const metaOf = (tid: string) => {
    const tok = row.tokens?.find((x) => x.tokenId.toLowerCase() === tid);
    return tok ? { name: tok.name, decimals: tok.decimals ?? 0 } : undefined;
  };
  const showLead = !("rank" in lead) && !lead.same;
  return (
    <FeedRow
      k={renewed ? "self" : "rent"}
      glyph={renewed ? "self" : "rent"}
      tileTitle={status}
      lead={lead}
      leadSub={
        showLead ? (
          <Link prefetch={false} href={`/block/${row.spentHeight}`} className="tabular-nums">
            {row.spentHeight.toLocaleString(tag)}
          </Link>
        ) : undefined
      }
      enterClass={enterClass}
      title={
        who ? (
          <Link
            prefetch={false}
            href={`/address/${encodeURIComponent(who)}`}
            title={who}
            className={clsx("feed-name hover:underline", name ? "font-semibold" : "font-mono tabular-nums")}
          >
            {name ?? shortId(who, 8)}
          </Link>
        ) : (
          <Link
            prefetch={false}
            href={`/box/${row.boxId}`}
            title={row.boxId}
            className="feed-name text-[var(--muted)] hover:underline"
          >
            {t("rent.poolsUncovered")}
          </Link>
        )
      }
      facts={
        <>
          <span className="feed-kind">{status}</span>
          <span className="feed-mid">
            {t("tx.box")} <FeedIdLink href={`/box/${row.boxId}`} id={row.boxId} />
          </span>
          <Link prefetch={false} href={`/block/${row.spentHeight}`} className="feed-phone-only tabular-nums">
            {row.spentHeight.toLocaleString(tag)}
          </Link>
        </>
      }
      chips={taken.length ? <FeedTokenChips tokens={taken} meta={metaOf} signed={false} /> : null}
      value={<FeedAmount raw={bigOf(row.rentNano)} />}
      sub={
        row.valueNano ? (
          <>
            {t("rent.colValue")} <span className="tabular-nums">{formatScaledAmount(bigOf(row.valueNano), 9, tag)}</span>
          </>
        ) : null
      }
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.box")} wide>
            <FeedIdLine href={`/box/${row.boxId}`} id={row.boxId} />
          </FeedField>
          {who ? (
            <FeedField label={renewed ? t("rent.colOwner") : t("rent.colWho")} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(who)}`} id={who} />
            </FeedField>
          ) : null}
          {row.spentTxId ? (
            <FeedField label={t("detail.tx")} wide>
              <FeedIdLine href={`/tx/${row.spentTxId}`} id={row.spentTxId} />
            </FeedField>
          ) : null}
          <FeedField label={t("rent.colRent")}>
            <span className="tabular-nums">{formatScaledAmount(bigOf(row.rentNano), 9, tag, 9)} ERG</span>
          </FeedField>
          <FeedField label={t("rent.colWhen")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {toEpochMs(row.spentTs) != null ? formatTs(row.spentTs ?? 0) : "—"}
              <span className="text-[var(--muted-2)]">
                {" · "}
                <Link prefetch={false} href={`/block/${row.spentHeight}`} className="hover:underline">
                  {row.spentHeight.toLocaleString(tag)}
                </Link>
              </span>
            </span>
          </FeedField>
          {taken.length ? (
            <FeedField label={t("rent.colSeized")} wide>
              <FeedTokenChips tokens={taken} meta={metaOf} signed={false} max={taken.length} />
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

/**
 * One collector of the "who took it" donut: its slice colour leads the name, the ERG it
 * took is the figure. A pool with several payout addresses lists them all in the detail.
 */
export function FeedRentPoolRow({
  row,
  rank,
  enterClass,
}: {
  row: RentMinerRow;
  rank: number;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const light = isLightInk(useInk());
  const tag = feedLoc(locale);
  const named = !!row.address && row.name !== row.address;
  const pct = formatRentSharePct(row.share);
  const rent = bigOf(row.rentNano);
  const href = row.address ? `/address/${encodeURIComponent(row.address)}` : null;
  const label = named ? row.name : row.address ? shortId(row.address, 8) : row.name || t("rent.poolsUncovered");
  const nameCls = clsx(
    "feed-name",
    href && "hover:underline",
    named || !row.address ? "font-semibold" : "font-mono tabular-nums"
  );
  return (
    <FeedRow
      k={row.kind === "pool" ? "block" : "quiet"}
      glyph="block"
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        <>
          <span className="feed-ink" style={{ "--ink": pageInk(row.ink, light) } as CSSProperties} aria-hidden />
          {href ? (
            <Link prefetch={false} href={href} title={row.address ?? undefined} className={nameCls}>
              {label}
            </Link>
          ) : (
            <span className={nameCls}>{label}</span>
          )}
        </>
      }
      facts={
        <>
          <span className="feed-kind tabular-nums">{t("feed.rent.share").replace("{pct}", pct)}</span>
          {named && row.address ? (
            <span className="feed-narrow-off font-mono tabular-nums" title={row.address}>
              {shortId(row.address, 6)}
            </span>
          ) : null}
          {row.addresses.length > 1 ? (
            <FeedCount k="feed.addresses" n={row.addresses.length} className="feed-mid" />
          ) : null}
        </>
      }
      value={<FeedAmount raw={rent} glance />}
      sub={<FeedCount k="feed.boxes" n={row.boxCount} />}
      subMinor
      detail={() => (
        <FeedFields>
          {row.addresses.map((addr, i) => (
            <FeedField key={addr} label={i === 0 ? t("detail.address") : ""} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(addr)}`} id={addr} />
            </FeedField>
          ))}
          <FeedField label={t("rent.colRent")}>
            <span className="tabular-nums">{formatScaledAmount(rent, 9, tag, 9)} ERG</span>
          </FeedField>
          <FeedField label={t("feed.sort.share")}>
            <span className="tabular-nums">{pct}</span>
          </FeedField>
          <FeedField label={t("rent.chartBoxes")}>
            <span className="tabular-nums">{row.boxCount.toLocaleString(tag)}</span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

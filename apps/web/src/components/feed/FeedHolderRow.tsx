"use client";

import Link from "next/link";
import clsx from "clsx";
import { Tip, TipFigure } from "@/components/Tip";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { prefetchAddressPage } from "@/lib/address-page-cache";
import { listPip, type ListPipId } from "@/lib/address-pips";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatEmissionGlance, formatRelTime, formatScaledAmount, formatScaledGlance, formatTs, shortId, toBigIntAmt } from "@/lib/format";
import { FeedAmount, FeedCount, FeedField, FeedFields, FeedIdLine, FeedMeter, FeedPhrase, FeedRow, feedLoc, type FeedKind } from "./Feed";
import type { FeedGlyphId } from "./FeedGlyph";

const PIP_TILE: Record<ListPipId, [FeedKind, FeedGlyphId]> = {
  holder: ["addr", "holder"],
  contract: ["contract", "contract"],
  exchange: ["exchange", "exchange"],
  pool: ["reward", "reward"],
  protocol: ["defi", "protocol"],
};

export type FeedHolder = {
  address: string;
  amount: number | string;
  nanoerg?: string | null;
  sharePct?: number | null;
  boxes?: number | null;
  txCount?: number | null;
  tokenCount?: number | null;
  firstTs?: number | null;
  lastTs?: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

function shareText(pct: number | null | undefined, tag: string): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** One address on a ranked holder list: what it is, how much it holds, its share as a level. */
export function FeedHolderRow({
  row,
  rank,
  decimals,
  enterClass,
  fav,
}: {
  row: FeedHolder;
  rank: number;
  decimals: number;
  enterClass?: string;
  fav: { on: boolean; ready: boolean; toggle: (address: string) => void };
}) {
  const { t, tn, locale } = useI18n();
  const tag = feedLoc(locale);
  const nano = row.nanoerg ?? "0";
  const pip = listPip(row.address, nano);
  const [k, g] = PIP_TILE[pip.id];
  const kindLabel = t(`addresses.pip.${pip.id}`);
  const href = `/address/${encodeURIComponent(row.address)}`;
  let raw = 0n;
  try {
    raw = toBigIntAmt(row.amount);
  } catch {
    raw = 0n;
  }
  const held = formatEmissionGlance(raw, decimals, tag);
  let ergRaw: bigint | null = null;
  try {
    ergRaw = row.nanoerg != null && row.nanoerg !== "" ? toBigIntAmt(row.nanoerg) : null;
  } catch {
    ergRaw = null;
  }
  const erg = ergRaw != null ? formatScaledGlance(ergRaw, 9, tag) : null;
  const share = shareText(row.sharePct, tag);
  const active = row.lastTs != null ? formatRelTime(row.lastTs, locale) : null;
  const created = row.firstTs != null ? formatRelTime(row.firstTs, locale) : null;
  return (
    <FeedRow
      k={k}
      glyph={g}
      tileTitle={kindLabel}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      onPointerEnter={() => prefetchAddressPage(row.address)}
      title={
        <>
          <Link
            prefetch={false}
            href={href}
            title={row.address}
            className={clsx("feed-name hover:underline", !pip.name && "font-mono tabular-nums")}
            onFocus={() => prefetchAddressPage(row.address)}
          >
            {pip.name ?? shortId(row.address, 8)}
          </Link>
          <FavoriteHeart
            size="sm"
            on={fav.on}
            ready={fav.ready}
            title={fav.on ? t("favorites.remove") : t("favorites.add")}
            onToggle={() => fav.toggle(row.address)}
          />
        </>
      }
      facts={
        <>
          <span className="feed-kind">{kindLabel}</span>
          {pip.name ? <span className="font-mono tabular-nums">{shortId(row.address, 6)}</span> : null}
          {row.txCount != null ? <FeedCount k="feed.txCount" n={row.txCount} /> : null}
          {active ? (
            row.lastTxId ? (
              <Link prefetch={false} href={`/tx/${row.lastTxId}`} className="feed-mid">
                <FeedPhrase text={t("feed.active")} value={active} />
              </Link>
            ) : (
              <span className="feed-mid">
                <FeedPhrase text={t("feed.active")} value={active} />
              </span>
            )
          ) : null}
          {erg ? (
            <Tip content={erg.exact !== erg.text ? () => <TipFigure>{erg.exact} ERG</TipFigure> : null}>
              <span className="feed-wide">
                <span className="tabular-nums">{erg.text}</span> ERG
              </span>
            </Tip>
          ) : null}
        </>
      }
      chips={<FeedMeter pct={row.sharePct ?? 0} label={share} title={`${t("token.colShare")} ${share}`} />}
      value={
        <Tip tap={false} content={held.exact !== held.text ? () => <TipFigure>{held.exact}</TipFigure> : null}>
          <span className="feed-amt tabular-nums">{held.text}</span>
        </Tip>
      }
      detail={() => (
        <FeedFields>
          <FeedField label={t("token.colAddress")} wide>
            <FeedIdLine href={href} id={row.address} />
          </FeedField>
          <FeedField label={t("token.colAmount")}>
            <span className="tabular-nums">{formatScaledAmount(raw, decimals, tag)}</span>
          </FeedField>
          <FeedField label={t("token.colShare")}>
            <span className="tabular-nums">{share}</span>
          </FeedField>
          <FeedField label={kindLabel}>
            <span>{[pip.name, pip.note].filter(Boolean).join(" · ") || "—"}</span>
          </FeedField>
          <FeedField label={t("addresses.colErg")}>
            <span className="tabular-nums">{ergRaw != null ? formatScaledAmount(ergRaw, 9, tag) : "—"}</span>
          </FeedField>
          <FeedField label={t("addresses.colTxs")}>
            <span className="tabular-nums">
              {row.txCount != null ? row.txCount.toLocaleString(tag) : "—"}
              {row.tokenCount != null ? (
                <span className="text-[var(--muted-2)]"> · {tn("feed.tokens", row.tokenCount, row.tokenCount.toLocaleString(tag))}</span>
              ) : null}
              {row.boxes != null ? (
                <span className="text-[var(--muted-2)]"> · {tn("feed.boxes", row.boxes, row.boxes.toLocaleString(tag))}</span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("addresses.colFirst")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.firstTs != null ? formatTs(row.firstTs) : "—"}
              {created ? <span className="text-[var(--muted-2)]"> · {created}</span> : null}
              {row.firstTxId ? (
                <>
                  {" · "}
                  <Link prefetch={false} href={`/tx/${row.firstTxId}`} className="font-mono hover:underline">
                    {shortId(row.firstTxId, 6)}
                  </Link>
                </>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("addresses.colLast")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.lastTs != null ? formatTs(row.lastTs) : "—"}
              {active ? <span className="text-[var(--muted-2)]"> · {active}</span> : null}
              {row.lastTxId ? (
                <>
                  {" · "}
                  <Link prefetch={false} href={`/tx/${row.lastTxId}`} className="font-mono hover:underline">
                    {shortId(row.lastTxId, 6)}
                  </Link>
                </>
              ) : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

export type FeedAddressSort = "erg" | "tokens" | "txs" | "first" | "last" | "address";

export type FeedAddress = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

function nanoOf(v: string | null | undefined): bigint | null {
  if (v == null || v === "") return null;
  try {
    return toBigIntAmt(v);
  } catch {
    return null;
  }
}

/** When it was first or last seen, with the tx that did it. */
function WhenField({
  label,
  ts,
  txId,
  rel,
}: {
  label: string;
  ts: number | null | undefined;
  txId: string | null | undefined;
  rel: string | null;
}) {
  return (
    <FeedField label={label}>
      <span className="tabular-nums" suppressHydrationWarning>
        {ts != null ? formatTs(ts) : "—"}
        {rel ? <span className="text-[var(--muted-2)]"> · {rel}</span> : null}
        {txId ? (
          <>
            {" · "}
            <Link prefetch={false} href={`/tx/${txId}`} className="font-mono hover:underline">
              {shortId(txId, 6)}
            </Link>
          </>
        ) : null}
      </span>
    </FeedField>
  );
}

/**
 * One address on a ranked list (/addresses, saved addresses): what it is,
 * named when it has a name. The figure on the right is what the list is
 * sorted by, ERG by default.
 */
export function FeedAddressRow({
  row,
  rank,
  sort = "erg",
  enterClass,
  fav,
}: {
  row: FeedAddress;
  rank: number;
  sort?: FeedAddressSort;
  enterClass?: string;
  fav: { on: boolean; ready: boolean; toggle: (address: string) => void };
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const nano = row.nanoerg ?? "0";
  const pip = listPip(row.address, nano);
  const [k, g] = PIP_TILE[pip.id];
  const kindLabel = t(`addresses.pip.${pip.id}`);
  const href = `/address/${encodeURIComponent(row.address)}`;
  const ergRaw = nanoOf(row.nanoerg);
  const active = row.lastTs != null ? formatRelTime(row.lastTs, locale) : null;
  const created = row.firstTs != null ? formatRelTime(row.firstTs, locale) : null;
  const key: FeedAddressSort = sort === "address" ? "erg" : sort;
  const value =
    key === "tokens" ? (
      <span className="feed-amt tabular-nums">{row.tokenCount != null ? row.tokenCount.toLocaleString(tag) : "—"}</span>
    ) : key === "txs" ? (
      <span className="feed-amt tabular-nums">{row.txCount != null ? row.txCount.toLocaleString(tag) : "—"}</span>
    ) : key === "first" || key === "last" ? (
      <span className="feed-amt tabular-nums" suppressHydrationWarning>
        {(key === "first" ? created : active) ?? "—"}
      </span>
    ) : (
      <FeedAmount raw={ergRaw} cents />
    );
  return (
    <FeedRow
      k={k}
      glyph={g}
      tileTitle={kindLabel}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      onPointerEnter={() => prefetchAddressPage(row.address)}
      title={
        <>
          <Link
            prefetch={false}
            href={href}
            title={row.address}
            className={clsx("feed-name hover:underline", !pip.name && "font-mono tabular-nums")}
            onFocus={() => prefetchAddressPage(row.address)}
          >
            {pip.name ?? shortId(row.address, 8)}
          </Link>
          <FavoriteHeart
            size="sm"
            on={fav.on}
            ready={fav.ready}
            title={fav.on ? t("favorites.remove") : t("favorites.add")}
            onToggle={() => fav.toggle(row.address)}
          />
        </>
      }
      facts={
        <>
          <span className="feed-kind">{kindLabel}</span>
          {pip.name ? <span className="font-mono tabular-nums">{shortId(row.address, 6)}</span> : null}
          {key !== "txs" && row.txCount != null ? <FeedCount k="feed.txCount" n={row.txCount} /> : null}
          {key !== "tokens" && row.tokenCount ? <FeedCount k="feed.tokens" n={row.tokenCount} className="feed-mid" /> : null}
          {key !== "last" && active ? (
            row.lastTxId ? (
              <Link prefetch={false} href={`/tx/${row.lastTxId}`} className="feed-mid">
                <FeedPhrase text={t("feed.active")} value={active} />
              </Link>
            ) : (
              <span className="feed-mid">
                <FeedPhrase text={t("feed.active")} value={active} />
              </span>
            )
          ) : null}
          {key !== "first" && created ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.created")} value={created} />
            </span>
          ) : null}
          {key !== "erg" && ergRaw != null ? (
            <Tip content={() => <TipFigure>{formatScaledAmount(ergRaw, 9, tag)} ERG</TipFigure>}>
              <span className="feed-wide">
                <span className="tabular-nums">{formatScaledGlance(ergRaw, 9, tag).text}</span> ERG
              </span>
            </Tip>
          ) : null}
        </>
      }
      value={value}
      sub={key === "erg" ? undefined : t(`feed.sort.${key}`)}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("addresses.colAddress")} wide>
            <FeedIdLine href={href} id={row.address} />
          </FeedField>
          <FeedField label={t("addresses.colErg")}>
            <span className="tabular-nums">{ergRaw != null ? formatScaledAmount(ergRaw, 9, tag) : "—"}</span>
          </FeedField>
          <FeedField label={kindLabel}>
            <span>{[pip.name, pip.note].filter(Boolean).join(" · ") || "—"}</span>
          </FeedField>
          <FeedField label={t("addresses.colTxs")}>
            <span className="tabular-nums">
              {row.txCount != null ? row.txCount.toLocaleString(tag) : "—"}
              {row.tokenCount != null ? (
                <span className="text-[var(--muted-2)]">
                  {" · "}
                  <FeedCount k="feed.tokens" n={row.tokenCount} />
                </span>
              ) : null}
            </span>
          </FeedField>
          <WhenField label={t("addresses.colFirst")} ts={row.firstTs} txId={row.firstTxId} rel={created} />
          <WhenField label={t("addresses.colLast")} ts={row.lastTs} txId={row.lastTxId} rel={active} />
        </FeedFields>
      )}
    />
  );
}

"use client";

import Link from "next/link";
import clsx from "clsx";
import { Tip } from "@/components/Tip";
import type { ReactNode } from "react";
import { TokenLogo } from "@/components/TokenBadge";
import { PrettyUsd } from "@/components/PrettyNum";
import { describeParty } from "@/lib/address-labels";
import { formatScaledAmount, shortId } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { tokenDecimals, tokenSymbol } from "@/lib/token-meta";
import type { Party } from "@/lib/tx-flow";
import {
  FeedAmount,
  FeedCount,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedIdLink,
  FeedRow,
  FeedTokenChips,
  feedLoc,
  type FeedKind,
  type FeedLead,
  type FeedTokenMeta,
} from "./Feed";
import type { FeedGlyphId } from "./FeedGlyph";

type Lead = FeedLead | { rank: ReactNode };
type MetaOf = (tid: string) => FeedTokenMeta | undefined;

const neg = (rows: [string, bigint][]): [string, bigint][] => rows.map(([tid, n]) => [tid, -n]);

/** Owner of an address in a few words: a book name, else the type. */
function ownerType(address: string | null, fee: boolean, t: (k: string) => string): { type: string; name: string | null } {
  const d = describeParty(address, fee);
  if (fee) return { type: t("tx.minerFee"), name: d.known };
  const type = d.kind === "wallet" ? t("addresses.pip.holder") : t(`address.type.${d.kind}`);
  return { type: type.startsWith("address.type.") ? t("address.type.unknown") : type, name: d.known };
}

/**
 * One box: ERG is the figure, its tokens are chips. On an address the box is the title;
 * in a transaction the owner is, and the box id is a fact.
 */
export function FeedBoxRow({
  boxId,
  nano,
  tokens,
  meta,
  lead,
  side,
  owner,
  fee = false,
  txId,
  index,
  height,
  enterClass,
}: {
  boxId: string | null;
  nano: bigint;
  tokens: [string, bigint][];
  meta: MetaOf;
  lead: Lead;
  /** In a transaction: spent boxes count down, created boxes up. */
  side?: "in" | "out";
  owner?: string | null;
  fee?: boolean;
  txId?: string | null;
  index?: number | null;
  height?: number | null;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const signed = side != null;
  const raw = side === "in" ? -nano : nano;
  const chips = side === "in" ? neg(tokens) : tokens;
  const inTx = owner !== undefined;
  const who = inTx ? ownerType(owner ?? null, fee, t) : null;
  const boxHref = boxId ? `/box/${boxId}` : null;
  const ownerHref = owner ? `/address/${encodeURIComponent(owner)}` : null;
  const k: FeedKind = fee ? "reward" : "box";
  const glyph: FeedGlyphId = fee ? "fee" : "box";
  const title = inTx ? (
    ownerHref ? (
      <Link
        prefetch={false}
        href={ownerHref}
        title={owner ?? undefined}
        className={clsx("feed-name hover:underline", who?.name || fee ? "font-semibold" : "font-mono tabular-nums")}
      >
        {fee ? t("tx.minerFee") : (who?.name ?? shortId(owner ?? "", 8))}
      </Link>
    ) : (
      <span className="feed-name">{t("tx.unknown")}</span>
    )
  ) : boxHref ? (
    <Link prefetch={false} href={boxHref} title={boxId ?? undefined} className="feed-name font-mono tabular-nums hover:underline">
      {shortId(boxId ?? "", 8)}
    </Link>
  ) : (
    <span className="feed-name">{t("tx.box")}</span>
  );
  return (
    <FeedRow
      k={k}
      glyph={glyph}
      tileTitle={fee ? t("tx.minerFee") : t("detail.box")}
      lead={lead}
      enterClass={enterClass}
      title={title}
      facts={
        <>
          {/* The title already says "Miner fee"; a fee box only names its pool, when known. */}
          {who && (!fee || who.name) ? <span className="feed-kind">{fee ? who.name : who.type}</span> : null}
          {inTx && owner && (who?.name || fee) ? (
            <span className="feed-narrow-off font-mono tabular-nums" title={owner}>
              {shortId(owner, 6)}
            </span>
          ) : null}
          {inTx && boxHref && boxId ? (
            <span className="feed-mid">
              {t("tx.box")} <FeedIdLink href={boxHref} id={boxId} />
            </span>
          ) : null}
          {txId ? (
            <span>
              {t("address.colTx")} <FeedIdLink href={`/tx/${txId}`} id={txId} />
              {index != null ? <span className="tabular-nums text-[var(--muted-2)]">:{index}</span> : null}
            </span>
          ) : null}
          {height != null ? (
            <Tip content={t("address.colHeight")} tap={false}>
              <Link prefetch={false} href={`/block/${height}`} className="feed-mid tabular-nums hover:underline">
                {height.toLocaleString(tag)}
              </Link>
            </Tip>
          ) : null}
        </>
      }
      chips={tokens.length ? <FeedTokenChips tokens={chips} meta={meta} signed={signed} /> : null}
      value={<FeedAmount raw={raw} signed={signed && !fee} />}
      detail={() => (
        <FeedFields>
          {boxHref && boxId ? (
            <FeedField label={t("detail.box")} wide>
              <FeedIdLine href={boxHref} id={boxId} />
            </FeedField>
          ) : null}
          {ownerHref && owner ? (
            <FeedField label={fee ? t("tx.minerFee") : t("detail.address")} wide>
              <FeedIdLine href={ownerHref} id={owner} />
            </FeedField>
          ) : null}
          {txId ? (
            <FeedField label={t("detail.tx")} wide>
              <FeedIdLine href={`/tx/${txId}`} id={txId} />
            </FeedField>
          ) : null}
          <FeedField label="ERG">
            <span className="tabular-nums">{formatScaledAmount(nano, 9, tag, 9)}</span>
          </FeedField>
          {height != null || index != null ? (
            <FeedField label={t("address.colHeight")}>
              <span className="tabular-nums">
                {height != null ? (
                  <Link prefetch={false} href={`/block/${height}`} className="hover:underline">
                    {height.toLocaleString(tag)}
                  </Link>
                ) : (
                  "—"
                )}
                {index != null ? (
                  <span className="text-[var(--muted-2)]">
                    {" · "}
                    {t("address.colIndex")} {index}
                  </span>
                ) : null}
              </span>
            </FeedField>
          ) : null}
          {tokens.length ? (
            <FeedField label={t("tx.tab.tokens")} wide>
              <FeedTokenChips tokens={chips} meta={meta} signed={signed} max={tokens.length} />
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

/** One side of a transaction: who paid or got paid, ERG as the figure, tokens as chips. */
export function FeedPartyRow({
  party,
  side,
  meta,
  rank,
  enterClass,
}: {
  party: Party;
  side: "from" | "to" | "fee";
  meta: MetaOf;
  rank: number;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const fee = side === "fee" || party.isFee;
  const who = ownerType(party.address, fee, t);
  const firstBox = party.boxes.find((b) => b.boxId)?.boxId ?? null;
  const href = party.address
    ? `/address/${encodeURIComponent(party.address)}`
    : firstBox
      ? `/box/${firstBox}`
      : null;
  const rows = [...party.tokens.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1));
  const chips = side === "from" ? neg(rows) : rows;
  const raw = side === "from" ? -party.erg : party.erg;
  const [k, glyph]: [FeedKind, FeedGlyphId] = fee ? ["reward", "fee"] : side === "from" ? ["out", "out"] : ["in", "in"];
  const name = fee ? t("tx.minerFee") : (who.name ?? (party.address ? shortId(party.address, 8) : firstBox ? shortId(firstBox, 6) : t("tx.unknown")));
  return (
    <FeedRow
      k={k}
      glyph={glyph}
      tileTitle={fee ? t("tx.minerFee") : side === "from" ? t("tx.from") : t("tx.to")}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      title={
        href ? (
          <Link
            prefetch={false}
            href={href}
            title={party.address ?? firstBox ?? undefined}
            className={clsx("feed-name hover:underline", who.name || fee ? "font-semibold" : "font-mono tabular-nums")}
          >
            {name}
          </Link>
        ) : (
          <span className="feed-name">{name}</span>
        )
      }
      facts={
        <>
          {!fee || who.name ? <span className="feed-kind">{fee ? who.name : who.type}</span> : null}
          {party.address && (who.name || fee) ? (
            <span className="feed-narrow-off font-mono tabular-nums" title={party.address}>
              {shortId(party.address, 6)}
            </span>
          ) : null}
          <FeedCount k="feed.boxes" n={party.boxes.length} className="feed-mid" />
        </>
      }
      chips={rows.length ? <FeedTokenChips tokens={chips} meta={meta} signed={!fee} /> : null}
      value={<FeedAmount raw={raw} signed={!fee} />}
      detail={() => (
        <FeedFields>
          {party.address ? (
            <FeedField label={t("detail.address")} wide>
              <FeedIdLine href={`/address/${encodeURIComponent(party.address)}`} id={party.address} />
            </FeedField>
          ) : null}
          <FeedField label={t("tx.tab.boxes")} wide>
            <span className="feed-id-run">
              {party.boxes.map((b, i) =>
                b.boxId ? (
                  <span key={b.boxId} className="tabular-nums">
                    <FeedIdLink href={`/box/${b.boxId}`} id={b.boxId} />
                    <span className="text-[var(--muted-2)]"> {formatScaledAmount(b.value, 9, tag)} ERG</span>
                  </span>
                ) : (
                  <span key={`box-${i}`}>{t("tx.box")}</span>
                )
              )}
            </span>
          </FeedField>
          {rows.length ? (
            <FeedField label={t("tx.tab.tokens")} wide>
              <FeedTokenChips tokens={chips} meta={meta} signed={!fee} max={rows.length} />
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}

/**
 * One token held somewhere: the amount is the figure, its dollar value sits under it.
 * `facts` and `more` add what the place knows (first and last move, a mint).
 */
export function FeedHoldingRow({
  tokenId,
  name,
  decimals,
  artworkUrl,
  amount,
  signed = false,
  priceUsd,
  valueUsd,
  lead,
  facts,
  sub,
  more,
  enterClass,
}: {
  tokenId: string;
  name?: string | null;
  decimals?: number | null;
  artworkUrl?: string | null;
  amount: bigint;
  signed?: boolean;
  priceUsd?: number | null;
  valueUsd?: number | null;
  lead: Lead;
  facts?: ReactNode;
  /** Replaces the dollar value under the figure. */
  sub?: ReactNode;
  more?: () => ReactNode;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const dec = tokenDecimals(tokenId, decimals);
  const label = tokenSymbol(tokenId, name ?? null);
  const href = `/token/${tokenId}`;
  const abs = amount < 0n ? -amount : amount;
  const usd = valueUsd != null && Number.isFinite(valueUsd) && valueUsd > 0 ? valueUsd : null;
  return (
    <FeedRow
      k="token"
      tile={<TokenLogo tokenId={tokenId} artworkUrl={artworkUrl ?? null} size={22} />}
      tileTitle={label || tokenId}
      lead={lead}
      enterClass={enterClass}
      title={
        <Link
          prefetch={false}
          href={href}
          title={name ? `${name} · ${tokenId}` : tokenId}
          className={clsx("feed-name hover:underline", label ? "font-semibold" : "font-mono tabular-nums")}
        >
          {label || shortId(tokenId, 8)}
        </Link>
      }
      facts={
        <>
          <span className="font-mono tabular-nums">{shortId(tokenId, 6)}</span>
          {priceUsd != null && Number.isFinite(priceUsd) && priceUsd > 0 ? (
            <span className="feed-mid">
              {t("feed.price")} <PrettyUsd n={priceUsd} digits={6} className="tabular-nums" />
            </span>
          ) : null}
          {facts}
        </>
      }
      value={<FeedAmount raw={amount} decimals={dec} unit={null} signed={signed} glance />}
      sub={sub !== undefined ? sub : usd != null ? <PrettyUsd n={usd} className="tabular-nums" /> : null}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.token")} wide>
            <FeedIdLine href={href} id={tokenId} />
          </FeedField>
          <FeedField label={t("address.colAmount")}>
            <span className="tabular-nums">
              {signed && amount !== 0n ? (amount > 0n ? "+" : "−") : null}
              {formatScaledAmount(abs, dec, tag, dec)}
            </span>
          </FeedField>
          {usd != null || (priceUsd != null && priceUsd > 0) ? (
            <FeedField label={t("address.colValue")}>
              <span className="tabular-nums">
                {usd != null ? <PrettyUsd n={usd} /> : "—"}
                {priceUsd != null && priceUsd > 0 ? (
                  <span className="text-[var(--muted-2)]">
                    {" · "}
                    {t("feed.price")} <PrettyUsd n={priceUsd} digits={6} />
                  </span>
                ) : null}
              </span>
            </FeedField>
          ) : null}
          {more?.()}
        </FeedFields>
      )}
    />
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Tip } from "@/components/Tip";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatBytes, formatFeeRate, formatScaledAmount, formatStamp, shortId, toBigIntAmt } from "@/lib/format";
import { txChipCaption } from "@/lib/tx-lock";
import type { TxListItem } from "@/lib/list-snapshots";
import { meaningTile } from "@/lib/tx-meaning-row";
import {
  MeaningFeePayer,
  MeaningGave,
  MeaningPhraseField,
  MeaningTitle,
  MeaningValue,
  meaningFacts,
  meaningSub,
  useMeaningRow,
} from "./FeedMeaning";
import {
  FeedAmount,
  FeedChip,
  FeedCount,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedRow,
  feedLoc,
  type FeedKind,
  type FeedLead,
} from "./Feed";
import type { FeedGlyphId } from "./FeedGlyph";

const BY_CATEGORY: Record<string, [FeedKind, FeedGlyphId]> = {
  transfer: ["transfer", "transfer"],
  token: ["token", "token"],
  nft: ["nft", "nft"],
  defi: ["defi", "defi"],
  stable: ["stable", "stable"],
  bridge: ["bridge", "bridge"],
  mixer: ["mixer", "mixer"],
  oracle: ["oracle", "oracle"],
  agent: ["contract", "contract"],
  coinbase: ["reward", "reward"],
  "fee-collect": ["reward", "reward"],
  "reward-unlock": ["reward", "reward"],
  rent: ["rent", "rent"],
  "rent-renew": ["rent", "rent"],
};

const BY_LOCK: Record<string, [FeedKind, FeedGlyphId]> = {
  oracle: ["oracle", "oracle"],
  "oracle-datapoint": ["oracle", "oracle"],
  "oracle-refresh": ["oracle", "oracle"],
  spectrum: ["defi", "defi"],
  "spectrum-swap": ["defi", "defi"],
  "pool-deposit": ["defi", "defi"],
  "pool-redeem": ["defi", "defi"],
  lithos: ["defi", "defi"],
  "lithos-swap": ["defi", "defi"],
  sigmausd: ["stable", "stable"],
  rosen: ["bridge", "bridge"],
  emission: ["reward", "reward"],
  reemission: ["reward", "reward"],
  "emission-proxy": ["reward", "reward"],
};

/** What a tx is, as a tile: the shape first, then what its script belongs to. */
export function txKind(category: string, platform?: string | null, action?: string | null): [FeedKind, FeedGlyphId] {
  const direct = BY_CATEGORY[category];
  if (direct) return direct;
  const locked = (action && BY_LOCK[action]) || (platform && BY_LOCK[platform]);
  if (locked) return locked;
  if (category === "unknown" || !category) return ["quiet", "none"];
  return ["contract", "contract"];
}

type FeedTxRowProps = {
  row: TxListItem;
  lead: FeedLead | { rank: string };
  /** Global tape: height is a fact. A block's own list already has it. */
  showHeight?: boolean;
  /** Mempool position, shown in the detail. */
  queue?: number;
  enterClass?: string;
  fav?: { on: boolean; ready: boolean; title: string; toggle: () => void };
};

/**
 * One tx on a tape: /transactions, /mempool, a block's tx list, favorites.
 * Unconfirmed txs get a hollow tile. With the gateway's `meaning` the row says what happened
 * («Обмен · ErgoDex», who, gave → got); without it, the id row as before.
 */
export function FeedTxRow(props: FeedTxRowProps) {
  return props.row.meaning ? <FeedMeaningTxRow {...props} /> : <FeedIdTxRow {...props} />;
}

/** The block of a run of rows under the time, on a desktop. */
function heightSub(row: TxListItem, lead: FeedTxRowProps["lead"], showHeight: boolean, tag: string) {
  return showHeight && !("rank" in lead) && !lead.same && row.inclusionHeight != null ? (
    <Link prefetch={false} href={`/block/${row.inclusionHeight}`} className="tabular-nums">
      {row.inclusionHeight.toLocaleString(tag)}
    </Link>
  ) : undefined;
}

/** Block, time, fee, size and in → out of a tx: the detail both row looks share. */
function TxFields({ row, queue, feeTail }: { row: TxListItem; queue?: number; feeTail?: ReactNode }) {
  const { t, tn, locale } = useI18n();
  const tag = feedLoc(locale);
  const fee = toBigIntAmt(row.fee);
  return (
    <>
      <FeedField label={t("detail.block")}>
        {row.inclusionHeight != null ? (
          <span className="tabular-nums">
            <Link prefetch={false} href={`/block/${row.inclusionHeight}`} className="hover:underline">
              {row.inclusionHeight.toLocaleString(tag)}
            </Link>
            {row.index != null ? (
              <span className="text-[var(--muted-2)]"> · {t("blocks.txIndex")} {row.index}</span>
            ) : null}
          </span>
        ) : (
          <span className="tabular-nums">
            {t("txs.mempool")}
            {queue != null ? <span className="text-[var(--muted-2)]"> · #{queue + 1}</span> : null}
          </span>
        )}
      </FeedField>
      <FeedField label={t("address.colTime")}>
        <span className="tabular-nums" suppressHydrationWarning>
          {row.timestamp != null ? formatStamp(row.timestamp) : "—"}
        </span>
      </FeedField>
      <FeedField label={t("tx.fee")}>
        <span className="tabular-nums">
          {formatScaledAmount(fee, 9, tag, 9)} ERG
          {fee > 0n ? <span className="text-[var(--muted-2)]"> · {formatFeeRate(row.feeRate)}</span> : null}
          {feeTail}
        </span>
      </FeedField>
      <FeedField label={t("blocks.size")}>
        <span className="tabular-nums">{row.size ? tn("feed.bytes", row.size, row.size.toLocaleString(tag)) : "—"}</span>
      </FeedField>
      <FeedField label={t("blocks.txIo")}>
        <span className="tabular-nums">
          {row.inputs} {t("block.tx.in")} → {row.outputs} {t("block.tx.out")}
        </span>
      </FeedField>
    </>
  );
}

/**
 * Line 1 «Обмен · ErgoDex», line 2 «9fYV…reou · по заявке», right «6.73 ERG → 132.36 RSN».
 * Fee, size and in → out live in the detail. Machine rows (oracle posts, block rewards) are quiet.
 */
function FeedMeaningTxRow({ row, lead, showHeight = false, queue, enterClass, fav }: FeedTxRowProps) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const m = row.meaning!;
  const r = useMeaningRow(m)!;
  const [k, g] = meaningTile(m);
  return (
    <FeedRow
      k={k}
      glyph={g}
      hollow={!row.confirmed}
      tileTitle={r.where ? `${r.word} · ${r.where}` : r.word}
      lead={lead}
      leadSub={heightSub(row, lead, showHeight, tag)}
      enterClass={enterClass}
      className={r.quiet ? "mx-row is-quiet" : "mx-row"}
      title={
        <MeaningTitle r={r} href={`/tx/${row.id}`} title={row.id}>
          {fav ? <FavoriteHeart size="sm" on={fav.on} ready={fav.ready} title={fav.title} onToggle={fav.toggle} /> : null}
        </MeaningTitle>
      }
      facts={meaningFacts(r)}
      chips={r.gave.length ? <MeaningGave r={r} /> : null}
      value={<MeaningValue r={r} />}
      sub={meaningSub(r)}
      detail={() => (
        <FeedFields>
          <MeaningPhraseField m={m} />
          <FeedField label={t("detail.tx")} wide>
            <FeedIdLine href={`/tx/${row.id}`} id={row.id} />
          </FeedField>
          <TxFields row={row} queue={queue} feeTail={<MeaningFeePayer m={m} />} />
        </FeedFields>
      )}
    />
  );
}

/** The row without `meaning`: the tx id, its script caption, in → out, size, fee. */
function FeedIdTxRow({ row, lead, showHeight = false, queue, enterClass, fav }: FeedTxRowProps) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const [k, g] = txKind(row.category, row.platform, row.action);
  const caption = txChipCaption(row.category, row.platform, row.action, t);
  /* "Contract · Oracle datapoint": on a phone only the part after the last dot shows; the tile already says the rest. */
  const cut = caption.lastIndexOf(" · ");
  const tokens = row.tokenCount != null && row.tokenCount > 0 ? row.tokenCount : 0;
  const fee = toBigIntAmt(row.fee);
  const value = row.value == null ? null : toBigIntAmt(row.value);
  const coinbase = row.confirmed && row.index === 0;
  return (
    <FeedRow
      k={k}
      glyph={g}
      hollow={!row.confirmed}
      tileTitle={caption}
      lead={lead}
      leadSub={heightSub(row, lead, showHeight, tag)}
      enterClass={enterClass}
      title={
        <>
          <Link prefetch={false} href={`/tx/${row.id}`} title={row.id} className="feed-name font-mono tabular-nums hover:underline">
            {shortId(row.id, 8)}
          </Link>
          {fav ? <FavoriteHeart size="sm" on={fav.on} ready={fav.ready} title={fav.title} onToggle={fav.toggle} /> : null}
        </>
      }
      facts={
        <>
          <span className="feed-kind" title={caption}>
            {cut > 0 ? (
              <>
                <span className="feed-kind-head">{caption.slice(0, cut + 3)}</span>
                {caption.slice(cut + 3)}
              </>
            ) : (
              caption
            )}
          </span>
          <Tip content={`${row.inputs} ${t("block.tx.in")} → ${row.outputs} ${t("block.tx.out")}`}>
            <span className="tabular-nums">
              {row.inputs} → {row.outputs}
            </span>
          </Tip>
          {showHeight && row.inclusionHeight != null ? (
            <Link prefetch={false} href={`/block/${row.inclusionHeight}`} className="feed-phone-only tabular-nums">
              {row.inclusionHeight.toLocaleString(tag)}
            </Link>
          ) : null}
          {row.size ? <span className="feed-mid tabular-nums">{formatBytes(row.size)}</span> : null}
          {fee > 0n ? (
            <span className="feed-wide tabular-nums">{formatFeeRate(row.feeRate)}</span>
          ) : null}
        </>
      }
      chips={
        tokens > 0 ? (
          <FeedChip>
            <FeedCount k="feed.tokens" n={tokens} />
          </FeedChip>
        ) : null
      }
      value={<FeedAmount raw={value} />}
      subMinor
      sub={
        fee > 0n ? (
          <>
            {t("feed.fee")} <span className="tabular-nums">{formatScaledAmount(fee, 9, tag)}</span>
          </>
        ) : coinbase ? (
          t("block.tx.coinbase")
        ) : null
      }
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.tx")} wide>
            <FeedIdLine href={`/tx/${row.id}`} id={row.id} />
          </FeedField>
          <TxFields row={row} queue={queue} />
        </FeedFields>
      )}
    />
  );
}

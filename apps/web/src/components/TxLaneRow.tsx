"use client";

import Link from "next/link";
import clsx from "clsx";
import { TxIoMark } from "@/components/TxIoMark";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { ListWhen } from "@/components/ListWhen";
import { formatBytes, formatErgPrecise, formatFeeRate, shortId, toBigIntAmt } from "@/lib/format";
import { txChipCaption } from "@/lib/tx-lock";
import type { TxListItem } from "@/lib/list-snapshots";

export function TxLaneRow({
  row,
  index,
  locale,
  t,
  enterClass,
  showHeight,
  hidePending,
  fav = false,
  favReady = true,
  favTitle,
  onToggleFav,
}: {
  row: TxListItem;
  index: number;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
  /** Global tape: height as last column. Block tape already has height in chrome. */
  showHeight?: boolean;
  /** Mempool tape: status is the last column, not a chip on the hash. */
  hidePending?: boolean;
  fav?: boolean;
  favReady?: boolean;
  favTitle?: string;
  onToggleFav?: () => void;
}) {
  const caption = txChipCaption(row.category, row.platform, row.action, t);
  const tokens = row.tokenCount != null && row.tokenCount > 0 ? row.tokenCount : null;
  const unconfirmed = !row.confirmed;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-tx-pairs border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <div className="flex items-center gap-2">
            <Link
              href={`/tx/${row.id}`}
              className="whitespace-nowrap font-mono text-accent hover:underline"
            >
              {shortId(row.id, 8)}
            </Link>
            {unconfirmed && !hidePending ? (
              <span className="addr-pending-mark shrink-0">{t("txs.pending")}</span>
            ) : null}
            {onToggleFav ? (
              <FavoriteHeart
                size="sm"
                on={fav}
                ready={favReady}
                title={favTitle ?? ""}
                onToggle={onToggleFav}
              />
            ) : null}
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            <span className="whitespace-nowrap">{caption}</span>
          </p>
        </div>
        <div className="flex min-w-0 items-center justify-end px-3">
          <TxIoMark
            inputs={row.inputs}
            outputs={row.outputs}
            inLabel={t("block.tx.in")}
            outLabel={t("block.tx.out")}
          />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums">
          {tokens == null ? "—" : tokens}
        </div>
        <div className="min-w-0 px-3 text-right">
          <ListWhen ts={row.timestamp} locale={locale} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <p className="tabular-nums">{formatErgPrecise(toBigIntAmt(row.fee), locale)}</p>
          {row.fee > 0 && row.size > 0 ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{formatFeeRate(row.feeRate)}</p>
          ) : null}
        </div>
        <div
          className={clsx(
            "min-w-0 px-3 text-right tabular-nums",
            row.value != null && "text-[var(--up)]"
          )}
        >
          {row.value == null ? "—" : formatErgPrecise(toBigIntAmt(row.value), locale)}
        </div>
      </div>
      <div className={clsx("block-lane-pair", showHeight && "is-triple")}>
        <div className="min-w-0 px-3 tabular-nums text-[var(--muted)]">
          <p>{index}</p>
          {row.confirmed && index === 0 ? (
            <p className="mt-0.5 text-[11px] font-normal">{t("block.tx.coinbase")}</p>
          ) : null}
        </div>
        <div
          className={clsx(
            "min-w-0 px-3 tabular-nums text-[var(--muted)]",
            !showHeight && "text-right"
          )}
        >
          {row.size ? formatBytes(row.size) : "—"}
        </div>
        {showHeight ? (
          row.inclusionHeight != null ? (
            <Link
              href={`/block/${row.inclusionHeight}`}
              className="flex min-w-0 items-center justify-end px-3 text-right font-mono tabular-nums text-accent hover:underline"
            >
              {row.inclusionHeight.toLocaleString(locale)}
            </Link>
          ) : (
            <div className="flex min-w-0 items-center justify-end px-3">
              <span className="addr-pending-mark">{t("txs.mempool")}</span>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

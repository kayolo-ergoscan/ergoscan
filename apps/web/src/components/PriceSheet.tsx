"use client";

import { useEffect, useState } from "react";
import { BottomSheet, SheetNavLink } from "./BottomSheet";
import { TokenAvatar } from "./TokenBadge";
import { PrettyUsd } from "./PrettyNum";
import { fetchChainStats } from "@/lib/chain-stats";
import { formatCompact, formatUsdPrice } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import type { SpectrumTapeRow } from "@/lib/list-snapshots";

function fmtChange(n: number): string {
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function Rows({ rows, onClose }: { rows: SpectrumTapeRow[]; onClose: () => void }) {
  return (
    <ul className="flex flex-col px-2 pb-4">
      {rows.map((row) => {
        const up = (row.changePct ?? 0) > 0;
        const down = (row.changePct ?? 0) < 0;
        return (
          <li key={row.tokenId}>
            <SheetNavLink
              href={`/token/${row.tokenId}`}
              onDone={onClose}
              className="price-sheet-row chip-press flex min-h-[48px] items-center gap-3 overflow-hidden rounded-[12px] px-2.5"
            >
              <TokenAvatar tokenId={row.tokenId} symbol={row.symbol} size={24} />
              <span className="price-tape-sym min-w-0 flex-1 truncate text-[15px] font-semibold">{row.symbol}</span>
              <span className="price-tape-px shrink-0 text-[14px] font-semibold">
                <PrettyUsd n={row.priceUsd} digits={row.priceUsd >= 1 ? 2 : 4} />
              </span>
              <span
                className={`price-tape-chg w-[4.25rem] shrink-0 text-right text-[12px]${up ? " is-up" : ""}${down ? " is-down" : ""}`}
              >
                {row.changePct != null ? fmtChange(row.changePct) : ""}
              </span>
            </SheetNavLink>
          </li>
        );
      })}
    </ul>
  );
}

/** Phone: the header price opens this instead of a ticker on every page. */
export function PriceSheet({
  open,
  onClose,
  rows,
  usd,
}: {
  open: boolean;
  onClose: () => void;
  rows: SpectrumTapeRow[];
  usd: number | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [circulating, setCirculating] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    void fetchChainStats().then((s) => {
      if (dead || !s) return;
      setCirculating(s.circulating != null && s.circulating > 0 ? s.circulating : null);
    });
    return () => {
      dead = true;
    };
  }, [open]);

  const mcap = usd != null && circulating != null ? usd * circulating : null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label={t("spectrum.tape")}
      head={<h2 className="m-0 truncate text-[17px] font-semibold tracking-tight">{t("spectrum.tape")}</h2>}
    >
      <div className="flex items-end justify-between gap-4 px-4 pb-3 pt-1">
        <div className="min-w-0">
          <p className="m-0 text-[12px] text-[var(--muted)]">{t("header.ergPrice")}</p>
          <p className="m-0 text-[24px] font-semibold leading-tight tabular-nums">
            {usd != null ? formatUsdPrice(usd, locale) : "—"}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="m-0 text-[12px] text-[var(--muted)]">{t("header.mcap")}</p>
          <p className="m-0 text-[15px] font-medium leading-tight tabular-nums">
            {mcap != null ? `$${formatCompact(mcap)}` : "—"}
          </p>
        </div>
      </div>
      {rows.length ? (
        <Rows rows={rows} onClose={onClose} />
      ) : (
        <p className="px-4 pb-6 text-[13px] text-[var(--muted)]">—</p>
      )}
    </BottomSheet>
  );
}

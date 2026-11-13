"use client";

import type { ReactNode } from "react";
import type { BallProps } from "@ergoscan/shared";
import { formatFeeRate, formatNano, shortId } from "@/lib/format";
import Link from "next/link";
import { useT } from "@/lib/i18n/I18nProvider";
import { lockCaption } from "@/lib/tx-lock";
import { copyText } from "@/lib/copy-text";

export function TxDrawer({
  ball,
  onClose,
}: {
  ball: BallProps | null;
  onClose: () => void;
}) {
  const t = useT();
  if (!ball) return null;
  const lock = lockCaption(ball.platform, t);

  return (
    <>
      <button
        type="button"
        aria-label={t("nav.close")}
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />
      <aside className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-md overflow-y-auto border-l border-[var(--border)] bg-[var(--module)] p-6">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-accent">
              {t("detail.tx")}
            </p>
            <h2 className="mt-1 font-mono text-sm text-[var(--text)]">
              {shortId(ball.txId, 10)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] bg-[var(--invert)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--invert-fg)] transition-opacity hover:opacity-90"
          >
            {t("nav.close")}
          </button>
        </div>

        <div
          className="mb-6 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: ball.color }}
        >
          <span className="text-lg font-bold text-black/80">
            {ball.r.toFixed(0)}
          </span>
        </div>

        <dl className="space-y-3 text-[14px]">
          <Row k={t("drawer.category")} v={ball.category} />
          <Row k={t("drawer.platform")} v={lock ?? "—"} />
          <Row k={t("drawer.size")} v={`${ball.size} B`} />
          <Row k={t("drawer.fee")} v={formatNano(ball.fee)} />
          <Row k={t("drawer.feeRate")} v={formatFeeRate(ball.feeRate)} />
          <Row
            k={t("drawer.io")}
            v={`${ball.inputCount} / ${ball.outputCount}`}
          />
          <Row k={t("drawer.value")} v={formatNano(ball.value)} />
        </dl>

        {!!ball.tokenIds.length && (
          <div className="mt-4">
            <p className="mb-2 text-[12px] text-[var(--muted)]">
              {t("drawer.tokens")}
            </p>
            <div className="flex flex-wrap gap-2">
              {ball.tokenIds.slice(0, 6).map((id: string) => (
                <Link
                  prefetch={false}
                  key={id}
                  href={`/token/${id}`}
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 font-mono text-[11px] text-accent"
                >
                  {shortId(id, 4)}
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-[12px] leading-relaxed text-[var(--muted)]">
          {t("drawer.eutxoHint")}
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link
            prefetch={false}
            href={`/tx/${ball.txId}`}
            className="rounded-[8px] bg-[var(--invert)] px-4 py-2 text-[13px] font-semibold text-[var(--invert-fg)]"
          >
            {t("drawer.openTx")}
          </Link>
          <button
            type="button"
            className="chip-press overflow-hidden rounded-[8px] border border-[var(--border)] px-4 py-2 text-[13px] text-[var(--muted)]"
            onClick={() => copyText(ball.txId)}
          >
            {t("drawer.copyId")}
          </button>
          <Link
            prefetch={false}
            href="/mempool"
            className="rounded-[8px] border border-[var(--border)] px-4 py-2 text-[13px] text-[var(--muted)]"
          >
            {t("live.openMempool")}
          </Link>
        </div>
      </aside>
    </>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border-soft)] py-2">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="text-right font-medium capitalize text-[var(--text)]">{v}</dd>
    </div>
  );
}

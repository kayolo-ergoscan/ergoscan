"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useTip } from "@/components/Tip";
import {
  formatFactWhen,
  formatRelTime,
  relAgeTone,
  relAgeToneClass,
} from "@/lib/format";
import { copyText } from "@/lib/copy-text";

export type AddressTapeData = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

export function AddressActivityWhen({
  ts,
  txId,
  locale,
  align,
  openLabel,
  copyLabel,
  copiedLabel,
}: {
  ts: number | null | undefined;
  txId?: string | null;
  locale: string;
  align: "left" | "right";
  openLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const rel = formatRelTime(ts, locale);
  const stamp = formatFactWhen(ts, locale);
  const tone = relAgeTone(ts);
  const href = txId ? `/tx/${encodeURIComponent(txId)}` : null;
  const empty = rel === "—" && stamp === "—";
  // The full tx id with a copy button: an interactive tip, so the cursor can move onto it.
  const tip = useTip(
    href && txId
      ? () => (
          <div className="tip-idline">
            <Link prefetch={false} href={href} className="tip-hash font-mono">
              {txId}
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void copyText(txId)?.then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
              aria-label={copied ? copiedLabel : copyLabel}
              className="tip-icon-btn chip-press"
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2.4 6.2 4.8 8.6 9.6 3.4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M3 8.2V3.4A1.2 1.2 0 0 1 4.2 2.2H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        )
      : null,
    { interactive: true, disabled: !href || !txId, tap: false }
  );
  const when = (
    <>
      <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(tone))}>{rel}</p>
      <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
        {stamp}
      </p>
    </>
  );

  return (
    <div
      className={clsx(
        "relative px-3",
        align === "right" ? "flex flex-col items-end text-right" : "flex flex-col items-start"
      )}
      {...tip}
    >
      {empty ? (
        <span className="text-[var(--muted)]">—</span>
      ) : href ? (
        <Link
          prefetch={false}
          href={href}
          aria-label={`${openLabel} · ${rel} · ${stamp}`}
          className="block whitespace-nowrap"
        >
          {when}
        </Link>
      ) : (
        <div className="whitespace-nowrap">{when}</div>
      )}
    </div>
  );
}

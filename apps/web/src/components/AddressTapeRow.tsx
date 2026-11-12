"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  formatFactWhen,
  formatRelTime,
  relAgeTone,
  relAgeToneClass,
} from "@/lib/format";

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
        "group/act relative px-3",
        align === "right" ? "flex flex-col items-end text-right" : "flex flex-col items-start"
      )}
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
      {href && txId ? (
        <div
          data-align={align}
          role="tooltip"
          className={clsx(
            "addr-act-chip pointer-events-none absolute bottom-[calc(100%+8px)] z-40 flex items-start gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--module)] px-2.5 py-2 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "group-hover/act:pointer-events-auto group-hover/act:opacity-100 group-focus-within/act:pointer-events-auto group-focus-within/act:opacity-100",
            align === "right" ? "right-0" : "left-0"
          )}
        >
            <Link
              prefetch={false}
              href={href}
              className="max-w-[14.5rem] break-all text-left font-mono text-[11px] leading-snug text-[var(--accent)]"
            >
              {txId}
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void navigator.clipboard?.writeText(txId).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
              aria-label={copied ? copiedLabel : copyLabel}
              className="chip-press mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
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
                  <path
                    d="M3 8.2V3.4A1.2 1.2 0 0 1 4.2 2.2H8"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          </div>
        ) : null}
    </div>
  );
}

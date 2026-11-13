"use client";

import { useState } from "react";
import clsx from "clsx";
import { INK } from "@/lib/palette";
import { copyText } from "@/lib/copy-text";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export function parseGix(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Sequential gix chip. Label is always "gix" — never a bare #. */
export function GixMark({
  value,
  locale,
  hint,
  copyLabel,
  copiedLabel,
  size = "sm",
}: {
  value: unknown;
  locale: string;
  hint: string;
  copyLabel: string;
  copiedLabel: string;
  size?: "sm" | "md";
}) {
  const gix = parseGix(value);
  const [ok, setOk] = useState(false);
  const pretty = gix != null ? gix.toLocaleString(loc(locale)) : "—";
  const ready = gix != null;

  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center leading-none",
        size === "md"
          ? "h-5 gap-1 rounded-[7px] px-1.5"
          : "h-3 gap-0.5 rounded-[5px] px-1"
      )}
      style={
        ready
          ? { background: "rgba(232, 121, 249, 0.14)" }
          : { background: "rgba(255, 255, 255, 0.04)" }
      }
      title={hint}
    >
      <span
        className={clsx(
          "shrink-0 font-semibold lowercase leading-none tracking-[0.16em]",
          size === "md" ? "text-[10px]" : "text-[9px]"
        )}
        style={{ color: INK.gix }}
      >
        gix
      </span>
      <span
        className={clsx(
          "min-w-0 truncate font-semibold tabular-nums leading-none tracking-tight",
          size === "md" ? "text-[14px]" : "text-[12px]",
          !ready && "text-[var(--muted-2)]"
        )}
        style={ready ? { color: INK.gix } : undefined}
      >
        {pretty}
      </span>
      {ready && (
        <button
          type="button"
          onClick={() => {
            void copyText(String(gix))?.then(() => {
              setOk(true);
              window.setTimeout(() => setOk(false), 1200);
            });
          }}
          className={clsx(
            "chip-press inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[rgba(232,121,249,0.2)]",
            size === "md" ? "h-4 w-4" : "h-3 w-3"
          )}
          style={{ color: INK.gix }}
          aria-label={ok ? copiedLabel : copyLabel}
        >
          {ok ? (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M2.4 6.2 4.8 8.6 9.6 3.4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
              <rect x="2" y="2" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

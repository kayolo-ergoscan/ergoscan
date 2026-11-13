"use client";

import { useState } from "react";
import clsx from "clsx";
import { copyText } from "@/lib/copy-text";

/** The copy button next to a tx id: a check for a moment after it copies. */
export function CopyChip({
  text,
  copyLabel,
  copiedLabel,
  inherit,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  inherit?: boolean;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text)?.then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        });
      }}
      className={clsx(
        "chip-press inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)]",
        inherit ? "text-inherit hover:text-inherit" : "text-[var(--muted)] hover:text-[var(--text)]"
      )}
      aria-label={ok ? copiedLabel : copyLabel}
    >
      {ok ? (
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
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

/** One automatic retry per path. A second failure inside the window stays on this screen. */
const retriedAt = new Map<string, number>();

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const armed = useRef(false);

  useEffect(() => {
    console.error(error);
    if (armed.current) return;
    const path = window.location.pathname;
    const prev = retriedAt.get(path) ?? 0;
    if (Date.now() - prev < 4000) return;
    armed.current = true;
    retriedAt.set(path, Date.now());
    reset();
  }, [error, reset]);

  return (
    <div className="max-w-lg">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("error.title")}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--muted)]">{t("error.body")}</p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[12px] tabular-nums text-[var(--muted-2)]">
          {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="chip-press overflow-hidden rounded-[10px] bg-[var(--wash)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
        >
          {t("error.retry")}
        </button>
        <Link
          href="/"
          className="chip-press overflow-hidden rounded-[10px] bg-[var(--wash)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
        >
          {t("nav.home")}
        </Link>
      </div>
    </div>
  );
}

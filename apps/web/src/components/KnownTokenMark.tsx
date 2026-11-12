"use client";

import { useT } from "@/lib/i18n/I18nProvider";

/** Small check on a token the explorer already names (catalog / known set). */
export function KnownTokenMark() {
  const t = useT();
  return (
    <span className="search-known inline-flex shrink-0 items-center">
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        <path d="M4.6 8.2 7 10.5l4.4-4.8" fill="none" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{t("search.knownToken")}</span>
    </span>
  );
}

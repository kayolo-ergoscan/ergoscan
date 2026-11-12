"use client";

import Link from "next/link";
import { MissShell } from "@/components/MissPanel";
import { KnownTokenMark } from "@/components/KnownTokenMark";
import { TokenAvatar } from "@/components/TokenBadge";
import { shortId } from "@/lib/format";
import { tokenKnown, tokenTickerInk } from "@/lib/token-meta";
import { useI18n } from "@/lib/i18n/I18nProvider";

export type ResolveHit = {
  type: "block" | "tx" | "box" | "token" | "address";
  id: string;
  path: string;
  label?: string;
};

export function SearchHits({
  q,
  hits,
  holders = {},
}: {
  q: string;
  hits: ResolveHit[];
  /** Holder count by token id, when the catalog had it. */
  holders?: Record<string, number>;
}) {
  const { t, tn, locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  if (hits.length > 1 && hits.every((h) => h.type === "token")) {
    return (
      <div className="max-w-lg">
        <p className="text-[14px] text-[var(--muted)]">{t("search.nameList")}</p>
        <ul className="mt-5 space-y-1">
          {hits.map((h) => {
            const n = holders[h.id];
            return (
              <li key={h.id}>
                <Link
                  prefetch={false}
                  href={h.path}
                  className="chip-press flex min-h-[56px] items-center gap-3 overflow-hidden rounded-[12px] px-3 py-2 hover:bg-[var(--wash-faint)]"
                >
                  <TokenAvatar tokenId={h.id} symbol={h.label} size={28} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="min-w-0 truncate text-[14px] font-semibold"
                        style={{ color: tokenTickerInk(h.id) }}
                      >
                        {h.label || t("search.hit.token")}
                      </span>
                      {tokenKnown(h.id) ? <KnownTokenMark /> : null}
                    </span>
                    <span className="truncate font-mono text-[12px] text-[var(--muted)]">{shortId(h.id, 8)}</span>
                  </span>
                  {n != null ? (
                    <span className="shrink-0 text-right text-[12px] tabular-nums text-[var(--muted)]">
                      {tn("feed.holders", n, n.toLocaleString(loc))}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (!q) return <MissShell looked="" copy="empty" />;
  return <MissShell looked={q} copy="index" />;
}

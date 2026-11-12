"use client";

import Link from "next/link";
import { MissShell } from "@/components/MissPanel";
import { tokenTickerInk } from "@/lib/token-meta";
import { useT } from "@/lib/i18n/I18nProvider";

export type ResolveHit = {
  type: "block" | "tx" | "box" | "token" | "address";
  id: string;
  path: string;
  label?: string;
};

export function SearchHits({ q, hits }: { q: string; hits: ResolveHit[] }) {
  const t = useT();
  if (hits.length > 1 && hits.every((h) => h.type === "token")) {
    return (
      <div className="max-w-lg">
        <p className="text-[14px] text-[var(--muted)]">{t("search.nameList")}</p>
        <ul className="mt-5 space-y-1">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                prefetch={false}
                href={h.path}
                className="flex items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 chip-press overflow-hidden hover:bg-[var(--wash-faint)]"
              >
                <span
                  className="min-w-0 truncate text-[13px] font-medium"
                  style={{ color: tokenTickerInk(h.id) }}
                >
                  {h.label || t("search.hit.token")}
                </span>
                <span className="min-w-0 max-w-[50%] truncate font-mono text-[13px] text-accent">
                  {h.id}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!q) return <MissShell looked="" copy="empty" />;
  return <MissShell looked={q} copy="index" />;
}

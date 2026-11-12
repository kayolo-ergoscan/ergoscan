"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/I18nProvider";

export type Crumb = { href?: string; label: string };

/** Contextual path — prefer this over always “← Stage”. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <nav
      aria-label={t("ux.breadcrumb")}
      className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]"
    >
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-[var(--muted-2)]">/</span>}
            {c.href && !last ? (
              <Link prefetch={false} href={c.href} className="text-accent hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className={last ? "text-[var(--muted-2)]" : undefined}>{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

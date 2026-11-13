"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { NavIcon } from "@/components/nav-icons";
import { formatRelAge } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { INK } from "@/lib/palette";
import { useChainTipRefresh, useKeepFresh, usePageSync } from "@/lib/page-sync";
import { doorFreshness, formatOracleQuote, sparkPath, type DoorFreshness, type OracleDoorSummary } from "@/lib/oracle-door";
import type { OracleFeedSlug } from "@/lib/oracle-feed";

const DOORS = [
  {
    slug: "ergusd" as const,
    href: "/oracles/ergusd",
    titleKey: "oracles.doorOfficial",
    hintKey: "oracles.doorOfficialHint",
    icon: "oracleUsd" as const,
  },
  {
    slug: "erg-usd" as const,
    href: "/oracles/erg-usd",
    titleKey: "oracles.doorUsd",
    hintKey: "oracles.doorUsdHint",
    icon: "oracleUsdV2" as const,
  },
  {
    slug: "xau-erg" as const,
    href: "/oracles/xau-erg",
    titleKey: "oracles.doorXau",
    hintKey: "oracles.doorXauHint",
    icon: "oracleXau" as const,
  },
];

const FRESH_TONE: Record<DoorFreshness, string> = {
  fresh: "var(--up)",
  late: "var(--warning)",
  stale: "var(--down)",
};

const SPARK_W = 120;
const SPARK_H = 28;

export function OraclesDoor({
  summaries = {},
  renderedAt,
}: {
  summaries?: Partial<Record<OracleFeedSlug, OracleDoorSummary>>;
  renderedAt?: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { markSynced } = usePageSync();
  // The server's clock first, so the ages hydrate as rendered; then the browser's, every 30 s.
  const [now, setNow] = useState(() => renderedAt ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [renderedAt]);
  useKeepFresh(() => {
    markSynced();
    router.refresh();
  });
  // A new block can carry a new pool box: read the three cards again.
  useChainTipRefresh(true, () => router.refresh());
  useEffect(() => {
    markSynced();
  }, [markSynced, renderedAt]);

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-3">
        {DOORS.map((door, i) => {
          const sum = summaries[door.slug];
          const fresh = sum ? doorFreshness(door.slug, sum.lastMs, now) : null;
          const path = sum ? sparkPath(sum.spark, SPARK_W, SPARK_H, 2) : "";
          return (
            <Link
              prefetch={false}
              key={door.href}
              href={door.href}
              className="home-tile-enter mod kpi-tile--press flex min-w-0 flex-col gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
              style={{ "--enter": i } as React.CSSProperties}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="ico-line inline-flex shrink-0">
                  <NavIcon id={door.icon} className="size-[22px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                    {t(door.titleKey)}
                  </span>
                  <span className="mt-1 block truncate text-[13px] text-[var(--muted)]">{t(door.hintKey)}</span>
                </span>
                {sum ? (
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="font-mono text-[17px] font-semibold tabular-nums text-[var(--text)]">
                      {formatOracleQuote(door.slug, sum.quote, locale)}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--muted)]">
                      {fresh ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: FRESH_TONE[fresh] }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="tabular-nums">
                        {sum.lastMs != null ? formatRelAge(sum.lastMs, locale, now) : "—"}
                      </span>
                    </span>
                  </span>
                ) : null}
              </span>
              {path ? (
                <svg
                  viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                  preserveAspectRatio="none"
                  className="block h-8 w-full overflow-visible"
                  role="img"
                  aria-label={t("oracles.doorSpark")}
                >
                  <path
                    d={path}
                    fill="none"
                    stroke={INK.sky}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}

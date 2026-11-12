"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { NavIcon } from "@/components/nav-icons";
import { useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

const DOORS = [
  {
    href: "/oracles/ergusd",
    titleKey: "oracles.doorOfficial",
    hintKey: "oracles.doorOfficialHint",
    icon: "oracleUsd" as const,
  },
  {
    href: "/oracles/erg-usd",
    titleKey: "oracles.doorUsd",
    hintKey: "oracles.doorUsdHint",
    icon: "oracleUsdV2" as const,
  },
  {
    href: "/oracles/xau-erg",
    titleKey: "oracles.doorXau",
    hintKey: "oracles.doorXauHint",
    icon: "oracleXau" as const,
  },
];

export function OraclesDoor() {
  const t = useT();
  const { markSynced } = usePageSync();
  useKeepFresh(() => markSynced());
  useEffect(() => {
    markSynced();
  }, [markSynced]);

  return (
    <Shell>
      <div className="grid gap-3 sm:grid-cols-3">
        {DOORS.map((door) => (
          <Link
            prefetch={false}
            key={door.href}
            href={door.href}
            className="home-tile-enter mod kpi-tile--press flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
          >
            <span className="ico-line inline-flex shrink-0">
              <NavIcon id={door.icon} className="size-[22px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[17px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                {t(door.titleKey)}
              </span>
              <span className="mt-1 block text-[13px] text-[var(--muted)]">{t(door.hintKey)}</span>
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}

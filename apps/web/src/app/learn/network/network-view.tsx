"use client";

import { useEffect, type CSSProperties } from "react";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { Shell } from "@/components/Shell";
import { INK } from "@/lib/palette";
import { useT } from "@/lib/i18n/I18nProvider";
import {
  NETWORK_DIRECTORY,
  NETWORK_KINDS,
  NETWORK_OPS,
  hrefHost,
  hrefPath,
  type NetworkKind,
} from "@/lib/network-directory";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

const KIND_TITLE: Record<NetworkKind, string> = {
  explorers: "network.explorers",
  apis: "network.apis",
  graphql: "network.graphql",
};

export function NetworkView() {
  const t = useT();
  const { markSynced } = usePageSync();

  useKeepFresh(() => markSynced());
  useEffect(() => {
    markSynced();
  }, [markSynced]);

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <AddrFactCard
          className="min-h-0 h-auto"
          enter={0}
          label={t("network.eyebrow")}
          ink={INK.cyan}
          mark={<KpiMark id="network" />}
        >
          <h1 className="mt-0.5 text-[17px] font-semibold leading-none tracking-tight">
            {t("network.title")}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
            {t("network.lead")}
          </p>
          <a
            href="https://api.ergoscan.me/docs"
            className="mt-3 inline-flex rounded-[10px] bg-[var(--wash)] px-3 py-2 text-[12px] text-[var(--accent)] transition-colors duration-[400ms] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {t("network.ours")}
          </a>
        </AddrFactCard>

        {NETWORK_KINDS.map((kind, i) => (
          <section
            key={kind}
            className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
            style={enterAt(i + 1)}
          >
            <h2 className="text-[15px] font-semibold text-[var(--text)]">
              {t(KIND_TITLE[kind])}
            </h2>
            <ul className="mt-3 flex flex-col gap-1">
              {NETWORK_DIRECTORY[kind].map((row) => {
                const host = hrefHost(row.href);
                const path = hrefPath(row.href);
                const op = t(NETWORK_OPS[row.op]);
                return (
                  <li key={row.href}>
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-baseline justify-between gap-3 rounded-[12px] px-2 py-2 text-[var(--text)] transition-colors duration-[400ms] hover:bg-[var(--wash-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[13px] tracking-tight">
                          {host}
                        </span>
                        {path ? (
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--muted-2)]">
                            {path}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[12px] text-[var(--muted)]">{op}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Shell>
  );
}

function enterAt(i: number): CSSProperties {
  return { "--enter": i } as CSSProperties;
}


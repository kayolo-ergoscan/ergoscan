"use client";

import { useEffect } from "react";
import { AddrFactCard } from "@/components/AddrFactCard";
import { Shell } from "@/components/Shell";
import { Feed, FeedCount, FeedPlate, FeedRow, FeedSection, type FeedKind } from "@/components/feed/Feed";
import type { FeedGlyphId } from "@/components/feed/FeedGlyph";
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

/** Explorers are other sites; APIs and GraphQL are endpoints a program calls. */
const KIND_TILE: Record<NetworkKind, [FeedKind, FeedGlyphId]> = {
  explorers: ["bridge", "bridge"],
  apis: ["contract", "contract"],
  graphql: ["contract", "protocol"],
};

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
          mark={<GlobeMark />}
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

        <Feed className="is-rank">
          {NETWORK_KINDS.map((kind) => (
            <FeedSection
              key={kind}
              label={t(KIND_TITLE[kind])}
              plate={
                <FeedPlate
                  tag={t(KIND_TITLE[kind])}
                  count={<FeedCount k="feed.links" n={NETWORK_DIRECTORY[kind].length} />}
                />
              }
            >
              {NETWORK_DIRECTORY[kind].map((row, i) => {
                const host = hrefHost(row.href);
                const path = hrefPath(row.href);
                const [k, g] = KIND_TILE[kind];
                return (
                  <FeedRow
                    key={row.href}
                    k={k}
                    glyph={g}
                    tileTitle={t(KIND_TITLE[kind])}
                    lead={{ rank: String(i + 1) }}
                    title={
                      <a
                        href={row.href}
                        target="_blank"
                        rel="noreferrer"
                        className="feed-name font-mono tabular-nums hover:underline"
                      >
                        {host}
                      </a>
                    }
                    facts={
                      <>
                        <span className="feed-kind">{t(NETWORK_OPS[row.op])}</span>
                        {path ? <span className="font-mono">{path}</span> : null}
                      </>
                    }
                  />
                );
              })}
            </FeedSection>
          ))}
        </Feed>
      </div>
    </Shell>
  );
}

function GlobeMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-10 w-10">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.55" />
      <path
        d="M12 2.8a15 15 0 0 0 0 18.4A15 15 0 0 0 12 2.8Z"
        stroke="currentColor"
        strokeWidth="1.55"
      />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>
  );
}

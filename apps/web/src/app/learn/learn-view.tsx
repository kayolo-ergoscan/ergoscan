"use client";

import { useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { AddrFactCard } from "@/components/AddrFactCard";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { IndexScopeChip } from "@/components/IndexScopeChip";
import { Shell } from "@/components/Shell";
import { publicGatewayHref } from "@/lib/config";
import { INK } from "@/lib/palette";
import type { EvidenceKind } from "@/lib/trust-board";
import { useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

const EVIDENCE: EvidenceKind[] = [
  "chain",
  "decoded",
  "telemetry",
  "heuristic",
  "live",
  "external",
];
const TX_STEPS = ["spend", "create", "fee", "collect", "change"] as const;
const LIMITS = ["intent", "ownership", "offchain", "nodes"] as const;

export function LearnView() {
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
          label={t("learn.eyebrow")}
          ink={INK.cyan}
          mark={<LearnMark />}
        >
          <h1 className="mt-0.5 text-[17px] font-semibold leading-none tracking-tight">
            {t("learn.title")}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
            {t("learn.lead")}
          </p>
        </AddrFactCard>

        <section
          id="evidence"
          className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
          style={enterAt(1)}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text)]">
                {t("learn.evidence.title")}
              </h2>
              <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
                {t("learn.evidence.lead")}
              </p>
            </div>
            <IndexScopeChip />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {EVIDENCE.map((kind) => (
              <article key={kind} className="rounded-[14px] bg-[var(--wash-faint)] p-3">
                <EvidenceBadge kind={kind} />
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
                  {t(`learn.evidence.${kind}`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4" style={enterAt(2)}>
          <h2 className="text-[15px] font-semibold text-[var(--text)]">
            {t("learn.tx.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
            {t("learn.tx.lead")}
          </p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {TX_STEPS.map((step, index) => (
              <li key={step} className="rounded-[14px] bg-[var(--wash-faint)] p-3">
                <span className="font-mono text-[10px] text-[var(--accent)]">
                  0{index + 1}
                </span>
                <h3 className="mt-1 text-[13px] font-medium text-[var(--text)]">
                  {t(`learn.tx.${step}.title`)}
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                  {t(`learn.tx.${step}.body`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-2 lg:grid-cols-2">
          <section
            id="limits"
            className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
            style={enterAt(3)}
          >
            <h2 className="text-[15px] font-semibold text-[var(--text)]">
              {t("learn.limits.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
              {t("learn.limits.lead")}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {LIMITS.map((limit) => (
                <li key={limit} className="flex gap-2 text-[12px] leading-relaxed text-[var(--muted)]">
                  <span className="text-[var(--warning)]" aria-hidden>—</span>
                  {t(`learn.limits.${limit}`)}
                </li>
              ))}
            </ul>
          </section>

          <section className="home-tile-enter mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4" style={enterAt(4)}>
            <h2 className="text-[15px] font-semibold text-[var(--text)]">
              {t("learn.verify.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
              {t("learn.verify.body")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/status"
                className="rounded-[10px] bg-[var(--wash)] px-3 py-2 text-[12px] text-[var(--accent)] transition-colors duration-[400ms] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                {t("learn.verify.status")}
              </Link>
              <a
                href={publicGatewayHref("/v1/indexer/status")}
                target="_blank"
                rel="noreferrer"
                className="rounded-[10px] bg-[var(--wash)] px-3 py-2 font-mono text-[11px] text-[var(--accent)] transition-colors duration-[400ms] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                /v1/indexer/status
              </a>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function enterAt(i: number): CSSProperties {
  return { "--enter": i } as CSSProperties;
}

function LearnMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-10 w-10">
      <path
        d="M4 6.5c2.6-.9 5.2-.5 8 1.2v10c-2.8-1.7-5.4-2.1-8-1.2v-10Zm16 0c-2.6-.9-5.2-.5-8 1.2v10c2.8-1.7 5.4-2.1 8-1.2v-10Z"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinejoin="round"
      />
    </svg>
  );
}

"use client";

import clsx from "clsx";
import { Tip } from "./Tip";
import { useT } from "@/lib/i18n/I18nProvider";
import type { EvidenceKind } from "@/lib/trust-board";

export const EVIDENCE_TONE: Record<EvidenceKind, string> = {
  chain: "var(--accent)",
  decoded: "var(--k-nft, #9b87f5)",
  telemetry: "var(--c-net, #59b7c7)",
  live: "var(--up)",
  heuristic: "var(--k-rent, #d99b2b)",
  external: "var(--muted)",
};

export function EvidenceBadge({
  kind,
  className,
  compact = false,
}: {
  kind: EvidenceKind;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <Tip content={t(`trust.evidence.${kind}.hint`)}>
    <span
      className={clsx(
        "inline-flex items-center rounded-full bg-[var(--wash)] font-mono text-[var(--muted)]",
        compact
          ? "gap-1 px-1.5 py-0.5 text-[9px]"
          : "gap-1.5 px-2 py-1 text-[10px]",
        className
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: EVIDENCE_TONE[kind] }}
        aria-hidden
      />
      {t(`trust.evidence.${kind}${compact ? ".short" : ""}`)}
    </span>
    </Tip>
  );
}

/** The badge's dot alone: phones show it beside a figure and explain the colours once in a legend. */
export function EvidenceDot({ kind, className }: { kind: EvidenceKind; className?: string }) {
  const t = useT();
  return (
    <span
      className={clsx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: EVIDENCE_TONE[kind] }}
      role="img"
      aria-label={t(`trust.evidence.${kind}`)}
    />
  );
}

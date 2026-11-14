"use client";

import { memo, type ReactNode } from "react";
import clsx from "clsx";
import { EvidenceDot } from "@/components/EvidenceBadge";
import { Tip } from "@/components/Tip";
import { useT } from "@/lib/i18n/I18nProvider";
import type { EvidenceKind } from "@/lib/trust-board";
import type { PoolShare } from "@/lib/chain-stats";
import { INK } from "@/lib/palette";

/** The four week series, each in one ink of the look (marks tier; light.css answers the light ink). */
export type SeriesKey = "price" | "hashrate" | "txs" | "fees";

export const SERIES_INK: Record<SeriesKey, string> = {
  price: "var(--c-block)",
  hashrate: "var(--c-net)",
  txs: "var(--c-tx)",
  fees: "var(--ink-violet)",
};

/**
 * Pool inks: DONUT_SLICES in its order (the home street paints each pool's roof flag the same,
 * through lookInk), as tokens, so the bar follows the ink without a repaint. DONUT_SLICES' last slot
 * is «the rest»: that place, and a row with no pool address, is grey, as the flags are.
 */
const POOL_INK = [INK.cyan, INK.green, INK.gold, INK.coral, INK.sky, INK.violet, INK.teal];
const POOL_REST = "var(--lk-grey, #8a8a8a)";

function poolInk(p: PoolShare, i: number): string {
  const slot = i % (POOL_INK.length + 1);
  if (!p.address || slot === POOL_INK.length) return POOL_REST;
  return POOL_INK[slot]!;
}

/** A fact's name: muted words, and an evidence dot when the figure is not a plain chain fact. */
export function FactLabel({
  children,
  ev,
  className,
}: {
  children: ReactNode;
  ev?: EvidenceKind;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex min-w-0 items-center gap-1.5 text-[12px] leading-none text-[var(--muted)]", className)}>
      <span className="truncate">{children}</span>
      {ev ? <EvDot kind={ev} /> : null}
    </span>
  );
}

/** The evidence dot, with what it means on hover. */
export function EvDot({ kind }: { kind: EvidenceKind }) {
  const t = useT();
  return (
    <Tip content={t(`trust.evidence.${kind}.hint`)} side="top">
      <span className="inline-flex">
        <EvidenceDot kind={kind} />
      </span>
    </Tip>
  );
}

/** Signed change: sign, figure and the up/down tone (a status pair, never a series ink). */
export function Delta({ pct, suffix, className }: { pct: number; suffix?: string; className?: string }) {
  const up = pct >= 0;
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[12px] font-medium leading-none tabular-nums",
        up ? "bg-up/15 text-up" : "bg-down/15 text-down",
        className
      )}
    >
      {up ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}%
      {suffix ? <span className="word-dim font-normal opacity-80">{suffix}</span> : null}
    </span>
  );
}

/** Share of the emission cap: a fill on a lighter step of its own ink. */
export function SupplyMeter({ pct, className }: { pct: number; className?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span
      className={clsx("relative block h-2 overflow-hidden rounded-full", className)}
      style={{ background: "color-mix(in srgb, var(--ink-green) 22%, transparent)" }}
      role="img"
      aria-label={`${p.toFixed(1)}%`}
    >
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${p}%`, background: "var(--ink-green)" }} />
    </span>
  );
}

/**
 * Thin segmented bar of the pools' 24 h blocks: 8 px, round ends, a 2 px surface gap between parts,
 * no text on it. The figures sit beside it; hovering a part names it there (`onPick`).
 */
export const PoolBar = memo(function PoolBar({
  pools,
  onPick,
  className,
  otherLabel,
}: {
  pools: readonly PoolShare[];
  onPick?: (p: { name: string; share: number } | null) => void;
  className?: string;
  otherLabel: string;
}) {
  const total = pools.reduce((s, p) => s + p.blocks, 0);
  if (!total) return null;
  return (
    <span
      className={clsx("flex h-2 w-full gap-[2px] overflow-hidden rounded-full", className)}
      onPointerLeave={() => onPick?.(null)}
      role="img"
      aria-label={pools
        .map((p) => `${!p.address && p.name === "other" ? otherLabel : p.name} ${(p.share * 100).toFixed(1)}%`)
        .join(", ")}
    >
      {pools.map((p, i) => (
        <span
          key={`${p.address ?? p.name}-${i}`}
          className="h-full min-w-[2px] transition-opacity duration-150 hover:opacity-80"
          style={{ flex: `${p.blocks} 1 0`, background: poolInk(p, i) }}
          onPointerEnter={() => onPick?.({ name: !p.address && p.name === "other" ? otherLabel : p.name, share: p.share })}
        />
      ))}
    </span>
  );
});

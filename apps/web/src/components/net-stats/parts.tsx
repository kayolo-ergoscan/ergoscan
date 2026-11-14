"use client";

import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { EVIDENCE_TONE } from "@/components/EvidenceBadge";
import { Tip } from "@/components/Tip";
import { useT } from "@/lib/i18n/I18nProvider";
import type { EvidenceKind } from "@/lib/trust-board";
import type { PoolShare } from "@/lib/chain-stats";
import {
  areaPath,
  barCeiling,
  barPaths,
  binIndex,
  extent,
  linePath,
  nearestIndex,
  xOf,
  yOf,
  type Frame,
  type NetBin,
  type NetPt,
} from "@/lib/net-stats";

/** The four week series, each in one ink of the look (marks tier; light.css answers the light ink). */
export type SeriesKey = "price" | "hashrate" | "txs" | "fees";

export const SERIES_INK: Record<SeriesKey, string> = {
  price: "var(--c-block)",
  hashrate: "var(--c-net)",
  txs: "var(--c-tx)",
  fees: "var(--ink-violet)",
};

/**
 * Pool inks: the same family the home street paints each pool's roof flag in (DONUT_SLICES through
 * lookInk), as tokens, so the bar follows the ink without a repaint. The last slot is «the rest».
 */
const POOL_INK = [
  "var(--c-token)",
  "var(--c-box)",
  "var(--c-block)",
  "var(--c-tx)",
  "var(--c-token)",
  "var(--c-addr)",
  "var(--c-net)",
];
const POOL_REST = "var(--lk-grey, #8a8a8a)";

export function poolInk(p: PoolShare, i: number): string {
  if (!p.address) return POOL_REST;
  return POOL_INK[i % POOL_INK.length]!;
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

function EvDot({ kind }: { kind: EvidenceKind }) {
  const t = useT();
  return (
    <Tip content={t(`trust.evidence.${kind}.hint`)} side="top">
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: EVIDENCE_TONE[kind] }}
        role="img"
        aria-label={t(`trust.evidence.${kind}`)}
      />
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
      {suffix ? <span className="font-normal opacity-80">{suffix}</span> : null}
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
        .map((p) => `${!p.address && p.name === "other" ? otherLabel : p.name} ${((p.blocks / total) * 100).toFixed(1)}%`)
        .join(", ")}
    >
      {pools.map((p, i) => (
        <span
          key={`${p.address ?? p.name}-${i}`}
          className="h-full min-w-[2px] transition-opacity duration-150 hover:opacity-80"
          style={{ flex: `${p.blocks} 1 0`, background: poolInk(p, i) }}
          onPointerEnter={() =>
            onPick?.({ name: !p.address && p.name === "other" ? otherLabel : p.name, share: p.blocks / total })
          }
        />
      ))}
    </span>
  );
});

export type SparkHover = { t: number; v: number; t1?: number; open?: boolean } | null;

/**
 * Stat-tile sparkline: the week in the quiet ink, the newest point in the series ink. A line for a
 * level (price, hashrate), columns for a sum (transactions, fees per 6 h). Hover scrubs.
 */
export const Spark = memo(function Spark({
  pts,
  bins,
  t0,
  t1,
  ink,
  className,
  onHover,
  label,
}: {
  pts?: readonly NetPt[];
  bins?: readonly NetBin[];
  t0: number;
  t1: number;
  ink: string;
  className?: string;
  onHover?: (h: SparkHover) => void;
  label: string;
}) {
  const W = 176;
  const H = 30;
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const geo = useMemo(() => {
    if (bins && bins.length) {
      const { hi } = barCeiling(bins.filter((b) => b.known && b.t1 > t0).map((b) => b.v));
      const f: Frame = { w: W, h: H, t0, t1, lo: 0, hi, top: 2, bottom: 0 };
      return { f, bars: barPaths(f, bins, 4), line: "", area: "", end: null as null | { x: number; y: number } };
    }
    const p = pts ?? [];
    const [lo, hi] = extent(p.map((q) => q.v));
    const f: Frame = { w: W, h: H, t0, t1, lo, hi, top: 4, bottom: 4 };
    const last = p[p.length - 1];
    return {
      f,
      bars: null,
      line: linePath(f, p),
      area: areaPath(f, p),
      end: last ? { x: xOf(f, last.t), y: yOf(f, last.v) } : null,
    };
  }, [pts, bins, t0, t1]);

  const move = (clientX: number) => {
    const r = rect.current ?? (rect.current = box.current?.getBoundingClientRect() ?? null);
    if (!r || r.width <= 0) return;
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
    if (bins && bins.length) {
      const i = binIndex(bins, t);
      const b = i >= 0 ? bins[i] : null;
      if (!b || !b.known) return;
      if (at !== b.t) {
        setAt(b.t);
        onHover?.({ t: b.t, t1: b.t1, v: b.v, open: b.open });
      }
      return;
    }
    const p = pts ?? [];
    const i = nearestIndex(p, t);
    if (i < 0) return;
    const q = p[i]!;
    if (at !== q.t) {
      setAt(q.t);
      onHover?.({ t: q.t, v: q.v });
    }
  };
  const leave = () => {
    rect.current = null;
    setAt(null);
    onHover?.(null);
  };
  const hx = at != null ? xOf(geo.f, bins && bins.length ? at + (bins[0]!.t1 - bins[0]!.t) / 2 : at) : null;
  const hp = at != null && pts ? pts[nearestIndex(pts, at)] : null;

  return (
    <div
      ref={box}
      className={clsx("relative h-[30px] min-w-0 shrink-0 cursor-crosshair", className)}
      onPointerEnter={() => (rect.current = box.current?.getBoundingClientRect() ?? null)}
      onPointerMove={(e) => move(e.clientX)}
      onPointerLeave={leave}
      role="img"
      aria-label={label}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        {geo.bars ? (
          <>
            <path d={geo.bars.closed} fill="var(--muted-2)" opacity={0.42} />
            <path d={geo.bars.open} fill="var(--muted-2)" opacity={0.2} />
            {geo.bars.cut ? <path d={geo.bars.cut} fill="var(--module)" /> : null}
          </>
        ) : (
          <>
            <path d={geo.area} fill={ink} opacity={0.1} />
            <path d={geo.line} fill="none" stroke="var(--muted-2)" strokeOpacity={0.7} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
        {hx != null ? <line x1={hx} x2={hx} y1={0} y2={H} stroke="var(--hair)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      {geo.end && at == null ? (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(geo.end.x / W) * 100}%`, top: `${(geo.end.y / H) * 100}%`, background: ink, boxShadow: "0 0 0 2px var(--module)" }}
        />
      ) : null}
      {geo.bars && at == null ? <LastBarMark bins={bins!} f={geo.f} ink={ink} /> : null}
      {hp ? (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(xOf(geo.f, hp.t) / W) * 100}%`, top: `${(yOf(geo.f, hp.v) / H) * 100}%`, background: ink, boxShadow: "0 0 0 2px var(--module)" }}
        />
      ) : null}
    </div>
  );
});

/** The newest closed column of a column spark, in the series ink. */
function LastBarMark({ bins, f, ink }: { bins: readonly NetBin[]; f: Frame; ink: string }) {
  const last = [...bins].reverse().find((b) => !b.open && b.known);
  if (!last) return null;
  const d = barPaths(f, [last], 4).closed;
  return (
    <svg viewBox={`0 0 ${f.w} ${f.h}`} className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill={ink} />
    </svg>
  );
}

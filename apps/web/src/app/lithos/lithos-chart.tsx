"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { DAY_MS, type LithosDay } from "@ergoscan/shared";
import { TipFigure, TipHead, TipNote, useFloatTip } from "@/components/Tip";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { formatDottedDate, formatDottedDay, formatGroupedNumber, formatInt } from "@/lib/format";
import { formatShare, niceTicks, rollingSeries } from "@/lib/lithos-header";
import { pointRect } from "@/lib/tip-place";

export type LithosChartView = "blocks" | "hash" | "share";

const INK = "var(--c-block, #ebcb71)";
const PAD = { l: 26, r: 8, t: 14, b: 18 };

/** Width of the box the chart sits in; a guess until the first measure (SSR). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setW(Math.max(160, Math.round(el.clientWidth)));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function dayMs(d: number): number {
  return d * DAY_MS;
}

/** Dates under the plot: the first day, then every whole number of weeks, ~3 labels. */
function xTicks(n: number): number[] {
  if (n <= 1) return [0];
  const step = Math.max(7, Math.ceil(n / 3 / 7) * 7);
  const out: number[] = [];
  for (let i = 0; i < n - 3; i += step) out.push(i);
  return out.length ? out : [0];
}

/**
 * Lithos per UTC day since launch: blocks as bars (today hatched, partial), or GH/s / share of
 * blocks over a rolling 7-day window as a line with a ±1/√n band. One axis per view.
 */
export function LithosDailyChart({
  series,
  view,
  height,
}: {
  series: readonly LithosDay[];
  view: LithosChartView;
  height: number;
}) {
  const t = useT();
  const { locale, tn } = useI18n();
  const { ref, w } = useWidth(460);
  const tip = useFloatTip({ within: () => ref.current });
  const [hover, setHover] = useState<number | null>(null);
  const roll = useMemo(() => rollingSeries(series), [series]);
  const n = series.length;
  const iw = Math.max(1, w - PAD.l - PAD.r);
  const ih = Math.max(1, height - PAD.t - PAD.b);
  const slot = iw / Math.max(1, n);

  const values =
    view === "blocks" ? series.map((d) => d.lb) : view === "hash" ? roll.map((p) => p.ghs) : roll.map((p) => p.share);
  const highs = view === "blocks" ? values : view === "hash" ? roll.map((p) => p.hi) : roll.map((p) => p.shareHi);
  const lineMax = Math.max(0, ...values);
  // The band may run high on the thin first days: the axis follows the line, the band is clipped.
  // The peak label sits in the top padding, so no headroom: 57 blocks → 0 / 20 / 40 / 60.
  const ticks = niceTicks(Math.max(lineMax, view === "blocks" ? 4 : 0.01));
  const yMax = ticks[ticks.length - 1]!;
  const Y = (v: number) => PAD.t + ih * (1 - Math.min(v, yMax) / yMax);
  const X = (i: number) => PAD.l + slot * (i + 0.5);
  const base = Y(0);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const tickText = (v: number) =>
    step >= 1 ? formatInt(v, locale) : formatGroupedNumber(v, step >= 0.1 ? 1 : 2, step >= 0.1 ? 1 : 2, locale);

  const peak = values.reduce((best, v, i) => (v > (values[best] ?? -1) ? i : best), 0);
  const valueText = (i: number) => {
    const v = values[i] ?? 0;
    if (view === "blocks") return formatInt(v, locale);
    if (view === "hash") return formatGroupedNumber(v, v >= 10 ? 0 : 1, v >= 10 ? 0 : 2, locale);
    return formatShare(v, locale);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const i = Math.min(n - 1, Math.max(0, Math.floor((x - PAD.l) / slot)));
    if (!Number.isFinite(i) || !series[i]) return;
    setHover(i);
    const day = series[i]!;
    const p = roll[i]!;
    const when = `${formatDottedDate(dayMs(day.d), "UTC")}${day.s != null ? ` · ${t("lithosH.today")}` : ""}`;
    const body =
      view === "blocks" ? (
        <>
          <TipFigure dot={INK}>{tn("lithosH.tipBlocks", day.lb, formatInt(day.lb, locale))}</TipFigure>
          <TipNote>{t("lithosH.tipOf").replace("{n}", formatInt(day.nb, locale))}</TipNote>
        </>
      ) : (
        <>
          <TipFigure dot={INK}>
            {view === "hash"
              ? `${formatGroupedNumber(p.ghs, 2, 2, locale)} GH/s`
              : `${formatShare(p.share, locale)}%`}
            {p.n > 0 ? ` ±${Math.round(100 / Math.sqrt(p.n))}%` : ""}
          </TipFigure>
          <TipNote>
            {`${t("lithosH.tipWindow")} · ${tn("lithosH.tipBlocks", p.n, formatInt(p.n, locale))} ${t("lithosH.tipOf").replace("{n}", formatInt(p.nb, locale))}`}
          </TipNote>
        </>
      );
    tip.show(
      pointRect(box.left + X(i), box.top + Y(values[i] ?? 0), 4),
      <>
        <TipHead mono quiet>
          {when}
        </TipHead>
        {body}
      </>,
      { tapped: e.pointerType === "touch" }
    );
  };
  const onLeave = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    setHover(null);
    tip.hide();
  };

  let plot: ReactNode = null;
  if (view === "blocks") {
    const bw = Math.max(1.5, slot - 2);
    plot = series.map((day, i) => {
      if (day.lb <= 0) return null;
      const x = PAD.l + slot * i + (slot - bw) / 2;
      const top = Y(day.lb);
      const r = Math.min(2, bw / 2, base - top);
      const d = `M${x.toFixed(1)} ${base.toFixed(1)}V${(top + r).toFixed(1)}Q${x.toFixed(1)} ${top.toFixed(1)} ${(x + r).toFixed(1)} ${top.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${top.toFixed(1)} ${(x + bw).toFixed(1)} ${(top + r).toFixed(1)}V${base.toFixed(1)}Z`;
      return (
        <path
          key={day.d}
          d={d}
          fill={day.s != null ? "url(#lithos-hatch)" : INK}
          opacity={hover != null && hover !== i ? 0.55 : 1}
        />
      );
    });
  } else if (n > 1) {
    const lo = view === "hash" ? roll.map((p) => p.lo) : roll.map((p) => p.shareLo);
    const line = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const band =
      highs.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("") +
      lo
        .map((v, i) => [X(i), Y(v)] as const)
        .reverse()
        .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
        .join("") +
      "Z";
    const last = n - 1;
    plot = (
      <>
        <path d={band} fill={INK} fillOpacity={0.16} />
        <path d={line} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={X(last)} cy={Y(values[last] ?? 0)} r={4} fill="var(--module)" stroke={INK} strokeWidth={2} />
        {hover != null ? (
          <circle cx={X(hover)} cy={Y(values[hover] ?? 0)} r={4} fill={INK} stroke="var(--module)" strokeWidth={2} />
        ) : null}
      </>
    );
  }

  const peakX = X(peak);
  const peakY = Y(values[peak] ?? 0);
  const peakLabel =
    view === "blocks"
      ? valueText(peak)
      : t("lithosH.peak").replace("{v}", valueText(peak)).replace("{d}", formatDottedDay(dayMs(series[peak]?.d ?? 0), "UTC"));
  const peakAnchor = peakX < PAD.l + 40 ? "start" : peakX > w - PAD.r - 40 ? "end" : "middle";

  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ height }}>
      <svg
        width={w}
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={t(view === "blocks" ? "lithosH.chartBlocks" : view === "hash" ? "lithosH.chartHash" : "lithosH.chartShare")}
        className="block touch-pan-y select-none overflow-visible"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={onLeave}
      >
        <defs>
          <pattern id="lithos-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="#ebcb71" fillOpacity="0.35" />
            <rect width="2" height="4" fill="#ebcb71" />
          </pattern>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 5} y={Y(v) + 3} textAnchor="end" className="fill-[var(--muted-2)] font-mono text-[10px]">
              {tickText(v)}
            </text>
          </g>
        ))}
        {xTicks(n).map((i) => (
          <text
            key={i}
            x={X(i)}
            y={height - 4}
            textAnchor={i === 0 ? "start" : "middle"}
            className="fill-[var(--muted-2)] font-mono text-[10px]"
          >
            {formatDottedDay(dayMs(series[i]!.d), "UTC")}
          </text>
        ))}
        {plot}
        {n > 0 && (values[peak] ?? 0) > 0 ? (
          <text
            x={peakX}
            y={Math.max(10, peakY - 5)}
            textAnchor={peakAnchor}
            className="fill-[var(--text)] font-mono text-[11px] font-semibold"
          >
            {peakLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

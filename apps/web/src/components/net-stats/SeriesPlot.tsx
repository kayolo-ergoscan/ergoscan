"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
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

/** Width of a box, from one ResizeObserver; `fallback` until it reports (and on the server). */
function useBoxWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((rows) => {
      const next = Math.round(rows[0]?.contentRect.width ?? 0);
      if (next > 0) setW((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A line's `pts` are the week's own points (hover reads them); `edge` only starts the line on t0. */
export type PlotData =
  | { kind: "line"; pts: readonly NetPt[]; edge?: NetPt | null }
  | { kind: "bars"; bins: readonly NetBin[] };

export type PlotValue = { t: number; t1?: number; v: number; open?: boolean };

/** The point or column under time t (or null), for a readout. */
export function valueAt(data: PlotData, t: number | null): PlotValue | null {
  if (t == null) return null;
  if (data.kind === "bars") {
    const i = binIndex(data.bins, t);
    const b = i >= 0 ? data.bins[i]! : null;
    return b && b.known ? { t: b.t, t1: b.t1, v: b.v, open: b.open } : null;
  }
  const i = nearestIndex(data.pts, t);
  return i >= 0 ? data.pts[i]! : null;
}

/**
 * One series over the shared week. A level is a 2 px line on a 10 % wash with a ringed end dot;
 * a sum is columns from a zero baseline (≤ 24 px, 4 px data end, the open bin as a ghost).
 * Hover comes from the parent (`hoverT`), so the stacked plots share one crosshair.
 */
export const SeriesPlot = memo(function SeriesPlot({
  data,
  t0,
  t1,
  ink,
  height,
  hoverT,
}: {
  data: PlotData;
  t0: number;
  t1: number;
  ink: string;
  height: number;
  hoverT: number | null;
}) {
  const [box, w] = useBoxWidth<HTMLDivElement>(600);
  const geo = useMemo(() => {
    if (data.kind === "bars") {
      const ceil = barCeiling(data.bins.filter((b) => b.known && b.t1 > t0).map((b) => b.v));
      const f: Frame = { w, h: height, t0, t1, lo: 0, hi: ceil.hi, top: 3, bottom: 0 };
      return { f, bars: barPaths(f, data.bins), line: "", area: "" };
    }
    const drawn = data.edge ? [data.edge, ...data.pts] : data.pts;
    const [lo, hi] = extent(drawn.map((p) => p.v));
    const f: Frame = { w, h: height, t0, t1, lo, hi, top: 6, bottom: 6 };
    return { f, bars: null, line: linePath(f, drawn), area: areaPath(f, drawn) };
  }, [data, t0, t1, w, height]);

  const f = geo.f;
  const hv = valueAt(data, hoverT);
  const dim = hv != null && data.kind === "bars";

  // The week itself: built once per data/size, so a hover re-renders only the overlay below
  // (React skips an element it gets back unchanged).
  const base = useMemo(
    () => (
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {geo.bars ? (
          <>
            <line x1={0} x2={w} y1={height - 0.5} y2={height - 0.5} stroke="var(--wash-mid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={geo.bars.closed} fill={ink} opacity={dim ? 0.38 : 0.62} />
            <path d={geo.bars.open} fill={ink} opacity={0.24} />
            {geo.bars.cut ? <path d={geo.bars.cut} fill="var(--module)" /> : null}
          </>
        ) : (
          <>
            <path d={geo.area} fill={ink} opacity={0.1} />
            <path d={geo.line} fill="none" stroke={ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    ),
    [geo, w, height, ink, dim]
  );

  // The overlay: the newest column (at rest) or the hovered one, the crosshair, the end/hover dot.
  let mark = "";
  let markOpen = false;
  if (data.kind === "bars") {
    const one = hv ? data.bins.find((b) => b.t === hv.t) : [...data.bins].reverse().find((b) => !b.open && b.known);
    if (one) mark = barPaths(f, [{ ...one, open: false }]).closed;
    // A hovered column still filling stays a lighter step: it is the part so far.
    markOpen = one?.open ?? false;
  }
  const dot = data.kind === "line" ? (hv ?? data.pts[data.pts.length - 1] ?? null) : null;
  // The pointer's hour in every plot, so stacked plots share one straight crosshair.
  const cx = hoverT != null ? xOf(f, data.kind === "line" && hv ? hv.t : hoverT) : null;

  return (
    <div ref={box} className="relative w-full" style={{ height }}>
      {base}
      {mark || cx != null ? (
        <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {mark ? <path d={mark} fill={ink} opacity={markOpen ? 0.62 : 1} /> : null}
          {geo.bars?.cut && mark ? <path d={geo.bars.cut} fill="var(--module)" /> : null}
          {cx != null ? <line x1={cx} x2={cx} y1={0} y2={height} stroke="var(--hair)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
      ) : null}
      {dot ? (
        <span
          className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${(xOf(f, dot.t) / w) * 100}%`, top: yOf(f, dot.v), background: ink, boxShadow: "0 0 0 2px var(--module)" }}
        />
      ) : null}
    </div>
  );
});

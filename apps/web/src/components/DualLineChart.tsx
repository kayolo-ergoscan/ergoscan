"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { EffectScatterChart, LineChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { chartChrome } from "@/lib/chart-chrome";
import { formatDottedDate, formatH24 } from "@/lib/format";
import { neonLine } from "@/lib/chart-neon";
import { useInk } from "@/lib/use-ink";
import {
  HOME_TX_CHART_BIN_MS,
  TX_ACTIVITY_TZ,
  binTxActivity,
  dropOpenActivityBin,
  formatActivityTick,
  formatActivityWindow,
  type TxActivityPoint,
} from "@/lib/tx-activity-bin";

echarts.use([
  LineChart,
  ScatterChart,
  EffectScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

export type { TxActivityPoint };

/** AdaStat-like: soft sky + pink, no fill. Not brand cyan / violet-on-wash. */
const TX = "#86a6f0";
const FEE = "#e799b7";
const DAY_MS = 24 * 60 * 60 * 1000;

function tickStepDays(tMin: number, tMax: number): number {
  const days = (tMax - tMin) / DAY_MS;
  if (days <= 16) return 2;
  if (days <= 120) return 14;
  if (days <= 400) return 30;
  return 60;
}

function utcDayTicks(tMin: number, tMax: number, stepDays = 2): number[] {
  const step = stepDays * DAY_MS;
  const first = Math.floor(tMin / DAY_MS) * DAY_MS;
  const last = Math.floor(tMax / DAY_MS) * DAY_MS;
  const out: number[] = [];
  for (let t = first; t <= last; t += step) out.push(t);
  return out;
}

function fmtTime(t: number, _locale?: string): string {
  return `${formatDottedDate(t, TX_ACTIVITY_TZ)}, ${formatH24(t, TX_ACTIVITY_TZ, false)}`;
}

/** Same relative pad on both axes so txs and fees share visual amplitude. */
function padAxis(
  extent: { min: number; max: number },
  fill = false
): { min: number; max: number } {
  const span = extent.max - extent.min;
  if (fill) {
    const pad = span > 0 ? span * 0.1 : Math.max(Math.abs(extent.max) * 0.05, 1e-9);
    return { min: extent.min - pad, max: extent.max + pad };
  }
  const pad = span > 0 ? span * 0.28 : Math.max(Math.abs(extent.max) * 0.15, 1);
  return { min: Math.max(0, extent.min - pad), max: extent.max + pad };
}

function lastPair(data: [number, number | null][]): [number, number][] {
  for (let i = data.length - 1; i >= 0; i--) {
    const p = data[i];
    if (!p) continue;
    const y = p[1];
    if (y != null && Number.isFinite(y)) return [[p[0], y]];
  }
  return [];
}

function tipRipple(
  data: [number, number][],
  color: string,
  yAxisIndex: number,
  reduced: boolean
) {
  if (!data.length) return [];
  if (reduced) {
    return [
      {
        type: "scatter" as const,
        yAxisIndex,
        data,
        symbol: "circle",
        symbolSize: 8,
        silent: true,
        z: 6,
        tooltip: { show: false },
        itemStyle: { color },
      },
    ];
  }
  return [
    {
      type: "effectScatter" as const,
      yAxisIndex,
      data,
      symbol: "circle",
      symbolSize: 9,
      silent: true,
      z: 6,
      tooltip: { show: false },
      showEffectOn: "render" as const,
      rippleEffect: {
        brushType: "stroke" as const,
        scale: 2.8,
        period: 2.6,
        number: 2,
      },
      itemStyle: { color },
    },
  ];
}

export function DualLineChart({
  points,
  height,
  formatTxs,
  formatFees,
  nameTxs,
  nameFees,
  onHover,
  compact = false,
  colorTxs = TX,
  colorFees = FEE,
  locale,
  binMs = HOME_TX_CHART_BIN_MS,
  skipBin = false,
  yRight = false,
  fillPlot = false,
  tipPulse = false,
  revealKey,
  series = "both",
  glow = false,
  showTip = true,
}: {
  points: TxActivityPoint[];
  height?: number;
  formatTxs: (v: number) => string;
  formatFees: (v: number) => string;
  nameTxs: string;
  nameFees: string;
  onHover?: (p: TxActivityPoint | null) => void;
  compact?: boolean;
  colorTxs?: string;
  colorFees?: string;
  locale?: string;
  /** Display bin. Home stays 12h UTC. Rent history uses a week. */
  binMs?: number;
  /** Already-bucketed series — do not re-wall or drop the last stroke. */
  skipBin?: boolean;
  /** Price ticks only on the right. */
  yRight?: boolean;
  /** Tight y-pad so the series uses most of the plot. */
  fillPlot?: boolean;
  /** Pulsing dots on the latest stroke. */
  tipPulse?: boolean;
  /** When this changes, the old plot blinks out and the next one draws in from the left. */
  revealKey?: string;
  /** Home split tiles draw one series; oracles/DEX keep both. */
  series?: "both" | "txs" | "fees";
  /** Neon halo on the stroke, plus a short fade under it. Home txs and fees. */
  glow?: boolean;
  /** False keeps the axis hair and the hover callback, and hides the date box. */
  showTip?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const fmtTxs = useRef(formatTxs);
  const fmtFees = useRef(formatFees);
  const hover = useRef(onHover);
  const labels = useRef({ nameTxs, nameFees });
  const loc = useRef(locale);
  const quietMove = useRef<((ev: MouseEvent) => void) | null>(null);
  fmtTxs.current = formatTxs;
  fmtFees.current = formatFees;
  hover.current = onHover;
  labels.current = { nameTxs, nameFees };
  loc.current = locale;
  const ink = useInk();
  const incoming = useRef(points);
  incoming.current = points;
  const [shown, setShown] = useState(points);
  const [veil, setVeil] = useState<"idle" | "out" | "hold" | "in">("idle");
  const revealSeen = useRef(revealKey);
  const shownKey = useRef(revealKey);
  const snap = useRef(false);
  const frozen = useRef(false);

  useEffect(() => {
    if (revealKey != null && revealKey !== shownKey.current) return;
    if (!frozen.current) setShown(points);
  }, [points, revealKey]);

  useEffect(() => {
    if (revealKey == null || revealKey === revealSeen.current) return;
    revealSeen.current = revealKey;
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      frozen.current = false;
      snap.current = true;
      shownKey.current = revealKey;
      setShown(incoming.current);
      setVeil("idle");
      return;
    }
    frozen.current = true;
    setVeil("out");
    const outId = window.setTimeout(() => {
      snap.current = true;
      shownKey.current = revealKey;
      setShown(incoming.current);
      frozen.current = false;
      setVeil("hold");
    }, 380);
    const drawId = window.setTimeout(() => setVeil("in"), 430);
    const doneId = window.setTimeout(() => setVeil("idle"), 430 + 720);
    return () => {
      window.clearTimeout(outId);
      window.clearTimeout(drawId);
      window.clearTimeout(doneId);
      frozen.current = false;
    };
  }, [revealKey]);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const c = echarts.init(node, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);
    const leave = () => hover.current?.(null);
    node.addEventListener("mouseleave", leave);
    return () => {
      node.removeEventListener("mouseleave", leave);
      if (quietMove.current) node.removeEventListener("mousemove", quietMove.current);
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const chrome = chartChrome();
    const day = ink === "day";
    const wall = binMs > 0 ? binMs : HOME_TX_CHART_BIN_MS;
    const binned = skipBin ? shown : dropOpenActivityBin(binTxActivity(shown, wall), wall);
    const seriesPts = binned.length >= 2 ? binned : shown;
    const windowMs = skipBin ? (binMs > 0 ? wall : 0) : binned.length >= 2 ? wall : 0;
    if (seriesPts.length < 2) {
      c.clear();
      return;
    }
    const wantTxs = series !== "fees";
    const wantFees = series !== "txs";
    const showFees =
      wantFees && seriesPts.some((p) => p.feesKnown !== false && p.feesErg > 0);
    const showTxs = wantTxs;
    const single = series !== "both";
    const txData = seriesPts.map((p) => [p.t, p.txs] as [number, number]);
    const feeData = seriesPts.map((p) =>
      p.feesKnown === false ? [p.t, null] : [p.t, p.feesErg]
    ) as [number, number | null][];
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const quiet = snap.current;
    if (quiet) snap.current = false;
    const xTicks = utcDayTicks(
      seriesPts[0]!.t,
      seriesPts[seriesPts.length - 1]!.t,
      tickStepDays(seriesPts[0]!.t, seriesPts[seriesPts.length - 1]!.t)
    );
    const grid = yRight
      ? compact
        ? { top: fillPlot ? 8 : 12, right: 48, bottom: fillPlot ? 22 : 28, left: 8 }
        : { top: fillPlot ? 8 : 16, right: 56, bottom: fillPlot ? 26 : 36, left: 10 }
      : compact
        ? {
            top: single ? (glow ? 18 : 8) : 12,
            right: showFees && showTxs ? 44 : 10,
            bottom: single ? 20 : 28,
            left: 36,
          }
        : { top: 16, right: showFees && showTxs ? 52 : 12, bottom: 36, left: 52 };
    const txTip = tipPulse && showTxs ? lastPair(txData) : [];
    const feeTip = tipPulse && showFees ? lastPair(feeData) : [];
    const feeAxis = showFees && showTxs && !yRight;
    const yFmt = showTxs ? (v: number) => fmtTxs.current(v) : (v: number) => fmtFees.current(v);
    c.setOption(
      {
        ...(chrome.font ? { textStyle: { fontFamily: chrome.font } } : {}),
        useUTC: true,
        animationDuration: reduced || quiet ? 0 : 420,
        animationEasing: "cubicOut",
        grid,
        tooltip: {
          trigger: "axis",
          showContent: showTip,
          axisPointer: {
            type: "line",
            lineStyle: {
              color: showTip ? chrome.hair : showFees && !showTxs ? colorFees : colorTxs,
              width: 1,
              type: showTip ? ("dashed" as const) : ("solid" as const),
              opacity: showTip ? 1 : 0.55,
            },
          },
          backgroundColor: chrome.module,
          borderColor: chrome.border,
          borderWidth: showTip ? 1 : 0,
          padding: showTip ? [8, 12] : 0,
          textStyle: { color: chrome.text, fontSize: 12 },
          formatter: (raw: unknown) => {
            const rows = Array.isArray(raw) ? raw : [raw];
            const first = rows[0] as { value?: [number, number] } | undefined;
            const t = first?.value?.[0];
            if (t == null) return "";
            const y = (rows[0] as { value?: [number, number] })?.value?.[1] ?? 0;
            const src =
              seriesPts.find((p) => p.t === t) ??
              seriesPts.reduce<(typeof seriesPts)[number] | null>((best, p) => {
                if (!best) return p;
                return Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best;
              }, null);
            hover.current?.(src ?? { t, txs: showTxs ? y : 0, feesErg: showTxs ? 0 : y });
            if (!showTip) return "";
            const { nameTxs: nT, nameFees: nF } = labels.current;
            const feeTxt =
              src == null
                ? "—"
                : src.feesKnown === false
                  ? "—"
                  : fmtFees.current(src.feesErg);
            const when =
              windowMs > 0
                ? formatActivityWindow(t, windowMs, loc.current)
                : fmtTime(t, loc.current);
            if (showTxs && showFees) {
              return `${when}<br/>${nT}  ${fmtTxs.current(src?.txs ?? y)}<br/>${nF}  ${feeTxt}`;
            }
            if (showFees) return `${when}<br/>${nF}  ${feeTxt}`;
            return `${when}<br/>${nT}  ${fmtTxs.current(src?.txs ?? y)}`;
          },
        },
        xAxis: {
          type: "time",
          boundaryGap: ["2%", "2%"],
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: chrome.muted,
            fontSize: 11,
            hideOverlap: true,
            customValues: xTicks,
            formatter: (value: number) => formatActivityTick(value, loc.current),
          },
        },
        yAxis: [
          {
            type: "value",
            position: yRight ? "right" : "left",
            min: (ext: { min: number; max: number }) => padAxis(ext, fillPlot).min,
            max: (ext: { min: number; max: number }) => padAxis(ext, fillPlot).max,
            splitNumber: single ? 3 : 4,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: glow
              ? { show: true, lineStyle: { color: chrome.hair, opacity: day ? 0.16 : 0.2, width: 1 } }
              : { show: false },
            axisLabel: {
              color: chrome.muted,
              fontSize: 11,
              formatter: (v: number) => yFmt(v),
            },
          },
          {
            type: "value",
            position: "right",
            min: (ext: { min: number; max: number }) => padAxis(ext, fillPlot).min,
            max: (ext: { min: number; max: number }) => padAxis(ext, fillPlot).max,
            splitNumber: 4,
            show: feeAxis,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: {
              color: chrome.muted,
              fontSize: 11,
              formatter: (v: number) => fmtFees.current(v),
            },
          },
        ],
        series: [
          ...(showTxs
            ? glow
              ? neonLine({
                  data: txData,
                  color: colorTxs,
                  name: labels.current.nameTxs,
                  day,
                  smooth: 0.55,
                  width: 2,
                  wash: 0.2,
                  yAxisIndex: 0,
                })
              : [
                  {
                    type: "line" as const,
                    yAxisIndex: 0,
                    name: labels.current.nameTxs,
                    data: txData,
                    showSymbol: false,
                    symbol: "circle",
                    symbolSize: 8,
                    smooth: 0.65,
                    lineStyle: { width: 2.5, color: colorTxs, cap: "round" as const, join: "round" as const },
                    itemStyle: { color: colorTxs },
                    emphasis: { scale: true, lineStyle: { width: 2.6 } },
                  },
                ]
            : []),
          ...(showFees
            ? glow
              ? neonLine({
                  data: feeData,
                  color: colorFees,
                  name: labels.current.nameFees,
                  day,
                  smooth: 0.55,
                  width: 2,
                  wash: 0.2,
                  connectNulls: false,
                  yAxisIndex: showTxs ? 1 : 0,
                })
              : [
                  {
                    type: "line" as const,
                    yAxisIndex: showTxs ? 1 : 0,
                    name: labels.current.nameFees,
                    data: feeData,
                    showSymbol: false,
                    symbol: "circle",
                    symbolSize: 8,
                    smooth: 0.65,
                    connectNulls: false,
                    lineStyle: {
                      width: 2.4,
                      color: colorFees,
                      cap: "round" as const,
                      join: "round" as const,
                      type: "solid" as const,
                    },
                    itemStyle: { color: colorFees },
                    emphasis: { scale: true, lineStyle: { width: 2.6 } },
                  },
                ]
            : []),
          ...tipRipple(txTip, colorTxs, 0, reduced),
          ...tipRipple(feeTip, colorFees, showTxs ? 1 : 0, reduced),
        ],
      },
      { notMerge: true }
    );
    const node = el.current;
    if (node && quietMove.current) {
      node.removeEventListener("mousemove", quietMove.current);
      quietMove.current = null;
    }
    if (node && !showTip) {
      const onMove = (ev: MouseEvent) => {
        const rect = node.getBoundingClientRect();
        const raw = c.convertFromPixel({ gridIndex: 0 }, [ev.clientX - rect.left, ev.clientY - rect.top]);
        const t = Array.isArray(raw) ? raw[0] : null;
        if (typeof t !== "number" || !Number.isFinite(t)) return;
        let best = seriesPts[0];
        let dist = Infinity;
        for (const p of seriesPts) {
          const d = Math.abs(p.t - t);
          if (d < dist) {
            dist = d;
            best = p;
          }
        }
        if (!best) return;
        hover.current?.(best);
      };
      quietMove.current = onMove;
      node.addEventListener("mousemove", onMove);
    }
  }, [shown, compact, colorTxs, colorFees, locale, binMs, skipBin, yRight, fillPlot, tipPulse, series, glow, showTip, ink]);

  return (
    <div
      ref={el}
      className={
        "h-full min-h-0 w-full" +
        (veil === "out"
          ? " chart-range-out"
          : veil === "hold"
            ? " chart-range-hold"
            : veil === "in"
              ? " chart-range-in"
              : "")
      }
      style={height != null ? { height } : series === "both" ? { minHeight: 168 } : undefined}
    />
  );
}

export default DualLineChart;

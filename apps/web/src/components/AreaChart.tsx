"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { LinePoint } from "@lumen/amm-chart";
import { chartChrome } from "@/lib/chart-chrome";
import { formatDottedDate, formatH24 } from "@/lib/format";
import { neonLine } from "@/lib/chart-neon";
import { useInk } from "@/lib/use-ink";
import { TipFigure, TipHead, useFloatTip } from "@/components/Tip";
import { pointRect } from "@/lib/tip-place";
import {
  TX_ACTIVITY_TZ,
  binLinePoints,
  formatActivityWindow,
} from "@/lib/tx-activity-bin";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

function fmtTime(t: number, _locale?: string): string {
  return `${formatDottedDate(t, TX_ACTIVITY_TZ)}, ${formatH24(t, TX_ACTIVITY_TZ, false)}`;
}

export function AreaChart({
  points,
  height = 220,
  formatValue,
  onHover,
  color,
  compact = false,
  binMs = 0,
  locale,
  fillOpacity = 0.45,
  lineWidth = 1.5,
  glow = false,
  fill = false,
  showTip = true,
  activity = false,
}: {
  points: LinePoint[];
  height?: number;
  formatValue: (v: number) => string;
  onHover?: (v: number | null, t?: number | null) => void;
  /** Override PnL green/red (e.g. volume uses link cyan). */
  color?: string;
  /** KPI spark: no axis labels, tight grid. */
  compact?: boolean;
  /** Display-only mean bins. Snapshot stays hourly. */
  binMs?: number;
  locale?: string;
  /** 0 = stroke only. Home KPI keeps 0.45. */
  fillOpacity?: number;
  lineWidth?: number;
  /** Neon core, halo, and a fade under the stroke. Home KPI sparks. */
  glow?: boolean;
  /** Stretch to the parent. Parent must have a height. */
  fill?: boolean;
  /** False keeps the axis hair and the hover callback, and hides the date box. */
  showTip?: boolean;
  /** Same neon stack as the home transactions chart. */
  activity?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const fmt = useRef(formatValue);
  const hover = useRef(onHover);
  const quietMove = useRef<((ev: PointerEvent) => void) | null>(null);
  /** The shared tip at the hovered point; a tap on a phone shows it too. */
  const pointTip = useFloatTip({ within: () => el.current });
  const loc = useRef(locale);
  fmt.current = formatValue;
  hover.current = onHover;
  loc.current = locale;
  const ink = useInk();

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const c = echarts.init(node, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);
    const leave = (ev: PointerEvent) => {
      if (ev.pointerType === "touch") return;
      hover.current?.(null);
      pointTip.hide();
    };
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointerleave", leave);
      if (quietMove.current) {
        node.removeEventListener("pointermove", quietMove.current);
        node.removeEventListener("pointerdown", quietMove.current);
      }
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const binned = binMs > 0 ? binLinePoints(points, binMs) : [];
    const seriesPts = binned.length >= 2 ? binned : points;
    const windowMs = binned.length >= 2 ? binMs : 0;
    if (seriesPts.length < 2) {
      c.clear();
      return;
    }
    const chrome = chartChrome();
    const day = ink === "day";
    const up = seriesPts[seriesPts.length - 1]!.v >= seriesPts[0]!.v;
    const stroke = color ?? (up ? chrome.up : chrome.down);
    const data = seriesPts.map((p) => [p.t, p.v] as [number, number]);
    const line =
      glow
        ? neonLine({
            data,
            color: stroke,
            name: "",
            day,
            smooth: activity ? 0.55 : 0.15,
            width: activity ? 2 : lineWidth,
            wash: activity ? 0.2 : 0,
            scatter: activity ? 0 : 22,
          })
        : [
            {
              type: "line" as const,
              data,
              showSymbol: false,
              symbol: "none" as const,
              smooth: fillOpacity <= 0.15 ? 0.65 : true,
              ...(windowMs > 0 && fillOpacity > 0.15 ? { smoothMonotone: "x" as const } : {}),
              lineStyle: { width: lineWidth, color: stroke, cap: "round" as const, join: "round" as const },
              ...(fillOpacity > 0 ? { areaStyle: { color: stroke, opacity: fillOpacity } } : {}),
            },
          ];
    c.setOption(
      {
        ...(chrome.font ? { textStyle: { fontFamily: chrome.font } } : {}),
        animationDuration: 280,
        animationEasing: "cubicOut",
        grid: compact
          ? activity
            ? { top: 6, right: 6, bottom: 2, left: 6 }
            : { top: glow ? 4 : 6, right: 4, bottom: glow ? 2 : 4, left: 4 }
          : { top: 16, right: 4, bottom: 22, left: 4 },
        tooltip: {
          trigger: "axis",
          showContent: false,
          axisPointer: {
            type: "line",
            lineStyle: { color: showTip ? chrome.hair : stroke, width: 1, opacity: showTip ? 1 : 0.45 },
          },
        },
        xAxis: {
          type: "time",
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: compact
            ? { show: false }
            : { color: chrome.muted, fontSize: 10, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          scale: true,
          show: activity,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: activity
            ? { show: true, lineStyle: { color: chrome.hair, opacity: day ? 0.16 : 0.2, width: 1 } }
            : { show: false },
          ...(glow
            ? {
                min: (ext: { min: number; max: number }) => {
                  const span = Math.max(ext.max - ext.min, Math.abs(ext.max) * 0.004, 1e-9);
                  const pad = activity ? span * 0.28 : span * 0.35;
                  return ext.min - pad;
                },
                max: (ext: { min: number; max: number }) => {
                  const span = Math.max(ext.max - ext.min, Math.abs(ext.max) * 0.004, 1e-9);
                  const pad = activity ? span * 0.28 : span * 0.35;
                  return ext.max + pad;
                },
              }
            : {}),
        },
        series: line,
      },
      { notMerge: true }
    );
    const node = el.current;
    if (node && quietMove.current) {
      node.removeEventListener("pointermove", quietMove.current);
      node.removeEventListener("pointerdown", quietMove.current);
      quietMove.current = null;
    }
    if (node) {
      const onMove = (ev: PointerEvent) => {
        if (ev.type === "pointermove" && ev.pointerType === "touch") return;
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
        hover.current?.(best.v, best.t);
        if (!showTip) return;
        const px = c.convertToPixel({ gridIndex: 0 }, [best.t, best.v]);
        if (!Array.isArray(px)) return;
        const when =
          windowMs > 0 ? formatActivityWindow(best.t, windowMs, loc.current) : fmtTime(best.t, loc.current);
        pointTip.show(
          pointRect(rect.left + px[0]!, rect.top + px[1]!, 6),
          <>
            <TipHead mono quiet>{when}</TipHead>
            <TipFigure dot={stroke}>{fmt.current(best.v)}</TipFigure>
          </>,
          { tapped: ev.pointerType === "touch" }
        );
      };
      quietMove.current = onMove;
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerdown", onMove);
    }
  }, [points, color, compact, binMs, locale, fillOpacity, lineWidth, glow, showTip, activity, ink]);

  return (
    <div
      ref={el}
      className={fill ? "h-full w-full" : "w-full"}
      style={fill ? undefined : { height }}
    />
  );
}

export default AreaChart;

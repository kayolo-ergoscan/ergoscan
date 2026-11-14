"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as echarts from "echarts/core";
import { EffectScatterChart, LineChart, ScatterChart } from "echarts/charts";
import { AxisPointerComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { chartChrome } from "@/lib/chart-chrome";
import { formatDottedDate, formatH24 } from "@/lib/format";
import { neonLine } from "@/lib/chart-neon";
import { TipHead, TipRow, TipRows, useFloatTip } from "@/components/Tip";
import { pointRect } from "@/lib/tip-place";
import { useInk } from "@/lib/use-ink";
import { isLightInk } from "@/lib/skin-ink";
import { usePhoneChart } from "@/lib/use-phone-chart";
import {
  PHONE_CHART_PX,
  PHONE_READOUT_PX,
  PHONE_X_LABELS,
  finiteExtent,
  insideTicks,
  labelGutter,
  readoutWhen,
  thinTicks,
  tickStep,
  tickText,
} from "@/lib/chart-axis";
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
  const wrap = useRef<HTMLDivElement>(null);
  /** Removes the pointer listeners of the last paint. */
  const unbind = useRef<(() => void) | null>(null);
  /** The shared tip at the hovered day; a tap on a phone shows it too. */
  const lineTip = useFloatTip({ within: () => el.current });
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
  const phone = usePhoneChart();
  /** Phone: the point under a finger goes into the chart's own header line, not a floating tip. */
  const readout = phone && showTip;
  /** Phone, two series: the one whose scale the y labels show. */
  const [focus, setFocus] = useState<"txs" | "fees">("txs");
  /** The reading in the header line; null shows the latest point. */
  const [pick, setPick] = useState<TxActivityPoint | null>(null);

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

  const view = useMemo(() => {
    const wall = binMs > 0 ? binMs : HOME_TX_CHART_BIN_MS;
    const binned = skipBin ? shown : dropOpenActivityBin(binTxActivity(shown, wall), wall);
    const seriesPts = binned.length >= 2 ? binned : shown;
    const windowMs = skipBin ? (binMs > 0 ? wall : 0) : binned.length >= 2 ? wall : 0;
    const showTxs = series !== "fees";
    const showFees =
      series !== "txs" && seriesPts.some((p) => p.feesKnown !== false && p.feesErg > 0);
    return { seriesPts, windowMs, showTxs, showFees };
  }, [shown, binMs, skipBin, series]);
  const both = view.showTxs && view.showFees;
  /** Phone: the series whose scale the y labels show; the other one is drawn faint. */
  const lead: "txs" | "fees" = !view.showTxs ? "fees" : both ? focus : "txs";

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
      lineTip.hide();
      setPick(null);
      // A phone-width window drives the hair itself (triggerOn none), so it also takes it away.
      c.dispatchAction({ type: "hideTip" });
    };
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointerleave", leave);
      unbind.current?.();
      unbind.current = null;
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  // A tapped reading stays in the header until a tap lands outside the chart.
  useEffect(() => {
    if (!readout || !pick) return;
    const away = (ev: PointerEvent) => {
      const root = wrap.current;
      if (root && ev.target instanceof Node && root.contains(ev.target)) return;
      setPick(null);
      hover.current?.(null);
      chart.current?.dispatchAction({ type: "hideTip" });
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [readout, pick]);

  useEffect(() => {
    if (!readout) setPick(null);
  }, [readout]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const chrome = chartChrome();
    const day = isLightInk(ink);
    const { seriesPts, windowMs, showTxs, showFees } = view;
    if (seriesPts.length < 2) {
      c.clear();
      return;
    }
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
    // Phone: y labels sit inside the plot on the right, so the line keeps the full width.
    const grid = phone
      ? { top: readout ? 4 : 8, right: 4, bottom: 18, left: 4 }
      : yRight
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
    // Each axis spans its own series with the same pad the chart has always used.
    const padOf = (data: [number, number | null][]) => {
      const ext = finiteExtent(data.map((d) => d[1]));
      return ext ? padAxis(ext, fillPlot) : null;
    };
    const pad0 = padOf(showTxs ? txData : feeData);
    const pad1 = showTxs && showFees ? padOf(feeData) : null;
    // A padded floor is not a round tick; its label sat on the next one ($0.1557 under $0.1800).
    const floorLabel = (pad: { min: number } | null) => (pad && pad.min !== 0 ? { showMinLabel: false } : {});
    const label0 = !showTxs || lead === "txs";
    const label1 = showTxs && showFees && lead === "fees";
    const plotPx = Math.max(60, (el.current?.clientHeight || PHONE_CHART_PX) - grid.top - grid.bottom);
    // Phone: only the lead series' axis is labelled, with about three round figures.
    const leadPad = label1 ? pad1 : pad0;
    const yTicks = phone && leadPad ? insideTicks(leadPad.min, leadPad.max, 3, plotPx) : [];
    const yStep = tickStep(yTicks);
    const plotW = Math.max(60, (el.current?.clientWidth || 300) - grid.left - grid.right);
    // The line ends where the labels start, so the newest point never sits under a figure.
    const rightGap = phone ? labelGutter(yTicks.map((v) => tickText(v, yStep, locale)), plotW, 0.02, tipPulse ? 22 : 10) : 0.02;
    const phoneAxis = (pad: { min: number; max: number } | null, labelled: boolean) => {
      const ticks = labelled ? yTicks : [];
      const step = yStep;
      return {
        type: "value" as const,
        position: "right" as const,
        ...(pad ? { min: pad.min, max: pad.max } : {}),
        axisLine: { show: false },
        axisTick: { show: false, customValues: ticks },
        splitLine: labelled
          ? { show: true, lineStyle: { color: chrome.hair, opacity: day ? 0.16 : 0.2, width: 1 } }
          : { show: false },
        axisLabel: labelled
          ? {
              show: true,
              inside: true,
              align: "right" as const,
              verticalAlign: "bottom" as const,
              margin: 0,
              padding: [0, 0, 2, 0],
              color: chrome.muted,
              fontSize: 10,
              textBorderColor: chrome.module,
              textBorderWidth: 3,
              customValues: ticks,
              formatter: (v: number) => tickText(v, step, locale),
            }
          : { show: false },
      };
    };
    const dimTx = phone && showTxs && showFees && lead === "fees";
    const dimFee = phone && showTxs && showFees && lead === "txs";
    c.setOption(
      {
        ...(chrome.font ? { textStyle: { fontFamily: chrome.font } } : {}),
        useUTC: true,
        animationDuration: reduced || quiet ? 0 : 420,
        animationEasing: "cubicOut",
        grid,
        tooltip: {
          trigger: "axis",
          showContent: false,
          // The phone header line drives the hair itself, from the finger.
          triggerOn: readout ? ("none" as const) : ("mousemove|click" as const),
          axisPointer: {
            type: "line",
            lineStyle: {
              color: showTip ? chrome.hair : showFees && !showTxs ? colorFees : colorTxs,
              width: 1,
              type: showTip ? ("dashed" as const) : ("solid" as const),
              opacity: showTip ? 1 : 0.55,
            },
          },
        },
        xAxis: {
          type: "time",
          boundaryGap: ["2%", `${(rightGap * 100).toFixed(2)}%`],
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: chrome.muted,
            fontSize: phone ? 10 : 11,
            hideOverlap: true,
            customValues: phone
              ? thinTicks(
                  xTicks.filter((t) => t >= seriesPts[0]!.t && t <= seriesPts[seriesPts.length - 1]!.t),
                  PHONE_X_LABELS
                )
              : xTicks,
            formatter: (value: number) => formatActivityTick(value, loc.current),
          },
        },
        yAxis: phone
          ? [phoneAxis(pad0, label0), { ...phoneAxis(pad1, label1), show: showTxs && showFees }]
          : [
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
                  // The padded max is not a round tick; its label sat on top of the next one (97.3 over 90.0).
                  showMaxLabel: false,
                  ...floorLabel(pad0),
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
                  showMaxLabel: false,
                  ...floorLabel(pad1),
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
                    lineStyle: {
                      width: 2.5,
                      color: colorTxs,
                      cap: "round" as const,
                      join: "round" as const,
                      opacity: dimTx ? 0.45 : 1,
                    },
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
                      opacity: dimFee ? 0.45 : 1,
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
    unbind.current?.();
    unbind.current = null;
    if (node) {
      const nearest = (clientX: number, clientY: number): TxActivityPoint | null => {
        const rect = node.getBoundingClientRect();
        const raw = c.convertFromPixel({ gridIndex: 0 }, [clientX - rect.left, clientY - rect.top]);
        const t = Array.isArray(raw) ? raw[0] : null;
        if (typeof t !== "number" || !Number.isFinite(t)) return null;
        let best: TxActivityPoint | null = null;
        let dist = Infinity;
        for (const p of seriesPts) {
          const d = Math.abs(p.t - t);
          if (d < dist) {
            dist = d;
            best = p;
          }
        }
        return best;
      };
      /** Phone: the reading goes to the header line and the hair stands on the point. */
      const read = (best: TxActivityPoint) => {
        setPick(best);
        const px = c.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
          best.t,
          showTxs ? best.txs : best.feesErg,
        ]);
        if (Array.isArray(px)) c.dispatchAction({ type: "showTip", x: px[0], y: px[1] });
      };
      const unread = () => {
        setPick(null);
        hover.current?.(null);
        c.dispatchAction({ type: "hideTip" });
      };
      let finger: { id: number; x: number; y: number; slid: boolean } | null = null;
      const onMove = (ev: PointerEvent) => {
        const touch = ev.pointerType === "touch";
        if (ev.type === "pointerdown" && touch && readout) {
          finger = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, slid: false };
        }
        if (ev.type === "pointermove" && touch) {
          // A finger slides the reading only on a phone chart; elsewhere a tap reads.
          if (!readout || !finger || finger.id !== ev.pointerId) return;
          if (Math.hypot(ev.clientX - finger.x, ev.clientY - finger.y) > 6) finger.slid = true;
        }
        const best = nearest(ev.clientX, ev.clientY);
        if (!best) return;
        hover.current?.(best);
        if (readout) {
          read(best);
          return;
        }
        if (!showTip) return;
        const rect = node.getBoundingClientRect();
        // Anchor on the higher of the two dots, so the tip sits over both lines.
        const feeOk = showFees && best.feesKnown !== false;
        const ys: number[] = [];
        if (showTxs) {
          const px = c.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [best.t, best.txs]);
          if (Array.isArray(px)) ys.push(px[1]!);
        }
        if (feeOk) {
          const px = c.convertToPixel({ xAxisIndex: 0, yAxisIndex: showTxs ? 1 : 0 }, [best.t, best.feesErg]);
          if (Array.isArray(px)) ys.push(px[1]!);
        }
        const xs = c.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [best.t, 0]);
        const x = Array.isArray(xs) ? xs[0]! : ev.clientX - rect.left;
        const y = ys.length ? Math.min(...ys) : ev.clientY - rect.top;
        const { nameTxs: nT, nameFees: nF } = labels.current;
        const when =
          windowMs > 0 ? formatActivityWindow(best.t, windowMs, loc.current) : fmtTime(best.t, loc.current);
        lineTip.show(
          pointRect(rect.left + x, rect.top + y, 6),
          <>
            <TipHead mono quiet>{when}</TipHead>
            <TipRows>
              {showTxs ? (
                <TipRow label={nT} dot={colorTxs}>
                  {fmtTxs.current(best.txs)}
                </TipRow>
              ) : null}
              {showFees ? (
                <TipRow label={nF} dot={colorFees}>
                  {feeOk ? fmtFees.current(best.feesErg) : "—"}
                </TipRow>
              ) : null}
            </TipRows>
          </>,
          { tapped: touch }
        );
      };
      const onEnd = (ev: PointerEvent) => {
        if (!readout || ev.pointerType !== "touch" || !finger || finger.id !== ev.pointerId) return;
        const slid = finger.slid || ev.type === "pointercancel";
        finger = null;
        // A slide reads while the finger is down; a tap keeps its reading until a tap lands elsewhere.
        if (slid) unread();
      };
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerdown", onMove);
      node.addEventListener("pointerup", onEnd);
      node.addEventListener("pointercancel", onEnd);
      unbind.current = () => {
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerdown", onMove);
        node.removeEventListener("pointerup", onEnd);
        node.removeEventListener("pointercancel", onEnd);
      };
    }
  }, [view, compact, colorTxs, colorFees, locale, yRight, fillPlot, tipPulse, series, glow, showTip, ink, phone, readout, lead]);

  const latest = view.seriesPts.length ? view.seriesPts[view.seriesPts.length - 1]! : null;
  const reading = pick ?? latest;
  const feeKnown = reading != null && reading.feesKnown !== false;

  return (
    <div
      ref={wrap}
      className="flex h-full min-h-0 w-full flex-col"
      style={
        readout
          ? { height: PHONE_CHART_PX + PHONE_READOUT_PX }
          : height != null
            ? { height }
            : series === "both"
              ? { minHeight: 168 }
              : undefined
      }
    >
      {readout ? (
        <div
          className="flex shrink-0 items-center justify-between gap-2 text-[11px] leading-none"
          style={{ height: PHONE_READOUT_PX }}
        >
          <span className="min-w-0 truncate font-mono tabular-nums text-[var(--muted)]">
            {reading ? readoutWhen(reading.t, view.windowMs, TX_ACTIVITY_TZ) : ""}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {view.showTxs ? (
              <ReadoutValue
                color={colorTxs}
                label={nameTxs}
                on={lead === "txs"}
                onPick={both ? () => setFocus("txs") : undefined}
              >
                {reading ? formatTxs(reading.txs) : "—"}
              </ReadoutValue>
            ) : null}
            {view.showFees ? (
              <ReadoutValue
                color={colorFees}
                label={nameFees}
                on={lead === "fees"}
                onPick={both ? () => setFocus("fees") : undefined}
              >
                {reading && feeKnown ? formatFees(reading.feesErg) : "—"}
              </ReadoutValue>
            ) : null}
          </span>
        </div>
      ) : null}
      <div
        ref={el}
        className={clsx(
          "min-h-0 w-full flex-1",
          readout && "touch-pan-y",
          veil === "out"
            ? "chart-range-out"
            : veil === "hold"
              ? "chart-range-hold"
              : veil === "in"
                ? "chart-range-in"
                : null
        )}
      />
    </div>
  );
}

/**
 * One value in a phone chart header. With two series it is also the legend toggle:
 * the pressed one owns the y labels.
 */
function ReadoutValue({
  color,
  label,
  on,
  onPick,
  children,
}: {
  color: string;
  label: string;
  on: boolean;
  onPick?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="font-mono tabular-nums">{children}</span>
    </>
  );
  const base = "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2";
  if (!onPick) {
    return (
      <span className={clsx(base, "text-[var(--text)]")} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onPick}
      className={clsx(
        base,
        "chip-press transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        on ? "is-pressed bg-[var(--wash-mid)] text-[var(--text)]" : "text-[var(--muted)]"
      )}
    >
      {body}
    </button>
  );
}

export default DualLineChart;

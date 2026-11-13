"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { EffectScatterChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  RENT_SERIES_DAY_MS,
  mixRentExtent,
  rentChartCut,
  rentPadExtent,
  rentWindowExtent,
} from "@ergoscan/shared";
import { chartChrome } from "@/lib/chart-chrome";
import { formatDottedDate, formatDottedDay } from "@/lib/format";
import { pickRentChartTip } from "@/lib/rent-chart-tip";
import { TX_ACTIVITY_TZ } from "@/lib/tx-activity-bin";
import { useInk } from "@/lib/use-ink";
import { usePhoneChart } from "@/lib/use-phone-chart";
import { PHONE_X_LABELS, insideTicks, labelGutter, thinTicks, tickStep, tickText } from "@/lib/chart-axis";
import { TipHead, TipRow, TipRows, useFloatTip } from "@/components/Tip";
import { pointRect } from "@/lib/tip-place";

echarts.use([
  LineChart,
  EffectScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

const ERG = "#5ee0a0";
/** Phone plot: y labels inside on the right, so the line keeps the full width. */
const PHONE_GRID = { top: 6, right: 4, bottom: 18, left: 4 };
const DAY_MS = RENT_SERIES_DAY_MS;
const Y_FOLLOW = 0.2;
const Y_EPS = 1e-4;

export type RentChartPoint = {
  t: number;
  boxes: number;
  rentErg: number;
};

/** The day a phone reading points at; `due` marks a day still ahead. */
export type RentChartPick = RentChartPoint & { due: boolean };

function utcTicks(cutStart: number, cutEnd: number): number[] {
  const spanDays = Math.max(1, (cutEnd - cutStart) / DAY_MS);
  const stepDays = spanDays <= 22 ? 2 : spanDays <= 45 ? 4 : 7;
  const step = stepDays * DAY_MS;
  const first = Math.floor(cutStart / step) * step;
  const last = Math.floor(cutEnd / step) * step;
  const out: number[] = [];
  for (let t = first; t <= last; t += step) {
    if (t >= cutStart - step && t <= cutEnd + step) out.push(t);
  }
  return out.length ? out : [cutStart, cutEnd];
}

/** Phone: only the days inside the window, at most four. */
function phoneDays(start: number, end: number): number[] {
  return thinTicks(
    utcTicks(start, end).filter((t) => t >= start && t <= end),
    PHONE_X_LABELS
  );
}

function formatTick(t: number, _locale: string | undefined): string {
  return formatDottedDay(t, TX_ACTIVITY_TZ);
}

function formatWindow(t: number, _locale: string | undefined): string {
  return formatDottedDate(t, TX_ACTIVITY_TZ);
}

function rippleSeries(data: [number, number][], color: string, reduced: boolean) {
  if (!data.length) return [];
  if (reduced) {
    return [
      {
        type: "scatter" as const,
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

function yClose(
  a: { min: number; max: number },
  b: { min: number; max: number }
): boolean {
  return Math.abs(a.min - b.min) < Y_EPS && Math.abs(a.max - b.max) < Y_EPS;
}

export function RentHistoryChart({
  past,
  ahead = [],
  nameErg,
  nameAhead,
  nameBoxes,
  formatErg,
  formatBoxes,
  locale,
  onPick,
}: {
  past: RentChartPoint[];
  ahead?: RentChartPoint[];
  nameErg: string;
  nameAhead: string;
  nameBoxes: string;
  formatErg: (v: number) => string;
  formatBoxes: (v: number) => string;
  locale?: string;
  /**
   * Phone: a tap writes its day into the chart header through this instead of a floating tip.
   * null clears the reading (a pan, or a tap elsewhere).
   */
  onPick?: (p: RentChartPick | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  /** The shared tip on the day under the pointer; a tap on a phone shows it too. */
  const dayTip = useFloatTip({ within: () => el.current });
  const fmtBoxes = useRef(formatBoxes);
  const fmtErg = useRef(formatErg);
  const labels = useRef({ nameErg, nameAhead, nameBoxes });
  const loc = useRef(locale);
  const win = useRef({ start: 0, end: 0, min: 0, max: 0 });
  const yPainted = useRef({ min: 0, max: 1 });
  const yTarget = useRef({ min: 0, max: 1 });
  const series = useRef({ past, ahead });
  const paintedSig = useRef("");
  fmtBoxes.current = formatBoxes;
  fmtErg.current = formatErg;
  labels.current = { nameErg, nameAhead, nameBoxes };
  loc.current = locale;
  const ink = useInk();
  series.current = { past, ahead };
  const phone = usePhoneChart();
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  /** Phone y labels: about three round figures inside the plot, no unit (the header has it). */
  const yLabels = (
    y: { min: number; max: number }
  ): { axisTick?: { show: false; customValues: number[] }; axisLabel?: { customValues: number[]; formatter: (v: number) => string } } => {
    if (!phoneRef.current) return {};
    const plot = Math.max(60, (el.current?.clientHeight || 160) - PHONE_GRID.top - PHONE_GRID.bottom);
    const ticks = insideTicks(y.min, y.max, 3, plot);
    const step = tickStep(ticks);
    return {
      axisTick: { show: false, customValues: ticks },
      axisLabel: { customValues: ticks, formatter: (v: number) => tickText(v, step, loc.current) },
    };
  };
  const yLabelsRef = useRef(yLabels);
  yLabelsRef.current = yLabels;

  const fitY = (start: number, end: number) => {
    const pts = [...series.current.past, ...series.current.ahead];
    const slop = DAY_MS * 0.35;
    return rentPadExtent(
      rentWindowExtent(pts, start - slop, end + slop, (p) => p.rentErg)
    );
  };
  const fitYRef = useRef(fitY);
  fitYRef.current = fitY;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const c = echarts.init(node, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);

    let dragging = false;
    let lastX = 0;
    let lastTs = 0;
    let vx = 0;
    let loop = 0;
    const reduced = () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clampStart = (next: number, span: number) => {
      const { min, max } = win.current;
      if (span >= max - min) return min;
      return Math.min(max - span, Math.max(min, next));
    };

    const paint = (snapY: boolean) => {
      const target = yTarget.current;
      if (snapY || reduced()) yPainted.current = { ...target };
      else yPainted.current = mixRentExtent(yPainted.current, target, Y_FOLLOW);
      const y = yPainted.current;
      const xs = utcTicks(win.current.start, win.current.end);
      c.setOption({
        animationDurationUpdate: 0,
        dataZoom: [{ startValue: win.current.start, endValue: win.current.end }],
        xAxis: {
          axisLabel: {
            customValues: phoneRef.current ? phoneDays(win.current.start, win.current.end) : xs,
          },
        },
        yAxis: { min: y.min, max: y.max, ...yLabelsRef.current(y) },
      });
    };

    const needsY = () => !yClose(yPainted.current, yTarget.current);

    const apply = (start: number, end: number, snapY = false) => {
      win.current.start = start;
      win.current.end = end;
      yTarget.current = fitYRef.current(start, end);
      paint(snapY);
    };

    const shiftByPx = (dx: number) => {
      const wpx = node.clientWidth || 1;
      const span = win.current.end - win.current.start;
      const start = clampStart(win.current.start - (dx / wpx) * span, span);
      apply(start, start + span);
    };

    const step = (ts: number) => {
      loop = 0;
      const dt = Math.min(32, Math.max(8, ts - lastTs || 16));
      let moved = false;
      if (!dragging && Math.abs(vx) >= 0.03 && !reduced()) {
        shiftByPx(vx * dt);
        vx *= Math.pow(0.9, dt / 16);
        if (Math.abs(vx) < 0.03) vx = 0;
        moved = true;
      }
      if (!moved && needsY()) paint(false);
      if (dragging || Math.abs(vx) >= 0.03 || needsY()) {
        lastTs = ts;
        loop = requestAnimationFrame(step);
      }
    };

    const arm = () => {
      if (loop) return;
      lastTs = performance.now();
      loop = requestAnimationFrame(step);
    };

    /** The day under the pointer: past or due, on its dot. */
    const showDay = (e: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const raw = c.convertFromPixel({ gridIndex: 0 }, [e.clientX - rect.left, e.clientY - rect.top]);
      const t = Array.isArray(raw) ? raw[0] : null;
      const picked =
        typeof t === "number" && Number.isFinite(t)
          ? pickRentChartTip(series.current.past, series.current.ahead, t)
          : null;
      const px = picked ? c.convertToPixel({ gridIndex: 0 }, [picked.src.t, picked.src.rentErg]) : null;
      if (!picked || !Array.isArray(px)) {
        dayTip.hide();
        return;
      }
      if (phoneRef.current && pickRef.current) {
        // Phone: the day goes to the chart header, the hair stands on it.
        pickRef.current({ ...picked.src, due: picked.due });
        reading = true;
        c.dispatchAction({ type: "showTip", x: px[0], y: px[1] });
        return;
      }
      const { nameErg: nE, nameAhead: nA, nameBoxes: nB } = labels.current;
      dayTip.show(
        pointRect(rect.left + px[0]!, rect.top + px[1]!, 6),
        <>
          <TipHead chip={picked.due ? nA : undefined} ink={picked.due ? ERG : undefined} mono quiet>
            {formatWindow(picked.src.t, loc.current)}
          </TipHead>
          <TipRows>
            <TipRow label={nE} dot={ERG}>
              {fmtErg.current(picked.src.rentErg)}
            </TipRow>
            <TipRow label={nB}>{fmtBoxes.current(picked.src.boxes)}</TipRow>
          </TipRows>
        </>,
        { tapped: e.pointerType === "touch" }
      );
    };
    let downAt: { x: number; y: number } | null = null;
    /** A phone reading is in the header; a pan or a tap elsewhere clears it. */
    let reading = false;
    const unread = () => {
      reading = false;
      pickRef.current?.(null);
      c.dispatchAction({ type: "hideTip" });
    };
    const away = (e: PointerEvent) => {
      if (reading && e.target instanceof Node && !node.contains(e.target)) unread();
    };
    const onHover = (e: PointerEvent) => {
      if (dragging || e.pointerType === "touch") return;
      showDay(e);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== "touch") dayTip.hide();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      if (e.pointerType !== "touch") dayTip.hide();
      if (reading) unread();
      dragging = true;
      lastX = e.clientX;
      lastTs = performance.now();
      vx = 0;
      node.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const x = e.clientX;
      const now = performance.now();
      const dx = x - lastX;
      const dt = Math.max(8, now - lastTs);
      vx = dx / dt;
      lastX = x;
      lastTs = now;
      shiftByPx(dx);
      arm();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      // A press that did not pan is a tap: it reads the day.
      const at = downAt;
      downAt = null;
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) < 6 && e.type === "pointerup") showDay(e);
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }
      if (reduced()) {
        vx = 0;
        if (needsY()) paint(true);
        return;
      }
      arm();
    };

    node.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerdown", away, true);
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointermove", onHover);
    node.addEventListener("pointerleave", onLeave);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(loop);
      node.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerdown", away, true);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointermove", onHover);
      node.removeEventListener("pointerleave", onLeave);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const chrome = chartChrome();
    if (past.length < 2) {
      c.clear();
      paintedSig.current = "";
      return;
    }
    const tMin = Math.min(past[0]!.t, ahead[0]?.t ?? past[0]!.t);
    const peek = ahead.filter((p) => Number.isFinite(p.t));
    const lastPast = past[past.length - 1]!;
    const lastT = peek.length ? peek[peek.length - 1]!.t : lastPast.t;
    const cut = rentChartCut("day", tMin, lastT, lastT);
    const end = lastT;
    const start = Math.min(cut.start, end);
    const sig = `${ink}:${locale}:${phone}:${past.map((p) => `${p.t}:${p.rentErg}`).join(",")}|${peek.map((p) => `${p.t}:${p.rentErg}`).join(",")}`;
    if (paintedSig.current === sig) return;
    paintedSig.current = sig;
    win.current = { start, end, min: tMin, max: end };
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pastErg = past.map((p) => [p.t, p.rentErg] as [number, number]);
    const peekErg = peek.map((p) => [p.t, p.rentErg] as [number, number]);
    const firstPeek = peek[0];
    const tips: [number, number][] = [[lastPast.t, lastPast.rentErg]];
    if (firstPeek) tips.push([firstPeek.t, firstPeek.rentErg]);
    const y = fitY(start, end);
    yTarget.current = y;
    yPainted.current = y;
    const phoneY = yLabels(y);
    // Phone: the line stops where the y labels start, so the newest day never sits under a figure.
    let viewEnd = end;
    if (phone) {
      const ticks = phoneY.axisLabel?.customValues ?? [];
      const step = tickStep(ticks);
      const plotW = Math.max(60, (el.current?.clientWidth || 300) - PHONE_GRID.left - PHONE_GRID.right);
      viewEnd = end + (end - start) * labelGutter(ticks.map((v) => tickText(v, step, locale)), plotW, 0, 22);
      win.current = { start, end: viewEnd, min: tMin, max: viewEnd };
    }
    const xTicks = phone ? phoneDays(start, viewEnd) : utcTicks(start, end);
    c.setOption(
      {
        ...(chrome.font ? { textStyle: { fontFamily: chrome.font } } : {}),
        useUTC: true,
        animationDuration: reduced ? 0 : 480,
        animationDurationUpdate: 0,
        animationEasing: "cubicOut",
        grid: phone ? PHONE_GRID : { top: 8, right: 8, bottom: 24, left: 48 },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            startValue: start,
            endValue: viewEnd,
            zoomLock: true,
            moveOnMouseMove: false,
            moveOnMouseWheel: false,
            zoomOnMouseWheel: false,
            preventDefaultMouseMove: true,
          },
        ],
        tooltip: {
          trigger: "axis",
          showContent: false,
          // A phone reading moves the hair itself; a finger on the plot pans.
          triggerOn: phone && onPick ? ("none" as const) : ("mousemove|click" as const),
          axisPointer: {
            type: "line",
            snap: false,
            lineStyle: { color: chrome.hair, width: 1, type: "dashed" },
          },
        },
        xAxis: {
          type: "time",
          min: tMin,
          max: viewEnd,
          boundaryGap: false,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: chrome.muted,
            fontSize: phone ? 10 : 11,
            hideOverlap: true,
            customValues: xTicks,
            formatter: (value: number) => formatTick(value, loc.current),
          },
        },
        yAxis: phone
          ? {
              type: "value",
              position: "right",
              min: y.min,
              max: y.max,
              axisLine: { show: false },
              axisTick: { show: false, ...phoneY.axisTick },
              splitLine: {
                show: true,
                lineStyle: { color: chrome.hair, opacity: ink === "day" ? 0.16 : 0.2, width: 1 },
              },
              axisLabel: {
                inside: true,
                align: "right",
                verticalAlign: "bottom",
                margin: 0,
                padding: [0, 0, 2, 0],
                color: chrome.muted,
                fontSize: 10,
                textBorderColor: chrome.module,
                textBorderWidth: 3,
                ...phoneY.axisLabel,
              },
            }
          : {
              type: "value",
              min: y.min,
              max: y.max,
              splitNumber: 4,
              axisLine: { show: false },
              axisTick: { show: false },
              splitLine: { show: false },
              axisLabel: {
                color: chrome.muted,
                fontSize: 11,
                // The padded floor and ceiling are not round ticks (102.92, 209.10); they crowd the next label.
                showMinLabel: false,
                showMaxLabel: false,
                formatter: (v: number) => fmtErg.current(v),
              },
            },
        series: [
          {
            type: "line",
            name: labels.current.nameErg,
            data: pastErg,
            showSymbol: false,
            symbol: "circle",
            symbolSize: 8,
            smooth: 0.65,
            lineStyle: { width: 2.6, color: ERG, cap: "round", join: "round" },
            itemStyle: { color: ERG },
            emphasis: { scale: true, lineStyle: { width: 2.8 } },
          },
          ...(peek.length > 0
            ? [
                {
                  type: "line" as const,
                  name: labels.current.nameAhead,
                  data: peekErg,
                  showSymbol: true,
                  symbol: "circle",
                  symbolSize: 6,
                  smooth: 0.35,
                  z: 3,
                  lineStyle: {
                    width: 2.2,
                    color: ERG,
                    type: [6, 5],
                    cap: "round" as const,
                    join: "round" as const,
                    opacity: 0.88,
                  },
                  itemStyle: { color: ERG },
                  emphasis: { scale: true, lineStyle: { width: 2.4 } },
                },
              ]
            : []),
          ...rippleSeries(tips, ERG, reduced),
        ],
      },
      { notMerge: true }
    );
  }, [past, ahead, locale, ink, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={el}
      className={
        phone
          ? "h-full w-full touch-pan-y select-none"
          : "h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      }
    />
  );
}

export default RentHistoryChart;

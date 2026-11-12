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
import { pickRentChartTip, rentTipAxisMs } from "@/lib/rent-chart-tip";
import { TX_ACTIVITY_TZ } from "@/lib/tx-activity-bin";
import { useInk } from "@/lib/use-ink";

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
const DAY_MS = RENT_SERIES_DAY_MS;
const Y_FOLLOW = 0.2;
const Y_EPS = 1e-4;

export type RentChartPoint = {
  t: number;
  boxes: number;
  rentErg: number;
};

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
}: {
  past: RentChartPoint[];
  ahead?: RentChartPoint[];
  nameErg: string;
  nameAhead: string;
  nameBoxes: string;
  formatErg: (v: number) => string;
  formatBoxes: (v: number) => string;
  locale?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
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
      c.setOption({
        animationDurationUpdate: 0,
        dataZoom: [{ startValue: win.current.start, endValue: win.current.end }],
        xAxis: {
          axisLabel: {
            customValues: utcTicks(win.current.start, win.current.end),
          },
        },
        yAxis: { min: y.min, max: y.max },
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

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
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
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(loop);
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
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
    const sig = `${ink}:${locale}:${past.map((p) => `${p.t}:${p.rentErg}`).join(",")}|${peek.map((p) => `${p.t}:${p.rentErg}`).join(",")}`;
    if (paintedSig.current === sig) return;
    paintedSig.current = sig;
    win.current = { start, end, min: tMin, max: end };
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const xTicks = utcTicks(start, end);
    const pastErg = past.map((p) => [p.t, p.rentErg] as [number, number]);
    const peekErg = peek.map((p) => [p.t, p.rentErg] as [number, number]);
    const firstPeek = peek[0];
    const tips: [number, number][] = [[lastPast.t, lastPast.rentErg]];
    if (firstPeek) tips.push([firstPeek.t, firstPeek.rentErg]);
    const y = fitY(start, end);
    yTarget.current = y;
    yPainted.current = y;
    c.setOption(
      {
        ...(chrome.font ? { textStyle: { fontFamily: chrome.font } } : {}),
        useUTC: true,
        animationDuration: reduced ? 0 : 480,
        animationDurationUpdate: 0,
        animationEasing: "cubicOut",
        grid: { top: 8, right: 8, bottom: 24, left: 48 },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            startValue: start,
            endValue: end,
            zoomLock: true,
            moveOnMouseMove: false,
            moveOnMouseWheel: false,
            zoomOnMouseWheel: false,
            preventDefaultMouseMove: true,
          },
        ],
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "line",
            snap: false,
            lineStyle: { color: chrome.hair, width: 1, type: "dashed" },
          },
          backgroundColor: chrome.module,
          borderColor: chrome.border,
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: chrome.text, fontSize: 12 },
          formatter: (raw: unknown) => {
            const t = rentTipAxisMs(raw);
            if (t == null) return "";
            const picked = pickRentChartTip(
              series.current.past,
              series.current.ahead,
              t
            );
            if (!picked) return "";
            const { nameErg: nE, nameAhead: nA, nameBoxes: nB } = labels.current;
            const when = formatWindow(picked.src.t, loc.current);
            const head = picked.due ? nA : when;
            const whenLine = picked.due ? `${when}<br/>` : "";
            return `${head}<br/>${whenLine}${nE}  ${fmtErg.current(picked.src.rentErg)}<br/>${nB}  ${fmtBoxes.current(picked.src.boxes)}`;
          },
        },
        xAxis: {
          type: "time",
          min: tMin,
          max: end,
          boundaryGap: false,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: chrome.muted,
            fontSize: 11,
            hideOverlap: true,
            customValues: xTicks,
            formatter: (value: number) => formatTick(value, loc.current),
          },
        },
        yAxis: {
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
  }, [past, ahead, locale, ink]);

  return (
    <div
      ref={el}
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
    />
  );
}

export default RentHistoryChart;

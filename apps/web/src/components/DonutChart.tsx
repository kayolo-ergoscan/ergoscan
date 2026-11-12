"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { PieChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { chartChrome } from "@/lib/chart-chrome";
import { DONUT_SLICES } from "@/lib/palette";
import { lookInk } from "@/lib/look";
import { useInk } from "@/lib/use-ink";
import { TipHead, useFloatTip } from "@/components/Tip";
import { pointRect } from "@/lib/tip-place";

echarts.use([PieChart, TooltipComponent, CanvasRenderer]);

const EASE = "cubicOut";
const MOTION_MS = 420;

export type DonutSlice = { label: string; value: number; color?: string };

export type HoverSlice = { label: string; value: number; pct: number };

export function DonutChart({
  data,
  height = 220,
  compact = false,
  fill = false,
  caption,
  formatValue,
  onHover,
}: {
  data: DonutSlice[];
  height?: number;
  compact?: boolean;
  /** Fill the parent box instead of a fixed height. */
  fill?: boolean;
  /** Hover caption under the ring. Off in compact tiles. */
  caption?: boolean;
  formatValue: (v: number, pct: number) => string;
  onHover?: (slice: HoverSlice | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const fmt = useRef(formatValue);
  fmt.current = formatValue;
  const hoverOut = useRef(onHover);
  hoverOut.current = onHover;
  const showCaption = caption ?? !compact;
  const [hover, setHover] = useState<HoverSlice | null>(null);
  const [reduce, setReduce] = useState(false);
  const ink = useInk();
  /** Compact rings have no caption: the shared tip names the slice at the cursor. */
  const sliceTip = useFloatTip({ within: () => el.current });
  const pointer = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const shown = useRef<{ label: string; color: string; text: string } | null>(null);

  useEffect(() => {
    const node = el.current;
    if (!node || !compact) return;
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" };
      const now = shown.current;
      if (now && sliceTip.isOpen()) sliceTip.move(pointRect(e.clientX, e.clientY, 6));
    };
    node.addEventListener("pointermove", track);
    node.addEventListener("pointerdown", track);
    return () => {
      node.removeEventListener("pointermove", track);
      node.removeEventListener("pointerdown", track);
    };
  }, [compact, sliceTip]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const c = echarts.init(node, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total <= 0) {
      c.clear();
      setHover(null);
      return;
    }
    const ms = reduce ? 0 : MOTION_MS;
    const chrome = chartChrome();
    const sliceColor = (d: DonutSlice, i: number) => {
      const fallback = DONUT_SLICES[i % DONUT_SLICES.length];
      const raw = d.color ?? fallback;
      return raw.startsWith("rgba(255") ? chrome.hair : lookInk(raw);
    };
    c.setOption(
      {
        animationDuration: ms,
        animationDurationUpdate: ms,
        animationEasing: EASE,
        animationEasingUpdate: EASE,
        stateAnimation: { duration: ms, easing: EASE },
        tooltip: { show: false },
        series: [
          {
            type: "pie",
            radius: compact ? ["46%", "90%"] : ["58%", "78%"],
            center: ["50%", "50%"],
            avoidLabelOverlap: true,
            minAngle: 2,
            cursor: "pointer",
            padAngle: compact ? 1.8 : 1.6,
            itemStyle: {
              borderColor: chrome.module,
              borderWidth: compact ? 2 : 3,
              borderRadius: compact ? 3 : 6,
            },
            label: { show: false },
            labelLine: { show: false },
            emphasis: {
              scale: !reduce,
              scaleSize: reduce ? 0 : compact ? 5 : 11,
              focus: "self",
              itemStyle: { shadowBlur: 0 },
            },
            blur: {
              itemStyle: { opacity: 0.38 },
            },
            data: data.map((d, i) => ({
              name: d.label,
              value: d.value,
              itemStyle: { color: sliceColor(d, i) },
            })),
          },
        ],
      },
      { notMerge: true }
    );

    const onOver = (raw: unknown) => {
      const rec = raw as { componentType?: string; name?: string; value?: unknown };
      if (rec.componentType && rec.componentType !== "series") return;
      const v = Number(rec.value) || 0;
      const name = typeof rec.name === "string" ? rec.name : "";
      if (!name || v <= 0) return;
      const slice = { label: name, value: v, pct: v / total };
      setHover(slice);
      hoverOut.current?.(slice);
      const at = pointer.current;
      if (compact && at) {
        const i = data.findIndex((d) => d.label === name);
        const color = i >= 0 ? sliceColor(data[i]!, i) : chrome.hair;
        const text = fmt.current(v, v / total);
        shown.current = { label: name, color, text };
        sliceTip.show(
          pointRect(at.x, at.y, 6),
          <TipHead chip={name} ink={color === chrome.hair ? undefined : color} mono>
            {text}
          </TipHead>,
          { tapped: at.touch }
        );
      }
    };
    const onOut = () => {
      setHover(null);
      hoverOut.current?.(null);
      shown.current = null;
      sliceTip.hide();
    };
    c.on("mouseover", onOver);
    c.on("globalout", onOut);
    return () => {
      c.off("mouseover", onOver);
      c.off("globalout", onOut);
    };
  }, [data, compact, reduce, ink]);

  return (
    <div className={fill ? "relative h-full w-full" : "relative w-full"}>
      <div ref={el} className={fill ? "h-full w-full" : "w-full"} style={fill ? undefined : { height }} />
      {showCaption ? (
      <div className="pointer-events-none mt-0.5 min-h-[36px] text-center" aria-live="polite">
        <div
          className="motion-safe:transition-[opacity,transform] motion-safe:duration-[420ms] motion-safe:ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
          style={{
            opacity: hover ? 1 : 0,
            transform: hover ? "translateY(0)" : "translateY(8px)",
          }}
        >
          {hover ? (
            <>
              <p className="truncate px-1 text-[13px] font-medium tracking-tight text-[var(--text)]">
                {hover.label}
              </p>
              <p className="mt-0.5 tabular-nums text-[12px] text-[var(--muted)]">
                {fmt.current(hover.value, hover.pct)}
              </p>
            </>
          ) : (
            <p className="text-[13px]">&nbsp;</p>
          )}
        </div>
      </div>
      ) : null}
    </div>
  );
}

export default DonutChart;

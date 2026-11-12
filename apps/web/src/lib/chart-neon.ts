import type { EChartsCoreOption } from "echarts/core";
import { currentLook, lookInk } from "./look";

type Series = NonNullable<EChartsCoreOption["series"]>;
type LineOpt = Extract<Series extends readonly (infer U)[] ? U : Series, { type?: "line" }>;

type Rgb = { r: number; g: number; b: number };

function rgbOf(input: string): Rgb | null {
  const rgb = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const h = input.trim().replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgba(hex: string, a: number): string {
  const c = rgbOf(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/** Pull a pale ink away from gray so the bloom reads on #26252d paper. */
function punch(hex: string, k: number): string {
  const c = rgbOf(hex);
  if (!c) return hex;
  const avg = (c.r + c.g + c.b) / 3;
  const m = (n: number) => Math.max(0, Math.min(255, Math.round(avg + (n - avg) * (1 + k))));
  return `rgb(${m(c.r)},${m(c.g)},${m(c.b)})`;
}

/** Brighten toward white so the stroke core reads as light, not a flat crayon. */
function lift(hex: string, t: number): string {
  const c = rgbOf(hex);
  if (!c) return hex;
  const m = (n: number) => Math.round(n + (255 - n) * t);
  return `rgb(${m(c.r)},${m(c.g)},${m(c.b)})`;
}

/** Plain stops. A LinearGradient instance does not survive setOption and paints solid. */
function wash(hex: string, top: number) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: rgba(hex, top) },
      { offset: 0.55, color: rgba(hex, top * 0.38) },
      { offset: 1, color: rgba(hex, 0) },
    ],
  };
}

/**
 * Three stacked strokes of one series.
 * Wash sits under a soft halo; a thin lifted core keeps peaks apart.
 * One shadowBlur on a fat line is what turns the reference skins into a blob.
 */
export function neonLine(opts: {
  data: [number, number | null][];
  color: string;
  name: string;
  day: boolean;
  smooth: number | boolean;
  width?: number;
  yAxisIndex?: number;
  /** 0 hides the under-fill. Activity charts use a light wash. Sparks use none. */
  wash?: number;
  /** Extra blur around the stroke, so light thins out with distance from the line. */
  scatter?: number;
  connectNulls?: boolean;
  smoothMonotone?: "x";
}): LineOpt[] {
  const day = opts.day;
  const yAxisIndex = opts.yAxisIndex ?? 0;
  const width = opts.width ?? 2;
  const washTop = opts.wash ?? 0;
  const scatter = opts.scatter ?? 0;
  const look = currentLook();
  const ink = look ? lookInk(opts.color) : punch(opts.color, day ? 0.15 : 0.62);
  const shared = {
    type: "line" as const,
    yAxisIndex,
    data: opts.data,
    clip: false,
    showSymbol: false,
    symbol: "none" as const,
    smooth: opts.smooth,
    connectNulls: opts.connectNulls ?? true,
    ...(opts.smoothMonotone ? { smoothMonotone: opts.smoothMonotone } : {}),
  };
  const quiet = { name: "", silent: true as const, tooltip: { show: false } };
  const layers: LineOpt[] = [];
  if (look) {
    // A look draws one flat stroke over a light wash. No halo, no bloom.
    if (washTop > 0) {
      layers.push({
        ...shared,
        ...quiet,
        z: 1,
        lineStyle: { width: 0, color: "transparent" },
        areaStyle: { origin: "start", color: wash(ink, washTop * 0.5), opacity: 1 },
      });
    }
    layers.push({
      ...shared,
      name: opts.name,
      z: 4,
      lineStyle: { width: width + 0.25, color: ink, cap: "round", join: "round" },
      itemStyle: { color: ink },
      emphasis: { disabled: true },
    });
    return layers;
  }
  if (washTop > 0) {
    layers.push({
      ...shared,
      ...quiet,
      z: 1,
      lineStyle: { width: 0, color: "transparent" },
      areaStyle: {
        // 'start' is the axis floor. Origin 0 sits far below a tight price scale,
        // so the canvas clips a still-opaque slice and the wash ends in a hard edge.
        origin: "start",
        color: wash(ink, day ? washTop * 0.55 : washTop),
        opacity: 1,
      },
    });
  }
  if (scatter > 0) {
    layers.push({
      ...shared,
      ...quiet,
      z: 2,
      lineStyle: {
        width: width + 1.5,
        color: rgba(ink, day ? 0.16 : 0.4),
        shadowBlur: scatter,
        shadowColor: rgba(ink, day ? 0.28 : 0.9),
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        cap: "round",
        join: "round",
      },
    });
  }
  layers.push({
    ...shared,
    ...quiet,
    z: 3,
    lineStyle: {
      width: day ? width + 0.75 : width + 1.25,
      color: rgba(ink, day ? 0.14 : 0.22),
      shadowBlur: day ? 6 : 14,
      shadowColor: rgba(ink, day ? 0.22 : 0.8),
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      cap: "round",
      join: "round",
    },
  });
  layers.push({
    ...shared,
    name: opts.name,
    z: 4,
    lineStyle: {
      width,
      color: lift(ink, day ? 0.1 : 0.42),
      shadowBlur: day ? 4 : 12,
      shadowColor: rgba(ink, day ? 0.35 : 1),
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      cap: "round",
      join: "round",
    },
    itemStyle: { color: ink },
    emphasis: { disabled: true },
  });
  return layers;
}

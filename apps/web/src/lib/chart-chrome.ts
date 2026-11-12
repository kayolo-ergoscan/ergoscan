/** Live CSS tokens for ECharts — canvas cannot resolve `var(--token)` itself. */

export function cssToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function chartChrome() {
  return {
    module: cssToken("--module", "#26252d"),
    border: cssToken("--border", "rgba(255,255,255,0.08)"),
    text: cssToken("--text", "#ffffff"),
    muted: cssToken("--muted-2", "rgba(255,255,255,0.38)"),
    hair: cssToken("--hair", "rgba(255,255,255,0.22)"),
    wash: cssToken("--wash-faint", "rgba(255,255,255,0.04)"),
    up: cssToken("--up", "#3dd68c"),
    down: cssToken("--down", "#ff5a6a"),
    /** Figure face for axis labels. Empty unless a look sets `--chart-font`. */
    font: cssToken("--chart-font", ""),
  };
}

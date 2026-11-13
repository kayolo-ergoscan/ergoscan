import { groupIntDigits } from "./format";

/** Whole ERG glyphs, grouped by the UI language — `83430000` → `83,430,000` / `83 430 000`. */
export function supplyGlyphs(n: number, locale?: string): string[] {
  if (!Number.isFinite(n) || n < 0) return ["0"];
  return groupIntDigits(String(Math.round(n)), locale).split("");
}

export function zipSupplyGlyphs(
  from: number,
  to: number,
  locale?: string
): { idle: string; hover: string }[] {
  const a = supplyGlyphs(from, locale);
  const b = supplyGlyphs(to, locale);
  const w = Math.max(a.length, b.length);
  const pad = (g: string[]) => Array.from({ length: w - g.length }, () => "\u00a0").concat(g);
  const idle = pad(a);
  const hover = pad(b);
  return idle.map((ch, i) => ({ idle: ch, hover: hover[i] ?? "\u00a0" }));
}

export function isSupplyDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

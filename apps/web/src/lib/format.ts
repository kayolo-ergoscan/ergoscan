export function shortId(id: string, n = 6): string {
  if (!id || id.length <= n * 2) return id;
  return `${id.slice(0, n)}…${id.slice(-n)}`;
}

/** Same visible width as a standard P2PK (`9…`, 51 chars). Longer P2S is cropped in the middle. */
export const P2PK_VISIBLE_LEN = 51;

export function visibleAddress(address: string): string {
  if (address.length <= P2PK_VISIBLE_LEN) return address;
  const n = Math.floor((P2PK_VISIBLE_LEN - 1) / 2);
  return `${address.slice(0, n)}…${address.slice(-n)}`;
}

/**
 * One number policy per UI language. Every helper in this file follows it. Call sites pass
 * the UI locale ("en" / "ru", or the "en-US" / "ru-RU" tags the feed rows use); no locale
 * means English, the language the server renders.
 *
 * - EN: `1,234,567.89`, `$14.87M`, `$0.1779`.
 * - RU: `1 234 567.89`. Groups are split by a no-break space (U+00A0, the same separator
 *   `toLocaleString("ru-RU")` prints, so helper output and plain counts match). The decimal
 *   point stays: amounts are copied into wallets, and the Russian UI has always shown a point.
 * - Both: `$` in front; compact `1.34M`, `141.9k` with latin suffixes and a point.
 *
 * Ids, hashes and heights in links are never formatted here.
 */
export const GROUP_SEP_EN = ",";
export const GROUP_SEP_RU = " ";

export function isRuNumbers(locale?: string): boolean {
  return isRuLocale(locale);
}

export function groupSeparator(locale?: string): string {
  return isRuNumbers(locale) ? GROUP_SEP_RU : GROUP_SEP_EN;
}

/** Gateway amounts arrive as strings to keep nanoERG / token units exact. */
export function toBigIntAmt(
  v: number | string | bigint | null | undefined
): bigint {
  if (v == null || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0n;
    return BigInt(Math.trunc(v));
  }
  const s = String(v).trim();
  if (!s) return 0n;
  try {
    if (/[eE]/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return 0n;
      return BigInt(Math.trunc(n));
    }
    const intPart = s.split(".")[0] ?? "0";
    if (!/^-?\d+$/.test(intPart)) return 0n;
    return BigInt(intPart);
  } catch {
    return 0n;
  }
}

/** Ergo coinbase recycles the emission leftover box — not user volume. */
export function splitBlockOutput(
  valueNano: string | number | bigint | null | undefined,
  userValueNano?: string | number | bigint | null
): { user: bigint; emission: bigint } {
  const total = toBigIntAmt(valueNano);
  if (userValueNano == null || userValueNano === "") return { user: total, emission: 0n };
  const user = toBigIntAmt(userValueNano);
  return { user, emission: total > user ? total - user : 0n };
}

/** Whole digits in groups of three: `1,234,567` / `1 234 567` (RU: no-break space, never wraps). */
export function groupIntDigits(digits: string, locale?: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator(locale));
}

export function formatGroupedInt(n: bigint, locale?: string): string {
  const sign = n < 0n ? "-" : "";
  const digits = (n < 0n ? -n : n).toString();
  return `${sign}${groupIntDigits(digits, locale)}`;
}

/** A count or a height in text: `1,915,364` / `1 915 364`. Fractions are rounded away. */
export function formatInt(n: number | bigint | null | undefined, locale?: string): string {
  if (n == null) return "—";
  if (typeof n === "bigint") return formatGroupedInt(n, locale);
  if (!Number.isFinite(n)) return "—";
  return formatGroupedInt(BigInt(Math.round(n)), locale);
}

/** Finite number → `1,234,567.89` / `1 234 567.89` (decimal point in both languages). */
export function formatGroupedNumber(
  n: number,
  minFrac = 0,
  maxFrac = 2,
  locale?: string
): string {
  if (!Number.isFinite(n)) return "—";
  const body = Math.abs(n).toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  });
  // -0.001 at two decimals is "0", not "-0".
  const sign = n < 0 && /[1-9]/.test(body) ? "-" : "";
  const [w, f] = body.split(".");
  const grouped = groupIntDigits(w ?? "0", locale);
  return f != null ? `${sign}${grouped}.${f}` : `${sign}${grouped}`;
}

/** Share or ratio: `12.34%`, `1,250%` / `1 250%`. */
export function formatPct(
  n: number | null | undefined,
  locale?: string,
  minFrac = 0,
  maxFrac = 2
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, minFrac, maxFrac, locale)}%`;
}

const COMPACT_STEPS: readonly (readonly [number, string])[] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

function compactBody(x: number, maxFrac: number): string {
  const whole = x >= 100 ? 3 : x >= 10 ? 2 : 1;
  const frac = Math.max(0, Math.min(maxFrac, 4 - whole));
  const fixed = x.toFixed(frac);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/**
 * Short form of a large figure, the same in both languages: `1.34M`, `14.87M`, `148.7M`,
 * `141.9k`, `2.5B`. At most four significant digits and `maxFrac` decimals, trailing zeros
 * dropped. A value that rounds up to 1000 of a step moves to the next one (999 999 → `1M`).
 * Below 1 000 the figure is printed whole, grouped by the locale.
 */
export function formatCompactNumber(n: number, locale?: string, maxFrac = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  for (let i = 0; i < COMPACT_STEPS.length; i++) {
    const [step, suffix] = COMPACT_STEPS[i]!;
    if (abs < step) continue;
    const body = compactBody(abs / step, maxFrac);
    if (Number(body) >= 1000 && i > 0) {
      const [up, upSuffix] = COMPACT_STEPS[i - 1]!;
      return `${sign}${compactBody(abs / up, maxFrac)}${upSuffix}`;
    }
    return `${sign}${body}${suffix}`;
  }
  return formatGroupedNumber(n, 0, maxFrac, locale);
}

/** Max digits after the decimal. Tiny values use 0.0₄xx instead. */
export const MAX_FRAC_DIGITS = 4;

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

export function toSubscript(n: number | string): string {
  return String(n).replace(/\d/g, (d) => SUBSCRIPT[Number(d)] ?? d);
}

export type TinyFrac = { zeros: number; digits: string };

export function formatTinyCore(tiny: TinyFrac): string {
  return `0.0${toSubscript(tiny.zeros)}${tiny.digits}`;
}

function leadingZeros(frac: string): number {
  let z = 0;
  while (z < frac.length && frac[z] === "0") z += 1;
  return z;
}

function tinyFromFrac(frac: string, maxDigits = MAX_FRAC_DIGITS): TinyFrac {
  const zeros = leadingZeros(frac);
  const digits = frac.slice(zeros, zeros + maxDigits).replace(/0+$/, "") || "1";
  return { zeros: Math.max(1, zeros), digits };
}

export type ScaledView = {
  text: string;
  sign: string;
  tiny: TinyFrac | null;
};

/**
 * Scaled integer (nanoERG, token raw) → at most 4 dp, or 0.0ₙxxxx if many zeros.
 */
export function describeScaledAmount(
  raw: bigint,
  decimals: number,
  locale?: string,
  maxFrac = MAX_FRAC_DIGITS
): ScaledView {
  if (raw === 0n) return { text: "0", sign: "", tiny: null };
  const sign = raw < 0n ? "-" : "";
  const a = raw < 0n ? -raw : raw;
  const dec = Math.max(0, decimals);
  if (dec === 0) {
    return { text: `${sign}${formatGroupedInt(a, locale)}`, sign, tiny: null };
  }

  const base = 10n ** BigInt(dec);
  const whole = a / base;
  const frac = a % base;
  if (frac === 0n) {
    return { text: `${sign}${formatGroupedInt(whole, locale)}`, sign, tiny: null };
  }

  const fracStr = frac.toString().padStart(dec, "0");
  const zeros = leadingZeros(fracStr);
  if (whole === 0n && zeros >= maxFrac) {
    const tiny = tinyFromFrac(fracStr, maxFrac);
    return { text: `${sign}${formatTinyCore(tiny)}`, sign, tiny };
  }

  const cut = Math.min(maxFrac, dec);
  let head = BigInt(fracStr.slice(0, cut) || "0");
  let wholeAdj = whole;
  const next = fracStr[cut];
  if (next != null && next >= "5") {
    head += 1n;
    const limit = 10n ** BigInt(cut);
    if (head >= limit) {
      head = 0n;
      wholeAdj += 1n;
    }
  }
  const headStr = head.toString().padStart(cut, "0").replace(/0+$/, "");
  if (!headStr) {
    return { text: `${sign}${formatGroupedInt(wholeAdj, locale)}`, sign, tiny: null };
  }
  return {
    text: `${sign}${formatGroupedInt(wholeAdj, locale)}.${headStr}`,
    sign,
    tiny: null,
  };
}

export function formatScaledAmount(
  raw: bigint,
  decimals: number,
  locale?: string,
  maxFrac = MAX_FRAC_DIGITS
): string {
  return describeScaledAmount(raw, decimals, locale, maxFrac).text;
}

/** Exactly `places` digits after the point, rounded half up: "910 001.39", "1.00". */
export function formatScaledFixed(raw: bigint, decimals: number, places: number, locale?: string): string {
  const sign = raw < 0n ? "-" : "";
  const abs = raw < 0n ? -raw : raw;
  const keep = Math.min(places, decimals);
  const drop = 10n ** BigInt(decimals - keep);
  const scaled = (abs + drop / 2n) / drop;
  const base = 10n ** BigInt(keep);
  const whole = formatGroupedInt(scaled / base, locale);
  if (places <= 0) return `${sign}${whole}`;
  const frac = (scaled % base).toString().padStart(keep, "0").padEnd(places, "0");
  return `${sign}${whole}.${frac}`;
}

/** Approx ERG as Number for USD/KPI compact — not for stored amounts. */
export function nanoErgToNumber(nano: string | number | bigint | null | undefined): number {
  if (typeof nano === "number") return Number.isFinite(nano) ? nano / 1e9 : 0;
  if (typeof nano === "bigint") {
    const s = nano.toString();
    return nanoErgToNumber(s);
  }
  const raw = String(nano ?? "0").trim();
  if (!raw) return 0;
  const neg = raw.startsWith("-");
  const body = (neg ? raw.slice(1) : raw).split(".")[0] ?? "0";
  if (!/^\d+$/.test(body)) return 0;
  const d = body.replace(/^0+/, "") || "0";
  const n =
    d.length <= 9
      ? Number(d) / 1e9
      : Number(d.slice(0, -9)) + Number(d.slice(-9)) / 1e9;
  return neg ? -n : n;
}

/** List ERG: grouped thousands, always 2 dp. `800000` nano→ `800 000.00 ERG`. No k/M. */
export function formatErgFixed(
  nano: number | string | bigint | null | undefined,
  locale?: string,
  withUnit = true
): string {
  const raw = toBigIntAmt(nano);
  const sign = raw < 0n ? "-" : "";
  const a = raw < 0n ? -raw : raw;
  const base = 1_000_000_000n;
  const whole = a / base;
  const frac = a % base;
  const step = 10_000_000n;
  let cents = (frac + step / 2n) / step;
  let w = whole;
  if (cents >= 100n) {
    cents = 0n;
    w += 1n;
  }
  const body = `${sign}${formatGroupedInt(w, locale)}.${cents.toString().padStart(2, "0")}`;
  return withUnit ? `${body} ERG` : body;
}

export type RentErgView = {
  sign: string;
  /** Four decimal places, or null when the fraction is a run of zeros. */
  text: string | null;
  tiny: TinyFrac | null;
};

/**
 * Rent columns: exactly 4 digits after the point.
 * A long run of zeros folds to `0.0(n)45` (n is how many zeros).
 */
export function describeRentErg(
  nano: number | string | bigint | null | undefined,
  locale?: string
): RentErgView {
  const raw = toBigIntAmt(nano);
  if (raw === 0n) return { sign: "", text: "0.0000 ERG", tiny: null };
  const sign = raw < 0n ? "-" : "";
  const a = raw < 0n ? -raw : raw;
  const base = 1_000_000_000n;
  const whole = a / base;
  const fracStr = (a % base).toString().padStart(9, "0");
  const zeros = leadingZeros(fracStr);
  if (whole === 0n && zeros >= MAX_FRAC_DIGITS) {
    return { sign, text: null, tiny: tinyFromFrac(fracStr, MAX_FRAC_DIGITS) };
  }
  let head = BigInt(fracStr.slice(0, MAX_FRAC_DIGITS) || "0");
  let w = whole;
  const next = fracStr[MAX_FRAC_DIGITS];
  if (next != null && next >= "5") {
    head += 1n;
    if (head >= 10n ** BigInt(MAX_FRAC_DIGITS)) {
      head = 0n;
      w += 1n;
    }
  }
  const headStr = head.toString().padStart(MAX_FRAC_DIGITS, "0");
  return {
    sign,
    text: `${sign}${formatGroupedInt(w, locale)}.${headStr} ERG`,
    tiny: null,
  };
}

/** Always ERG units, trim trailing zeros. 51.384 ERG → 51.384; 574.2476124 → 574.2476 */
export function formatErgPrecise(
  nano: number | string | bigint | null | undefined,
  locale?: string,
  withUnit = true
): string {
  const core = formatScaledAmount(toBigIntAmt(nano), 9, locale);
  return withUnit ? `${core} ERG` : core;
}

export function formatTokenAmount(
  raw: number | string | bigint | null | undefined,
  decimals = 0,
  locale?: string
): string {
  return formatScaledAmount(toBigIntAmt(raw), decimals, locale);
}

/** Compact from 1 million UI units. Below that, full grouped digits. */
const GLANCE_FROM = 1_000_000n;
/** Token-card emission: millions stay grouped (`21 000 000`); compact from 1B. */
const EMISSION_GLANCE_FROM = 1_000_000_000n;
/** Past trillions a suffix becomes `1000T`; print a power of ten from here on. */
const GLANCE_GROUPED_FROM = 10n ** 15n;

function scaledWhole(abs: bigint, decimals: number): bigint {
  const d = Math.max(0, decimals);
  if (d === 0) return abs;
  return abs / 10n ** BigInt(d);
}

function scaledToCompactNumber(abs: bigint, decimals: number): number | null {
  const whole = scaledWhole(abs, decimals);
  if (whole >= GLANCE_GROUPED_FROM) return null;
  const d = Math.max(0, decimals);
  if (d === 0) return Number(abs);
  const base = 10n ** BigInt(d);
  const frac = abs % base;
  return Number(whole) + Number(frac) / Number(base);
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Past trillions a suffix turns into `1000T`; print a power of ten instead: 1×10¹⁸, 2.5×10¹⁵. */
function powerGlance(whole: bigint): string {
  const digits = whole.toString();
  const exp = digits.length - 1;
  const mantissa = Number(digits.slice(0, 4)) / 1000;
  const head = String(Number(mantissa.toPrecision(3)));
  const sup = String(exp)
    .split("")
    .map((d) => SUPERSCRIPT[Number(d)])
    .join("");
  return `${head}×10${sup}`;
}

/**
 * Tight-column token amounts: `1.01B` in both languages (`formatCompactNumber`); from a
 * quadrillion on, a power of ten (1×10¹⁸).
 * Exact grouped string stays on title / aria-label.
 */
export function formatScaledGlance(
  raw: bigint,
  decimals: number,
  locale?: string,
  from: bigint = GLANCE_FROM
): { text: string; exact: string } {
  const exact = formatScaledAmount(raw, decimals, locale);
  const abs = raw < 0n ? -raw : raw;
  const whole = scaledWhole(abs, decimals);
  if (whole < from) return { text: exact, exact };
  if (whole >= GLANCE_GROUPED_FROM) {
    return { text: `${raw < 0n ? "-" : ""}${powerGlance(whole)}`, exact };
  }
  const n = scaledToCompactNumber(abs, decimals);
  if (n == null) return { text: exact, exact };
  const sign = raw < 0n ? "-" : "";
  return { text: `${sign}${formatCompactNumber(n, locale)}`, exact };
}

/** Emission on the token name tile: full through millions, compact from 1B. */
export function formatEmissionGlance(
  raw: bigint,
  decimals: number,
  locale?: string
): { text: string; exact: string } {
  return formatScaledGlance(raw, decimals, locale, EMISSION_GLANCE_FROM);
}

export type UsdView = {
  text: string;
  sign: string;
  tiny: TinyFrac | null;
};

function unsignedDecimal(
  a: number,
  maxFrac: number,
  tinyDigits = maxFrac
): { tiny: TinyFrac | null; body: string } {
  const fixed = a.toFixed(Math.min(18, Math.max(maxFrac + 8, 8)));
  const [w, f = ""] = fixed.split(".");
  const zeros = leadingZeros(f);
  if (Number(w) === 0 && zeros >= maxFrac && a > 0) {
    const tiny = tinyFromFrac(f, tinyDigits);
    return { tiny, body: formatTinyCore(tiny) };
  }
  const rounded = Number(a.toFixed(maxFrac));
  if (rounded === 0 && a > 0) {
    const tiny = tinyFromFrac(f, tinyDigits);
    return { tiny, body: formatTinyCore(tiny) };
  }
  const body = rounded.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
  return { tiny: null, body };
}

export function describeUsd(
  n: number | null | undefined,
  digits = 2
): UsdView | null {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a === 0) return { text: "$0", sign: "", tiny: null };
  if (a >= 1_000) {
    return { text: `${sign}$${formatCompactNumber(a)}`, sign, tiny: null };
  }
  if (a < 0.01) {
    const { tiny, body } = unsignedDecimal(a, MAX_FRAC_DIGITS);
    return { text: `${sign}$${body}`, sign, tiny };
  }
  return { text: `${sign}$${a.toFixed(digits)}`, sign, tiny: null };
}

/**
 * A market price in dollars, four significant digits: `$0.1779`, `$1.234`, `$12.34`,
 * `$1,234` / `$1 234`. The header and the home price tile print ERG with it, so they agree.
 */
export function formatUsdPrice(n: number | null | undefined, locale?: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a < 0.01) return formatUsd(n, MAX_FRAC_DIGITS);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000) return `${sign}$${formatGroupedNumber(a, 0, 0, locale)}`;
  return `${sign}$${a.toFixed(a >= 10 ? 2 : a >= 1 ? 3 : 4)}`;
}

/** ERG-per-token: at most 4 glyphs after the point (`0.0039` or `0.0₇22`). */
export function describePrice(n: number | null | undefined, locale?: string): UsdView | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const sign = "";
  const a = n;
  if (a >= 1_000_000) {
    return { text: formatCompactNumber(a, locale), sign, tiny: null };
  }
  if (a >= 1_000) {
    return { text: formatGroupedNumber(a, 0, 2, locale), sign, tiny: null };
  }
  if (a >= 1) {
    const body = a.toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: MAX_FRAC_DIGITS,
    });
    return { text: body, sign, tiny: null };
  }
  const { tiny, body } = unsignedDecimal(a, MAX_FRAC_DIGITS, 2);
  return { text: body, sign, tiny };
}

export function nanoToNumberErg(nano: bigint): number {
  return Number(nano) / 1e9;
}

export function nanoToUsd(nano: bigint, ergUsd: number | null | undefined): number | null {
  if (ergUsd == null || !Number.isFinite(ergUsd) || ergUsd <= 0) return null;
  const erg = nanoToNumberErg(nano);
  if (!Number.isFinite(erg)) return null;
  return erg * ergUsd;
}

export function tokenAmountToUsd(
  raw: bigint,
  decimals: number,
  priceUsd: number | null | undefined
): number | null {
  if (priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const ui = Number(raw) / 10 ** Math.max(0, decimals);
  if (!Number.isFinite(ui)) return null;
  return ui * priceUsd;
}

export function formatNano(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(3)} ERG`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} mERG`;
  return `${n} nano`;
}

/** Chart ticks and tight ERG figures: `1.34M ERG`, `12.5k ERG`, `12.50 ERG`. */
export function formatErg(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000) return `${formatCompactNumber(n)} ERG`;
  return `${n.toFixed(digits)} ERG`;
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  return describeUsd(n, digits)?.text ?? "—";
}

/**
 * Whole figure up to 9 999 (`9,275` / `9 275`), compact from 10 000 (`12.3k`, `1.34M`).
 * Thousands keep one decimal; `digits` caps the decimals from a million on.
 */
export function formatCompact(n: number | null | undefined, digits = 2, locale?: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 999_950) return formatCompactNumber(n, locale, digits);
  if (abs >= 10_000) return formatCompactNumber(n, locale, 1);
  return formatGroupedNumber(Math.round(n), 0, 0, locale);
}

export function formatHashrate(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h) || h <= 0) return "—";
  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let v = h;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  const d = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(d)} ${units[i]}`;
}

export function formatBlockTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(2)}m`;
}

export function formatPrice(n: number | null | undefined): string {
  return describePrice(n)?.text ?? "—";
}

/** Fee rate for tiles: `107 n/B`, `2.2k n/B`, `34.7k n/B` (the shared short form, one decimal). */
export function formatFeeRate(r: number): string {
  if (r >= 1000) return `${formatCompactNumber(r, undefined, 1)} n/B`;
  return `${Math.round(r)} n/B`;
}

export function toEpochMs(ts: number | null | undefined): number | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  return ts > 1e12 ? ts : ts > 1e10 ? ts : ts * 1000;
}

/** Latest of snapshot lastTs and tape timestamps. Stale summary must not win. */
export function laterEpochMs(
  ...vals: Array<number | null | undefined>
): number | null {
  let max: number | null = null;
  for (const v of vals) {
    const ms = toEpochMs(v);
    if (ms == null) continue;
    if (max == null || ms > max) max = ms;
  }
  return max;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type ClockBits = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
};

/** Local wall clock, or the named zone. Hour is always 00–23. */
function clockBits(ms: number, timeZone?: string): ClockBits | null {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  if (!timeZone) {
    return {
      day: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }
  try {
    const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const part of new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d)) {
      bag[part.type] = part.value;
    }
    let hour = Number(bag.hour);
    if (hour === 24) hour = 0;
    const bits = {
      day: Number(bag.day),
      month: Number(bag.month),
      year: Number(bag.year),
      hour,
      minute: Number(bag.minute),
      second: Number(bag.second),
    };
    if (Object.values(bits).some((n) => !Number.isFinite(n))) return null;
    return bits;
  } catch {
    return null;
  }
}

/** `21.01.2026`. Same order in every locale. */
export function formatDottedDate(
  ts: number | null | undefined,
  timeZone?: string
): string {
  const ms = toEpochMs(ts);
  if (ms == null) return "—";
  const b = clockBits(ms, timeZone);
  if (!b) return "—";
  return `${pad2(b.day)}.${pad2(b.month)}.${b.year}`;
}

/** `21.01` — axis ticks, where a year would collide. */
export function formatDottedDay(
  ts: number | null | undefined,
  timeZone?: string
): string {
  const ms = toEpochMs(ts);
  if (ms == null) return "—";
  const b = clockBits(ms, timeZone);
  if (!b) return "—";
  return `${pad2(b.day)}.${pad2(b.month)}`;
}

/** 24-hour clock. Seconds on by default. */
export function formatH24(
  ts: number | null | undefined,
  timeZone?: string,
  withSeconds = true
): string {
  const ms = toEpochMs(ts);
  if (ms == null) return "—";
  const b = clockBits(ms, timeZone);
  if (!b) return "—";
  const hm = `${pad2(b.hour)}:${pad2(b.minute)}`;
  return withSeconds ? `${hm}:${pad2(b.second)}` : hm;
}

/** `21.01.2026, 07:36:42`. */
export function formatStamp(
  ts: number | null | undefined,
  timeZone?: string
): string {
  const date = formatDottedDate(ts, timeZone);
  const time = formatH24(ts, timeZone, true);
  if (date === "—" || time === "—") return "—";
  return `${date}, ${time}`;
}

/** Day month year, day-first numeric. */
export function formatDayMonthYear(ts: number | null | undefined, _locale?: string): string {
  return formatDottedDate(ts);
}

export function formatTs(ts: number | null | undefined): string {
  return formatStamp(ts);
}

/** Clock only — first line of a Time column. 24-hour. */
export function formatClockTime(ts: number | null | undefined, _locale?: string): string {
  return formatH24(ts, undefined, true);
}

/** Numeric date only — second line of a Time column. */
export function formatNumericDate(ts: number | null | undefined, _locale?: string): string {
  return formatDottedDate(ts);
}

/** AdaStat-style relative age: "22s ago", "2m ago". Same as address tx tape. */
/** Compact "5m ago" / "5 мин назад". `formatRelTime(ts, locale)` or `formatRelTime(ts, now, locale)`. */
export function formatRelTime(
  ts: number | null | undefined,
  nowOrLocale?: number | string,
  locale?: string
): string {
  const ms = toEpochMs(ts);
  if (ms == null) return "—";
  const now = typeof nowOrLocale === "number" ? nowOrLocale : undefined;
  const ru = isRuLocale(typeof nowOrLocale === "string" ? nowOrLocale : locale);
  const origin = now ?? Date.now();
  const sec = Math.max(0, Math.floor((origin - ms) / 1000));
  if (sec < 60) return ru ? `${sec} с назад` : `${sec}s ago`;
  if (sec < 3600) return ru ? `${Math.floor(sec / 60)} мин назад` : `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return ru ? `${Math.floor(sec / 3600)} ч назад` : `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 30) return ru ? `${days} дн. назад` : `${days}d ago`;
  if (days < 365) {
    const mo = Math.max(1, Math.floor(days / 30));
    return ru ? `${mo} мес. назад` : `${mo}mo ago`;
  }
  const yr = Math.max(1, Math.floor(days / 365));
  return ru ? `${yr} г. назад` : `${yr}y ago`;
}

function isRuLocale(locale?: string): boolean {
  return !!locale && (locale === "ru" || locale.startsWith("ru-"));
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** `18.08.2020, 07:36:42` — first/last activity on /addresses. */
export function formatActivityStamp(ts: number | null | undefined): string {
  return formatStamp(ts);
}

/** Address tx-tape stamp: day-first date + 24h clock. */
export function formatFactWhen(
  ts: number | null | undefined,
  _locale?: string
): string {
  return formatStamp(ts);
}

const REL_MINUTE = 60;
const REL_HOUR = 3600;
const REL_DAY = 86400;

function relAgeSeconds(ts: number | null | undefined, now?: number): number | null {
  const ms = toEpochMs(ts);
  if (ms == null) return null;
  const origin = now ?? Date.now();
  return Math.max(0, Math.floor((origin - ms) / 1000));
}

/** "6 yrs ago" / "6 лет назад". Hours, days, months, years. Inject `now` in tests. */
export function formatRelAge(
  ts: number | null | undefined,
  locale?: string,
  now?: number
): string {
  const sec = relAgeSeconds(ts, now);
  if (sec == null) return "—";
  const ru = isRuLocale(locale);
  if (sec < REL_MINUTE) return ru ? `${sec} с назад` : `${sec}s ago`;
  if (sec < REL_HOUR) {
    const m = Math.floor(sec / REL_MINUTE);
    return ru ? `${m} мин назад` : `${m} min ago`;
  }
  if (sec < REL_DAY) {
    const h = Math.floor(sec / REL_HOUR);
    if (ru) return `${h} ${ruPlural(h, "час", "часа", "часов")} назад`;
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  const days = Math.floor(sec / REL_DAY);
  if (days < 30) {
    if (ru) return `${days} ${ruPlural(days, "день", "дня", "дней")} назад`;
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (days < 365) {
    const mo = Math.max(1, Math.floor(days / 30));
    if (ru) return `${mo} ${ruPlural(mo, "месяц", "месяца", "месяцев")} назад`;
    return mo === 1 ? "1 month ago" : `${mo} months ago`;
  }
  const yr = Math.max(1, Math.floor(days / 365));
  if (ru) return `${yr} ${ruPlural(yr, "год", "года", "лет")} назад`;
  return yr === 1 ? "1 yr ago" : `${yr} yrs ago`;
}

/** Recency ink for first/last: live → today → month → year → old. */
export type RelAgeTone = "hot" | "day" | "month" | "year" | "old";

export function relAgeTone(
  ts: number | null | undefined,
  now?: number
): RelAgeTone | null {
  const sec = relAgeSeconds(ts, now);
  if (sec == null) return null;
  if (sec < REL_HOUR) return "hot";
  if (sec < REL_DAY) return "day";
  if (sec < 30 * REL_DAY) return "month";
  if (sec < 365 * REL_DAY) return "year";
  return "old";
}

export function relAgeToneClass(tone: RelAgeTone | null): string {
  switch (tone) {
    case "hot":
      return "text-[var(--up)]";
    case "day":
      return "text-[var(--accent)]";
    case "month":
      return "text-[var(--warning)]";
    case "year":
      return "text-[var(--muted)]";
    case "old":
      return "text-[var(--muted-2)]";
    default:
      return "text-[var(--muted-2)]";
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)}B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    return `${kb >= 10 ? kb.toFixed(0) : kb.toFixed(1)}KB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)}MB`;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describePrice,
  describeRentErg,
  describeScaledAmount,
  describeUsd,
  formatCompact,
  formatCompactNumber,
  formatErg,
  formatFeeRate,
  formatGroupedInt,
  formatGroupedNumber,
  formatInt,
  formatPct,
  formatScaledGlance,
  formatUsdPrice,
  groupSeparator,
  formatActivityStamp,
  formatClockTime,
  formatDottedDate,
  formatEmissionGlance,
  formatH24,
  formatNumericDate,
  formatErgFixed,
  formatScaledFixed,
  formatFactWhen,
  formatRelAge,
  formatRelTime,
  formatScaledAmount,
  formatTokenAmount,
  laterEpochMs,
  relAgeTone,
  relAgeToneClass,
  visibleAddress,
} from "./format.js";

function vis(s: string): string {
  return s.replace(/[\u00a0\u202f]/g, " ");
}

test("long contract addresses keep P2PK width with a middle ellipsis", () => {
  const p2pk = "9".repeat(51);
  assert.equal(visibleAddress(p2pk), p2pk);
  const p2s = "2" + "a".repeat(80) + "Z";
  const shown = visibleAddress(p2s);
  assert.equal(shown.length, 51);
  assert.equal(shown, `${p2s.slice(0, 25)}…${p2s.slice(-25)}`);
});

test("rent columns keep 4 decimals and fold a run of zeros", () => {
  assert.equal(describeRentErg("1403000000").text, "1.4030 ERG");
  assert.equal(describeRentErg("1231910000000").text, "1,231.9100 ERG");
  assert.equal(describeRentErg("1231910000000", "ru").text, "1\u00a0231.9100 ERG");
  assert.equal(describeRentErg("10000000").text, "0.0100 ERG");
  assert.equal(describeRentErg("4452310").text, "0.0045 ERG");
  assert.equal(describeRentErg("0").text, "0.0000 ERG");
  const tiny = describeRentErg("45");
  assert.equal(tiny.text, null);
  assert.equal(tiny.tiny?.zeros, 7);
  assert.equal(tiny.tiny?.digits, "45");
});

test("formatErgFixed groups thousands and keeps two decimals", () => {
  assert.equal(formatErgFixed("800000000000000", "ru"), "800\u00a0000.00 ERG");
  assert.equal(formatErgFixed("1450000000000000", "ru"), "1\u00a0450\u00a0000.00 ERG");
  assert.equal(formatErgFixed("1450000000000000", "ru-RU"), "1\u00a0450\u00a0000.00 ERG");
  assert.equal(formatErgFixed("800000000000000", "en"), "800,000.00 ERG");
  assert.equal(formatErgFixed("800000000000000"), "800,000.00 ERG");
  assert.equal(formatErgFixed("-1450000000000000", "en"), "-1,450,000.00 ERG");
  assert.equal(formatErgFixed("0", "en"), "0.00 ERG");
  assert.equal(formatErgFixed("123456789", "ru"), "0.12 ERG");
});

test("token amounts cap at 4 dp; EN groups with commas, RU with a no-break space, both keep the point", () => {
  assert.equal(formatScaledAmount(267_486_903_956n, 8, "ru"), "2\u00a0674.869");
  assert.equal(formatScaledAmount(267_486_903_956n, 8, "en"), "2,674.869");
  assert.equal(formatScaledAmount(267_486_903_956n, 8, "en-US"), "2,674.869");
  assert.equal(formatScaledAmount(-267_486_903_956n, 8, "ru-RU"), "-2\u00a0674.869");
  assert.equal(formatTokenAmount("80000", 0, "en"), "80,000");
  assert.equal(formatTokenAmount("80000", 0, "ru"), "80\u00a0000");
  assert.equal(formatTokenAmount("60000000000", 8, "ru"), "600");
  assert.doesNotMatch(formatTokenAmount("80000", 0, "ru"), /,/);
  assert.doesNotMatch(formatScaledAmount(267_486_903_956n, 8, "ru"), /,/);
  // bigint past Number precision stays exact
  assert.equal(formatTokenAmount(123_456_789_012_345_678_901n, 0, "en"), "123,456,789,012,345,678,901");
  assert.equal(formatScaledAmount(97_739_924_123_456_789n, 9, "en"), "97,739,924.1235");
});

test("formatEmissionGlance groups millions and compacts from a billion", () => {
  assert.equal(formatEmissionGlance(21_000_000n, 0, "en").text, "21,000,000");
  assert.equal(vis(formatEmissionGlance(21_000_000n, 0, "ru").text), "21 000 000");
  assert.equal(formatEmissionGlance(21_000_000n * 1_000_000n, 6, "en").text, "21,000,000");
  assert.equal(formatEmissionGlance(999_999_999n, 0, "en").text, "999,999,999");
  assert.equal(formatEmissionGlance(1_000_000_000n, 0, "en").text, "1B");
  // RU keeps the latin suffix and the point, like every other short figure on the site.
  assert.equal(formatEmissionGlance(1_000_000_000n, 0, "ru").text, "1B");
  assert.equal(formatEmissionGlance(100_000_000_000n, 0, "ru").text, "100B");
  assert.equal(formatEmissionGlance(10n ** 18n, 3, "en").text, "1×10¹⁵");
  assert.doesNotMatch(formatEmissionGlance(10n ** 18n, 3, "en").text, /E|T/);
  assert.equal(formatEmissionGlance(10n ** 18n + 1n, 0, "en").text, "1×10¹⁸");
  assert.equal(formatEmissionGlance(25n * 10n ** 14n, 0, "ru").text, "2.5×10¹⁵");
  assert.equal(formatEmissionGlance(10n ** 18n, 3, "en").exact, "1,000,000,000,000,000");
  assert.equal(vis(formatEmissionGlance(10n ** 18n, 3, "ru").exact), "1 000 000 000 000 000");
});

test("one group separator per language", () => {
  assert.equal(groupSeparator("en"), ",");
  assert.equal(groupSeparator(undefined), ",");
  assert.equal(groupSeparator("ru"), "\u00a0");
  assert.equal(groupSeparator("ru-RU"), "\u00a0");
  assert.equal(formatGroupedInt(1_915_364n, "en"), "1,915,364");
  assert.equal(formatGroupedInt(-1_915_364n, "ru"), "-1\u00a0915\u00a0364");
  assert.equal(formatGroupedInt(999n, "en"), "999");
  // Integer counts match toLocaleString with the UI tag, so helper and plain counts never differ.
  assert.equal(formatInt(1_915_364, "en"), (1_915_364).toLocaleString("en-US"));
  assert.equal(formatInt(1_915_364, "ru"), (1_915_364).toLocaleString("ru-RU"));
  assert.equal(formatInt(1_024, "ru"), (1_024).toLocaleString("ru-RU"));
  assert.equal(formatInt(12_345_678_901_234_567_890n, "en"), "12,345,678,901,234,567,890");
  assert.equal(formatInt(2.6, "en"), "3");
  assert.equal(formatInt(null, "en"), "—");
  assert.equal(formatInt(Number.NaN, "ru"), "—");
});

test("formatGroupedNumber keeps the point in both languages", () => {
  assert.equal(formatGroupedNumber(1_337_399.256, 2, 2, "en"), "1,337,399.26");
  assert.equal(formatGroupedNumber(1_337_399.256, 2, 2, "ru"), "1\u00a0337\u00a0399.26");
  assert.equal(formatGroupedNumber(-27_508_614.891, 2, 2, "en"), "-27,508,614.89");
  assert.equal(formatGroupedNumber(-0.001, 0, 2, "en"), "0");
  assert.equal(formatGroupedNumber(6.6, 0, 1, "ru"), "6.6");
  assert.equal(formatGroupedNumber(0.000123, 2, 6, "en"), "0.000123");
  assert.equal(formatGroupedNumber(Number.POSITIVE_INFINITY, 0, 2, "en"), "—");
});

test("formatPct: point and no space before % in both languages", () => {
  assert.equal(formatPct(99.987, "ru", 2, 2), "99.99%");
  assert.equal(formatPct(0.5, "ru-RU", 1, 1), "0.5%");
  assert.equal(formatPct(1250, "en", 0, 0), "1,250%");
  assert.equal(formatPct(1250, "ru", 0, 0), "1\u00a0250%");
  assert.equal(formatPct(-3.14159, "en"), "-3.14%");
  assert.equal(formatPct(null, "en"), "—");
});

test("formatCompactNumber: one short form, latin suffix and point in both languages", () => {
  assert.equal(formatCompactNumber(1_337_399.26), "1.34M");
  assert.equal(formatCompactNumber(1_337_399.26, "ru"), "1.34M");
  assert.equal(formatCompactNumber(14_865_346), "14.87M");
  assert.equal(formatCompactNumber(148_700_000), "148.7M");
  assert.equal(formatCompactNumber(141_892), "141.9k");
  assert.equal(formatCompactNumber(1_500_000), "1.5M");
  assert.equal(formatCompactNumber(2_000_000_000), "2B");
  assert.equal(formatCompactNumber(9_994_445_956_549), "9.99T");
  assert.equal(formatCompactNumber(-1_720_000), "-1.72M");
  // rounding up to 1000 of a step moves to the next step
  assert.equal(formatCompactNumber(999_999), "1M");
  assert.equal(formatCompactNumber(999_960_000), "1B");
  // below a thousand: grouped as is
  assert.equal(formatCompactNumber(999), "999");
  assert.equal(formatCompactNumber(12.345, "en"), "12.35");
  assert.equal(formatCompactNumber(1_337_399.26, "en", 1), "1.3M");
});

test("formatCompact: whole figure below 10 000, short from there", () => {
  assert.equal(formatCompact(9_275, 2, "en"), "9,275");
  assert.equal(formatCompact(9_275, 2, "ru"), "9\u00a0275");
  assert.equal(formatCompact(12_345), "12.3k");
  assert.equal(formatCompact(12_345, 0), "12.3k");
  assert.equal(formatCompact(14_865_346), "14.87M");
  assert.equal(formatCompact(14_865_346, 0), "15M");
  assert.equal(formatCompact(999_990), "1M");
  assert.equal(formatCompact(-27_509_702.32, 2, "ru"), "-27.51M");
  assert.equal(formatCompact(null), "—");
});

test("formatScaledGlance: same short form in RU, exact keeps every digit", () => {
  const g = formatScaledGlance(1_720_000_000_000_000n, 9, "ru-RU");
  assert.equal(g.text, "1.72M");
  assert.equal(g.exact, "1\u00a0720\u00a0000");
  const e = formatScaledGlance(910_001_389_000_000n, 9, "en");
  assert.equal(e.text, "910,001.389");
  assert.equal(formatScaledGlance(-27_509_702_320_000_000n, 9, "en").text, "-27.51M");
});

test("USD: $ in front, compact from a thousand, tiny values fold zeros", () => {
  assert.equal(describeUsd(14_865_346)?.text, "$14.87M");
  assert.equal(describeUsd(174_545)?.text, "$174.5k");
  assert.equal(describeUsd(1_500)?.text, "$1.5k");
  assert.equal(describeUsd(13.5)?.text, "$13.50");
  assert.equal(describeUsd(-9.76)?.text, "-$9.76");
  assert.equal(describeUsd(0.0001234)?.text, "$0.0001");
  assert.equal(describeUsd(0.00001234)?.tiny?.zeros, 4);
  assert.equal(describeUsd(0)?.text, "$0");
  assert.equal(describeUsd(null), null);
});

test("formatUsdPrice: header and home tile agree at four significant digits", () => {
  assert.equal(formatUsdPrice(0.17786), "$0.1779");
  assert.equal(formatUsdPrice(0.17786, "ru"), "$0.1779");
  assert.equal(formatUsdPrice(1.23456), "$1.235");
  assert.equal(formatUsdPrice(12.3456), "$12.35");
  assert.equal(formatUsdPrice(96_123.4, "en"), "$96,123");
  assert.equal(formatUsdPrice(96_123.4, "ru"), "$96\u00a0123");
  assert.equal(formatUsdPrice(0.004321), "$0.0043");
  assert.equal(formatUsdPrice(null), "—");
});

test("describePrice and formatErg follow the same policy", () => {
  assert.equal(describePrice(1_234.5678, "en")?.text, "1,234.57");
  assert.equal(describePrice(1_234.5678, "ru")?.text, "1\u00a0234.57");
  assert.equal(describePrice(2_500_000, "ru")?.text, "2.5M");
  assert.equal(describePrice(0.0039)?.text, "0.0039");
  assert.equal(formatErg(1_337_399.26), "1.34M ERG");
  assert.equal(formatErg(12_500), "12.5k ERG");
  assert.equal(formatErg(12.5), "12.50 ERG");
});

test("dust uses a tiny-zero mark", () => {
  const d = describeScaledAmount(677n, 8, "ru");
  assert.equal(d.tiny?.zeros, 5);
  assert.equal(d.tiny?.digits, "677");
  assert.equal(d.text, "0.0₅677");
});

test("formatRelAge covers hours days months years", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  assert.equal(formatRelAge(now - 45_000, "en", now), "45s ago");
  assert.equal(formatRelAge(now - 12 * 60_000, "en", now), "12 min ago");
  assert.equal(formatRelAge(now - 5 * 3600_000, "en", now), "5 hours ago");
  assert.equal(formatRelAge(now - 3 * 86400_000, "en", now), "3 days ago");
  assert.equal(formatRelAge(now - 60 * 86400_000, "en", now), "2 months ago");
  assert.equal(formatRelAge(now - 6 * 365 * 86400_000, "en", now), "6 yrs ago");
  assert.equal(formatRelAge(now - 45_000, "ru", now), "45 с назад");
  assert.equal(formatRelAge(now - 3 * 86400_000, "ru", now), "3 дня назад");
  assert.equal(formatRelAge(now - 1 * 86400_000, "ru", now), "1 день назад");
  assert.equal(formatRelAge(now - 21 * 86400_000, "ru", now), "21 день назад");
  assert.equal(formatRelAge(now - 5 * 86400_000, "ru", now), "5 дней назад");
  assert.equal(formatRelAge(now - 6 * 365 * 86400_000, "ru", now), "6 лет назад");
  assert.equal(formatRelAge(null, "en", now), "—");
});

test("relAgeTone follows recency bands", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  assert.equal(relAgeTone(now - 12 * 60_000, now), "hot");
  assert.equal(relAgeTone(now - 5 * 3600_000, now), "day");
  assert.equal(relAgeTone(now - 3 * 86400_000, now), "month");
  assert.equal(relAgeTone(now - 60 * 86400_000, now), "year");
  assert.equal(relAgeTone(now - 6 * 365 * 86400_000, now), "old");
  assert.equal(relAgeTone(null, now), null);
  assert.equal(relAgeToneClass("hot"), "text-[var(--up)]");
  assert.equal(relAgeToneClass("day"), "text-[var(--accent)]");
  assert.equal(relAgeToneClass("month"), "text-[var(--warning)]");
  assert.equal(relAgeToneClass("year"), "text-[var(--muted)]");
  assert.equal(relAgeToneClass("old"), "text-[var(--muted-2)]");
});

test("formatRelTime matches the address tx tape", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  assert.equal(formatRelTime(now - 45_000, now), "45s ago");
  assert.equal(formatRelTime(now - 12 * 60_000, now), "12m ago");
  assert.equal(formatRelTime(now - 5 * 3600_000, now), "5h ago");
  assert.equal(formatRelTime(now - 3 * 86400_000, now), "3d ago");
  assert.equal(formatRelTime(now - 60 * 86400_000, now), "2mo ago");
  assert.equal(formatRelTime(now - 6 * 365 * 86400_000, now), "6y ago");
  assert.equal(formatRelTime(null, now), "—");
});

test("formatRelTime in Russian keeps the compact shape", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  assert.equal(formatRelTime(now - 45_000, now, "ru"), "45 с назад");
  assert.equal(formatRelTime(now - 12 * 60_000, now, "ru-RU"), "12 мин назад");
  assert.equal(formatRelTime(now - 5 * 3600_000, now, "ru"), "5 ч назад");
  assert.equal(formatRelTime(now - 3 * 86400_000, now, "ru"), "3 дн. назад");
  assert.equal(formatRelTime(now - 60 * 86400_000, now, "ru"), "2 мес. назад");
  assert.equal(formatRelTime(now - 6 * 365 * 86400_000, now, "ru"), "6 г. назад");
  assert.equal(formatRelTime(now - 45_000, now, "en"), "45s ago");
});

test("formatFactWhen is day-first with a 24h clock", () => {
  const ts = Date.UTC(2020, 7, 18, 15, 36, 42);
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  assert.equal(formatFactWhen(ts, "en"), stamp);
  assert.equal(formatFactWhen(ts, "ru"), stamp);
  assert.equal(formatFactWhen(null, "en"), "—");
  assert.doesNotMatch(stamp, /AM|PM|\//);
  assert.equal(formatDottedDate(ts, "UTC"), "18.08.2020");
  assert.equal(formatH24(ts, "UTC"), "15:36:42");
  assert.equal(formatH24(Date.UTC(2020, 7, 18, 0, 0, 0), "UTC"), "00:00:00");
  assert.doesNotMatch(formatClockTime(ts, "en"), /AM|PM/);
  assert.equal(formatNumericDate(ts, "en"), formatDottedDate(ts));
});

test("formatActivityStamp is day-first with 24h clock", () => {
  const stamp = formatActivityStamp(Date.UTC(2020, 7, 18, 7, 36, 42));
  assert.match(stamp, /^\d{2}\.\d{2}\.2020, \d{2}:\d{2}:\d{2}$/);
});

test("laterEpochMs prefers tape over a stale summary lastTs", () => {
  const snap = Date.parse("2026-09-17T10:53:52Z");
  const tip = Date.parse("2026-09-19T10:17:25Z");
  assert.equal(laterEpochMs(snap, tip), tip);
  assert.equal(laterEpochMs(snap, null, tip), tip);
  assert.equal(laterEpochMs(null, undefined), null);
});

test("formatScaledFixed: two places for a balance column", () => {
  assert.equal(formatScaledFixed(910_001_389_000_000n, 9, 2, "en"), "910,001.39");
  assert.equal(formatScaledFixed(910_001_389_000_000n, 9, 2, "ru-RU"), "910\u00a0001.39");
  assert.equal(formatScaledFixed(10_953_580_330_000_000n, 9, 2, "en-US"), "10,953,580.33");
  assert.equal(formatScaledFixed(1_000_000_000n, 9, 2, "en"), "1.00");
  assert.equal(formatScaledFixed(9_995_000_000n, 9, 2, "en"), "10.00");
  assert.equal(formatScaledFixed(5n, 0, 2, "en"), "5.00");
});

test("formatFeeRate: shared short form, one decimal, no trailing zero", () => {
  assert.equal(formatFeeRate(107.4), "107 n/B");
  assert.equal(formatFeeRate(2_000), "2k n/B");
  assert.equal(formatFeeRate(2_240), "2.2k n/B");
  assert.equal(formatFeeRate(34_740), "34.7k n/B");
  assert.equal(formatFeeRate(999_990), "1M n/B");
});

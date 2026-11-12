import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeRentErg,
  describeScaledAmount,
  formatActivityStamp,
  formatClockTime,
  formatDottedDate,
  formatEmissionGlance,
  formatH24,
  formatNumericDate,
  formatErgFixed,
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
  assert.equal(describeRentErg("10000000").text, "0.0100 ERG");
  assert.equal(describeRentErg("4452310").text, "0.0045 ERG");
  assert.equal(describeRentErg("0").text, "0.0000 ERG");
  const tiny = describeRentErg("45");
  assert.equal(tiny.text, null);
  assert.equal(tiny.tiny?.zeros, 7);
  assert.equal(tiny.tiny?.digits, "45");
});

test("formatErgFixed groups thousands and keeps two decimals", () => {
  assert.equal(vis(formatErgFixed("800000000000000", "ru")), "800 000.00 ERG");
  assert.equal(vis(formatErgFixed("1450000000000000", "ru")), "1 450 000.00 ERG");
  assert.equal(vis(formatErgFixed("800000000000000", "en")), "800 000.00 ERG");
  assert.equal(formatErgFixed("0", "en"), "0.00 ERG");
  assert.equal(vis(formatErgFixed("123456789", "ru")), "0.12 ERG");
});

test("token amounts cap at 4 dp and group thousands with spaces not commas", () => {
  assert.equal(vis(formatScaledAmount(267_486_903_956n, 8, "ru")), "2 674.869");
  assert.equal(vis(formatScaledAmount(267_486_903_956n, 8, "en")), "2 674.869");
  assert.equal(vis(formatTokenAmount("80000", 0, "en")), "80 000");
  assert.equal(vis(formatTokenAmount("80000", 0, "ru")), "80 000");
  assert.equal(formatTokenAmount("60000000000", 8, "ru"), "600");
  assert.match(formatTokenAmount("80000", 0, "en"), /\u00a0/);
  assert.doesNotMatch(formatTokenAmount("80000", 0, "en"), /,/);
});

test("formatEmissionGlance groups millions and compacts from a billion", () => {
  assert.equal(vis(formatEmissionGlance(21_000_000n, 0, "en").text), "21 000 000");
  assert.equal(vis(formatEmissionGlance(21_000_000n * 1_000_000n, 6, "en").text), "21 000 000");
  assert.equal(vis(formatEmissionGlance(999_999_999n, 0, "en").text), "999 999 999");
  assert.equal(formatEmissionGlance(1_000_000_000n, 0, "en").text, "1B");
  assert.match(formatEmissionGlance(1_000_000_000n, 0, "ru").text, /млрд/);
  assert.equal(vis(formatEmissionGlance(10n ** 18n, 3, "en").text), "1 000 000 000 000 000");
  assert.doesNotMatch(formatEmissionGlance(10n ** 18n, 3, "en").text, /E|T/);
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

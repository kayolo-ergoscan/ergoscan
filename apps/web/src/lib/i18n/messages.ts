/**
 * Lightweight RU/EN strings for ErgoScan (no next-intl dep yet).
 * Split en/ru for maintainability + reliable GitHub sync.
 */
import { en } from "./en";

export type Locale = "en" | "ru";

export const LOCALES: { id: Locale; label: string; native: string }[] = [
  { id: "en", label: "English", native: "EN" },
  { id: "ru", label: "Русский", native: "RU" },
];

export const STORAGE_KEY = "lumen-stage-locale";

type Dict = Record<string, string>;

/**
 * English ships with every page. Russian (~100 KB of source) is its own chunk, loaded only
 * when RU is picked; until it arrives, keys fall back to English (the server renders EN anyway).
 */
export const MESSAGES: Partial<Record<Locale, Dict>> = { en };

export function translate(locale: Locale, key: string): string {
  return MESSAGES[locale]?.[key] ?? en[key as keyof typeof en] ?? key;
}

/**
 * Plural forms live in one string, split by "|": English "one|other", Russian "one|few|many"
 * ("{n} бокс|{n} бокса|{n} боксов"). A string without "|" is used for every count.
 */
export function pluralForm(locale: Locale, template: string, n: number): string {
  const forms = template.split("|");
  if (forms.length === 1) return template;
  const last = forms.length - 1;
  if (!Number.isFinite(n)) return forms[last]!;
  const cat = new Intl.PluralRules(locale === "ru" ? "ru-RU" : "en-US").select(n);
  const idx =
    locale === "ru"
      ? cat === "one"
        ? 0
        : cat === "few" || cat === "other"
          ? 1
          : 2
      : cat === "one"
        ? 0
        : 1;
  return forms[Math.min(idx, last)]!;
}

/** Translate a count string: pick the plural form for `n`, put `shown` (default n) in {n}. */
export function translateCount(locale: Locale, key: string, n: number, shown?: string): string {
  return pluralForm(locale, translate(locale, key), n).replace("{n}", shown ?? String(n));
}

/** translateCount for code that holds `t` and a locale ("ru", "ru-RU", "en", …). */
export function countText(
  t: (key: string) => string,
  locale: string,
  key: string,
  n: number,
  shown?: string
): string {
  const l: Locale = locale.startsWith("ru") ? "ru" : "en";
  return pluralForm(l, t(key), n).replace("{n}", shown ?? String(n));
}

export function localeLoaded(locale: Locale): boolean {
  return MESSAGES[locale] != null;
}

export async function loadLocale(locale: Locale): Promise<void> {
  if (MESSAGES[locale]) return;
  if (locale === "ru") MESSAGES.ru = (await import("./ru")).ru;
}

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* */
  }
  // Public default is English. RU is a switch, not Accept-Language / navigator.language.
  return "en";
}

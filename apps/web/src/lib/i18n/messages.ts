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

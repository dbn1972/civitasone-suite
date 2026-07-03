/**
 * Lightweight i18n framework for CivitasOne web app.
 * Uses a simple key-lookup pattern with English as source of truth.
 * No heavy dependencies — just plain TS objects and a context provider.
 */

import { en } from "./en";
import { hi } from "./hi";
import { ta } from "./ta";
import { te } from "./te";
import { kn } from "./kn";

export type Locale = "en" | "hi" | "ta" | "te" | "kn";
export const DEFAULT_LOCALE: Locale = "en";
export const SUPPORTED_LOCALES: Locale[] = ["en", "hi", "ta", "te", "kn"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "🇬🇧 English",
  hi: "🇮🇳 हिन्दी",
  ta: "🇮🇳 தமிழ்",
  te: "🇮🇳 తెలుగు",
  kn: "🇮🇳 ಕನ್ನಡ",
};

const dictionaries: Record<Locale, Record<string, string>> = { en, hi, ta, te, kn };

/**
 * Look up a translation key for the given locale.
 * Falls back to English, then returns the key itself if not found.
 */
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const translations = dictionaries[locale];
  return translations?.[key] ?? en[key] ?? key;
}

/**
 * Detect locale from browser navigator.language, mapping to supported locales.
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("hi")) return "hi";
  if (lang.startsWith("ta")) return "ta";
  if (lang.startsWith("te")) return "te";
  if (lang.startsWith("kn")) return "kn";
  return "en";
}

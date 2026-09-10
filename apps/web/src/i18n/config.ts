/**
 * Single source of truth for locale configuration (UX-004).
 *
 * next-intl is the one i18n system for apps/web (see
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-004 and
 * .claude/skills/09-localisation-i18n.md). The old `lib/i18n/*` framework
 * has been retired — its content was merged into src/messages/{en,hi}.json.
 */

export const SUPPORTED_LOCALES = ["en", "hi"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Cookie next-intl's request config (./request.ts) reads on every request. */
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/**
 * Locales that render right-to-left. Empty today (en/hi are both LTR) but
 * kept explicit so `dir` on <html> is driven by data, not hardcoded, ready
 * for skill 09's ar-SA locale (Phase 2) without another layout.tsx change.
 */
const RTL_LOCALES = new Set<string>(["ar"]);

export function isSupportedLocale(value: string | undefined | null): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: string | undefined | null): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirForLocale(locale: string): "ltr" | "rtl" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

/**
 * Single source of truth for locale configuration (UX-004).
 *
 * next-intl is the one i18n system for apps/web (see
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-004 and
 * .claude/skills/09-localisation-i18n.md). The old `lib/i18n/*` framework
 * has been retired — its content was merged into src/messages/{en,hi}.json.
 * ta/te/kn were later restored from that old framework's own git history
 * (a separate decision — see restored-locales.test.ts and the PR that added
 * them) after being dropped, undisclosed, by this same UX-004 fix.
 */

export const SUPPORTED_LOCALES = ["en", "hi", "ta", "te", "kn"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Cookie next-intl's request config (./request.ts) reads on every request. */
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  hi: "हिन्दी",
  // ta/te/kn (UX-004 follow-up): restored from the lib/i18n/* content
  // deleted when UX-004 consolidated onto next-intl (recovered from git
  // history — see src/messages/restored-locales.test.ts for provenance,
  // the coverage numbers, and the explicit, enforced-non-zero check).
  // Coverage is a real but partial subset of the full key set (~194 of
  // ~1859 keys, the original translator's own scope, unchanged). A missing
  // key degrades gracefully under next-intl's default onError/
  // getMessageFallback (a logged error + visible fallback text), never a
  // crash.
  ta: "தமிழ்",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
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

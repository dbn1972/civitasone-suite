"use client";

import { Button } from "../Button";

/**
 * GAP-DESIGNER-DETAIL-B8-01: a locale key is any BCP-47-ish code the tenant
 * publishes in (en, hi, or, bn, ta, …), not a fixed en|hi union. Kept as a
 * string alias so existing callers that pass "en"/"hi" compile unchanged while
 * dynamic-locale callers can pass arbitrary codes.
 */
export type LocaleKey = string;

/** Display label for a locale code. Falls back to the upper-cased code. */
export const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  hi: "हिंदी",
  or: "ଓଡ଼ିଆ",
  bn: "বাংলা",
  ta: "தமிழ்",
  te: "తెలుగు",
  mr: "मराठी",
  gu: "ગુજરાતી",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  pa: "ਪੰਜਾਬੀ",
  ur: "اردو",
  as: "অসমীয়া",
};

export function localeLabel(code: string): string {
  return LOCALE_LABELS[code] ?? code.toUpperCase();
}

export interface LocaleTabsProps {
  active: LocaleKey;
  onChange: (locale: LocaleKey) => void;
  /**
   * GAP-DESIGNER-DETAIL-B8-01: the locale codes to render tabs for. Defaults to
   * en/hi so pre-existing callers (DocumentsBuilder) are unchanged; the
   * notification builder passes the tenant's governance locales.
   */
  locales?: readonly LocaleKey[];
  /** Per-locale completeness dot: true=●, false=○, undefined=none. */
  completeness?: Record<string, boolean | undefined>;
}

export function LocaleTabs({ active, onChange, locales = ["en", "hi"], completeness }: LocaleTabsProps) {
  return (
    <div role="tablist" aria-label="Locale" style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      {locales.map((code) => {
        const selected = active === code;
        const complete = completeness?.[code];
        return (
          <Button
            key={code}
            type="button"
            role="tab"
            aria-selected={selected}
            variant={selected ? "primary" : "ghost"}
            onClick={() => onChange(code)}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            {localeLabel(code)}
            {complete === false ? " ○" : complete === true ? " ●" : ""}
          </Button>
        );
      })}
    </div>
  );
}

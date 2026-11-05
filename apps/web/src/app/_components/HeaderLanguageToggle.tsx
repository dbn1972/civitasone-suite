"use client";
/**
 * UAT-P2-D3 (A11Y-20 / GLB-05, GIGW 3.0 bilingual; WCAG 3.1.2): Hindi was only
 * reachable inside the avatar menu, behind an emoji-flag button. This is the
 * visible header toggle GIGW expects on every page: in English it offers
 * "हिन्दी", in any other language it offers "English". The label is plain text
 * marked with its own language, so it renders without an emoji font and is
 * pronounced correctly. The full language list stays in the Account menu.
 */
import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALE_COOKIE, LOCALE_LABELS, type SupportedLocale } from "@/i18n/config";

export function targetLocale(current: string): SupportedLocale {
  return current === "en" ? "hi" : "en";
}

export function HeaderLanguageToggle() {
  const locale = useLocale();
  const t = useTranslations("shell");
  const target = targetLocale(locale);
  const label = LOCALE_LABELS[target];

  const switchLanguage = useCallback(() => {
    document.cookie = `${LOCALE_COOKIE}=${target};path=/;max-age=31536000;SameSite=Lax`;
    window.location.reload();
  }, [target]);

  return (
    <button
      type="button"
      className="btn ghost sm tb-lang"
      onClick={switchLanguage}
      aria-label={t("switchLanguageTo", { language: label })}
    >
      <span lang={target} className="tb-lang-long">{label}</span>
      <span lang={target} className="tb-lang-short" aria-hidden="true">{target === "hi" ? "अ" : "A"}</span>
    </button>
  );
}

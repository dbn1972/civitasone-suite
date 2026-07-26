/**
 * Server-side i18n utilities for Server Components.
 *
 * Reads the locale from the "civitasone-locale" cookie (set by the client-side
 * LocaleProvider). Falls back to DEFAULT_LOCALE ("en") when the cookie is absent.
 *
 * Usage in Server Components:
 *   import { serverT } from "@/lib/i18n/server";
 *   const t = serverT();
 *   <h1>{t("nav.finance")}</h1>
 */
import { cookies } from "next/headers";
import { t as translate, DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./index";

export const LOCALE_COOKIE = "civitasone-locale";

/**
 * Read the current locale from the cookie store.
 * Safe to call in Server Components and server actions.
 */
export function getServerLocale(): Locale {
  try {
    const cookieStore = cookies();
    const value = cookieStore.get(LOCALE_COOKIE)?.value;
    if (value && SUPPORTED_LOCALES.includes(value as Locale)) {
      return value as Locale;
    }
  } catch {
    // cookies() throws outside of request context (e.g., during build)
  }
  return DEFAULT_LOCALE;
}

/**
 * Returns a translation function bound to the server-detected locale.
 * Use in Server Components: `const t = serverT();`
 */
export function serverT(): (key: string) => string {
  const locale = getServerLocale();
  return (key: string) => translate(key, locale);
}

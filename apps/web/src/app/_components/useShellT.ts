"use client";
/**
 * UAT-P3 (UX shell, H-1): translation for the shared shell (sidebar, top bar,
 * search) with an English fallback.
 *
 * The shell components are rendered by many component tests WITHOUT a
 * NextIntlClientProvider; a bare useTranslations() throws there. Same guard
 * as DataTable.useSafeTranslations, plus t.has(): a key missing from a
 * partial test message set falls back to the English literal instead of
 * printing the key or raising next-intl MISSING_MESSAGE.
 */
import { useTranslations } from "next-intl";

export type ShellT = (key: string, fallback: string, values?: Record<string, string | number>) => string;

function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? String(values[name]) : m));
}

export function useShellT(namespace = "appNav"): ShellT {
  let t: ReturnType<typeof useTranslations> | null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- same provider-optional guard as DataTable.useSafeTranslations; the hook runs unconditionally on every render.
    t = useTranslations(namespace);
  } catch {
    t = null;
  }
  return (key, fallback, values) => {
    if (!t) return interpolate(fallback, values);
    try {
      return t.has(key) ? t(key, values) : interpolate(fallback, values);
    } catch {
      return interpolate(fallback, values);
    }
  };
}

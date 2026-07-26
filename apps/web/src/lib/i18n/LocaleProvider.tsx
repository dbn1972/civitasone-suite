"use client";

/**
 * Locale context provider for CivitasOne i18n.
 * Reads initial locale from localStorage or browser language.
 * Provides t() and setLocale() via React context hooks.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, detectBrowserLocale, t as translate, type Locale } from "./index";

const STORAGE_KEY = "civitasone.locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key: string) => translate(key, DEFAULT_LOCALE),
});

interface LocaleProviderProps {
  children: ReactNode;
  /** Override initial locale (useful for testing). */
  initialLocale?: Locale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);

  // On mount, read persisted locale or detect from browser
  useEffect(() => {
    if (initialLocale) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "hi" || stored === "ta" || stored === "te" || stored === "kn") {
        setLocaleState(stored);
        // Sync to cookie for Server Components
        document.cookie = `civitasone-locale=${stored};path=/;max-age=31536000;SameSite=Lax`;
      } else {
        const detected = detectBrowserLocale();
        setLocaleState(detected);
        document.cookie = `civitasone-locale=${detected};path=/;max-age=31536000;SameSite=Lax`;
      }
    } catch {
      // SSR or localStorage unavailable — keep default
    }
  }, [initialLocale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      // ignore
    }
    // Sync to cookie so Server Components can read the locale via cookies()
    try {
      document.cookie = `civitasone-locale=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // ignore
    }
    // Update the html lang attribute for accessibility
    if (typeof document !== "undefined") {
      document.documentElement.lang = newLocale;
    }
  }, []);

  const t = useCallback(
    (key: string) => translate(key, locale),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Hook to access the current locale and setLocale function. */
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}

/** Hook to access the t() translation function bound to current locale. */
export function useT() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used within a LocaleProvider");
  return ctx.t;
}

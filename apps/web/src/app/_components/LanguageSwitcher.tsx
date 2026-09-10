"use client";

/**
 * Language switcher dropdown for the TopBar (mounted via AccountMenu).
 *
 * UX-004: previously drove `@/lib/i18n/LocaleProvider`, whose <LocaleProvider>
 * was never mounted anywhere in the app tree — so this control looked wired
 * but `setLocale` was a silent no-op. It now drives next-intl directly: on
 * selection it writes the `locale` cookie next-intl's request config reads
 * (src/i18n/request.ts) and reloads, so the root layout re-resolves the
 * locale server-side and both `<html lang>` and every translated string
 * update together.
 */
import { useCallback, useRef, useState, useEffect } from "react";
import { useLocale } from "next-intl";
import { LOCALE_COOKIE, LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/config";

export function LanguageSwitcher() {
  const locale = useLocale() as SupportedLocale;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleSelect = useCallback(
    (newLocale: SupportedLocale) => {
      setOpen(false);
      if (newLocale === locale) return;
      document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000;SameSite=Lax`;
      window.location.reload();
    },
    [locale],
  );

  // Close on Escape or click outside
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const currentFlag = locale === "hi" ? "🇮🇳" : "🇬🇧";

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={triggerRef}
        type="button"
        className="iconbtn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Language: ${LOCALE_LABELS[locale]}`}
        title="Switch language"
      >
        {currentFlag}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Select language"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "var(--surface, #fff)",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            listStyle: "none",
            padding: "4px 0",
            minWidth: 160,
            zIndex: 1100,
          }}
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <li key={loc}>
              <button
                type="button"
                role="option"
                aria-selected={loc === locale}
                onClick={() => handleSelect(loc)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 16px",
                  border: "none",
                  background: loc === locale ? "#f3f4f6" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 14,
                  fontWeight: loc === locale ? 600 : 400,
                }}
              >
                {LOCALE_LABELS[loc]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

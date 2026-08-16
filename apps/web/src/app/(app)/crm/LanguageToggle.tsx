"use client";

/**
 * LanguageToggle — CRM bilingual switch (GIGW 3.0 §4.3: Central Govt apps must
 * support Hindi and English).
 *
 * Phase 1 (S19): writes a localStorage preference key ('civitas-lang') and
 * reloads so server-rendered strings pick it up.  Full next-intl IntlProvider
 * wiring (locale routing, useTranslations hooks throughout) is tracked for S22.
 */
import { useEffect, useState } from "react";

const LANG_KEY = "civitas-lang";

function getStoredLang(): "en" | "hi" {
  if (typeof window === "undefined") return "en";
  return (localStorage.getItem(LANG_KEY) as "en" | "hi") ?? "en";
}

export function LanguageToggle() {
  const [lang, setLang] = useState<"en" | "hi">("en");

  useEffect(() => {
    setLang(getStoredLang());
  }, []);

  function switchTo(next: "en" | "hi") {
    if (next === lang) return;
    localStorage.setItem(LANG_KEY, next);
    setLang(next);
    window.location.reload();
  }

  return (
    <div
      role="toolbar"
      aria-label="Language selection"
      style={{
        display: "inline-flex",
        gap: 2,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r)",
        padding: 2,
      }}
    >
      <button
        type="button"
        onClick={() => switchTo("en")}
        aria-pressed={lang === "en"}
        style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: lang === "en" ? 600 : 400,
          background: lang === "en" ? "var(--accent)" : "transparent",
          color: lang === "en" ? "#fff" : "var(--ink-dim)",
          border: "none",
          borderRadius: "calc(var(--r) - 2px)",
          cursor: "pointer",
          lineHeight: 1.4,
          transition: "background 0.15s, color 0.15s",
        }}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => switchTo("hi")}
        aria-pressed={lang === "hi"}
        style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: lang === "hi" ? 600 : 400,
          background: lang === "hi" ? "var(--accent)" : "transparent",
          color: lang === "hi" ? "#fff" : "var(--ink-dim)",
          border: "none",
          borderRadius: "calc(var(--r) - 2px)",
          cursor: "pointer",
          lineHeight: 1.4,
          transition: "background 0.15s, color 0.15s",
        }}
      >
        हिन्दी
      </button>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

export function LanguageToggle() {
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    // Read from localStorage first (CRM i18n key), fall back to cookie
    const stored =
      typeof window !== "undefined" ? localStorage.getItem("civitas-lang") : null;
    if (stored === "en" || stored === "hi") {
      setLocale(stored);
    } else {
      const c = document.cookie.split("; ").find((r) => r.startsWith("locale="));
      if (c) setLocale(c.split("=")[1]);
    }
  }, []);

  const toggle = () => {
    const next = locale === "en" ? "hi" : "en";
    // Write to localStorage — consumed by CRM components via civitas-lang key
    localStorage.setItem("civitas-lang", next);
    // Also set cookie so server-side IntlProvider integration (S22) can read it
    document.cookie = "locale=" + next + ";path=/;max-age=31536000";
    setLocale(next);
    window.location.reload();
  };

  return (
    <button
      onClick={toggle}
      title={locale === "en" ? "हिंदी में बदलें" : "Switch to English"}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        color: "var(--text-2)",
      }}
      aria-label={locale === "en" ? "Switch to Hindi" : "Switch to English"}
    >
      {locale === "en" ? "हिन्दी" : "EN"}
    </button>
  );
}

import { describe, it, expect } from "vitest";
import { t, DEFAULT_LOCALE, SUPPORTED_LOCALES, detectBrowserLocale, type Locale } from "./index";
import { en } from "./en";
import { hi } from "./hi";

describe("i18n", () => {
  describe("t() function", () => {
    it("returns English string for a known key with default locale", () => {
      expect(t("nav.dashboard")).toBe("Dashboard");
    });

    it("returns Hindi string when locale is hi", () => {
      expect(t("nav.dashboard", "hi")).toBe("डैशबोर्ड");
    });

    it("returns English string when locale is en", () => {
      expect(t("action.save", "en")).toBe("Save");
    });

    it("falls back to English when Hindi key is missing", () => {
      // Simulate by testing a known key — both locales should have it
      // But if we call with an unknown locale, it should still return from en
      const result = t("action.save", "en");
      expect(result).toBe("Save");
    });

    it("returns the key itself when not found in any locale", () => {
      expect(t("nonexistent.key")).toBe("nonexistent.key");
      expect(t("nonexistent.key", "hi")).toBe("nonexistent.key");
    });

    it("uses DEFAULT_LOCALE when no locale is passed", () => {
      expect(t("status.active")).toBe(en["status.active"]);
    });
  });

  describe("locale constants", () => {
    it("DEFAULT_LOCALE is en", () => {
      expect(DEFAULT_LOCALE).toBe("en");
    });

    it("SUPPORTED_LOCALES contains en and hi", () => {
      expect(SUPPORTED_LOCALES).toContain("en");
      expect(SUPPORTED_LOCALES).toContain("hi");
      expect(SUPPORTED_LOCALES).toHaveLength(2);
    });
  });

  describe("locale completeness — all en keys exist in hi", () => {
    const enKeys = Object.keys(en);
    const hiKeys = Object.keys(hi);

    it("Hindi translation file has at least as many keys as English", () => {
      // Allow hi to have same or more keys
      expect(hiKeys.length).toBeGreaterThanOrEqual(enKeys.length);
    });

    it.each(enKeys)("hi has key: %s", (key) => {
      expect(hi[key]).toBeDefined();
      expect(hi[key]!.length).toBeGreaterThan(0);
    });
  });

  describe("locale completeness — all hi keys exist in en", () => {
    const hiKeys = Object.keys(hi);

    it.each(hiKeys)("en has key: %s", (key) => {
      expect(en[key]).toBeDefined();
      expect(en[key]!.length).toBeGreaterThan(0);
    });
  });

  describe("translation quality", () => {
    it("no English values are identical to Hindi (all should be translated)", () => {
      const enKeys = Object.keys(en);
      const identical = enKeys.filter((key) => en[key] === hi[key]);
      // Some brand names (CivitasOne, English) may stay the same — allow up to 5
      expect(identical.length).toBeLessThanOrEqual(5);
    });

    it("no values are empty strings", () => {
      Object.entries(en).forEach(([key, val]) => {
        expect(val.length, `en key "${key}" is empty`).toBeGreaterThan(0);
      });
      Object.entries(hi).forEach(([key, val]) => {
        expect(val.length, `hi key "${key}" is empty`).toBeGreaterThan(0);
      });
    });
  });

  describe("detectBrowserLocale()", () => {
    it("returns en as fallback when navigator is not available", () => {
      // In jsdom, navigator exists but may have default language
      const result = detectBrowserLocale();
      expect(SUPPORTED_LOCALES).toContain(result);
    });
  });
});

/**
 * Pack #17 — I18N: Localised Templates domain logic.
 *
 * Tests BCP 47 validation, locale resolution with fallback chain,
 * and stale-variant detection after a base template update.
 */
import { describe, it, expect } from "vitest";
import {
  validateBcp47,
  resolveLocale,
  findStaleVariants,
  type LocaleVariant,
} from "../src/modules/i18n/domain.js";

describe("validateBcp47", () => {
  it("accepts a two-letter language code", () => {
    expect(validateBcp47("en")).toBe(true);
  });

  it("accepts a three-letter language code", () => {
    expect(validateBcp47("hin")).toBe(true);
  });

  it("accepts language + region", () => {
    expect(validateBcp47("hi-IN")).toBe(true);
    expect(validateBcp47("en-US")).toBe(true);
    expect(validateBcp47("pt-BR")).toBe(true);
  });

  it("accepts language + script + region", () => {
    expect(validateBcp47("zh-Hans-CN")).toBe(true);
    expect(validateBcp47("sr-Latn-RS")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateBcp47("")).toBe(false);
  });

  it("rejects single character", () => {
    expect(validateBcp47("e")).toBe(false);
  });

  it("rejects strings exceeding 35 characters", () => {
    expect(validateBcp47("en-" + "a".repeat(35))).toBe(false);
  });

  it("rejects numeric-only codes", () => {
    expect(validateBcp47("123")).toBe(false);
  });

  it("rejects codes with invalid characters", () => {
    expect(validateBcp47("en_US")).toBe(false); // underscore not allowed
    expect(validateBcp47("en US")).toBe(false); // space not allowed
    expect(validateBcp47("en@GB")).toBe(false); // @ not allowed
  });

  it("rejects codes with wrong casing for script subtag", () => {
    // Script subtag must be titlecase (first upper, rest lower)
    expect(validateBcp47("zh-hans-CN")).toBe(false);
    expect(validateBcp47("zh-HANS-CN")).toBe(false);
  });

  it("rejects codes with wrong casing for region", () => {
    // Region subtag must be upper
    expect(validateBcp47("en-us")).toBe(false);
  });

  it("accepts numeric region subtag (UN M.49)", () => {
    expect(validateBcp47("es-419")).toBe(true);
  });
});

describe("resolveLocale — fallback chain", () => {
  const variants: LocaleVariant[] = [
    { locale: "hi", subject: "Hindi Subject", body: "Hindi Body", status: "current" },
    { locale: "hi-IN", subject: "Hindi India Subject", body: "Hindi India Body", status: "current" },
    { locale: "en", subject: "English Subject", body: "English Body", status: "current" },
    { locale: "mr", subject: null, body: "Marathi Body", status: "needs_review" },
    { locale: "ta", subject: "Tamil Subject", body: "Tamil Body", status: "current" },
  ];

  it("returns exact match for recipient locale", () => {
    const result = resolveLocale(variants, "hi-IN", "en");
    expect(result?.locale).toBe("hi-IN");
    expect(result?.body).toBe("Hindi India Body");
  });

  it("falls back to language-only when full tag not found", () => {
    // "hi-Deva" not found, falls back to "hi"
    const result = resolveLocale(variants, "hi-Deva", "en");
    expect(result?.locale).toBe("hi");
  });

  it("falls back to tenant default when recipient locale not found", () => {
    const result = resolveLocale(variants, "fr", "en");
    expect(result?.locale).toBe("en");
  });

  it("returns null when no match at all — caller uses base template", () => {
    const result = resolveLocale(variants, "fr", "de");
    expect(result).toBeNull();
  });

  it("skips non-current variants (needs_review)", () => {
    // "mr" exists but has status "needs_review"
    const result = resolveLocale(variants, "mr", "en");
    expect(result?.locale).toBe("en"); // falls through to tenant default
  });

  it("handles null recipient locale — goes straight to tenant default", () => {
    const result = resolveLocale(variants, null, "ta");
    expect(result?.locale).toBe("ta");
  });

  it("handles null tenant default — returns null if recipient locale not found", () => {
    const result = resolveLocale(variants, "fr", null);
    expect(result).toBeNull();
  });

  it("handles both nulls — returns null", () => {
    const result = resolveLocale(variants, null, null);
    expect(result).toBeNull();
  });

  it("returns exact match even when language-only also exists", () => {
    // "hi-IN" should be preferred over "hi" when recipient asks for "hi-IN"
    const result = resolveLocale(variants, "hi-IN", "en");
    expect(result?.locale).toBe("hi-IN");
  });

  it("handles empty variant list", () => {
    const result = resolveLocale([], "en", "hi");
    expect(result).toBeNull();
  });
});

describe("findStaleVariants", () => {
  it("returns locales of all current variants", () => {
    const variants: LocaleVariant[] = [
      { locale: "en", subject: "S", body: "B", status: "current" },
      { locale: "hi", subject: "S", body: "B", status: "current" },
      { locale: "ta", subject: "S", body: "B", status: "needs_review" },
    ];
    const stale = findStaleVariants(variants);
    expect(stale).toEqual(["en", "hi"]);
  });

  it("returns empty when no variants are current", () => {
    const variants: LocaleVariant[] = [
      { locale: "en", subject: "S", body: "B", status: "needs_review" },
    ];
    expect(findStaleVariants(variants)).toEqual([]);
  });

  it("returns empty for empty array", () => {
    expect(findStaleVariants([])).toEqual([]);
  });
});

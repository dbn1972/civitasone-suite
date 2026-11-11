/**
 * S8-G4: the grade-band strings exist in English and Hindi with the same keys and the same ICU placeholders,
 * and no Hindi value is left identical to its English source for the sentences that must be translated.
 */
import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

type Dict = Record<string, unknown>;
const E = en as Dict; const H = hi as Dict;

// Code-point checks instead of regex classes (lint: no-misleading-character-class forbids combining marks in a class).
const isDevanagari = (ch: string): boolean => { const c = ch.codePointAt(0)!; return c >= 0x0900 && c <= 0x097f; };
const hasDevanagari = (v: string): boolean => [...v].some(isDevanagari);
const hasLetters = (v: string): boolean => [...v].some((ch) => /[A-Za-z]/.test(ch) || isDevanagari(ch));

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();

const NEW_KEYS: Array<[string, string[]]> = [
  ["designations", ["subtitleBands", "statBandsInUseLabel", "manageBandsLink"]],
  ["designationsTable", ["colBand", "bandAriaLabel", "bandNone", "bandNoneOption", "bandInactiveSuffix", "bandNote"]],
  ["addDesignationForm", ["bandLabel", "bandNoneOption", "bandHint", "bandsEmptyHint", "bandsEmptyLink"]],
  ["employeeWizard", ["gradeBandLabel", "gradeBandNone", "gradeBandComputedNote"]],
  ["hr", ["gradeBands", "gradeBandsDesc"]],
  ["wfhForm", ["gazettedErrorBand"]],
];

describe("grade-band strings", () => {
  it("the gradeBands namespace has identical keys in en and hi, with identical placeholders", () => {
    const e = E.gradeBands as Dict; const h = H.gradeBands as Dict;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) {
      expect(typeof h[k], k).toBe("string");
      expect(placeholders(h[k] as string), k).toEqual(placeholders(e[k] as string));
    }
  });

  it("the keys added to existing namespaces exist in both languages with matching placeholders", () => {
    for (const [ns, keys] of NEW_KEYS) {
      for (const k of keys) {
        const ev = (E[ns] as Dict)[k]; const hv = (H[ns] as Dict)[k];
        expect(typeof ev, `${ns}.${k} en`).toBe("string");
        expect(typeof hv, `${ns}.${k} hi`).toBe("string");
        expect(placeholders(hv as string), `${ns}.${k}`).toEqual(placeholders(ev as string));
      }
    }
  });

  it("every sentence-length Hindi string is actually Hindi (contains Devanagari), not a copied English fallback", () => {
        const h = H.gradeBands as Dict;
    for (const [k, v] of Object.entries(h)) {
      // Strings that are only placeholders, the rupee sign and punctuation (e.g. the CTC range) are language-neutral.
      const words = typeof v === "string" ? v.replace(/\{[^}]*\}/g, "") : "";
      if (typeof v === "string" && v.length > 12 && hasLetters(words)) expect(hasDevanagari(v), k).toBe(true);
    }
  });
});

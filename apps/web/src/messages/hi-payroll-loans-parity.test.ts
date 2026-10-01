import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * en/hi parity for the namespaces the payroll loans page renders (#1758 and
 * its follow-up). hi.json is otherwise allowed to be partial (keys fall back
 * to English -- see restored-locales.test.ts), but these namespaces are
 * fully translated, so a key added to en.json without a Hindi string, or a
 * Hindi string whose {placeholders} / <rich tags> drift from English (which
 * makes next-intl format with a missing argument), fails here.
 */
const NAMESPACES = ["payrollLoans", "loanSearchForm", "createLoanForm", "loansTable", "employeePicker"] as const;

type Messages = Record<string, Record<string, unknown>>;

function placeholders(value: unknown): string[] {
  const s = String(value);
  const args = [...s.matchAll(/\{\s*(\w+)/g)].map((m) => `{${m[1]}}`);
  const tags = [...s.matchAll(/<(\w+)>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...args, ...tags])].sort();
}

describe("hi.json parity with en.json for payroll loans namespaces", () => {
  for (const ns of NAMESPACES) {
    const enNs = (en as unknown as Messages)[ns];
    const hiNs = (hi as unknown as Messages)[ns];

    it(`${ns}: exists in both locales`, () => {
      expect(enNs, `en.json has no "${ns}"`).toBeDefined();
      expect(hiNs, `hi.json has no "${ns}"`).toBeDefined();
    });

    it(`${ns}: same key set`, () => {
      expect(Object.keys(hiNs ?? {}).sort()).toEqual(Object.keys(enNs ?? {}).sort());
    });

    it(`${ns}: same placeholders and rich tags per key, non-empty strings`, () => {
      for (const [key, enValue] of Object.entries(enNs ?? {})) {
        const hiValue = hiNs?.[key];
        expect(typeof hiValue === "string" && hiValue.trim().length > 0, `${ns}.${key} is empty in hi.json`).toBe(true);
        expect(placeholders(hiValue), `${ns}.${key} placeholders differ`).toEqual(placeholders(enValue));
      }
    });
  }
});

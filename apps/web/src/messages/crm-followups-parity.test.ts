import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * CRM follow-ups (PR 1861) moved every new user-facing string behind t(). English
 * and Hindi must stay in step: same keys, non-empty, and identical ICU placeholder
 * names (a mismatch renders a raw `{name}` or throws at format time).
 */
const NAMESPACES = [
  "crmExport",
  "crmOwner",
  "crmTimeline",
  "crmCatalogue",
  "crmServiceTypes",
  "crmQuotation",
  "crmCaseNotes",
] as const;

type Dict = Record<string, unknown>;
const ns = (root: Dict, name: string): Record<string, string> => root[name] as Record<string, string>;
const args = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();

describe("CRM follow-ups i18n parity (en/hi)", () => {
  it.each(NAMESPACES)("%s exists in both locales with identical key sets", (name) => {
    expect(ns(en, name), `${name} missing in en`).toBeTruthy();
    expect(ns(hi, name), `${name} missing in hi`).toBeTruthy();
    expect(Object.keys(ns(hi, name)).sort()).toEqual(Object.keys(ns(en, name)).sort());
  });

  it("every value is non-empty and placeholders match", () => {
    for (const name of NAMESPACES) {
      for (const [k, v] of Object.entries(ns(en, name))) {
        const h = ns(hi, name)[k];
        expect(v.length, `${name}.${k} en empty`).toBeGreaterThan(0);
        expect(h?.length ?? 0, `${name}.${k} hi empty`).toBeGreaterThan(0);
        expect(args(h as string), `${name}.${k} placeholders`).toEqual(args(v));
      }
    }
  });

  it("Hindi is actually translated, not a copy of English (except invariant tax terms)", () => {
    const invariant = new Set(["crmCatalogue.hsnHeader", "crmQuotation.cgst", "crmQuotation.sgst", "crmQuotation.igst"]);
    for (const name of NAMESPACES) {
      for (const [k, v] of Object.entries(ns(en, name))) {
        if (invariant.has(`${name}.${k}`)) continue;
        expect(ns(hi, name)[k], `${name}.${k} untranslated`).not.toBe(v);
      }
    }
  });

  it("the LIVE crm.health namespace carries the new owner / last-contact keys (not only the retired messages/ folder)", () => {
    for (const root of [en, hi] as Dict[]) {
      const health = (root.crm as Dict).health as Record<string, string>;
      for (const k of ["columnOwner", "columnLastContact", "unassigned", "unknownUser"]) {
        expect(health[k], `crm.health.${k}`).toBeTruthy();
      }
    }
  });
});

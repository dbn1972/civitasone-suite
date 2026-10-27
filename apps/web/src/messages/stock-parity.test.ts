/**
 * The stock page copy added for UAT B4 (stockEntryNew, stockLedger namespaces) exists in both en and
 * hi, with the same keys and the same ICU placeholders, and no value is left empty.
 */
import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

const NAMESPACES = ["stockEntryNew", "stockLedger"] as const;
const ns = (m: unknown, n: string) => (m as Record<string, Record<string, string>>)[n] ?? {};

describe.each(NAMESPACES)("%s catalogue parity", (name) => {
  it("has the same keys in en and hi", () => {
    expect(Object.keys(ns(en, name)).length).toBeGreaterThan(0);
    expect(Object.keys(ns(hi, name)).sort()).toEqual(Object.keys(ns(en, name)).sort());
  });

  it("has no empty values and matching placeholders", () => {
    for (const [k, v] of Object.entries(ns(en, name))) {
      const h = ns(hi, name)[k];
      expect(h?.trim(), k).toBeTruthy();
      expect(v.trim(), k).toBeTruthy();
      const ph = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(h!), k).toEqual(ph(v));
    }
  });
});

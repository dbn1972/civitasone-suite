/**
 * The stock "New Stock Entry" page copy (stockEntryNew namespace) exists in both en and hi, with
 * the same keys and the same ICU placeholders, and no hi value is left empty.
 */
import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

const ns = (m: unknown) => (m as Record<string, Record<string, string>>).stockEntryNew ?? {};

describe("stockEntryNew catalogue parity", () => {
  it("has the same keys in en and hi", () => {
    expect(Object.keys(ns(en)).length).toBeGreaterThan(0);
    expect(Object.keys(ns(hi)).sort()).toEqual(Object.keys(ns(en)).sort());
  });

  it("has no empty values and matching placeholders", () => {
    for (const [k, v] of Object.entries(ns(en))) {
      const h = ns(hi)[k];
      expect(h?.trim(), k).toBeTruthy();
      expect(v.trim(), k).toBeTruthy();
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(h!), k).toEqual(ph(v));
    }
  });
});

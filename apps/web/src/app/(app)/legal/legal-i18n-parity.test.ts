import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/** Every legal-workflow namespace added for the UAT owner decisions must have the same keys in en and hi, no empty strings. */
const NAMESPACES = ["legalAffidavits", "legalCaseNew", "legalOrderNew", "legalOpinionNew", "legalAdvocates"] as const;

const flat = (o: Record<string, unknown>, p = ""): Array<[string, unknown]> =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, v] as [string, unknown]]));

describe("legal workflow i18n parity (en + hi)", () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: hi has exactly the en keys, all non-empty`, () => {
      const e = flat((en as Record<string, Record<string, unknown>>)[ns]!);
      const h = flat((hi as Record<string, Record<string, unknown>>)[ns]!);
      expect(h.map(([k]) => k).sort()).toEqual(e.map(([k]) => k).sort());
      for (const [k, v] of [...e, ...h]) expect(typeof v === "string" && v.trim().length > 0, k).toBe(true);
    });
  }
});

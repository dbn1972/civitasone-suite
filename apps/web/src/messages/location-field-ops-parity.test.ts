import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/** locationsOps + fieldSync strings exist in English and Hindi with identical keys and ICU placeholders. */
type Dict = { [k: string]: string | Dict };
function flat(d: Dict, pre = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "string") out[pre + k] = v;
    else Object.assign(out, flat(v, `${pre}${k}.`));
  }
  return out;
}
const args = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();

for (const ns of ["locationsOps", "fieldSync"] as const) {
  describe(`${ns} i18n parity`, () => {
    const e = flat((en as unknown as Record<string, Dict>)[ns]!);
    const h = flat((hi as unknown as Record<string, Dict>)[ns]!);
    it("has the same keys in en and hi, all non-empty", () => {
      expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
      for (const v of [...Object.values(e), ...Object.values(h)]) expect(v.length).toBeGreaterThan(0);
    });
    it("uses the same ICU placeholders", () => {
      for (const k of Object.keys(e)) expect(args(h[k]!), k).toEqual(args(e[k]!));
    });
    it("the Hindi text is actually translated", () => {
      for (const k of Object.keys(e)) expect(h[k], k).not.toBe(e[k]);
    });
  });
}

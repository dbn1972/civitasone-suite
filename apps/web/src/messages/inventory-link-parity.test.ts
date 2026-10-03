import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/** inventoryLink strings exist in English and Hindi with identical keys and ICU placeholders. */
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

describe("inventoryLink i18n", () => {
  const e = flat((en as unknown as { inventoryLink: Dict }).inventoryLink);
  const h = flat((hi as unknown as { inventoryLink: Dict }).inventoryLink);
  it("has the same keys in both languages, all non-empty", () => {
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const [k, v] of Object.entries({ ...e })) expect(v.length > 0 || k === "x").toBe(true);
    for (const v of Object.values(h)) expect(v.length).toBeGreaterThan(0);
  });
  it("uses the same placeholders", () => {
    for (const k of Object.keys(e)) expect(args(h[k]!), k).toEqual(args(e[k]!));
  });
  it("the Hindi text is actually translated", () => {
    expect(h["badge.linked"]).not.toBe(e["badge.linked"]);
    expect(h["report.title"]).not.toBe(e["report.title"]);
  });
});

import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * S8 G7: the two new namespaces must exist in English and Hindi with the same
 * keys and the same {placeholders} / <tags> (a Hindi string that drops {pct}
 * would silently print the wrong sentence).
 */
type Dict = Record<string, string>;
const slots = (s: string) => (s.match(/\{[a-zA-Z]+\}|<\/?[a-z]+>/g) ?? []).sort().join("|");

describe.each(["projectCosting", "projectStaffCost", "payrollCosting"] as const)("%s messages", (ns) => {
  const e = (en as unknown as Record<string, Dict>)[ns]!;
  const h = (hi as unknown as Record<string, Dict>)[ns]!;
  it("exists in English and Hindi", () => {
    expect(e).toBeDefined();
    expect(h).toBeDefined();
  });
  it("every English key has a non-empty Hindi string with the same placeholders", () => {
    const keys = ns === "payrollCosting" ? ["projectCostingLink"] : Object.keys(e);
    for (const k of keys) {
      expect(typeof h[k], `${ns}.${k} missing in hi`).toBe("string");
      expect(h[k]!.trim().length).toBeGreaterThan(0);
      expect(slots(h[k]!), `${ns}.${k} placeholders`).toBe(slots(e[k]!));
    }
  });
});

describe("Hindi strings are actually Hindi", () => {
  it("the headline strings use Devanagari, not a copy of the English", () => {
    const hp = (hi as unknown as Record<string, Dict>).projectCosting!;
    const ep = (en as unknown as Record<string, Dict>).projectCosting!;
    for (const k of ["title", "requestBtn", "approveBtn", "pmNote"]) {
      expect(hp[k]).toMatch(/[ऀ-ॿ]/);
      expect(hp[k]).not.toBe(ep[k]);
    }
  });
});

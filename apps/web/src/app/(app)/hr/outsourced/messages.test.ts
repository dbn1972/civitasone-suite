import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

// GAP-HR-OUTSOURCED-02 / GAP-HR-WORKFORCE-CONTRACTUAL-01: dead i18n
// namespaces must not linger for translators.
describe("outsourced / workforceContractual i18n", () => {
  const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const used = new Set([...src.matchAll(/\bt\("(\w+)"\)/g)].map((m) => m[1]));

  it.each([["en", en], ["hi", hi]] as const)("%s outsourced keys == keys the page uses", (_l, m) => {
    expect(Object.keys((m as { outsourced: object }).outsourced).sort()).toEqual([...used].sort());
  });

  it("drops the unreferenced workforceContractual namespace", () => {
    expect("workforceContractual" in en).toBe(false);
    expect("workforceContractual" in hi).toBe(false);
  });
});

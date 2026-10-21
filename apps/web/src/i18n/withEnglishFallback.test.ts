import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withEnglishFallback } from "./withEnglishFallback";
import en from "../messages/en.json";
import ta from "../messages/ta.json";
import te from "../messages/te.json";
import kn from "../messages/kn.json";

describe("withEnglishFallback (GAP-CRM-DATA-QUALITY-07)", () => {
  it("fills a key the locale lacks with the English string", () => {
    const merged = withEnglishFallback(
      { crm: { dataQuality: { title: "Data Quality" } }, action: { save: "Save" } },
      { action: { save: "Sahej" } },
    );
    expect(merged).toEqual({ crm: { dataQuality: { title: "Data Quality" } }, action: { save: "Sahej" } });
  });

  it("keeps the locale's own string where both define the key (locale wins)", () => {
    const merged = withEnglishFallback({ a: { b: "english" } }, { a: { b: "locale" } }) as { a: { b: string } };
    expect(merged.a.b).toBe("locale");
  });

  it("merges nested namespaces key by key rather than replacing the whole object", () => {
    const merged = withEnglishFallback(
      { crm: { one: "1", two: "2" } },
      { crm: { two: "dos" } },
    ) as { crm: { one: string; two: string } };
    expect(merged.crm).toEqual({ one: "1", two: "dos" });
  });

  it("does not mutate either input", () => {
    const english = { x: { y: "en" } };
    const locale = { x: { z: "loc" } };
    withEnglishFallback(english, locale);
    expect(english).toEqual({ x: { y: "en" } });
    expect(locale).toEqual({ x: { z: "loc" } });
  });

  it.each([
    ["ta", ta],
    ["te", te],
    ["kn", kn],
  ])("%s resolves crm.dataQuality.title (absent from its own file) to the English title", (_loc, own) => {
    expect((own as Record<string, unknown>).crm).toBeUndefined();
    const merged = withEnglishFallback(en as Record<string, unknown>, own as Record<string, unknown>) as {
      crm: { dataQuality: { title: string } };
    };
    expect(merged.crm.dataQuality.title).toBe("Data Quality");
  });

  it("request.ts routes every non-English locale through the fallback merge", () => {
    const src = readFileSync(join(__dirname, "request.ts"), "utf8");
    expect(src).toContain("withEnglishFallback(english, own)");
  });
});

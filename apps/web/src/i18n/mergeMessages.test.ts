import { describe, it, expect } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import kn from "../messages/kn.json";
import ta from "../messages/ta.json";
import te from "../messages/te.json";
import { withEnglishFallback, type MessageTree } from "./mergeMessages";

const get = (tree: MessageTree, path: string): unknown =>
  path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), tree);

describe("withEnglishFallback (GAP-HR-TRANSFER-10)", () => {
  const english: MessageTree = { a: "A", ns: { x: "X", y: "Y", deep: { z: "Z" } }, list: ["1", "2"] };

  it("fills a missing namespace and missing nested keys from English, and lets the locale win everywhere else", () => {
    const out = withEnglishFallback(english, { ns: { x: "ex", deep: {} } });
    expect(out).toEqual({ a: "A", ns: { x: "ex", y: "Y", deep: { z: "Z" } }, list: ["1", "2"] });
  });

  it("keeps keys the locale has that English does not (never drops a translation)", () => {
    expect(withEnglishFallback(english, { onlyHere: "só" }).onlyHere).toBe("só");
  });

  it("treats arrays as leaves and keeps a locale value whose shape differs from English", () => {
    expect(withEnglishFallback(english, { list: ["a"], ns: "flat" })).toMatchObject({ list: ["a"], ns: "flat" });
  });

  it("does not mutate either input", () => {
    const loc: MessageTree = { ns: { x: "ex" } };
    const snapshot = JSON.stringify([english, loc]);
    withEnglishFallback(english, loc);
    expect(JSON.stringify([english, loc])).toBe(snapshot);
  });
});

describe("the real catalogues through the fallback", () => {
  it.each([["hi", hi], ["kn", kn], ["ta", ta], ["te", te]] as const)(
    "%s resolves a transfer-page key it has not translated (no raw key path), keeping its own strings",
    (_code, locale) => {
      const merged = withEnglishFallback(en as MessageTree, locale as MessageTree);
      const title = get(merged, "transfer.title");
      expect(typeof title).toBe("string");
      expect(String(title).length).toBeGreaterThan(0);
      // everything English has, the merged catalogue has
      for (const ns of ["transfer", "transferUi", "deputation", "confirmation", "promotion"]) {
        expect(Object.keys(merged[ns] as MessageTree).sort()).toEqual(Object.keys((en as MessageTree)[ns] as MessageTree).sort());
      }
    },
  );

  it("never overrides a translation the locale already has", () => {
    const merged = withEnglishFallback(en as MessageTree, kn as MessageTree);
    expect(get(merged, "common")).toEqual({ ...(en as MessageTree).common as object, ...(kn as MessageTree).common as object });
  });
});

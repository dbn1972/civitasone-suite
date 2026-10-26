import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

describe("reportsPiiExport i18n namespace: en/hi parity (owner decision #17)", () => {
  const e = (en as unknown as Record<string, Record<string, string>>)["reportsPiiExport"]!;
  const h = (hi as unknown as Record<string, Record<string, string>>)["reportsPiiExport"]!;
  it("has the same keys in en and hi, with a real Hindi translation", () => {
    expect(Object.keys(e).length).toBeGreaterThan(0);
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) {
      expect(h[k]!.length).toBeGreaterThan(0);
      expect(h[k]).not.toBe(e[k]);
    }
  });
});

import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe("crmContactEdit i18n parity (en/hi)", () => {
  const e: Record<string, string> = en.crmContactEdit;
  const h: Record<string, string> = hi.crmContactEdit;
  it("has the same keys in en and hi", () => {
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
  });
  it("has matching placeholders and non-empty copy", () => {
    for (const k of Object.keys(e)) {
      expect(h[k]!.length).toBeGreaterThan(0);
      expect(placeholders(h[k]!)).toEqual(placeholders(e[k]!));
    }
  });
});

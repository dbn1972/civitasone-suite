import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Tree = { [k: string]: string | Tree };

describe("knowledgeDocumentsNew i18n namespace: en/hi parity (owner decision #15)", () => {
  const e = (en as unknown as Tree)["knowledgeDocumentsNew"] as Record<string, string>;
  const h = (hi as unknown as Tree)["knowledgeDocumentsNew"] as Record<string, string>;
  it("has the same keys in en and hi, with a real Hindi translation", () => {
    expect(Object.keys(e).length).toBeGreaterThan(0);
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) {
      expect(h[k]!.length).toBeGreaterThan(0);
      expect(h[k]).not.toBe(e[k]);
    }
  });
});

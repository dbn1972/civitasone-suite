import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Tree = { [k: string]: string | Tree };

function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

describe("knowledgeW2 i18n namespace: en/hi parity", () => {
  const e = flatten((en as unknown as Tree)["knowledgeW2"] as Tree);
  const h = flatten((hi as unknown as Tree)["knowledgeW2"] as Tree);

  it("has the same key tree in en and hi", () => {
    expect(Object.keys(e).length).toBeGreaterThan(5);
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
  });

  it("has non-empty values and a Hindi value that is not a copy of the English", () => {
    for (const k of Object.keys(e)) {
      expect(e[k]!.length).toBeGreaterThan(0);
      expect(h[k]!.length).toBeGreaterThan(0);
      expect(h[k]).not.toBe(e[k]);
    }
  });
});

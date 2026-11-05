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
/** Top-level ICU arguments: {name} and {name, plural, ...} both count. */
const args = (s: string) => [...new Set([...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]))].sort();

describe("approvalsInbox: en/hi parity (UX R1)", () => {
  const enNs = flatten((en as unknown as Record<string, Tree>).approvalsInbox!);
  const hiNs = flatten((hi as unknown as Record<string, Tree>).approvalsInbox!);

  it("both locales have exactly the same keys", () => {
    expect(Object.keys(hiNs).sort()).toEqual(Object.keys(enNs).sort());
  });

  it("every Hindi string is non-empty, really Hindi, and has the same arguments", () => {
    for (const [k, v] of Object.entries(enNs)) {
      const h = hiNs[k] ?? "";
      expect(h.trim().length, `${k} empty in hi`).toBeGreaterThan(0);
      expect(/[ऀ-ॿ]/.test(h), `${k} is not Devanagari`).toBe(true);
      expect(args(h), k).toEqual(args(v));
    }
  });

  it("no copy carries a placeholder, an id or a role code", () => {
    for (const v of [...Object.values(enNs), ...Object.values(hiNs)]) {
      expect(v).not.toMatch(/\{\{|[0-9a-f]{8}-[0-9a-f]{4}|\b[a-z]+_[a-z]+\b/);
    }
  });
});

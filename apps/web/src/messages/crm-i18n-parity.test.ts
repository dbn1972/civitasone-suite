import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * Parity for every `crm*` namespace added by the CRM HIGH-gap sweep: identical
 * key tree, identical ICU placeholder names, non-empty values, and a Hindi
 * value that is not just a copy of the English (unless it is an acronym/number).
 */
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
function placeholders(s: string): string[] {
  // ICU argument names only: `{name}` / `{name, plural, ...}`. A plural/select branch body
  // (`one {star}`, `other {stars}`) is translated text, not an argument, and differs per language.
  return [...new Set([...s.matchAll(/(?<!(?:\b(?:zero|one|two|few|many|other|up)|=\d+)\s*)\{(\w+)\s*[,}]/g)].map((m) => m[1]!))].sort();
}

const enRoot = en as unknown as Tree;
const hiRoot = hi as unknown as Tree;
const namespaces = Object.keys(enRoot).filter((k) => /^crm[A-Z]/.test(k));

describe("crm* i18n namespaces: en/hi parity", () => {
  it("finds the crm namespaces", () => {
    expect(namespaces.length).toBeGreaterThan(5);
  });
  for (const ns of namespaces) {
    it(`${ns}: same keys, same placeholders, translated`, () => {
      const e = flatten(enRoot[ns] as Tree);
      const h = hiRoot[ns] ? flatten(hiRoot[ns] as Tree) : {};
      expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
      for (const k of Object.keys(e)) {
        expect(h[k]!.trim().length, `${ns}.${k} hi empty`).toBeGreaterThan(0);
        expect(placeholders(h[k]!), `${ns}.${k} placeholders`).toEqual(placeholders(e[k]!));
        if (/[a-z]{4,}/.test(e[k]!)) {
          expect(h[k], `${ns}.${k} hi identical to en`).not.toBe(e[k]);
        }
      }
    });
  }
});

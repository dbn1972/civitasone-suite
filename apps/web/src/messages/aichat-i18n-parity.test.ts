import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * GAP-AI-CHAT-06 / GAP-AI-CHAT-DETAIL-07 — en/hi parity for the aiChat
 * namespace. Identical key tree, identical ICU placeholder names, non-empty
 * values, and a Hindi value that is not a copy of the English.
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
  return [
    ...new Set(
      [...s.matchAll(/(?<!(?:\b(?:zero|one|two|few|many|other|up)|=\d+)\s*)\{(\w+)\s*[,}]/g)].map(
        (m) => m[1]!,
      ),
    ),
  ].sort();
}

const enNs = (en as unknown as Tree).aiChat as Tree;
const hiNs = (hi as unknown as Tree).aiChat as Tree;

describe("aiChat: en/hi parity (GAP-AI-CHAT-06, GAP-AI-CHAT-DETAIL-07)", () => {
  it("namespace exists in both locales", () => {
    expect(enNs).toBeDefined();
    expect(hiNs).toBeDefined();
  });

  it("same key set in hi as en", () => {
    const e = flatten(enNs);
    const h = flatten(hiNs);
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
  });

  it("all values non-empty and ICU placeholders preserved", () => {
    const e = flatten(enNs);
    const h = flatten(hiNs);
    for (const k of Object.keys(e)) {
      expect(h[k]!.trim().length, `hi.aiChat.${k} empty`).toBeGreaterThan(0);
      expect(placeholders(h[k]!), `hi.aiChat.${k} placeholders`).toEqual(
        placeholders(e[k]!),
      );
      // Hindi values must not be identical to English for words >= 4 chars
      if (/[a-z]{4,}/.test(e[k]!)) {
        expect(h[k], `hi.aiChat.${k} identical to en`).not.toBe(e[k]);
      }
    }
  });
});

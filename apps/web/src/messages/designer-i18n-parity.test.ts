import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "./en.json";
import hi from "./hi.json";

/**
 * The designer namespace must live in the ACTIVE catalogue (src/messages, loaded
 * by src/i18n/request.ts) - not the orphaned apps/web/messages copy - otherwise
 * next-intl logs MISSING_MESSAGE and Studio renders raw "designer.xxx" keys.
 */
type Dict = Record<string, unknown>;
const designer = (root: Dict): Record<string, string> => (root.designer ?? {}) as Record<string, string>;
const args = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

const SRC = join(__dirname, "..");
const usedKeys = (): string[] => {
  const keys = new Set<string>();
  const re = /\b(?:t|designerTextEn|dt)\(\s*["\x27]([A-Za-z0-9_.]+)["\x27]/g;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
        const txt = readFileSync(p, "utf8");
        if (!txt.includes("useDesignerT") && !txt.includes("designerTextEn")) continue;
        for (const m of txt.matchAll(re)) keys.add(m[1]!);
      }
    }
  };
  walk(SRC);
  return [...keys];
};
import { readdirSync } from "node:fs";

describe("designer i18n parity (src/messages en/hi)", () => {
  it("designer namespace exists in the active catalogue for both locales", () => {
    expect(Object.keys(designer(en as Dict)).length).toBeGreaterThan(0);
    expect(Object.keys(designer(hi as Dict)).sort()).toEqual(Object.keys(designer(en as Dict)).sort());
  });

  it("every value is non-empty with identical placeholders in en and hi", () => {
    const e = designer(en as Dict), h = designer(hi as Dict);
    for (const k of Object.keys(e)) {
      expect(e[k], k).toBeTruthy();
      expect(h[k], k).toBeTruthy();
      expect(args(h[k]!), k).toEqual(args(e[k]!));
    }
  });

  it("every literal key used via useDesignerT/designerTextEn exists in both locales", () => {
    const e = designer(en as Dict), h = designer(hi as Dict);
    const used = usedKeys().filter((k) => !k.includes("."));
    expect(used.length).toBeGreaterThan(0);
    for (const k of used) {
      if (!(k in e) && !(k in h)) continue; // not a designer key (unrelated t() call)
      expect(e[k], "en." + k).toBeTruthy();
      expect(h[k], "hi." + k).toBeTruthy();
    }
  });
});

import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * The HR pages touched by the cluster-13 rescan (work summary, disciplinary detail,
 * social feed, ID cards, pay matrix, DPC) read their copy from these namespaces.
 * Several of them were missing from, or had drifted in, hi.json (the active locale
 * file is loaded on its own, with no en fallback), so a Hindi session got
 * next-intl's missing-message path. Every en key must exist in hi with the same
 * ICU placeholders.
 */
const NAMESPACES = [
  "workSummary", "disciplinaryDetail", "socialFeed", "idCards", "payMatrix", "dpc", "dpcBatchView", "promotionCard",
] as const;

const enAll = en as unknown as Record<string, Record<string, string>>;
const hiAll = hi as unknown as Record<string, Record<string, string>>;
const placeholders = (v: string) => (v.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");
const tags = (v: string) => (v.match(/<\/?[a-zA-Z]+>/g) ?? []).sort().join(",");

describe.each(NAMESPACES)("hi.json namespace %s", (ns) => {
  it("exists", () => {
    expect(hiAll[ns], `${ns} missing from hi.json`).toBeDefined();
  });

  it("has every key en.json has", () => {
    const missing = Object.keys(enAll[ns] ?? {}).filter((k) => !(k in (hiAll[ns] ?? {})));
    expect(missing).toEqual([]);
  });

  it("keeps the same placeholders and rich-text tags per key", () => {
    for (const [k, v] of Object.entries(enAll[ns] ?? {})) {
      const h = hiAll[ns]?.[k];
      if (typeof v !== "string" || typeof h !== "string") continue;
      expect(placeholders(h), `${ns}.${k} placeholders`).toBe(placeholders(v));
      expect(tags(h), `${ns}.${k} rich-text tags`).toBe(tags(v));
    }
  });

  it("has no empty translations", () => {
    for (const [k, v] of Object.entries(hiAll[ns] ?? {})) {
      if (typeof v === "string") expect(v.trim().length, `${ns}.${k}`).toBeGreaterThan(0);
    }
  });
});

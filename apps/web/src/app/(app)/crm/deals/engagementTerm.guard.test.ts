import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { stripComments } from "@/lib/testUtils/stripComments";

/**
 * GAP-CRM-DEALS-07 / GAP-CRM-DEALS-NEW-07: the record the CRM deals screens
 * manage is an "engagement" everywhere a person reads it - list, hub, new form,
 * detail, error boundaries - not "deal" on some screens and "engagement" on
 * others. This is the grep the acceptance criterion asks for, kept as a test so
 * the mismatch cannot silently return.
 */

const DEAL_WORD = /\bdeals?\b/i;

/** Every catalogue namespace the deals screens read copy from. */
const NAMESPACES: Array<[string, (root: Record<string, unknown>) => unknown]> = [
  ["crm.dealsNew", (r) => (r.crm as Record<string, unknown>).dealsNew],
  ["crm.dealDetail", (r) => (r.crm as Record<string, unknown>).dealDetail],
  ["crmDealsPage", (r) => r.crmDealsPage],
  ["crmDealsTable", (r) => r.crmDealsTable],
  ["crmDealDetail", (r) => r.crmDealDetail],
  ["crmDealError", (r) => r.crmDealError],
  ["crmDealNewPage", (r) => r.crmDealNewPage],
];

function leaves(node: unknown, path: string): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [];
}

describe("one noun across the CRM deals screens (catalogue)", () => {
  it.each(NAMESPACES)("en: %s never says 'deal'", (ns, pick) => {
    const offenders = leaves(pick(enMessages as Record<string, unknown>), ns).filter(([, v]) => DEAL_WORD.test(v));
    expect(offenders).toEqual([]);
  });

  it("hub tile for the screen is the engagement label", () => {
    expect((enMessages.crm as Record<string, unknown>).tileEngagements).toBe("Vendor / Stakeholder Engagements");
    expect(enMessages.crmDealsPage.title).toBe("Vendor / Stakeholder Engagements");
  });

  it("hi mirrors every key the deals screens read (en/hi parity for the new copy)", () => {
    for (const [ns, pick] of NAMESPACES) {
      const enKeys = leaves(pick(enMessages as Record<string, unknown>), ns).map(([k]) => k);
      const hiKeys = new Set(leaves(pick(hiMessages as Record<string, unknown>), ns).map(([k]) => k));
      const missing = enKeys.filter((k) => !hiKeys.has(k));
      expect(missing, `hi is missing ${missing.join(", ")}`).toEqual([]);
    }
  });
});

describe("one noun across the CRM deals screens (hard-coded literals)", () => {
  const FILES = [
    "page.tsx",
    "DealsTable.tsx",
    "error.tsx",
    "loading.tsx",
    "[id]/page.tsx",
    "[id]/DealDetailActions.tsx",
    "[id]/error.tsx",
    "new/page.tsx",
    "new/error.tsx",
  ];

  /** String literals and JSX text in a source file, with comments removed. */
  function userFacingText(file: string): string[] {
    const src = stripComments(readFileSync(join(__dirname, file), "utf8"));
    const out: string[] = [];
    for (const m of src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) out.push(m[1] ?? m[2] ?? "");
    for (const m of src.matchAll(/>([^<>{}\n]+)</g)) out.push(m[1]!);
    // Skip identifier-like strings (element ids, css classes, routes, api paths):
    // all lower-case with no spaces. Real copy is capitalised or has a space.
    return out.filter((t) => !t.startsWith("/") && !/^[a-z0-9_./#:-]*$/.test(t) && !t.includes("v1/") && !t.includes("crm."));
  }

  it.each(FILES)("%s has no literal that says 'deal'", (file) => {
    const offenders = userFacingText(file).filter((t) => DEAL_WORD.test(t));
    expect(offenders).toEqual([]);
  });
});

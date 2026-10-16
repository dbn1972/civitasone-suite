import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";

/**
 * GAP-CRM-DEALS-DETAIL-06: DealDetailActions uses i18n keys, no hex literals.
 * Hex colors were already replaced with CSS tokens (var(--good)/var(--bad)) in
 * a prior wave; this test verifies the string literals are now in en.json.
 */
describe("GAP-CRM-DEALS-DETAIL-06 — DealDetailActions i18n", () => {
  const ns = (enMessages as Record<string, Record<string, string>>)["crmDealDetail"] ?? {};

  it("markWon key exists", () => {
    expect(ns.markWon).toBeTruthy();
  });

  it("markLost key exists", () => {
    expect(ns.markLost).toBeTruthy();
  });

  it("no hex literals in crmDealDetail namespace", () => {
    const allValues = JSON.stringify(ns);
    expect(allValues).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import type { BudgetSummary } from "@civitasone/types";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import {
  BUDGET_STATUSES, BUDGET_STATUS_LABEL, BUDGET_TAB_ALL, BUDGET_TAB_OTHER, budgetTabOf, budgetTabsFor, isBudgetStatus,
  isMaterialVariance, MATERIAL_VARIANCE_BPS, parseBudgetTab, parseMinor, previousFinancialYear, priorYearBeByHead, varianceBps,
} from "./budgetColumns";

const row = (o: Partial<BudgetSummary>): BudgetSummary => ({
  id: "x", majorHead: "2202", subHead: "Edu", sanctionedAmount: "0", releasedAmount: "0", expenditure: "0",
  balance: "0", beMinor: "0", reMinor: "0", status: "approved", financialYear: "2026-27", ...o,
});

describe("budget column helpers", () => {
  it("parseMinor is strict and exact (never a fabricated 0)", () => {
    expect(parseMinor("900719925474099300")).toBe(900719925474099300n);
    expect(parseMinor(10000000)).toBe(10000000n);
    for (const bad of [null, undefined, "", "abc", "1.5", 1.5]) expect(parseMinor(bad)).toBeNull();
  });
  it("previousFinancialYear", () => {
    expect(previousFinancialYear("2026-27")).toBe("2025-26");
    expect(previousFinancialYear("2000-01")).toBe("1999-00");
    expect(previousFinancialYear("bad")).toBeNull();
  });
  it("priorYearBeByHead sums last FY's BE per head only (not sanctioned/released)", () => {
    const all = [
      row({ financialYear: "2025-26", beMinor: "700", sanctionedAmount: "999", releasedAmount: "888" }),
      row({ financialYear: "2025-26", beMinor: "300" }),
      row({ financialYear: "2024-25", beMinor: "5" }),
      row({ financialYear: "2026-27", beMinor: "1" }),
      row({ financialYear: "2025-26", majorHead: "9999", beMinor: "42" }),
    ];
    expect(priorYearBeByHead(all, "2026-27")).toEqual({ "2202|Edu": "1000", "9999|Edu": "42" });
  });
  it("varianceBps is exact BigInt maths; undefined against a missing/zero BE", () => {
    expect(varianceBps(900719925474099300n, 900719925474099400n)).toBe(0n); // sub-bp change
    expect(varianceBps(10000000n, 12000000n)).toBe(2000n);
    expect(varianceBps(10000000n, 9000000n)).toBe(-1000n);
    expect(varianceBps(null, 5n)).toBeNull();
    expect(varianceBps(0n, 5n)).toBeNull();
  });
  it("isMaterialVariance flags >= 10% either way, not 5%", () => {
    expect(MATERIAL_VARIANCE_BPS).toBe(1000n);
    expect(isMaterialVariance(1200n)).toBe(true);
    expect(isMaterialVariance(-1000n)).toBe(true);
    expect(isMaterialVariance(500n)).toBe(false);
    expect(isMaterialVariance(null)).toBe(false);
  });
});

// GAP-FINANCE-BUDGET-FORMULATION-05: one vocabulary across tab, card, pill and the locale files.
describe("budget status enum: tab, pill and wording (GAP-FINANCE-BUDGET-FORMULATION-05)", () => {
  /** Every tab id the list could offer, i.e. the status tabs plus Other. */
  const ALL_STATUS_TABS = [...BUDGET_STATUSES, BUDGET_TAB_OTHER];

  it("the enum covers what the API computes today (active, exhausted) and the approval vocabulary", () => {
    expect([...BUDGET_STATUSES].sort()).toEqual(["active", "approved", "draft", "exhausted", "pending", "rejected", "submitted"]);
  });

  it.each(BUDGET_STATUSES)("%s appears under exactly one tab", (status) => {
    const tabsHolding = ALL_STATUS_TABS.filter((tab) => budgetTabOf(status) === tab);
    expect(tabsHolding).toEqual([status]);
  });

  it("a status outside the enum is listed under Other (never dropped), and is not an enum value", () => {
    expect(budgetTabOf("frozen")).toBe(BUDGET_TAB_OTHER);
    expect(isBudgetStatus("frozen")).toBe(false);
    expect(isBudgetStatus("toString")).toBe(false);
    expect(budgetTabOf("toString")).toBe(BUDGET_TAB_OTHER);
  });

  it.each(BUDGET_STATUSES)("%s renders an explicitly toned pill, never the unmapped info fallback", (status) => {
    const { container } = render(createElement(StatusPill, { status }));
    const tone = [...(container.querySelector(".pill")?.classList ?? [])].find((c) => c !== "pill");
    expect(tone).toBeDefined();
    expect(tone).not.toBe("info");
  });

  it("offers All plus only the statuses that have rows, in enum order, with Other last", () => {
    expect(budgetTabsFor([])).toEqual([BUDGET_TAB_ALL]);
    expect(budgetTabsFor([{ status: "exhausted" }, { status: "active" }, { status: "active" }])).toEqual([BUDGET_TAB_ALL, "active", "exhausted"]);
    expect(budgetTabsFor([{ status: "frozen" }, { status: "approved" }])).toEqual([BUDGET_TAB_ALL, "approved", BUDGET_TAB_OTHER]);
  });

  it("every row of a data set is under exactly one status tab, so the tab counts add up to the row count", () => {
    const rows = [{ status: "active" }, { status: "active" }, { status: "exhausted" }, { status: "pending" }, { status: "frozen" }];
    const counts = budgetTabsFor(rows)
      .filter((t) => t !== BUDGET_TAB_ALL)
      .map((t) => rows.filter((r) => budgetTabOf(r.status) === t).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(rows.length);
  });

  it("parseBudgetTab accepts only known tabs from the URL", () => {
    expect(parseBudgetTab("pending")).toBe("pending");
    expect(parseBudgetTab("all")).toBe("all");
    expect(parseBudgetTab("other")).toBe("other");
    for (const bad of ["Pending", "nope", "", undefined, null, 5, "__proto__"]) expect(parseBudgetTab(bad)).toBeNull();
  });

  it.each([["en", enMessages], ["hi", hiMessages]] as const)("%s has a label for every status, All and Other", (_l, messages) => {
    const ns = (messages as unknown as Record<string, Record<string, unknown>>).financeBudgetFormulation as {
      tabAll: string; tabOther: string; status: Record<string, string>;
    };
    expect(ns.tabAll).toBeTruthy();
    expect(ns.tabOther).toBeTruthy();
    for (const s of BUDGET_STATUSES) expect(ns.status[s], s).toBeTruthy();
    expect(Object.keys(ns.status).sort()).toEqual([...BUDGET_STATUSES].sort());
  });

  it("the English labels match the code-side fallback map", () => {
    const ns = (enMessages as unknown as { financeBudgetFormulation: { status: Record<string, string> } }).financeBudgetFormulation;
    for (const s of BUDGET_STATUSES) expect(ns.status[s]).toBe(BUDGET_STATUS_LABEL[s]);
  });
});

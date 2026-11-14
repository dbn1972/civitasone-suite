import { describe, it, expect } from "vitest";
import { addPriceDays, gstSplit, planPriceInsert, priceAt, quote, PriceError, type PriceRow } from "../src/plan-pricing.js";

const row = (o: Partial<PriceRow> & Pick<PriceRow, "subjectKind" | "subjectKey">): PriceRow => ({
  billingCycle: "annual", amountMinor: 100_000_00n, gstRateBps: 1800, effectiveFrom: "2026-04-01", effectiveTo: null, ...o,
});

describe("M6 price store rules", () => {
  it("GST is separate and rounded half-up to the paisa; money stays integer", () => {
    expect(gstSplit(100_000_00n, 1800)).toEqual({ netMinor: 10_000_000n, gstMinor: 1_800_000n, grossMinor: 11_800_000n });
    expect(gstSplit(1n, 1800).gstMinor).toBe(0n);   // 0.18 paise -> 0
    expect(gstSplit(3n, 1800).gstMinor).toBe(1n);   // 0.54 paise -> 1
    expect(gstSplit(500n, 0)).toEqual({ netMinor: 500n, gstMinor: 0n, grossMinor: 500n });
  });

  it("priceAt returns the row covering the date, nothing before the first or after a closed window", () => {
    const rows = [
      row({ subjectKind: "plan", subjectKey: "psu", amountMinor: 5n, effectiveFrom: "2026-04-01", effectiveTo: "2026-09-30" }),
      row({ subjectKind: "plan", subjectKey: "psu", amountMinor: 7n, effectiveFrom: "2026-10-01" }),
    ];
    expect(priceAt(rows, "plan", "psu", "annual", "2026-03-31")).toBeNull();
    expect(priceAt(rows, "plan", "psu", "annual", "2026-04-01")?.amountMinor).toBe(5n);
    expect(priceAt(rows, "plan", "psu", "annual", "2026-09-30")?.amountMinor).toBe(5n);
    expect(priceAt(rows, "plan", "psu", "annual", "2026-10-01")?.amountMinor).toBe(7n);
    expect(priceAt(rows, "plan", "psu", "monthly", "2026-10-01")).toBeNull();
    expect(priceAt(rows, "addon", "psu", "annual", "2026-10-01")).toBeNull();
  });

  it("a new price closes the open one the day before it starts; month and year boundaries are exact", () => {
    const open = row({ id: "a", subjectKind: "plan", subjectKey: "psu" });
    expect(planPriceInsert([open], row({ subjectKind: "plan", subjectKey: "psu", effectiveFrom: "2026-10-01" })).close).toEqual({ id: "a", effectiveTo: "2026-09-30" });
    expect(planPriceInsert([open], row({ subjectKind: "plan", subjectKey: "psu", effectiveFrom: "2027-01-01" })).close?.effectiveTo).toBe("2026-12-31");
    expect(planPriceInsert([], row({ subjectKind: "plan", subjectKey: "new" })).close).toBeNull();
    expect(addPriceDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("refuses back-dating into history and overlap with a closed window", () => {
    const hist = [row({ id: "a", subjectKind: "addon", subjectKey: "payroll", effectiveFrom: "2026-04-01", effectiveTo: "2026-09-30" }), row({ id: "b", subjectKind: "addon", subjectKey: "payroll", effectiveFrom: "2026-10-01" })];
    expect(() => planPriceInsert(hist, row({ subjectKind: "addon", subjectKey: "payroll", effectiveFrom: "2026-10-01" }))).toThrow(expect.objectContaining({ code: "PRICE_BACKDATED" }));
    expect(() => planPriceInsert(hist, row({ subjectKind: "addon", subjectKey: "payroll", effectiveFrom: "2026-06-01" }))).toThrow(expect.objectContaining({ code: "PRICE_BACKDATED" }));
    const closedOnly = [row({ id: "a", subjectKind: "addon", subjectKey: "x", effectiveFrom: "2026-04-01", effectiveTo: "2026-12-31" })];
    expect(() => planPriceInsert(closedOnly, row({ subjectKind: "addon", subjectKey: "x", effectiveFrom: "2026-11-01" }))).toThrow(expect.objectContaining({ code: "PRICE_WINDOW_OVERLAP" }));
    // a different cycle or subject is independent
    expect(planPriceInsert(hist, row({ subjectKind: "addon", subjectKey: "payroll", billingCycle: "monthly", effectiveFrom: "2026-01-01" })).close).toBeNull();
  });

  it("rejects invalid rows", () => {
    for (const bad of [row({ subjectKind: "plan", subjectKey: "p", amountMinor: -1n }), row({ subjectKind: "plan", subjectKey: "p", gstRateBps: 10_001 }), row({ subjectKind: "plan", subjectKey: "p", effectiveFrom: "2026-13-01" }), row({ subjectKind: "plan", subjectKey: "p", effectiveFrom: "2026-05-02", effectiveTo: "2026-05-01" })]) {
      expect(() => planPriceInsert([], bad)).toThrow(PriceError);
    }
  });

  it("quote: an add-on whose own hard dependency is missing is refused; covered by the plan or another add-on it is allowed", () => {
    const rows = [row({ subjectKind: "plan", subjectKey: "base", amountMinor: 100n }), row({ subjectKind: "addon", subjectKey: "payroll", amountMinor: 10n }), row({ subjectKind: "addon", subjectKey: "employee", amountMinor: 20n })];
    const q = (planModuleIds: string[], addonModuleIds: string[]) => quote({ rows, planCode: "base", planModuleIds, addonModuleIds, billingCycle: "annual", onDate: "2026-11-11" });
    expect(() => q([], ["payroll"])).toThrow(expect.objectContaining({ code: "ADDON_MISSING_DEPENDENCY" }));
    expect(q(["employee"], ["payroll"]).lines).toHaveLength(2);
    expect(q([], ["payroll", "employee"]).lines).toHaveLength(3);
  });

  it("quote: plan + add-ons, GST per line then summed, add-on already in the plan is refused, missing price is refused", () => {
    const rows = [
      row({ subjectKind: "plan", subjectKey: "hrms_basic", amountMinor: 1_000_000n }),
      row({ subjectKind: "addon", subjectKey: "payroll", amountMinor: 250_050n }),
      row({ subjectKind: "addon", subjectKey: "recruitment", amountMinor: 100_000n, gstRateBps: 1200 }),
    ];
    const q = quote({ rows, planCode: "hrms_basic", planModuleIds: ["employee", "leave"], addonModuleIds: ["payroll", "recruitment"], billingCycle: "annual", onDate: "2026-11-11" });
    expect(q.currency).toBe("INR");
    expect(q.lines.map((l) => [l.key, l.netMinor, l.gstMinor, l.grossMinor])).toEqual([
      ["hrms_basic", 1_000_000n, 180_000n, 1_180_000n],
      ["payroll", 250_050n, 45_009n, 295_059n],
      ["recruitment", 100_000n, 12_000n, 112_000n],
    ]);
    expect(q.totals).toEqual({ netMinor: 1_350_050n, gstMinor: 237_009n, grossMinor: 1_587_059n });
    expect(() => quote({ rows, planCode: "hrms_basic", planModuleIds: ["employee", "payroll"], addonModuleIds: ["payroll"], billingCycle: "annual", onDate: "2026-11-11" })).toThrow(expect.objectContaining({ code: "ADDON_ALREADY_IN_PLAN" }));
    expect(() => quote({ rows, planCode: "hrms_basic", planModuleIds: [], addonModuleIds: ["finance"], billingCycle: "annual", onDate: "2026-11-11" })).toThrow(expect.objectContaining({ code: "PRICE_NOT_FOUND" }));
    expect(() => quote({ rows, planCode: "hrms_basic", planModuleIds: [], billingCycle: "annual", onDate: "2026-03-01" })).toThrow(expect.objectContaining({ code: "PRICE_NOT_FOUND" }));
  });
});

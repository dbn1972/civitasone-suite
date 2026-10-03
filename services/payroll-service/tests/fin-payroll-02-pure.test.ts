/**
 * fin-payroll-02 -- pure rule logic: gratuity rule sets (GRATUITY-01/04),
 * bonus Act parameters (BONUS-02), declaration window (TAX-DECLARATION-05).
 */
import { describe, it, expect } from "vitest";
import { computeGratuity } from "../src/modules/payroll/domain.js";
import {
  computeGratuityByRule, resolveGratuityRule, DEFAULT_GRATUITY_RULE, CCS_DCRG_CEILING_MINOR,
  type GratuityRule, type GratuityRuleRow,
} from "../src/modules/gratuity-rules/rules.js";
import { bonusRuleViolation, bonusWagesMinor, resolveBonusRule, NO_BONUS_RULE, type BonusRule, type BonusRuleRow } from "../src/modules/bonus-rules/rules.js";
import { currentFyWindow, istToday } from "../src/modules/tax/declaration-window.js";

const ccs: GratuityRule = { ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: CCS_DCRG_CEILING_MINOR, source: "tenant", effectiveFrom: "2024-01-01" };

describe("gratuity rule sets (GAP-PAYROLL-STATUTORY-GRATUITY-01/04)", () => {
  it("the built-in default is byte-identical to the legacy Payment of Gratuity Act computation", () => {
    for (const years of [0, 3.9, 5, 5.49, 5.5, 10, 22, 30.2, 80]) {
      for (const [basic, da] of [[5_000_000n, 2_500_000n], [123_457n, 0n], [90_000_000n, 45_000_000n]] as const) {
        expect(computeGratuityByRule(DEFAULT_GRATUITY_RULE, years, basic, da)).toBe(computeGratuity(years, basic, da));
      }
    }
    expect(computeGratuityByRule(DEFAULT_GRATUITY_RULE, 2, 1_000_000n, 0n, "death")).toBe(computeGratuity(2, 1_000_000n, 0n, "death"));
  });

  it("Govt Department, 22 completed years: DCRG = 1/4 x emoluments x 44 half-years (11x), not 15/26 x 22 capped at Rs 20 lakh", () => {
    const basic = 10_000_000n; // Rs 1,00,000
    const da = 5_000_000n;     // Rs 50,000  => emoluments Rs 1,50,000
    const dcrg = computeGratuityByRule(ccs, 22, basic, da, "retirement");
    expect(dcrg).toBe(165_000_000n); // 11 x 1,50,000 = Rs 16,50,000
    const pog = computeGratuityByRule(DEFAULT_GRATUITY_RULE, 22, basic, da);
    expect(pog).not.toBe(dcrg);
    expect(pog).toBe(computeGratuity(22, basic, da));
  });

  it("a part half-year of 3 months or more counts as completed, under 3 months is dropped (CCS Pension Rules 2021 qualifying service)", () => {
    // months of service / 12 => exact half-year arithmetic
    expect(computeGratuityByRule(ccs, (10 * 12 + 2) / 12, 1_000_000n, 0n, "retirement")).toBe(5_000_000n);   // 10y 2m -> 20 half-years -> 5x
    expect(computeGratuityByRule(ccs, (10 * 12 + 3) / 12, 1_000_000n, 0n, "retirement")).toBe(5_250_000n);   // 10y 3m -> 21 -> 5.25x
    expect(computeGratuityByRule(ccs, (10 * 12 + 5) / 12, 1_000_000n, 0n, "retirement")).toBe(5_250_000n);   // 10y 5m -> 21
    expect(computeGratuityByRule(ccs, (10 * 12 + 9) / 12, 1_000_000n, 0n, "retirement")).toBe(5_500_000n);   // 10y 9m -> 21 + (3m) -> 22 -> 5.5x
  });

  it("DCRG separation-type allow-list: retirement-type and death pay, resignation / dismissal / removal / unknown do not", () => {
    for (const t of ["retirement", "superannuation", "voluntary_retirement", "compulsory_retirement", "invalidation", "death"]) {
      expect(computeGratuityByRule(ccs, 22, 10_000_000n, 5_000_000n, t)).toBeGreaterThan(0n);
    }
    for (const t of ["resignation", "dismissal", "removal", "termination", "", null, undefined]) {
      expect(computeGratuityByRule(ccs, 22, 10_000_000n, 5_000_000n, t)).toBe(0n);
    }
  });

  it("the DCRG ceiling is date-aware: Rs 20 lakh before 1-Jan-2024, Rs 25 lakh from", () => {
    const big = [75_000_000n, 0n] as const; // 16.5 x 7.5L far above both ceilings
    expect(computeGratuityByRule(ccs, 33, big[0], big[1], "retirement", "2023-12-31")).toBe(200_000_000n);
    expect(computeGratuityByRule(ccs, 33, big[0], big[1], "retirement", "2024-01-01")).toBe(250_000_000n);
    expect(computeGratuityByRule(ccs, 33, big[0], big[1], "death", "2023-06-30")).toBe(200_000_000n);
    // a tenant row already below the pre-2024 figure is never raised
    expect(computeGratuityByRule({ ...ccs, ceilingMinor: 100_000_000n }, 33, big[0], big[1], "retirement", "2023-06-30")).toBe(100_000_000n);
  });

  it("DCRG is capped at 16.5 x emoluments and at the configured ceiling (Rs 25 lakh)", () => {
    expect(computeGratuityByRule(ccs, 40, 1_000_000n, 0n, "retirement")).toBe(16_500_000n); // 66 half-years cap -> 16.5x of Rs 10,000
    const rich = computeGratuityByRule(ccs, 33, 50_000_000n, 25_000_000n, "retirement", "2026-06-30"); // 16.5 x 7.5L = 1.24Cr -> ceiling
    expect(rich).toBe(CCS_DCRG_CEILING_MINOR);
    const cheap: GratuityRule = { ...ccs, ceilingMinor: 100_000_000n };
    expect(computeGratuityByRule(cheap, 33, 50_000_000n, 25_000_000n, "retirement", "2026-06-30")).toBe(100_000_000n);
  });

  it("DCRG: 5-year floor, waived on invalidation; death follows the death-gratuity table", () => {
    expect(computeGratuityByRule(ccs, 4, 1_000_000n, 0n, "resignation")).toBe(0n);
    expect(computeGratuityByRule(ccs, 4, 1_000_000n, 0n, "invalidation")).toBeGreaterThan(0n);
    expect(computeGratuityByRule(ccs, 0.4, 1_000_000n, 0n, "death")).toBe(2_000_000n);   // < 1 yr : 2x
    expect(computeGratuityByRule(ccs, 3, 1_000_000n, 0n, "death")).toBe(6_000_000n);     // 1..<5 : 6x
    expect(computeGratuityByRule(ccs, 7, 1_000_000n, 0n, "death")).toBe(12_000_000n);    // 5..<11: 12x
    expect(computeGratuityByRule(ccs, 15, 1_000_000n, 0n, "death")).toBe(20_000_000n);   // 11..<20: 20x
    expect(computeGratuityByRule(ccs, 25, 1_000_000n, 0n, "death")).toBe(25_000_000n);   // 1/2 x 50 half-years = 25x
  });

  it("a PoG-Act row with a different floor/ceiling is honoured", () => {
    const rule: GratuityRule = { ruleSet: "pog_act", minServiceYears: 1, ceilingMinor: 5_000_000n, source: "tenant", effectiveFrom: "2026-04-01" };
    expect(computeGratuityByRule(rule, 2, 1_000_000n, 0n)).toBe(computeGratuity(2, 1_000_000n, 0n, null, { minServiceYears: 1, ceilingMinor: 5_000_000n }));
    expect(computeGratuityByRule(rule, 2, 1_000_000n, 0n)).toBeGreaterThan(0n);
    expect(computeGratuityByRule(rule, 30, 50_000_000n, 0n)).toBe(5_000_000n);
  });

  it("resolution is effective-dated: latest row on/before the date, else the default", () => {
    const rows: GratuityRuleRow[] = [
      { id: "a", effectiveFrom: "2024-01-01", ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: 250_000_000n, changeReason: "x", createdAt: "", createdBy: "" },
      { id: "b", effectiveFrom: "2026-04-01", ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: 200_000_000n, changeReason: "y", createdAt: "", createdBy: "" },
    ];
    expect(resolveGratuityRule(rows, "2023-12-31")).toBe(DEFAULT_GRATUITY_RULE);
    expect(resolveGratuityRule(rows, "2025-06-30")).toMatchObject({ ruleSet: "ccs_dcrg", source: "tenant" });
    expect(resolveGratuityRule(rows, "2026-04-01")).toMatchObject({ ruleSet: "pog_act", effectiveFrom: "2026-04-01" });
  });
});

describe("Payment of Bonus Act parameters (GAP-PAYROLL-BONUS-02)", () => {
  const rule: BonusRule = { wageCeilingMinor: 700_000n, eligibilityCeilingMinor: 2_100_000n, minBonusBps: 833, maxBonusBps: 2000, source: "tenant", effectiveFrom: "2026-04-01" };

  it("no rule => nothing enforced and wages are the basic as entered (legacy amounts)", () => {
    expect(bonusRuleViolation(NO_BONUS_RULE, 99_999_999n, 2000)).toBeNull();
    expect(bonusWagesMinor(NO_BONUS_RULE, 99_999_999n)).toBe(99_999_999n);
  });

  it("wages are capped at the calculation ceiling; below it they are untouched", () => {
    expect(bonusWagesMinor(rule, 1_500_000n)).toBe(700_000n);
    expect(bonusWagesMinor(rule, 500_000n)).toBe(500_000n);
  });

  it("rejects above the eligibility ceiling and outside the configured pct band", () => {
    expect(bonusRuleViolation(rule, 2_100_001n, 833)).toMatch(/eligibility/);
    expect(bonusRuleViolation(rule, 2_100_000n, 833)).toBeNull();
    expect(bonusRuleViolation(rule, 100_000n, 800)).toMatch(/minimum/);
    expect(bonusRuleViolation(rule, 100_000n, 2100)).toMatch(/maximum/);
  });

  it("resolves effective-dated", () => {
    const rows: BonusRuleRow[] = [{ id: "a", effectiveFrom: "2026-04-01", wageCeilingMinor: 700_000n, eligibilityCeilingMinor: null, minBonusBps: null, maxBonusBps: null, changeReason: "", createdAt: "", createdBy: "" }];
    expect(resolveBonusRule(rows, "2026-03-31")).toBe(NO_BONUS_RULE);
    expect(resolveBonusRule(rows, "2026-04-01").wageCeilingMinor).toBe(700_000n);
  });
});

describe("declaration window (GAP-PAYROLL-TAX-DECLARATION-05)", () => {
  it("no window configured => always open (legacy)", () => {
    expect(currentFyWindow(null, "2099-01-01")).toMatchObject({ open: true, state: "open" });
  });
  it("closesOn is the last day inclusive; opensOn the first", () => {
    const w = { opensOn: "2026-04-01", closesOn: "2026-12-31" };
    expect(currentFyWindow(w, "2026-03-31")).toMatchObject({ open: false, state: "not_open" });
    expect(currentFyWindow(w, "2026-04-01").open).toBe(true);
    expect(currentFyWindow(w, "2026-12-31").open).toBe(true);
    expect(currentFyWindow(w, "2027-01-01")).toMatchObject({ open: false, state: "closed" });
  });
  it("istToday rolls over at 18:30 UTC", () => {
    expect(istToday(new Date("2026-04-01T18:29:00Z"))).toBe("2026-04-01");
    expect(istToday(new Date("2026-04-01T18:31:00Z"))).toBe("2026-04-02");
  });
});

describe("calendarServiceYears (DCRG tenure)", () => {
  it("an exact anniversary is exact; a day short loses the last month", async () => {
    const { calendarServiceYears } = await import("../src/modules/gratuity-rules/rules.js");
    expect(calendarServiceYears(new Date("2004-06-30"), new Date("2026-06-30"))).toBe(22);
    expect(calendarServiceYears(new Date("2004-06-30"), new Date("2026-06-28"))).toBeCloseTo(21 + 11 / 12, 10);
    // the last day is INCLUSIVE: 1-Jan-2000 .. 31-Dec-2019 is exactly 20 years
    expect(calendarServiceYears(new Date("2000-01-01"), new Date("2019-12-31"))).toBe(20);
    expect(calendarServiceYears(new Date("2026-06-30"), new Date("2004-06-30"))).toBe(0);
    expect(computeGratuityByRule(ccs, calendarServiceYears(new Date("2004-06-30"), new Date("2026-06-30")), 10_000_000n, 5_000_000n, "retirement")).toBe(165_000_000n);
  });
});

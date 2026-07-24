/**
 * M1 — Rate Engine domain tests.
 *
 * Covers: slab boundaries, effective-date switchover, simple vs compound interest,
 * grace window, exemption application, rounding, snapshot re-derivation, maker-checker.
 *
 * _Requirements: SVC-136_
 */
import { describe, it, expect } from "vitest";
import {
  compute,
  computePrincipal,
  computeInterest,
  computeRebate,
  lookupEffectiveSlab,
  lookupEffectiveSlabs,
  applyRounding,
  assertMakerChecker,
  daysBetween,
  DomainError,
  type RateSlab,
  type PenaltyRule,
  type RebateRule,
  type ComputeInput,
} from "../src/modules/rate-engine/domain.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RATE_HEAD_ID = "rh-property-tax";
const TENANT_ID = "t-001";

function flatSlab(overrides: Partial<RateSlab> = {}): RateSlab {
  return {
    id: "slab-flat-1",
    rateHeadId: RATE_HEAD_ID,
    slabType: "flat",
    bandFrom: null,
    bandTo: null,
    rateValue: 500000n, // ₹5000 flat
    effectiveFrom: "2024-04-01",
    effectiveTo: null,
    isActive: true,
    ...overrides,
  };
}

function adValoremSlab(overrides: Partial<RateSlab> = {}): RateSlab {
  return {
    id: "slab-adv-1",
    rateHeadId: RATE_HEAD_ID,
    slabType: "ad_valorem",
    bandFrom: null,
    bandTo: null,
    rateValue: 150n, // 1.5% (150 bps)
    effectiveFrom: "2024-04-01",
    effectiveTo: null,
    isActive: true,
    ...overrides,
  };
}

function bandSlabs(): RateSlab[] {
  return [
    {
      id: "band-1",
      rateHeadId: RATE_HEAD_ID,
      slabType: "band",
      bandFrom: 0n,
      bandTo: 1000000n, // up to ₹10,000
      rateValue: 100n, // 1%
      effectiveFrom: "2024-04-01",
      effectiveTo: null,
      isActive: true,
    },
    {
      id: "band-2",
      rateHeadId: RATE_HEAD_ID,
      slabType: "band",
      bandFrom: 1000000n,
      bandTo: 5000000n, // ₹10,000 to ₹50,000
      rateValue: 200n, // 2%
      effectiveFrom: "2024-04-01",
      effectiveTo: null,
      isActive: true,
    },
    {
      id: "band-3",
      rateHeadId: RATE_HEAD_ID,
      slabType: "band",
      bandFrom: 5000000n,
      bandTo: null, // above ₹50,000
      rateValue: 300n, // 3%
      effectiveFrom: "2024-04-01",
      effectiveTo: null,
      isActive: true,
    },
  ];
}

function simplePenaltyRule(overrides: Partial<PenaltyRule> = {}): PenaltyRule {
  return {
    id: "pen-1",
    rateHeadId: RATE_HEAD_ID,
    interestType: "simple",
    annualRateBps: 1200, // 12% per annum
    graceDays: 15,
    capMonths: null,
    roundingMode: "round_half_up",
    isActive: true,
    ...overrides,
  };
}

function compoundPenaltyRule(overrides: Partial<PenaltyRule> = {}): PenaltyRule {
  return {
    id: "pen-compound-1",
    rateHeadId: RATE_HEAD_ID,
    interestType: "compound",
    annualRateBps: 1200, // 12% per annum
    graceDays: 15,
    capMonths: 24,
    roundingMode: "round_half_up",
    isActive: true,
    ...overrides,
  };
}

function earlyPaymentRebate(overrides: Partial<RebateRule> = {}): RebateRule {
  return {
    id: "reb-1",
    rateHeadId: RATE_HEAD_ID,
    rebateType: "early_payment",
    discountBps: 500, // 5%
    validUntilDaysBeforeDue: 30, // pay 30+ days before due
    isActive: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Rate Engine — M1 SVC-136", () => {
  describe("lookupEffectiveSlab", () => {
    it("finds the slab effective on the given date", () => {
      const slabs = [flatSlab()];
      const result = lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-06-15");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("slab-flat-1");
    });

    it("returns null when no slab is effective", () => {
      const slabs = [flatSlab({ effectiveFrom: "2025-04-01" })];
      const result = lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-06-15");
      expect(result).toBeNull();
    });

    it("handles effective date switchover (old slab expired, new slab starts)", () => {
      const slabs = [
        flatSlab({ id: "slab-old", rateValue: 400000n, effectiveFrom: "2023-04-01", effectiveTo: "2024-04-01" }),
        flatSlab({ id: "slab-new", rateValue: 500000n, effectiveFrom: "2024-04-01", effectiveTo: null }),
      ];
      const oldResult = lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-03-31");
      expect(oldResult!.id).toBe("slab-old");
      expect(oldResult!.rateValue).toBe(400000n);

      const newResult = lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-04-01");
      expect(newResult!.id).toBe("slab-new");
      expect(newResult!.rateValue).toBe(500000n);
    });

    it("ignores inactive slabs", () => {
      const slabs = [flatSlab({ isActive: false })];
      expect(lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-06-15")).toBeNull();
    });

    it("ignores slabs for other rate heads", () => {
      const slabs = [flatSlab({ rateHeadId: "other-head" })];
      expect(lookupEffectiveSlab(slabs, RATE_HEAD_ID, "2024-06-15")).toBeNull();
    });
  });

  describe("computePrincipal", () => {
    it("flat slab — returns fixed amount regardless of base value", () => {
      const result = computePrincipal(2000000n, [flatSlab()]);
      expect(result.principal).toBe(500000n); // ₹5000
    });

    it("ad_valorem — percentage of base value", () => {
      const base = 10000000n; // ₹1,00,000
      const result = computePrincipal(base, [adValoremSlab()]);
      // 1.5% of ₹1,00,000 = ₹1,500 = 150000 paise
      expect(result.principal).toBe(150000n);
    });

    it("band slab — progressive taxation", () => {
      const base = 3000000n; // ₹30,000
      const result = computePrincipal(base, bandSlabs());
      // Band 1: 0-10000 → 1% of 1000000 = 10000
      // Band 2: 10000-30000 → 2% of 2000000 = 40000
      // Total: 50000 paise = ₹500
      expect(result.principal).toBe(50000n);
    });

    it("band slab — value in first band only", () => {
      const base = 500000n; // ₹5,000
      const result = computePrincipal(base, bandSlabs());
      // 1% of 500000 = 5000 paise
      expect(result.principal).toBe(5000n);
    });

    it("band slab — value exceeding all bands", () => {
      const base = 7000000n; // ₹70,000
      const result = computePrincipal(base, bandSlabs());
      // Band 1: 1% of 1000000 = 10000
      // Band 2: 2% of 4000000 = 80000
      // Band 3: 3% of 2000000 = 60000
      // Total: 150000 paise
      expect(result.principal).toBe(150000n);
    });

    it("throws when no slabs provided", () => {
      expect(() => computePrincipal(100n, [])).toThrow(DomainError);
    });
  });

  describe("computeInterest — simple", () => {
    const rule = simplePenaltyRule();

    it("zero interest within grace period", () => {
      // Due 2024-06-01, checking on 2024-06-10 (9 days late, within 15 grace days)
      const result = computeInterest(500000n, "2024-06-01", "2024-06-10", rule);
      expect(result.interest).toBe(0n);
      expect(result.overdueDays).toBe(0);
    });

    it("interest starts after grace period", () => {
      // Due 2024-06-01, checking 2024-07-01 (30 days late, 30-15=15 overdue days ≈ 1 month)
      const result = computeInterest(500000n, "2024-06-01", "2024-07-01", rule);
      expect(result.overdueDays).toBe(15);
      expect(result.interestMonths).toBe(1);
      // Simple: 500000 * (1200/12) / 10000 * 1 = 500000 * 100 / 10000 = 5000
      expect(result.interest).toBe(5000n);
    });

    it("interest scales with months", () => {
      // Due 2024-01-01, checking 2024-04-16 (106 days late, 106-15=91 overdue, ceil(91/30)=4 months)
      const result = computeInterest(1000000n, "2024-01-01", "2024-04-16", rule);
      expect(result.overdueDays).toBe(91);
      expect(result.interestMonths).toBe(4);
      // 1000000 * 100 / 10000 * 4 = 40000
      expect(result.interest).toBe(40000n);
    });

    it("no interest when payment is on time", () => {
      const result = computeInterest(500000n, "2024-06-01", "2024-05-30", rule);
      expect(result.interest).toBe(0n);
    });
  });

  describe("computeInterest — compound", () => {
    const rule = compoundPenaltyRule();

    it("compound interest accumulates", () => {
      // Due 2024-01-01, checking 2024-04-16 (106 days, 91 overdue, ceil(91/30)=4 months)
      const result = computeInterest(1000000n, "2024-01-01", "2024-04-16", rule);
      expect(result.interestMonths).toBe(4);
      // Compound: P * ((1 + 100/10000)^4 - 1) = 1000000 * ((1.01)^4 - 1)
      // (1.01)^4 = 1.04060401 → interest = 40604 paise
      // Rounded (round_half_up to nearest 100): 40600
      expect(result.interest).toBe(40600n);
    });

    it("respects cap months", () => {
      // Due 2020-01-01, checking 2024-01-01 (way more than 24 months)
      const result = computeInterest(1000000n, "2020-01-01", "2024-01-01", rule);
      expect(result.interestMonths).toBe(24); // capped
    });
  });

  describe("computeRebate", () => {
    it("grants rebate when paid early enough", () => {
      const rules = [earlyPaymentRebate()];
      // Due 2024-07-01, paying 2024-05-30 (32 days before due, needs ≥ 30)
      const result = computeRebate(500000n, "2024-07-01", "2024-05-30", rules);
      // 5% of 500000 = 25000
      expect(result.rebate).toBe(25000n);
      expect(result.ruleUsed).toBe("reb-1");
    });

    it("no rebate when paid too late for early payment", () => {
      const rules = [earlyPaymentRebate()];
      // Due 2024-07-01, paying 2024-06-15 (16 days before due, needs ≥ 30)
      const result = computeRebate(500000n, "2024-07-01", "2024-06-15", rules);
      expect(result.rebate).toBe(0n);
    });

    it("no rebate when no payment date", () => {
      const rules = [earlyPaymentRebate()];
      const result = computeRebate(500000n, "2024-07-01", null, rules);
      expect(result.rebate).toBe(0n);
    });
  });

  describe("applyRounding", () => {
    it("round_half_up rounds 50+ paise up", () => {
      expect(applyRounding(12350n, "round_half_up")).toBe(12400n); // 123.50 → 124 rupees
    });

    it("round_half_up rounds 49 paise down", () => {
      expect(applyRounding(12349n, "round_half_up")).toBe(12300n);
    });

    it("floor always rounds down", () => {
      expect(applyRounding(12399n, "floor")).toBe(12300n);
    });

    it("ceil rounds up when there are remaining paise", () => {
      expect(applyRounding(12301n, "ceil")).toBe(12400n);
    });

    it("ceil keeps exact amounts", () => {
      expect(applyRounding(12300n, "ceil")).toBe(12300n);
    });
  });

  describe("compute (full pipeline)", () => {
    it("flat slab with no penalty, no rebate", () => {
      const input: ComputeInput = {
        rateHeadId: RATE_HEAD_ID,
        baseValue: 2000000n, // ₹20,000 property value (not used for flat)
        asOfDate: "2024-06-15",
        dueDate: "2024-07-01", // not yet overdue
        exemptions: [],
      };
      const result = compute([flatSlab()], [simplePenaltyRule()], [], input);
      expect(result.principal).toBe(500000n);
      expect(result.penalty).toBe(0n);
      expect(result.rebate).toBe(0n);
      expect(result.net).toBe(500000n);
    });

    it("ad_valorem with penalty after grace period", () => {
      const input: ComputeInput = {
        rateHeadId: RATE_HEAD_ID,
        baseValue: 10000000n, // ₹1,00,000
        asOfDate: "2024-08-01", // 61 days after due (61-15=46 overdue, ceil(46/30)=2 months)
        dueDate: "2024-06-01",
        exemptions: [],
      };
      const result = compute([adValoremSlab()], [simplePenaltyRule()], [], input);
      // Principal: 1.5% of 10000000 = 150000
      expect(result.principal).toBe(150000n);
      // Interest: 150000 * 100/10000 * 2 = 3000
      expect(result.penalty).toBe(3000n);
      expect(result.net).toBe(153000n);
    });

    it("ad_valorem with early payment rebate", () => {
      const input: ComputeInput = {
        rateHeadId: RATE_HEAD_ID,
        baseValue: 10000000n,
        asOfDate: "2024-05-01",
        dueDate: "2024-07-01",
        exemptions: [],
        paymentDate: "2024-05-01", // 61 days before due ≥ 30
      };
      const result = compute([adValoremSlab()], [simplePenaltyRule()], [earlyPaymentRebate()], input);
      expect(result.principal).toBe(150000n);
      // Rebate: 5% of 150000 = 7500
      expect(result.rebate).toBe(7500n);
      expect(result.penalty).toBe(0n);
      expect(result.net).toBe(142500n); // 150000 - 7500
    });

    it("snapshot is complete and re-derivable", () => {
      const input: ComputeInput = {
        rateHeadId: RATE_HEAD_ID,
        baseValue: 10000000n,
        asOfDate: "2024-08-01",
        dueDate: "2024-06-01",
        exemptions: [],
      };
      const result = compute([adValoremSlab()], [simplePenaltyRule()], [], input);
      const snap = result.snapshot;

      // Re-derive from snapshot — same result
      const input2: ComputeInput = {
        rateHeadId: snap.rateHeadId,
        baseValue: BigInt(snap.baseValue),
        asOfDate: snap.asOfDate,
        dueDate: snap.dueDate,
        exemptions: snap.exemptions,
        paymentDate: snap.paymentDate ?? undefined,
      };
      const result2 = compute([adValoremSlab()], [simplePenaltyRule()], [], input2);
      expect(result2.net).toBe(result.net);
      expect(result2.principal).toBe(result.principal);
      expect(result2.penalty).toBe(result.penalty);
    });

    it("throws when no effective slab found", () => {
      const input: ComputeInput = {
        rateHeadId: RATE_HEAD_ID,
        baseValue: 100n,
        asOfDate: "2020-01-01",
        dueDate: "2020-02-01",
        exemptions: [],
      };
      expect(() => compute([flatSlab()], [], [], input)).toThrow("No effective rate slab");
    });
  });

  describe("assertMakerChecker", () => {
    it("passes when maker and checker are different", () => {
      expect(() => assertMakerChecker("user-a", "user-b")).not.toThrow();
    });

    it("throws when same user", () => {
      expect(() => assertMakerChecker("user-a", "user-a")).toThrow(DomainError);
      expect(() => assertMakerChecker("user-a", "user-a")).toThrow("Checker cannot be the same person");
    });
  });

  describe("daysBetween", () => {
    it("computes positive days between dates", () => {
      expect(daysBetween("2024-07-01", "2024-06-01")).toBe(30);
    });

    it("computes negative days (before due date)", () => {
      expect(daysBetween("2024-05-01", "2024-06-01")).toBe(-31);
    });

    it("same date returns 0", () => {
      expect(daysBetween("2024-06-01", "2024-06-01")).toBe(0);
    });
  });
});

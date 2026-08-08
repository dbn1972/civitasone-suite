/**
 * Payroll Service — Pension Computation + Gratuity + Run Status: Deep tests.
 *
 * Tests CCS pension with additional-pension age bands, commutation restoration,
 * DR calculation, gratuity formula, run status transitions, and validators.
 *
 * Source: modules/payroll/domain.ts, modules/payroll/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  computePension,
  additionalPensionPct,
  ageAtMonth,
  computeGratuity,
  assertRunStatusTransition,
  roundRupee,
  hraSlabPct,
  isPayrollEligible,
  DomainError,
} from "../src/modules/payroll/domain.js";
import { createRunBody, createPensionerBody, createDdoBody } from "../src/modules/payroll/validators.js";

// ═══ Additional Pension (CCS Age Bands) ═══

describe("additionalPensionPct — CCS age-based enhancement", () => {
  it("below 80: 0%", () => expect(additionalPensionPct(79)).toBe(0n));
  it("80: 20%", () => expect(additionalPensionPct(80)).toBe(20n));
  it("84: 20%", () => expect(additionalPensionPct(84)).toBe(20n));
  it("85: 30%", () => expect(additionalPensionPct(85)).toBe(30n));
  it("89: 30%", () => expect(additionalPensionPct(89)).toBe(30n));
  it("90: 40%", () => expect(additionalPensionPct(90)).toBe(40n));
  it("94: 40%", () => expect(additionalPensionPct(94)).toBe(40n));
  it("95: 50%", () => expect(additionalPensionPct(95)).toBe(50n));
  it("99: 50%", () => expect(additionalPensionPct(99)).toBe(50n));
  it("100: 100%", () => expect(additionalPensionPct(100)).toBe(100n));
  it("110: 100%", () => expect(additionalPensionPct(110)).toBe(100n));
});

describe("ageAtMonth — age calculation", () => {
  it("exact birthday month counts the year", () => {
    expect(ageAtMonth("1946-07-15", "2026-07")).toBe(80);
  });
  it("month before birthday = one less year", () => {
    expect(ageAtMonth("1946-08-15", "2026-07")).toBe(79);
  });
  it("December birthday checked at Dec end", () => {
    expect(ageAtMonth("1946-12-31", "2026-12")).toBe(80);
  });
});

// ═══ Pension Computation ═══

describe("computePension — monthly pension slip", () => {
  it("basic pension with DR (50%) and no commutation for 75-year-old", () => {
    const result = computePension({
      basicPensionMinor: 5000000n, // ₹50,000
      drRateBps: 5000n,            // 50% DR
      dateOfBirth: "1951-03-15",
      month: "2026-07",
    });
    expect(result.ageYears).toBe(75);
    expect(result.additionalPensionPct).toBe(0n); // below 80
    expect(result.additionalPensionMinor).toBe(0n);
    expect(result.payableBasicPensionMinor).toBe(5000000n); // no commutation
    // DR = 50% of (basic + addl) = 50% of 50000 = ₹25,000
    expect(result.drMinor).toBe(2500000n);
    // Gross = basic + DR + medical
    expect(result.grossMinor).toBe(7500000n);
    expect(result.netPayMinor).toBe(7500000n); // no deductions
  });

  it("80-year-old gets 20% additional pension", () => {
    const result = computePension({
      basicPensionMinor: 4000000n, // ₹40,000
      drRateBps: 5000n,
      dateOfBirth: "1946-01-01",
      month: "2026-07",
    });
    expect(result.ageYears).toBe(80);
    expect(result.additionalPensionPct).toBe(20n);
    // Additional = 20% of ₹40,000 = ₹8,000
    expect(result.additionalPensionMinor).toBe(800000n);
    // DR on (basic + addl) = 50% of (40000 + 8000) = 50% of 48000 = ₹24,000
    expect(result.drMinor).toBe(2400000n);
  });

  it("commutation deduction withheld when not restored", () => {
    const result = computePension({
      basicPensionMinor: 5000000n,
      commutedPensionMinor: 2000000n,
      commutationDate: "2020-01-01", // Only 6 years ago, not restored (needs 15)
      dateOfBirth: "1960-03-15",
      month: "2026-07",
    });
    expect(result.commutationRestored).toBe(false);
    expect(result.commutationDeductionMinor).toBe(2000000n);
    expect(result.payableBasicPensionMinor).toBe(3000000n); // 50000 - 20000
  });

  it("commutation restored after 15 years", () => {
    const result = computePension({
      basicPensionMinor: 5000000n,
      commutedPensionMinor: 2000000n,
      commutationDate: "2010-01-01", // 16 years ago — restored
      dateOfBirth: "1960-03-15",
      month: "2026-07",
    });
    expect(result.commutationRestored).toBe(true);
    expect(result.commutationDeductionMinor).toBe(0n);
    expect(result.payableBasicPensionMinor).toBe(5000000n);
  });

  it("TDS is deducted from net", () => {
    const result = computePension({
      basicPensionMinor: 5000000n,
      tdsMinor: 500000n, // ₹5,000 TDS
      dateOfBirth: "1960-01-01",
      month: "2026-07",
    });
    expect(result.tdsMinor).toBe(500000n);
    expect(result.netPayMinor).toBe(result.grossMinor - 500000n);
  });
});

// ═══ Gratuity ═══

describe("computeGratuity — Payment of Gratuity Act", () => {
  it("returns 0 for less than 5 years service", () => {
    expect(computeGratuity(4.9, 5000000n)).toBe(0n);
  });

  it("exactly 5 years: (15/26) * (basic+DA) * 5", () => {
    // basic = ₹50,000 (5000000 paise), DA = 0
    // Gratuity = (15/26) * 50000 * 5 = 144230.76... → rounded
    const result = computeGratuity(5, 5000000n, 0n);
    expect(result).toBeGreaterThan(0n);
    // Manual: 5000000 * 15 * 5 / 26 = 14423076n → roundRupee
    expect(result).toBe(roundRupee(5000000n * 15n * 5n / 26n));
  });

  it("rounds up half-year in final year (6+ months)", () => {
    // 10.6 years → rounds to 11 completed years
    const result11 = computeGratuity(10.6, 5000000n, 0n);
    const result10 = computeGratuity(10.4, 5000000n, 0n);
    expect(result11).toBeGreaterThan(result10);
  });

  it("capped at ₹20 lakh (200000000 paise)", () => {
    // Very high salary × many years
    const result = computeGratuity(35, 30000000n, 15000000n); // ₹3L basic + ₹1.5L DA × 35yr
    expect(result).toBeLessThanOrEqual(200000000n);
  });

  it("includes DA in calculation", () => {
    const withoutDa = computeGratuity(10, 5000000n, 0n);
    const withDa = computeGratuity(10, 5000000n, 2500000n); // ₹25K DA
    expect(withDa).toBeGreaterThan(withoutDa);
  });
});

// ═══ Run Status Machine ═══

describe("assertRunStatusTransition", () => {
  it("draft → processing", () => expect(() => assertRunStatusTransition("draft", "processing")).not.toThrow());
  it("processing → approved", () => expect(() => assertRunStatusTransition("processing", "approved")).not.toThrow());
  it("processing → failed", () => expect(() => assertRunStatusTransition("processing", "failed")).not.toThrow());
  it("approved → disbursed", () => expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow());
  it("failed → draft (retry)", () => expect(() => assertRunStatusTransition("failed", "draft")).not.toThrow());
  it("disbursed is terminal", () => expect(() => assertRunStatusTransition("disbursed", "draft")).toThrow(DomainError));
  it("draft → approved is illegal (must process first)", () => expect(() => assertRunStatusTransition("draft", "approved")).toThrow(DomainError));
  it("approved → processing is illegal (no reversal)", () => expect(() => assertRunStatusTransition("approved", "processing")).toThrow(DomainError));
  it("error code is INVALID_STATUS_TRANSITION", () => {
    try { assertRunStatusTransition("disbursed", "draft"); } catch (e) { expect((e as DomainError).code).toBe("INVALID_STATUS_TRANSITION"); }
  });
});

// ═══ Utility Functions ═══

describe("roundRupee — nearest rupee (round-half-up)", () => {
  it("rounds 50 paise up", () => expect(roundRupee(1050n)).toBe(1100n));
  it("rounds 49 paise down", () => expect(roundRupee(1049n)).toBe(1000n));
  it("exact rupee unchanged", () => expect(roundRupee(1000n)).toBe(1000n));
  it("zero returns zero", () => expect(roundRupee(0n)).toBe(0n));
  it("negative values rounded symmetrically", () => expect(roundRupee(-1050n)).toBe(-1100n));
});

describe("hraSlabPct — 7th CPC city class slabs", () => {
  it("X city, DA < 50%: 24%", () => expect(hraSlabPct("X", 4999n)).toBe(24n));
  it("X city, DA >= 50%: 27%", () => expect(hraSlabPct("X", 5000n)).toBe(27n));
  it("X city, DA >= 100%: 30%", () => expect(hraSlabPct("X", 10000n)).toBe(30n));
  it("Y city, DA < 50%: 16%", () => expect(hraSlabPct("Y", 0n)).toBe(16n));
  it("Z city, DA < 50%: 8%", () => expect(hraSlabPct("Z", 0n)).toBe(8n));
});

describe("isPayrollEligible — engagement gate", () => {
  it("eligible by default (no flags)", () => expect(isPayrollEligible({})).toBe(true));
  it("eligible when paymentRoute=payroll", () => expect(isPayrollEligible({ paymentRoute: "payroll" })).toBe(true));
  it("not eligible when eligibleForPayroll=false", () => expect(isPayrollEligible({ eligibleForPayroll: false })).toBe(false));
  it("not eligible when paymentRoute=invoice", () => expect(isPayrollEligible({ paymentRoute: "invoice" })).toBe(false));
  it("not eligible when paymentRoute=agency", () => expect(isPayrollEligible({ paymentRoute: "agency" })).toBe(false));
});

// ═══ Validators ═══

describe("createRunBody — payroll run creation", () => {
  const valid = { runNo: "RUN-2026-07", month: "2026-07", structureId: "10000000-aaaa-4000-8000-000000000001" };

  it("accepts valid run", () => expect(createRunBody.safeParse(valid).success).toBe(true));
  it("rejects empty runNo", () => expect(createRunBody.safeParse({ ...valid, runNo: "" }).success).toBe(false));
  it("rejects invalid month", () => expect(createRunBody.safeParse({ ...valid, month: "2026" }).success).toBe(false));
  it("requires structureId for non-pensioner runs", () => {
    expect(createRunBody.safeParse({ runNo: "X", month: "2026-07" }).success).toBe(false);
  });
  it("allows missing structureId for pensioner runs", () => {
    expect(createRunBody.safeParse({ runNo: "X", month: "2026-07", runType: "pensioner" }).success).toBe(true);
  });
});

describe("createPensionerBody — pensioner master", () => {
  const valid = { ppoNo: "PPO-001", fullName: "Test Pensioner", dateOfBirth: "1950-01-01", basicPensionMinor: "5000000" };
  it("accepts valid pensioner", () => expect(createPensionerBody.safeParse(valid).success).toBe(true));
  it("rejects empty ppoNo", () => expect(createPensionerBody.safeParse({ ...valid, ppoNo: "" }).success).toBe(false));
  it("rejects invalid DOB", () => expect(createPensionerBody.safeParse({ ...valid, dateOfBirth: "bad" }).success).toBe(false));
  it("accepts numeric basicPensionMinor", () => expect(createPensionerBody.safeParse({ ...valid, basicPensionMinor: 5000000 }).success).toBe(true));
});

describe("createDdoBody — DDO admin", () => {
  it("accepts valid DDO", () => expect(createDdoBody.safeParse({ ddoCode: "DDO-01", name: "Treasury Officer" }).success).toBe(true));
  it("rejects empty ddoCode", () => expect(createDdoBody.safeParse({ ddoCode: "", name: "X" }).success).toBe(false));
  it("rejects empty name", () => expect(createDdoBody.safeParse({ ddoCode: "X", name: "" }).success).toBe(false));
});

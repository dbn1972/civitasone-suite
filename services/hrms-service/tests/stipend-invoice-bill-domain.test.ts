/**
 * HRMS Apprentice Stipend, Consultant Invoice, Contractor Bill — tax engine tests.
 * Packs #24, #29, #30. Source: modules/apprentice-stipend/domain.ts, consultant-invoice/domain.ts, contractor-bill/domain.ts
 */
import { describe, it, expect } from "vitest";
import { prorate, applyBps as stipendApplyBps, computeStipend } from "../src/modules/apprentice-stipend/domain.js";
import { computeInvoiceTax, applyBps as invoiceApplyBps } from "../src/modules/consultant-invoice/domain.js";
import { computeContractTax, tds194cRateBps } from "../src/modules/contractor-bill/domain.js";

// ─── Apprentice Stipend ──────────────────────────────────────────────────────
describe("apprentice stipend — prorate", () => {
  it("full attendance = full stipend", () => expect(prorate(15_000_00n, 22, 22)).toBe(15_000_00n));
  it("half attendance = half stipend (rounded)", () => expect(prorate(15_000_00n, 11, 22)).toBe(750_000n));
  it("0 days = 0", () => expect(prorate(15_000_00n, 0, 22)).toBe(0n));
  it("0 working days = 0", () => expect(prorate(15_000_00n, 10, 0)).toBe(0n));
});

describe("apprentice stipend — computeStipend", () => {
  it("computes NAPS reimbursement capped at ₹1,500", () => {
    const result = computeStipend({
      monthlyStipendMinor: 10_000_00n, workingDays: 22, daysPresent: 22,
      napsReimbPctBps: 2500, napsReimbCapMinor: 150_000n,
    });
    expect(result.grossStipendMinor).toBe(10_000_00n);
    // 25% of 10,000 = 2,500 → capped at 1,500
    expect(result.napsReimbMinor).toBe(150_000n);
    expect(result.employerCostMinor).toBe(10_000_00n - 150_000n);
  });

  it("uncapped when reimbursement is below cap", () => {
    const result = computeStipend({
      monthlyStipendMinor: 4_000_00n, workingDays: 22, daysPresent: 22,
      napsReimbPctBps: 2500, napsReimbCapMinor: 150_000n,
    });
    // 25% of 4,000 = 1,000 (below cap)
    expect(result.napsReimbMinor).toBe(stipendApplyBps(4_000_00n, 2500));
    expect(result.napsReimbMinor).toBeLessThan(150_000n);
  });
});

// ─── Consultant Invoice (194J) ───────────────────────────────────────────────
describe("consultant invoice — computeInvoiceTax", () => {
  it("applies 18% GST + 10% TDS when threshold crossed", () => {
    const result = computeInvoiceTax({
      grossMinor: 50_000_00n, gstApplicable: true, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: 30_000_00n, ytdGrossMinor: 0n,
    });
    // GST: 50000 * 1800 / 10000 = 9000 (with rounding)
    expect(result.gstMinor).toBeGreaterThan(0n);
    // TDS: crosses 30k threshold (YTD 0 + 50k = 50k >= 30k)
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsMinor).toBeGreaterThan(0n);
    // Net = gross + gst - tds
    expect(result.netPayableMinor).toBe(result.gstMinor + 50_000_00n - result.tdsMinor);
  });

  it("no TDS when below threshold", () => {
    const result = computeInvoiceTax({
      grossMinor: 20_000_00n, gstApplicable: true, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: 30_000_00n, ytdGrossMinor: 0n,
    });
    // YTD 0 + 20k = 20k < 30k threshold
    expect(result.tdsApplied).toBe(false);
    expect(result.tdsMinor).toBe(0n);
  });

  it("no GST when not applicable", () => {
    const result = computeInvoiceTax({
      grossMinor: 50_000_00n, gstApplicable: false, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: 30_000_00n, ytdGrossMinor: 0n,
    });
    expect(result.gstMinor).toBe(0n);
  });

  it("TDS base excludes GST (CBDT Circular 23/2017)", () => {
    const result = computeInvoiceTax({
      grossMinor: 100_000_00n, gstApplicable: true, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: 30_000_00n, ytdGrossMinor: 0n,
    });
    // TDS is 10% of GROSS (not gross+GST)
    const expectedTds = invoiceApplyBps(100_000_00n, 1000);
    expect(result.tdsMinor).toBe(expectedTds);
  });
});

// ─── Contractor Bill (194C) ──────────────────────────────────────────────────
describe("contractor bill — tds194cRateBps", () => {
  it("individual/HUF = 1% (100 bps)", () => expect(tds194cRateBps("individual_huf")).toBe(100));
  it("other = 2% (200 bps)", () => expect(tds194cRateBps("other")).toBe(200));
});

describe("contractor bill — computeContractTax", () => {
  it("single bill >= 30k triggers TDS", () => {
    const result = computeContractTax({
      grossMinor: 35_000_00n, gstApplicable: true, gstRateBps: 1800,
      contractorKind: "other", singleThresholdMinor: 30_000_00n,
      annualThresholdMinor: 100_000_00n, ytdGrossMinor: 0n,
    });
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsRateBps).toBe(200); // "other" = 2%
  });

  it("annual aggregate >= 1L triggers TDS even if single < 30k", () => {
    const result = computeContractTax({
      grossMinor: 20_000_00n, gstApplicable: false, gstRateBps: 0,
      contractorKind: "individual_huf", singleThresholdMinor: 30_000_00n,
      annualThresholdMinor: 100_000_00n, ytdGrossMinor: 85_000_00n, // 85k + 20k = 105k >= 1L
    });
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsRateBps).toBe(100); // individual = 1%
  });

  it("no TDS when both thresholds unmet", () => {
    const result = computeContractTax({
      grossMinor: 20_000_00n, gstApplicable: false, gstRateBps: 0,
      contractorKind: "other", singleThresholdMinor: 30_000_00n,
      annualThresholdMinor: 100_000_00n, ytdGrossMinor: 50_000_00n, // 50k + 20k = 70k < 1L
    });
    expect(result.tdsApplied).toBe(false);
  });

  it("net = gross + gst - tds", () => {
    const result = computeContractTax({
      grossMinor: 50_000_00n, gstApplicable: true, gstRateBps: 1800,
      contractorKind: "other", singleThresholdMinor: 30_000_00n,
      annualThresholdMinor: 100_000_00n, ytdGrossMinor: 0n,
    });
    expect(result.netPayableMinor).toBe(50_000_00n + result.gstMinor - result.tdsMinor);
  });
});

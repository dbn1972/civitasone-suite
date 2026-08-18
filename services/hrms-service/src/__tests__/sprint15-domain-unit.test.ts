/**
 * Sprint-15 domain unit tests
 *
 * Pure-function tests that require no DB, no buildApp, no JWT.
 * Directly imports domain modules and exercises every exported function,
 * covering the function-coverage gap that route-level inject tests cannot reach.
 *
 * Targeted modules: assessment, apprentice-stipend, consultant-invoice, contractor-bill
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────────────────────
// assessment/domain
// ──────────────────────────────────────────────────────────────────────────────
import {
  gradeAttempt,
  decidePass,
  canAttempt,
  issueCertificate,
  evaluateCertificateStatus,
  type GradableQuestion,
  type Qtype,
} from "../modules/assessment/domain.js";

describe("assessment domain — gradeAttempt", () => {
  const q1: GradableQuestion = { id: "q1", qtype: "single", correct: ["A"], marks: 10 };
  const q2: GradableQuestion = { id: "q2", qtype: "multi",  correct: ["A", "B"], marks: 20 };
  const q3: GradableQuestion = { id: "q3", qtype: "truefalse", correct: ["true"], marks: 5 };

  it("awards full marks for a correct single answer", () => {
    const result = gradeAttempt([q1], [{ questionId: "q1", response: ["A"] }]);
    expect(result.score).toBe(10);
    expect(result.perQuestion[0]!.awarded).toBe(10);
  });

  it("awards 0 for a wrong single answer", () => {
    const result = gradeAttempt([q1], [{ questionId: "q1", response: ["B"] }]);
    expect(result.score).toBe(0);
  });

  it("awards full marks for correct multi answer (exact set match)", () => {
    const result = gradeAttempt([q2], [{ questionId: "q2", response: ["B", "A"] }]);
    expect(result.score).toBe(20);
  });

  it("awards 0 for partial multi answer (missing one option)", () => {
    const result = gradeAttempt([q2], [{ questionId: "q2", response: ["A"] }]);
    expect(result.score).toBe(0);
  });

  it("awards 0 for extra options in multi answer", () => {
    const result = gradeAttempt([q2], [{ questionId: "q2", response: ["A", "B", "C"] }]);
    expect(result.score).toBe(0);
  });

  it("awards full marks for a correct truefalse answer", () => {
    const result = gradeAttempt([q3], [{ questionId: "q3", response: ["true"] }]);
    expect(result.score).toBe(5);
  });

  it("awards 0 for unanswered question (not in answers list)", () => {
    const result = gradeAttempt([q1], []);
    expect(result.score).toBe(0);
    expect(result.perQuestion[0]!.awarded).toBe(0);
  });

  it("sums scores across multiple questions", () => {
    const result = gradeAttempt(
      [q1, q2, q3],
      [
        { questionId: "q1", response: ["A"] },   // correct: 10
        { questionId: "q2", response: ["A"] },   // wrong: 0
        { questionId: "q3", response: ["true"] }, // correct: 5
      ],
    );
    expect(result.score).toBe(15);
  });
});

describe("assessment domain — decidePass", () => {
  it("returns true when score equals passing score", () => {
    expect(decidePass(70, 70)).toBe(true);
  });

  it("returns true when score exceeds passing score", () => {
    expect(decidePass(85, 70)).toBe(true);
  });

  it("returns false when score is below passing score", () => {
    expect(decidePass(69, 70)).toBe(false);
  });

  it("returns false when score is 0 and passing is >0", () => {
    expect(decidePass(0, 50)).toBe(false);
  });
});

describe("assessment domain — canAttempt", () => {
  it("allows attempt when count is below max", () => {
    expect(canAttempt(0, 3)).toBe(true);
    expect(canAttempt(2, 3)).toBe(true);
  });

  it("denies attempt when count equals max", () => {
    expect(canAttempt(3, 3)).toBe(false);
  });

  it("denies attempt when count exceeds max", () => {
    expect(canAttempt(5, 3)).toBe(false);
  });
});

describe("assessment domain — issueCertificate", () => {
  const base = {
    certificateNo: "CERT-2026-001",
    verifyToken: "tok-abc-123",
    issuedAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("sets validUntil when validityMonths is provided", () => {
    const cert = issueCertificate({}, {}, { ...base, validityMonths: 12 });
    expect(cert.certificateNo).toBe("CERT-2026-001");
    expect(cert.verifyToken).toBe("tok-abc-123");
    expect(cert.validUntil).not.toBeNull();
    // 12 months after 2026-01-01 = 2027-01-01
    expect(cert.validUntil!.getFullYear()).toBe(2027);
  });

  it("sets validUntil to null when validityMonths is null", () => {
    const cert = issueCertificate({}, {}, { ...base, validityMonths: null });
    expect(cert.validUntil).toBeNull();
  });

  it("sets validUntil to null when validityMonths is undefined", () => {
    const cert = issueCertificate({}, {}, base);
    expect(cert.validUntil).toBeNull();
  });

  it("sets validUntil to null when validityMonths is 0", () => {
    const cert = issueCertificate({}, {}, { ...base, validityMonths: 0 });
    expect(cert.validUntil).toBeNull();
  });
});

describe("assessment domain — evaluateCertificateStatus", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("returns 'revoked' regardless of dates when status is revoked", () => {
    const status = evaluateCertificateStatus(
      { status: "revoked", validUntil: new Date("2030-01-01") },
      now,
    );
    expect(status).toBe("revoked");
  });

  it("returns 'expired' when validUntil is in the past", () => {
    const status = evaluateCertificateStatus(
      { status: "active", validUntil: new Date("2025-01-01") },
      now,
    );
    expect(status).toBe("expired");
  });

  it("returns 'active' when validUntil is in the future", () => {
    const status = evaluateCertificateStatus(
      { status: "active", validUntil: new Date("2027-01-01") },
      now,
    );
    expect(status).toBe("active");
  });

  it("returns 'active' when validUntil is null (no expiry)", () => {
    const status = evaluateCertificateStatus({ status: "active", validUntil: null }, now);
    expect(status).toBe("active");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// apprentice-stipend/domain
// ──────────────────────────────────────────────────────────────────────────────
import {
  applyBps as applyBpsStipend,
  prorate,
  computeStipend,
} from "../modules/apprentice-stipend/domain.js";

describe("apprentice-stipend domain — applyBps", () => {
  it("computes 25% of 100,000 paise = 25,000", () => {
    expect(applyBpsStipend(100_000n, 2500)).toBe(25000n);
  });

  it("returns 0 when bps is 0", () => {
    expect(applyBpsStipend(100_000n, 0)).toBe(0n);
  });

  it("returns 0 when value is 0", () => {
    expect(applyBpsStipend(0n, 2500)).toBe(0n);
  });

  it("returns 0 when bps is negative", () => {
    expect(applyBpsStipend(100_000n, -100)).toBe(0n);
  });
});

describe("apprentice-stipend domain — prorate", () => {
  it("returns full stipend when daysPresent equals workingDays", () => {
    expect(prorate(300_000n, 26, 26)).toBe(300_000n);
  });

  it("returns full stipend when daysPresent exceeds workingDays", () => {
    expect(prorate(300_000n, 30, 26)).toBe(300_000n);
  });

  it("returns 0 when daysPresent is 0", () => {
    expect(prorate(300_000n, 0, 26)).toBe(0n);
  });

  it("returns 0 when workingDays is 0", () => {
    expect(prorate(300_000n, 10, 0)).toBe(0n);
  });

  it("computes proportional stipend for partial month", () => {
    // 13/26 of 300,000 = 150,000
    const result = prorate(300_000n, 13, 26);
    expect(result).toBe(150_000n);
  });
});

describe("apprentice-stipend domain — computeStipend", () => {
  it("computes gross, NAPS reimbursement, and employer cost", () => {
    const result = computeStipend({
      monthlyStipendMinor: 1_000_000n,  // ₹10,000
      workingDays: 25,
      daysPresent: 25,
      napsReimbPctBps: 2500,            // 25%
      napsReimbCapMinor: 150_000n,      // ₹1,500
    });
    expect(result.grossStipendMinor).toBe(1_000_000n);
    // 25% of 1,000,000 = 250,000; capped at 150,000
    expect(result.napsReimbMinor).toBe(150_000n);
    expect(result.employerCostMinor).toBe(850_000n);
  });

  it("NAPS reimbursement not capped when below cap", () => {
    const result = computeStipend({
      monthlyStipendMinor: 400_000n,   // ₹4,000
      workingDays: 26,
      daysPresent: 26,
      napsReimbPctBps: 2500,           // 25% = 100,000 paise = ₹1,000 (< cap ₹1,500)
      napsReimbCapMinor: 150_000n,
    });
    expect(result.napsReimbMinor).toBe(100_000n); // uncapped
    expect(result.employerCostMinor).toBe(300_000n);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// consultant-invoice/domain
// ──────────────────────────────────────────────────────────────────────────────
import {
  applyBps as applyBpsInvoice,
  computeInvoiceTax,
} from "../modules/consultant-invoice/domain.js";

describe("consultant-invoice domain — applyBps", () => {
  it("computes 18% GST on 500,000 paise = 90,000", () => {
    expect(applyBpsInvoice(500_000n, 1800)).toBe(90_000n);
  });

  it("returns 0 for zero amount", () => {
    expect(applyBpsInvoice(0n, 1800)).toBe(0n);
  });
});

describe("consultant-invoice domain — computeInvoiceTax", () => {
  const base = {
    grossMinor: 1_000_000n,          // ₹10,000
    gstApplicable: true,
    gstRateBps: 1800,                // 18%
    tdsRateBps: 1000,                // 10% (194J)
    tdsThresholdMinor: 3_000_000n,   // ₹30,000
    ytdGrossMinor: 0n,
  };

  it("applies GST but not TDS when below threshold", () => {
    const result = computeInvoiceTax({ ...base, ytdGrossMinor: 0n, grossMinor: 500_000n });
    expect(result.gstMinor).toBe(90_000n);  // 18% of 500,000
    expect(result.tdsMinor).toBe(0n);       // 500,000 < 3,000,000 threshold
    expect(result.tdsApplied).toBe(false);
    expect(result.netPayableMinor).toBe(590_000n);
  });

  it("applies both GST and TDS when threshold crossed", () => {
    const result = computeInvoiceTax({ ...base, ytdGrossMinor: 2_500_000n });
    // 2,500,000 YTD + 1,000,000 this invoice = 3,500,000 >= 3,000,000 threshold
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsMinor).toBe(100_000n);  // 10% of 1,000,000
    expect(result.gstMinor).toBe(180_000n);  // 18% of 1,000,000
    expect(result.netPayableMinor).toBe(1_080_000n); // 1,000,000 + 180,000 - 100,000
  });

  it("applies TDS when single invoice alone crosses threshold", () => {
    const result = computeInvoiceTax({ ...base, ytdGrossMinor: 0n, grossMinor: 3_000_000n });
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsMinor).toBe(300_000n);  // 10% of 3,000,000
  });

  it("skips GST when gstApplicable is false", () => {
    const result = computeInvoiceTax({ ...base, gstApplicable: false, ytdGrossMinor: 0n, grossMinor: 500_000n });
    expect(result.gstMinor).toBe(0n);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// contractor-bill/domain
// ──────────────────────────────────────────────────────────────────────────────
import {
  applyBps as applyBpsBill,
  tds194cRateBps,
  computeContractTax,
} from "../modules/contractor-bill/domain.js";

describe("contractor-bill domain — applyBps", () => {
  it("computes 2% of 1,000,000 paise = 20,000", () => {
    expect(applyBpsBill(1_000_000n, 200)).toBe(20_000n);
  });
});

describe("contractor-bill domain — tds194cRateBps", () => {
  it("returns 100 bps (1%) for individual_huf", () => {
    expect(tds194cRateBps("individual_huf")).toBe(100);
  });

  it("returns 200 bps (2%) for other entity types", () => {
    expect(tds194cRateBps("other")).toBe(200);
  });
});

describe("contractor-bill domain — computeContractTax", () => {
  const base = {
    grossMinor: 1_000_000n,
    gstApplicable: true,
    gstRateBps: 1800,
    contractorKind: "other" as const,
    singleThresholdMinor: 3_000_000n,  // ₹30,000
    annualThresholdMinor: 10_000_000n, // ₹1,00,000
    ytdGrossMinor: 0n,
  };

  it("applies GST but not TDS when below both thresholds", () => {
    const result = computeContractTax({ ...base, grossMinor: 1_000_000n, ytdGrossMinor: 0n });
    // 1,000,000 < 3,000,000 single threshold; 1,000,000 < 10,000,000 annual threshold
    expect(result.tdsApplied).toBe(false);
    expect(result.tdsMinor).toBe(0n);
    expect(result.gstMinor).toBe(180_000n);  // 18%
  });

  it("applies TDS when single bill threshold triggered (>=30k)", () => {
    const result = computeContractTax({ ...base, grossMinor: 3_000_000n });
    expect(result.tdsApplied).toBe(true);
    expect(result.tdsRateBps).toBe(200); // 'other' entity
    expect(result.tdsMinor).toBe(60_000n); // 2% of 3,000,000
  });

  it("applies TDS when annual threshold triggered", () => {
    const result = computeContractTax({ ...base, ytdGrossMinor: 9_500_000n, grossMinor: 1_000_000n });
    // 9,500,000 + 1,000,000 = 10,500,000 >= 10,000,000 annual threshold
    expect(result.tdsApplied).toBe(true);
  });

  it("uses 1% (100 bps) TDS for individual_huf", () => {
    const result = computeContractTax({
      ...base,
      contractorKind: "individual_huf",
      grossMinor: 3_000_000n,
    });
    expect(result.tdsRateBps).toBe(100);
    expect(result.tdsMinor).toBe(30_000n); // 1% of 3,000,000
  });

  it("skips GST when gstApplicable is false", () => {
    const result = computeContractTax({ ...base, gstApplicable: false, grossMinor: 3_000_000n });
    expect(result.gstMinor).toBe(0n);
  });
});

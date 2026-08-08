/**
 * Billing domain tests — e-MB finalization sequence, bill finalization sequence,
 * quantity-exceeds-BoQ check, net payable calculation, step validation.
 */
import { describe, it, expect } from "vitest";
import {
  eMbFinalizationSequence,
  billFinalizationSequence,
  canCreateBill,
  billedQuantityExceedsBoq,
  billAmountExceedsAward,
  calculateNetPayable,
  isValidNextStep,
} from "../src/modules/billing/domain.js";

describe("eMbFinalizationSequence", () => {
  it("returns correct sequence: SO → SDO → Estimator → DO", () => {
    const seq = eMbFinalizationSequence();
    expect(seq).toEqual(["so_finalized", "sdo_finalized", "estimator_finalized", "do_finalized"]);
  });

  it("has exactly 4 steps", () => {
    expect(eMbFinalizationSequence()).toHaveLength(4);
  });
});

describe("billFinalizationSequence", () => {
  it("returns correct sequence: SO → SDO → Auditor → DAO → DO", () => {
    const seq = billFinalizationSequence();
    expect(seq).toEqual(["so_finalized", "sdo_finalized", "auditor_finalized", "dao_finalized", "do_finalized"]);
  });

  it("has exactly 5 steps", () => {
    expect(billFinalizationSequence()).toHaveLength(5);
  });
});

describe("canCreateBill", () => {
  it("allows bill creation when MB is do_finalized", () => {
    expect(canCreateBill("do_finalized")).toBe(true);
  });

  it("blocks bill creation when MB is in draft", () => {
    expect(canCreateBill("draft")).toBe(false);
  });

  it("blocks bill creation when MB is partially finalized", () => {
    expect(canCreateBill("so_finalized")).toBe(false);
    expect(canCreateBill("sdo_finalized")).toBe(false);
    expect(canCreateBill("estimator_finalized")).toBe(false);
  });
});

describe("billedQuantityExceedsBoq (FR-BIL-011)", () => {
  it("returns false when billed equals approved", () => {
    expect(billedQuantityExceedsBoq(100, 100)).toBe(false);
  });

  it("returns false when billed is below approved", () => {
    expect(billedQuantityExceedsBoq(50, 100)).toBe(false);
  });

  it("returns true when billed exceeds approved", () => {
    expect(billedQuantityExceedsBoq(101, 100)).toBe(true);
  });

  it("handles decimal quantities", () => {
    expect(billedQuantityExceedsBoq(100.001, 100)).toBe(true);
    expect(billedQuantityExceedsBoq(99.999, 100)).toBe(false);
  });

  it("handles zero", () => {
    expect(billedQuantityExceedsBoq(0, 0)).toBe(false);
    expect(billedQuantityExceedsBoq(1, 0)).toBe(true);
  });
});

describe("billAmountExceedsAward (FR-BIL-012)", () => {
  it("allows cumulative gross equal to award ceiling", () => {
    expect(billAmountExceedsAward(500000n, 500000n, 1000000n)).toBe(false);
  });

  it("rejects cumulative gross above award ceiling", () => {
    expect(billAmountExceedsAward(900000n, 200000n, 1000000n)).toBe(true);
  });
});

describe("calculateNetPayable", () => {
  it("calculates gross - deductions", () => {
    expect(calculateNetPayable(100_000n, 10_000n)).toBe(90_000n);
  });

  it("handles zero deductions", () => {
    expect(calculateNetPayable(500_000n, 0n)).toBe(500_000n);
  });

  it("handles large amounts (bigint safety)", () => {
    const gross = 99_99_99_999_99n; // ~100 crore in paise
    const deductions = 1_00_00_000_00n; // 1 crore
    expect(calculateNetPayable(gross, deductions)).toBe(98_99_99_999_99n);
  });

  it("allows negative result (overpayment recovery)", () => {
    expect(calculateNetPayable(100n, 200n)).toBe(-100n);
  });
});

describe("isValidNextStep", () => {
  const mbSeq = eMbFinalizationSequence();
  const billSeq = billFinalizationSequence();

  it("draft → first step is valid", () => {
    expect(isValidNextStep("draft", "so_finalized", mbSeq)).toBe(true);
    expect(isValidNextStep("draft", "so_finalized", billSeq)).toBe(true);
  });

  it("draft → wrong first step is invalid", () => {
    expect(isValidNextStep("draft", "sdo_finalized", mbSeq)).toBe(false);
    expect(isValidNextStep("draft", "do_finalized", mbSeq)).toBe(false);
  });

  it("so_finalized → sdo_finalized is valid", () => {
    expect(isValidNextStep("so_finalized", "sdo_finalized", mbSeq)).toBe(true);
  });

  it("so_finalized → estimator_finalized (skipping step) is invalid", () => {
    expect(isValidNextStep("so_finalized", "estimator_finalized", mbSeq)).toBe(false);
  });

  it("estimator_finalized → do_finalized is valid for MB", () => {
    expect(isValidNextStep("estimator_finalized", "do_finalized", mbSeq)).toBe(true);
  });

  it("sdo_finalized → auditor_finalized is valid for bill", () => {
    expect(isValidNextStep("sdo_finalized", "auditor_finalized", billSeq)).toBe(true);
  });

  it("auditor_finalized → dao_finalized is valid for bill", () => {
    expect(isValidNextStep("auditor_finalized", "dao_finalized", billSeq)).toBe(true);
  });

  it("dao_finalized → do_finalized is valid for bill", () => {
    expect(isValidNextStep("dao_finalized", "do_finalized", billSeq)).toBe(true);
  });

  it("unknown current status is invalid", () => {
    expect(isValidNextStep("unknown", "so_finalized", mbSeq)).toBe(false);
  });
});

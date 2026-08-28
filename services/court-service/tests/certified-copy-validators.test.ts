/**
 * certified-copy validators — payment-proof + rejection-reason enforcement (§30
 * integrity). transitionCopyBody must reject a fee_paid transition that carries
 * no paymentRef and/or no receiptMinor, and must reject a `rejected` transition
 * that carries no remarks — BEFORE the command ever reaches the bus.
 */
import { describe, it, expect } from "vitest";
import { transitionCopyBody } from "../src/modules/certified-copy/validators.js";

const base = { expectedVersion: 1 } as const;

describe("transitionCopyBody — payment proof required for fee_paid", () => {
  it("rejects fee_paid with neither paymentRef nor receiptMinor", () => {
    const result = transitionCopyBody.safeParse({ target: "fee_paid", ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("paymentRef");
      expect(paths).toContain("receiptMinor");
    }
  });

  it("rejects fee_paid with only paymentRef (no receiptMinor)", () => {
    const result = transitionCopyBody.safeParse({ target: "fee_paid", paymentRef: "CHALLAN-1", ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("receiptMinor");
      expect(paths).not.toContain("paymentRef");
    }
  });

  it("rejects fee_paid with only receiptMinor (no paymentRef)", () => {
    const result = transitionCopyBody.safeParse({ target: "fee_paid", receiptMinor: 1500, ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("paymentRef");
    }
  });

  it("accepts fee_paid with both paymentRef and receiptMinor", () => {
    const result = transitionCopyBody.safeParse({
      target: "fee_paid",
      paymentRef: "CHALLAN-1",
      receiptMinor: 1500,
      ...base,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a receiptMinor supplied as a numeric string", () => {
    const result = transitionCopyBody.safeParse({
      target: "fee_paid",
      paymentRef: "CHALLAN-1",
      receiptMinor: "1500",
      ...base,
    });
    expect(result.success).toBe(true);
  });

  it("does NOT require payment proof for non-fee_paid targets", () => {
    expect(transitionCopyBody.safeParse({ target: "rejected", remarks: "Missing documents", ...base }).success).toBe(true);
    expect(transitionCopyBody.safeParse({ target: "prepared", ...base }).success).toBe(true);
    expect(transitionCopyBody.safeParse({ target: "issued", ...base }).success).toBe(true);
  });
});

describe("transitionCopyBody — a reason is required to reject a certified copy", () => {
  it("rejects target 'rejected' with no remarks", () => {
    const result = transitionCopyBody.safeParse({ target: "rejected", ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("remarks");
    }
  });

  it("rejects target 'rejected' with whitespace-only remarks", () => {
    const result = transitionCopyBody.safeParse({ target: "rejected", remarks: "   ", ...base });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("remarks");
    }
  });

  it("accepts target 'rejected' with a non-empty remarks", () => {
    const result = transitionCopyBody.safeParse({ target: "rejected", remarks: "Missing supporting documents", ...base });
    expect(result.success).toBe(true);
  });

  it("does NOT require remarks for targets other than 'rejected'", () => {
    expect(transitionCopyBody.safeParse({ target: "prepared", ...base }).success).toBe(true);
    expect(transitionCopyBody.safeParse({ target: "issued", ...base }).success).toBe(true);
    expect(
      transitionCopyBody.safeParse({ target: "fee_paid", paymentRef: "CHALLAN-1", receiptMinor: 1500, ...base })
        .success,
    ).toBe(true);
  });
});

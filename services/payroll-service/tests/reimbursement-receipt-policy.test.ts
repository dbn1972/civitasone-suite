import { describe, it, expect } from "vitest";
import {
  defaultReceiptRule, effectiveReceiptRule, evaluateReceiptRule, describeReceiptRule, receiptPolicyIssue,
  REIMBURSEMENT_CATEGORY_CODES, type ReceiptPolicy,
} from "@civitasone/types";
import { receiptRuleViolation } from "../src/modules/payroll/fin03-domain.js";

const policy = (categories: ReceiptPolicy["categories"]): ReceiptPolicy => ({ categories });

describe("receipt policy: default parity (today's behaviour)", () => {
  it("medical, lta and travel need a receipt; every other category does not; amount is irrelevant", () => {
    for (const c of REIMBURSEMENT_CATEGORY_CODES) {
      const needs = ["medical", "lta", "travel"].includes(c);
      for (const amount of [1, 100, 10_000_000]) {
        for (const p of [null, undefined, policy({})]) {
          const d = evaluateReceiptRule(p, c, amount, 0, false);
          expect(d.ok, `${c} ${amount}`).toBe(!needs);
          // a self-declaration never substitutes under the default
          expect(evaluateReceiptRule(p, c, amount, 0, true).ok, `${c} ${amount} selfdecl`).toBe(!needs);
        }
      }
      expect(evaluateReceiptRule(null, c, 500, 1, false)).toMatchObject({ ok: true, basis: "receipt" });
      if (!needs) expect(evaluateReceiptRule(null, c, 500, 0, false)).toMatchObject({ ok: true, basis: "not_required" });
    }
  });

  it("the legacy 4-argument receiptRuleViolation is unchanged", () => {
    expect(receiptRuleViolation("t", "a", "medical", undefined)).toBe("RECEIPT_REQUIRED");
    expect(receiptRuleViolation("t", "a", "lta", [])).toBe("RECEIPT_REQUIRED");
    expect(receiptRuleViolation("t", "a", "travel", [])).toBe("RECEIPT_REQUIRED");
    expect(receiptRuleViolation("t", "a", "food", undefined)).toBeNull();
    expect(receiptRuleViolation("t", "a", "medical", ["payroll/t/reimbursements/a/u/x.pdf"])).toBeNull();
    expect(receiptRuleViolation("t", "a", "medical", ["payroll/other/reimbursements/a/u/x.pdf"])).toBe("RECEIPT_KEY_INVALID");
  });
});

describe("receipt policy: modes", () => {
  it("always / never override the default in both directions", () => {
    const p = policy({ food: { mode: "always" }, medical: { mode: "never" } });
    expect(evaluateReceiptRule(p, "food", 100, 0, false).ok).toBe(false);
    expect(evaluateReceiptRule(p, "food", 100, 1, false).ok).toBe(true);
    expect(evaluateReceiptRule(p, "medical", 9_999_999, 0, false)).toMatchObject({ ok: true, basis: "not_required" });
    // unlisted categories keep their default
    expect(evaluateReceiptRule(p, "lta", 100, 0, false).ok).toBe(false);
    expect(evaluateReceiptRule(p, "fuel", 100, 0, false).ok).toBe(true);
  });

  it("above_amount: a receipt is needed strictly above the threshold (edges)", () => {
    const p = policy({ travel: { mode: "above_amount", thresholdMinor: 500_000 } });
    expect(evaluateReceiptRule(p, "travel", 499_999, 0, false)).toMatchObject({ ok: true, basis: "not_required" });
    expect(evaluateReceiptRule(p, "travel", 500_000, 0, false)).toMatchObject({ ok: true, basis: "not_required" });
    expect(evaluateReceiptRule(p, "travel", 500_001, 0, false).ok).toBe(false);
    expect(evaluateReceiptRule(p, "travel", 500_001, 1, false)).toMatchObject({ ok: true, basis: "receipt" });
  });

  it("self-declaration substitutes for the receipt up to and including its limit, not above, and only when asserted", () => {
    const p = policy({ lta: { mode: "always", selfDeclarationUpToMinor: 200_000 } });
    expect(evaluateReceiptRule(p, "lta", 200_000, 0, true)).toMatchObject({ ok: true, basis: "self_declaration" });
    expect(evaluateReceiptRule(p, "lta", 200_001, 0, true)).toMatchObject({ ok: false, selfDeclarationAllowed: false });
    expect(evaluateReceiptRule(p, "lta", 200_000, 0, false)).toMatchObject({ ok: false, selfDeclarationAllowed: true });
    // a receipt beats a self-declaration
    expect(evaluateReceiptRule(p, "lta", 100, 1, true)).toMatchObject({ ok: true, basis: "receipt" });
  });

  it("above_amount + self-declaration: receipt-free to the threshold, self-declaration to its limit, receipt beyond", () => {
    const p = policy({ medical: { mode: "above_amount", thresholdMinor: 100_000, selfDeclarationUpToMinor: 300_000 } });
    expect(evaluateReceiptRule(p, "medical", 100_000, 0, false)).toMatchObject({ ok: true, basis: "not_required" });
    expect(evaluateReceiptRule(p, "medical", 100_001, 0, false).ok).toBe(false);
    expect(evaluateReceiptRule(p, "medical", 300_000, 0, true)).toMatchObject({ ok: true, basis: "self_declaration" });
    expect(evaluateReceiptRule(p, "medical", 300_001, 0, true).ok).toBe(false);
  });

  it("a self-declaration is ignored when no receipt is required", () => {
    expect(evaluateReceiptRule(policy({ food: { mode: "never" } }), "food", 100, 0, true)).toMatchObject({ ok: true, basis: "not_required" });
  });

  it("receiptRuleViolation honours the policy, amount and self-declaration", () => {
    const p = policy({ lta: { mode: "always", selfDeclarationUpToMinor: 200_000 } });
    expect(receiptRuleViolation("t", "a", "lta", [], { policy: p, amountMinor: 200_000, selfDeclared: true })).toBeNull();
    expect(receiptRuleViolation("t", "a", "lta", [], { policy: p, amountMinor: 200_001, selfDeclared: true })).toBe("RECEIPT_REQUIRED");
  });
});

describe("receipt policy: description and validation", () => {
  it("describes the rule that applied", () => {
    expect(describeReceiptRule(defaultReceiptRule("medical"))).toMatch(/every claim/);
    expect(describeReceiptRule(defaultReceiptRule("food"))).toMatch(/no receipt is required/);
    expect(describeReceiptRule({ mode: "above_amount", thresholdMinor: 500_000 })).toContain("above Rs 5,000.00");
    expect(describeReceiptRule({ mode: "always", selfDeclarationUpToMinor: 200_000 })).toContain("self-declaration");
    expect(effectiveReceiptRule(null, "travel")).toEqual({ mode: "always" });
  });

  it("rejects incoherent policies", () => {
    expect(receiptPolicyIssue(policy({ food: { mode: "above_amount" } }))?.path).toBe("categories.food.thresholdMinor");
    expect(receiptPolicyIssue(policy({ food: { mode: "above_amount", thresholdMinor: 0 } }))).not.toBeNull();
    expect(receiptPolicyIssue(policy({ food: { mode: "always", thresholdMinor: 5 } }))).not.toBeNull();
    expect(receiptPolicyIssue(policy({ food: { mode: "never", selfDeclarationUpToMinor: 5 } }))).not.toBeNull();
    expect(receiptPolicyIssue(policy({ food: { mode: "above_amount", thresholdMinor: 500, selfDeclarationUpToMinor: 500 } }))).not.toBeNull();
    expect(receiptPolicyIssue(policy({ nonsense: { mode: "always" } }))).not.toBeNull();
    expect(receiptPolicyIssue(policy({}))).toBeNull();
    expect(receiptPolicyIssue(policy({ food: { mode: "above_amount", thresholdMinor: 500, selfDeclarationUpToMinor: 900 }, lta: { mode: "always", selfDeclarationUpToMinor: 1 } }))).toBeNull();
  });
});

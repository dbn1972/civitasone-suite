import { describe, it, expect } from "vitest";
import { isDecisionConsumed, DECISION_CONSUMED_REF_TYPES, MODULE_CALLBACK_TOPICS, SOURCE_REF_TYPES } from "./index.js";

/**
 * R21 — only source types with a working decision consumer may be raised.
 * `isDecisionConsumed` is the allowlist the estab linkage raise path enforces.
 */
describe("decision-consumed ref types (R21)", () => {
  it("recognises consumed types", () => {
    for (const t of ["finance_sanction", "finance_payment", "procurement_po", "hr_disciplinary", "grant_disbursement", "asset_disposal", "legal_opinion", "contract_award"]) {
      expect(isDecisionConsumed(t)).toBe(true);
    }
  });

  it("flags the orphaned types as not-consumed", () => {
    for (const t of ["procurement_award", "grant_scheme", "hr_leave_special", "hr_recruitment"]) {
      expect(isDecisionConsumed(t)).toBe(false);
    }
  });

  it("every consumed type has a callback topic", () => {
    for (const t of DECISION_CONSUMED_REF_TYPES) {
      expect(MODULE_CALLBACK_TOPICS[t]).toBeTruthy();
    }
  });

  it("every consumed type is a valid source ref type", () => {
    for (const t of DECISION_CONSUMED_REF_TYPES) {
      expect(SOURCE_REF_TYPES).toContain(t);
    }
  });

  it("unknown strings are not consumed", () => {
    expect(isDecisionConsumed("totally_made_up")).toBe(false);
  });
});

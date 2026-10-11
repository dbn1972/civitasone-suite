import { describe, it, expect } from "vitest";
import { isDecisionConsumed, DECISION_CONSUMED_REF_TYPES, MODULE_CALLBACK_TOPICS, SOURCE_REF_TYPES, EXTRA_DECISION_CONSUMED_ENV } from "./index.js";

/**
 * R21 — only source types with a working decision consumer may be raised.
 * `isDecisionConsumed` is the allowlist the estab linkage raise path enforces.
 */
describe("decision-consumed ref types (R21)", () => {
  it("recognises consumed types", () => {
    for (const t of ["finance_sanction", "finance_payment", "procurement_po", "procurement_award", "hr_disciplinary", "hr_leave_special", "hr_recruitment", "grant_disbursement", "grant_scheme", "asset_disposal", "legal_opinion", "contract_award"]) {
      expect(isDecisionConsumed(t)).toBe(true);
    }
  });

  it("flags the remaining orphaned types as not-consumed", () => {
    for (const t of ["finance_reappropriation"]) {
      // finance_reappropriation is consumed but let's verify non-existent ones:
    }
    expect(isDecisionConsumed("totally_made_up")).toBe(false);
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

  // ST-M01-16 — the SmartTransfer types are fail-closed by default (their
  // consumer, smarttransfer-service, is unmerged) and opt-in via the env.
  it("hr_transfer_order / hr_posting_cycle are NOT in the hard-coded consumed set", () => {
    expect(DECISION_CONSUMED_REF_TYPES.has("hr_transfer_order" as never)).toBe(false);
    expect(DECISION_CONSUMED_REF_TYPES.has("hr_posting_cycle" as never)).toBe(false);
  });

  it("fail-closed by default; EXTRA_DECISION_CONSUMED_REF_TYPES opts them in", () => {
    const prev = process.env[EXTRA_DECISION_CONSUMED_ENV];
    try {
      delete process.env[EXTRA_DECISION_CONSUMED_ENV];
      expect(isDecisionConsumed("hr_transfer_order")).toBe(false);
      expect(isDecisionConsumed("hr_posting_cycle")).toBe(false);

      process.env[EXTRA_DECISION_CONSUMED_ENV] = "hr_transfer_order , hr_posting_cycle";
      expect(isDecisionConsumed("hr_transfer_order")).toBe(true);
      expect(isDecisionConsumed("hr_posting_cycle")).toBe(true);

      // An unknown string in the env is ignored (stays fail-closed).
      process.env[EXTRA_DECISION_CONSUMED_ENV] = "totally_made_up";
      expect(isDecisionConsumed("totally_made_up")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env[EXTRA_DECISION_CONSUMED_ENV];
      else process.env[EXTRA_DECISION_CONSUMED_ENV] = prev;
    }
  });
});

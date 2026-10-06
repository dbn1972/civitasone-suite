/**
 * GAP-GRANTS-DETAIL-05: the UC list read model must reflect the VALIDATION
 * decision (validation_status: "validated"/"rejected"), not just the lifecycle
 * `status` column — otherwise a UC an officer just verified on the grant-detail
 * page is undercounted on /grants/utilization.
 *
 * GAP-GRANTS-DETAIL-03: the disburse body must accept a `reason` field distinct
 * from the opaque `beneficiaryBankRef` so the audit reason is never written to
 * the PFMS payee reference.
 */
import { describe, it, expect } from "vitest";
import { resolveUcWebStatus } from "../src/modules/utilisation/queries.js";
import { disburseBody } from "../src/modules/disbursement/validators.js";
import { approveApplicationBody } from "../src/modules/application/validators.js";

describe("resolveUcWebStatus (GAP-GRANTS-DETAIL-05)", () => {
  it("maps a validated UC to verified even when lifecycle status is still submitted", () => {
    expect(resolveUcWebStatus("submitted", "validated")).toBe("verified");
  });

  it("maps a rejected validation to rejected", () => {
    expect(resolveUcWebStatus("submitted", "rejected")).toBe("rejected");
  });

  it("falls back to the lifecycle status when no validation decision has been made", () => {
    expect(resolveUcWebStatus("submitted", "pending")).toBe("submitted");
    expect(resolveUcWebStatus("pending", "pending")).toBe("pending");
  });

  it("still honours a lifecycle 'verified' value", () => {
    expect(resolveUcWebStatus("verified", "pending")).toBe("verified");
  });
});

describe("disburseBody (GAP-GRANTS-DETAIL-03)", () => {
  it("accepts a reason distinct from beneficiaryBankRef", () => {
    const parsed = disburseBody.parse({ mode: "PFMS", reason: "Sanctioned per GO 441" });
    expect(parsed.reason).toBe("Sanctioned per GO 441");
    expect(parsed.beneficiaryBankRef).toBeUndefined();
  });

  it("still accepts an opaque beneficiaryBankRef when supplied separately", () => {
    const parsed = disburseBody.parse({ mode: "PFMS", beneficiaryBankRef: "grant_bank_accounts:abc", reason: "x" });
    expect(parsed.beneficiaryBankRef).toBe("grant_bank_accounts:abc");
    expect(parsed.reason).toBe("x");
  });

  it("rejects an empty reason (trimmed, min 1)", () => {
    expect(() => disburseBody.parse({ mode: "PFMS", reason: "   " })).toThrow();
  });
});

describe("approveApplicationBody (GAP-GRANTS-APPLICATIONS-DETAIL-04/02)", () => {
  it("accepts an optional sanction reason alongside the amount", () => {
    const parsed = approveApplicationBody.parse({ amountApprovedMinor: 5000000, reason: "Within scheme ceiling" });
    expect(parsed.amountApprovedMinor).toBe(5000000);
    expect(parsed.reason).toBe("Within scheme ceiling");
  });

  it("still accepts an amount with no reason (reason is optional)", () => {
    const parsed = approveApplicationBody.parse({ amountApprovedMinor: 5000000 });
    expect(parsed.reason).toBeUndefined();
  });

  it("rejects a non-positive amount", () => {
    expect(() => approveApplicationBody.parse({ amountApprovedMinor: 0 })).toThrow();
  });
});

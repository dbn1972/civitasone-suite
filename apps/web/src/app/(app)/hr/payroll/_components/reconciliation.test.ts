import { describe, it, expect } from "vitest";
import { reconciliationKey, countNeedingAttention } from "./reconciliation";

describe("reconciliationKey (GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02)", () => {
  it("maps every verdict to its own key", () => {
    expect(reconciliationKey({ status: "match" })).toBe("reconcileMatch");
    expect(reconciliationKey({ status: "mismatch" })).toBe("reconcileMismatch");
    expect(reconciliationKey({ status: "no_hrms_account" })).toBe("reconcileNoHrmsAccount");
    expect(reconciliationKey({ status: "hrms_unavailable" })).toBe("reconcileHrmsUnavailable");
  });
  it("treats a missing verdict (older server) as not checked, never as a match", () => {
    expect(reconciliationKey(undefined)).toBe("reconcileHrmsUnavailable");
    expect(reconciliationKey(null)).toBe("reconcileHrmsUnavailable");
  });
});

describe("countNeedingAttention", () => {
  it("counts only mismatch and no_hrms_account rows", () => {
    expect(countNeedingAttention([
      { reconciliation: { status: "match" } },
      { reconciliation: { status: "mismatch" } },
      { reconciliation: { status: "no_hrms_account" } },
      { reconciliation: { status: "hrms_unavailable" } },
      {},
    ])).toBe(2);
  });
});

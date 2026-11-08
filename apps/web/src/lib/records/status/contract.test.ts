import { describe, it, expect } from "vitest";
import { CONTRACT_STATUS_RULE, contractAllowedActions, contractLockedReason } from "./contract";
import { canRaiseForApproval } from "../statusActions";

describe("contract status rules (mirror contract-service VALID_TRANSITIONS)", () => {
  it("a terminated or closed contract allows nothing", () => {
    for (const s of ["terminated", "closed", "TERMINATED"]) {
      expect([...contractAllowedActions(s)]).toEqual([]);
      expect(contractLockedReason(s)).toMatch(/can no longer be changed/);
    }
  });

  it("only a draft may be raised for approval (submit-approval is draft -> pending_approval)", () => {
    expect(canRaiseForApproval(CONTRACT_STATUS_RULE, "draft")).toBe(true);
    for (const s of ["pending_approval", "approved", "active", "closed", "terminated"]) {
      expect(canRaiseForApproval(CONTRACT_STATUS_RULE, s)).toBe(false);
    }
  });

  it("bonds only on approved / active contracts", () => {
    expect(contractAllowedActions("approved").has("registerBond")).toBe(true);
    expect(contractAllowedActions("active").has("registerBond")).toBe(true);
    expect(contractAllowedActions("draft").has("registerBond")).toBe(false);
  });

  it("open contracts keep milestone and obligation work", () => {
    for (const s of ["draft", "pending_approval", "approved", "active"]) {
      const a = contractAllowedActions(s);
      expect(a.has("completeMilestone") && a.has("markMilestoneLate") && a.has("addObligation")).toBe(true);
      expect(contractLockedReason(s)).toBeNull();
    }
  });
});

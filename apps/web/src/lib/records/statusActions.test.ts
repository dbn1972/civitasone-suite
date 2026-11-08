import { describe, it, expect } from "vitest";
import { canRaiseForApproval, isAwaitingDecision, isTerminalStatus, normStatus, outcomeLine, raiseBlockedReason, type StatusRule } from "./statusActions";

const RULE: StatusRule = { terminal: ["approved", "rejected", "terminated", "dropped"], awaiting: ["pending_approval"] };

describe("records/statusActions (DS-3)", () => {
  it("normalises status spellings", () => {
    expect(normStatus(" Pending Approval ")).toBe("pending_approval");
    expect(normStatus("pending-approval")).toBe("pending_approval");
    expect(normStatus(null)).toBe("");
  });

  it("no Raise for approval on terminal or in-flight records", () => {
    for (const s of ["approved", "Rejected", "terminated", "DROPPED", "pending_approval", ""]) expect(canRaiseForApproval(RULE, s)).toBe(false);
    expect(canRaiseForApproval(RULE, "draft")).toBe(true);
  });

  it("an explicit raisable list wins", () => {
    const only: StatusRule = { terminal: ["closed"], raisable: ["draft"] };
    expect(canRaiseForApproval(only, "draft")).toBe(true);
    expect(canRaiseForApproval(only, "active")).toBe(false);
  });

  it("terminal / awaiting helpers", () => {
    expect(isTerminalStatus(RULE, "Approved")).toBe(true);
    expect(isAwaitingDecision(RULE, "Pending Approval")).toBe(true);
  });

  it("outcome line names who and when, and leaves out unknown parts", () => {
    expect(outcomeLine({ status: "approved", by: "N. Gupta, DDO", at: "2026-10-30" })).toBe("Approved by N. Gupta, DDO on 30 Oct 2026.");
    expect(outcomeLine({ status: "terminated" })).toBe("Terminated.");
    expect(outcomeLine({ status: "dropped", by: "—" })).toBe("Dropped.");
  });

  it("explains why the approval action is unavailable", () => {
    expect(raiseBlockedReason(RULE, "draft")).toBeNull();
    expect(raiseBlockedReason(RULE, "pending_approval", "Pending approval")).toBe("This record is already awaiting a decision (Pending approval).");
    expect(raiseBlockedReason(RULE, "approved", "Approved")).toBe("No approval can be raised for a record that is Approved.");
  });
});

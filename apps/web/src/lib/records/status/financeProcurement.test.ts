import { describe, it, expect } from "vitest";
import { canRaiseForApproval, isTerminalStatus, isAwaitingDecision, raiseBlockedReason } from "../statusActions";
import { SANCTION_STATUS_RULE } from "./sanction";
import { BILL_STATUS_RULE, BILL_PASSABLE, BILL_PAYABLE } from "./bill";
import { INDENT_STATUS_RULE } from "./indent";
import { PO_STATUS_RULE, PO_AMENDABLE } from "./po";

describe("sanction status rule (finance-service budget/domain)", () => {
  it("only a pending sanction can be raised for approval", () => {
    expect(canRaiseForApproval(SANCTION_STATUS_RULE, "pending")).toBe(true);
    expect(canRaiseForApproval(SANCTION_STATUS_RULE, "approved")).toBe(false);
    expect(canRaiseForApproval(SANCTION_STATUS_RULE, "rejected")).toBe(false);
  });
  it("approved and rejected are final", () => {
    expect(isTerminalStatus(SANCTION_STATUS_RULE, "Approved")).toBe(true);
    expect(isTerminalStatus(SANCTION_STATUS_RULE, "rejected")).toBe(true);
    expect(isTerminalStatus(SANCTION_STATUS_RULE, "pending")).toBe(false);
  });
  it("explains why an approved sanction offers no raise", () => {
    expect(raiseBlockedReason(SANCTION_STATUS_RULE, "approved", "Approved")).toMatch(/Approved/);
  });
});

describe("bill status rule (finance-service mapBillStatus)", () => {
  it("paid and rejected are final, nothing is raisable", () => {
    expect(isTerminalStatus(BILL_STATUS_RULE, "paid")).toBe(true);
    expect(isTerminalStatus(BILL_STATUS_RULE, "rejected")).toBe(true);
    expect(isTerminalStatus(BILL_STATUS_RULE, "passed")).toBe(false);
    for (const s of ["pending", "passed", "paid"]) expect(canRaiseForApproval(BILL_STATUS_RULE, s)).toBe(false);
  });
  it("pass fits pending/under review only; pay fits passed only", () => {
    expect(BILL_PASSABLE).toEqual(["pending", "under_review"]);
    expect(BILL_PAYABLE).toContain("passed");
    expect((BILL_PASSABLE as readonly string[]).includes("paid")).toBe(false);
  });
});

describe("indent status rule (procurement-service indent/domain VALID_TRANSITIONS)", () => {
  it("rejected, closed and converted are final", () => {
    for (const s of ["rejected", "closed", "converted_to_po"]) expect(isTerminalStatus(INDENT_STATUS_RULE, s)).toBe(true);
    expect(isTerminalStatus(INDENT_STATUS_RULE, "approved")).toBe(false);
  });
  it("pending approval and tender required are awaiting a decision", () => {
    expect(isAwaitingDecision(INDENT_STATUS_RULE, "pending_approval")).toBe(true);
    expect(isAwaitingDecision(INDENT_STATUS_RULE, "tender_required")).toBe(true);
    expect(isAwaitingDecision(INDENT_STATUS_RULE, "approved")).toBe(false);
  });
});

describe("PO status rule (procurement-service po/domain VALID_TRANSITIONS)", () => {
  it("the eOffice note is raisable only on a draft PO; a pending PO is already awaiting its approval", () => {
    expect(canRaiseForApproval(PO_STATUS_RULE, "draft")).toBe(true);
    expect(canRaiseForApproval(PO_STATUS_RULE, "pending")).toBe(false);
    expect(isAwaitingDecision(PO_STATUS_RULE, "pending")).toBe(true);
    for (const s of ["approved", "dispatched", "closed", "cancelled"]) expect(canRaiseForApproval(PO_STATUS_RULE, s)).toBe(false);
  });
  it("closed and cancelled are final and not amendable", () => {
    expect(isTerminalStatus(PO_STATUS_RULE, "closed")).toBe(true);
    expect(isTerminalStatus(PO_STATUS_RULE, "cancelled")).toBe(true);
    expect((PO_AMENDABLE as readonly string[]).includes("closed")).toBe(false);
    expect((PO_AMENDABLE as readonly string[]).includes("cancelled")).toBe(false);
  });
});

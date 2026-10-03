import { describe, it, expect } from "vitest";
import { canDecideArrear } from "./arrearApproval";

describe("canDecideArrear (GAP-PAYROLL-ARREARS-03)", () => {
  it("hides Approve from the creator when approval is required", () => {
    expect(canDecideArrear({ createdBy: "u1", actorId: "u1", approvalRequired: true })).toBe(false);
  });
  it("offers Approve to a different user", () => {
    expect(canDecideArrear({ createdBy: "u1", actorId: "u2", approvalRequired: true })).toBe(true);
  });
  it("allows the creator when the tenant switched approval off", () => {
    expect(canDecideArrear({ createdBy: "u1", actorId: "u1", approvalRequired: false })).toBe(true);
  });
  it("lets the server decide when identity is unknown", () => {
    expect(canDecideArrear({ createdBy: null, actorId: "u1", approvalRequired: true })).toBe(true);
  });
});

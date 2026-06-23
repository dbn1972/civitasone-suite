import { describe, it, expect } from "vitest";
import { evaluateDecision, parsePermissionKey } from "../src/modules/evaluate/domain.js";

describe("parsePermissionKey", () => {
  it("splits resource and action", () => {
    expect(parsePermissionKey("hrms.leave.approve")).toEqual({
      resource: "hrms.leave",
      action: "approve",
    });
  });

  it("rejects short keys", () => {
    expect(() => parsePermissionKey("hrms")).toThrow("invalid permission key");
  });
});

describe("evaluateDecision", () => {
  const granted = [
    { resource: "hrms.leave", action: "approve", effect: "allow", roleName: "manager" },
    { resource: "payroll.run", action: "approve", effect: "allow", roleName: "payroll_admin" },
  ];

  it("allows super_admin without granted rows", () => {
    const r = evaluateDecision("hrms.leave.approve", ["super_admin"], []);
    expect(r.decision).toBe("allow");
    expect(r.reason).toBe("role:super_admin");
  });

  it("allows matching permission for role", () => {
    const r = evaluateDecision("hrms.leave.approve", ["manager"], granted);
    expect(r.decision).toBe("allow");
    expect(r.reason).toContain("manager");
  });

  it("denies missing permission", () => {
    const r = evaluateDecision("finance.budget.approve", ["manager"], granted);
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("no permission");
  });
});

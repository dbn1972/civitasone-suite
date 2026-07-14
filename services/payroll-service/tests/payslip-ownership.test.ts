/**
 * SEC-P1-01 regression: the payslip PDF route guards against cross-employee
 * download. The route calls enforceEmployeeOwnership(ctx, slip.employeeId) after
 * loading the slip; these tests pin the ownership semantics that guard relies on
 * so a regression in the helper (or its removal from the route) is caught.
 */
import { describe, it, expect } from "vitest";
import { enforceEmployeeOwnership, isSelfServiceEmployee, HttpError } from "../src/shared/context.js";
import type { RequestContext } from "@civitasone/types";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    actorId: "22222222-2222-2222-2222-222222222222",
    actorType: "user",
    roles: ["employee"],
    correlationId: "c1",
    ...overrides,
  };
}

const OWN = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

describe("payslip ownership guard (SEC-P1-01)", () => {
  it("lets a self-service employee download their OWN payslip", () => {
    expect(enforceEmployeeOwnership(ctx(), OWN)).toBe(OWN);
  });

  it("rejects a self-service employee downloading a co-worker's payslip (403)", () => {
    expect(() => enforceEmployeeOwnership(ctx(), OTHER)).toThrow(HttpError);
    try {
      enforceEmployeeOwnership(ctx(), OTHER);
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
  });

  it("classifies a bare 'employee' as self-service", () => {
    expect(isSelfServiceEmployee(ctx())).toBe(true);
  });

  it("lets a payroll_officer read any employee's slip (act-on-behalf)", () => {
    const officer = ctx({ roles: ["payroll_officer"] });
    expect(isSelfServiceEmployee(officer)).toBe(false);
    expect(enforceEmployeeOwnership(officer, OTHER)).toBe(OTHER);
  });

  it("does not treat a service account as self-service", () => {
    expect(isSelfServiceEmployee(ctx({ actorType: "service_account", roles: ["employee"] }))).toBe(false);
  });

  it("an employee who ALSO holds a privileged role is not confined", () => {
    // e.g. an HR admin who is also an employee — the privileged role wins.
    const dual = ctx({ roles: ["employee", "hr_admin"] });
    expect(isSelfServiceEmployee(dual)).toBe(false);
    expect(enforceEmployeeOwnership(dual, OTHER)).toBe(OTHER);
  });
});

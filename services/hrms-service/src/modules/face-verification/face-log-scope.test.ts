/**
 * SEC: GET .../attendance/face-log's authorization rule, extracted as a pure
 * function (resolveFaceLogScope) specifically so it can be unit tested
 * without a Fastify/DB harness -- see that function's doc comment in
 * routes.ts. Before this fix, `employeeId` was mandatory but never checked
 * against the caller's own (or a direct report's) resolved employee id --
 * any authenticated caller under ALL_ROLES (bare "employee" included) could
 * read another employee's face-verification history (match/no-match
 * outcome, similarity score, method, timestamps) by naming a different
 * uuid. Real-DB, end-to-end coverage of the route itself (including the
 * direct-reports lookup) lives in
 * ../__tests__/face-log-manager-scope-real-db.test.ts; this file covers
 * just the decision logic's branches directly.
 */
import { describe, it, expect } from "vitest";
import { resolveFaceLogScope } from "./routes.js";
import { HttpError } from "../../shared/context.js";

const SELF = "11111111-0000-0000-0000-000000000001";
const REPORT = "22222222-0000-0000-0000-000000000002";
const OTHER = "33333333-0000-0000-0000-000000000003";

describe("resolveFaceLogScope", () => {
  it("allows a bare employee to view their own resolved employee id", () => {
    expect(resolveFaceLogScope(["employee"], SELF, [], SELF)).toBe(SELF);
  });

  it("rejects a bare employee viewing someone else's id (the original IDOR)", () => {
    try {
      resolveFaceLogScope(["employee"], SELF, [], OTHER);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("FORBIDDEN");
    }
  });

  it("allows a manager to view a direct report's id", () => {
    expect(resolveFaceLogScope(["manager"], SELF, [REPORT], REPORT)).toBe(REPORT);
  });

  it("allows a manager to view their own id even when they have reports", () => {
    expect(resolveFaceLogScope(["manager"], SELF, [REPORT], SELF)).toBe(SELF);
  });

  it("rejects a manager viewing a non-report's id (denied, not substituted)", () => {
    try {
      resolveFaceLogScope(["manager"], SELF, [REPORT], OTHER);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("FORBIDDEN");
    }
  });

  it("allows hr_admin to view any id, including one it has no employee link of its own for", () => {
    expect(resolveFaceLogScope(["hr_admin"], null, [], OTHER)).toBe(OTHER);
  });

  it("allows super_admin/admin the same tenant-wide access as hr_admin", () => {
    expect(resolveFaceLogScope(["super_admin"], SELF, [], OTHER)).toBe(OTHER);
    expect(resolveFaceLogScope(["admin"], SELF, [], OTHER)).toBe(OTHER);
  });

  it("403s NO_EMPLOYEE_RECORD for a caller with no linked employee record and no privileged role", () => {
    try {
      resolveFaceLogScope(["employee"], null, [], OTHER);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("NO_EMPLOYEE_RECORD");
    }
  });

  it("403s an unlinked manager (no employee record) requesting someone else's id, even with a non-empty directReportIds guard elsewhere", () => {
    try {
      resolveFaceLogScope(["manager"], null, [], OTHER);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("NO_EMPLOYEE_RECORD");
    }
  });
});

/**
 * GAP-HR-ATTENDANCE-05 (SEC): GET .../attendance/geo-history's authorization
 * rule, extracted as a pure function (resolveGeoHistoryScope) specifically so
 * it can be unit tested without a Fastify/DB harness -- see that function's
 * doc comment in routes.ts. Before this fix, an omitted employeeId defaulted
 * to the raw auth-account id (wrong id space) and an *explicit* employeeId
 * was accepted from ANY authenticated caller (including bare "employee")
 * with no check that it was their own -- a live IDOR reading another
 * employee's location history and selfie file key.
 */
import { describe, it, expect } from "vitest";
import { resolveGeoHistoryScope } from "./routes.js";
import { HttpError } from "../../shared/context.js";

const SELF = "11111111-0000-0000-0000-000000000001";
const OTHER = "22222222-0000-0000-0000-000000000002";

describe("resolveGeoHistoryScope", () => {
  it("defaults to the caller's own resolved employee id when no employeeId is given", () => {
    expect(resolveGeoHistoryScope(["employee"], SELF, undefined)).toBe(SELF);
  });

  it("allows an explicit employeeId that matches the caller's own id, for any role", () => {
    expect(resolveGeoHistoryScope(["employee"], SELF, SELF)).toBe(SELF);
  });

  it("rejects a bare employee asking for someone else's history (the original IDOR)", () => {
    expect(() => resolveGeoHistoryScope(["employee"], SELF, OTHER)).toThrow(HttpError);
    try {
      resolveGeoHistoryScope(["employee"], SELF, OTHER);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("FORBIDDEN");
    }
  });

  it("rejects a manager asking for someone else's history (this module's HR_ROLES excludes manager)", () => {
    expect(() => resolveGeoHistoryScope(["manager"], SELF, OTHER)).toThrow(HttpError);
  });

  it("allows hr_admin to look up another employee's history", () => {
    expect(resolveGeoHistoryScope(["hr_admin"], SELF, OTHER)).toBe(OTHER);
  });

  it("allows hr_admin to look up another employee's history even with no employee record of their own", () => {
    expect(resolveGeoHistoryScope(["hr_admin"], null, OTHER)).toBe(OTHER);
  });

  it("403s a caller with no linked employee record and no explicit employeeId", () => {
    expect(() => resolveGeoHistoryScope(["employee"], null, undefined)).toThrow(HttpError);
    try {
      resolveGeoHistoryScope(["employee"], null, undefined);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("NO_EMPLOYEE_RECORD");
    }
  });
});

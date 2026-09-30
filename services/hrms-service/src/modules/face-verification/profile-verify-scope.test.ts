/**
 * SEC: unit coverage for the three profile-photo/verify-face authorization
 * rules, extracted as pure functions (resolveProfilePhotoWriteScope,
 * resolveProfilePhotoReadScope, resolveVerifyFaceScope) specifically so each
 * decision can be unit tested without a Fastify/DB harness -- see their doc
 * comments in routes.ts. All three routes used to accept a target
 * employeeId (URL param or request body) under ALL_ROLES with no check it
 * matched the caller's own resolved employee id -- flagged as an
 * out-of-scope sibling finding in PR #1682 (the face-log IDOR fix) and
 * fixed here. Real-DB, end-to-end coverage of the routes themselves lives in
 * ../../__tests__/profile-photo-verify-face-scope-real-db.test.ts; this file
 * covers just the decision logic's branches directly.
 */
import { describe, it, expect } from "vitest";
import {
  resolveProfilePhotoWriteScope,
  resolveProfilePhotoReadScope,
  resolveVerifyFaceScope,
} from "./routes.js";
import { HttpError } from "../../shared/context.js";

const SELF = "11111111-0000-0000-0000-000000000001";
const REPORT = "22222222-0000-0000-0000-000000000002";
const OTHER = "33333333-0000-0000-0000-000000000003";

function expectForbidden(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
    expect((err as HttpError).code).toBe(code);
  }
}

describe("resolveProfilePhotoWriteScope (POST .../profile-photo)", () => {
  it("allows a bare employee to upload their own profile photo", () => {
    expect(resolveProfilePhotoWriteScope(["employee"], SELF, SELF)).toBe(SELF);
  });

  it("rejects a bare employee uploading a colleague's photo (the IDOR)", () => {
    expectForbidden(() => resolveProfilePhotoWriteScope(["employee"], SELF, OTHER), "FORBIDDEN");
  });

  it("allows hr_admin to upload for any employee (onboarding on-behalf-of), even with no employee link of its own", () => {
    expect(resolveProfilePhotoWriteScope(["hr_admin"], null, OTHER)).toBe(OTHER);
  });

  it("allows super_admin/admin the same tenant-wide upload access as hr_admin", () => {
    expect(resolveProfilePhotoWriteScope(["super_admin"], SELF, OTHER)).toBe(OTHER);
    expect(resolveProfilePhotoWriteScope(["admin"], SELF, OTHER)).toBe(OTHER);
  });

  it("rejects a manager uploading a DIRECT REPORT's photo -- no manager on-behalf-of workflow exists for this route", () => {
    expectForbidden(() => resolveProfilePhotoWriteScope(["manager"], SELF, REPORT), "FORBIDDEN");
  });

  it("403s NO_EMPLOYEE_RECORD for a caller with no linked employee record and no privileged role", () => {
    expectForbidden(() => resolveProfilePhotoWriteScope(["employee"], null, OTHER), "NO_EMPLOYEE_RECORD");
  });
});

describe("resolveProfilePhotoReadScope (GET .../profile-photo)", () => {
  it("allows a bare employee to view their own resolved employee id", () => {
    expect(resolveProfilePhotoReadScope(["employee"], SELF, [], SELF)).toBe(SELF);
  });

  it("rejects a bare employee viewing someone else's photo (the IDOR)", () => {
    expectForbidden(() => resolveProfilePhotoReadScope(["employee"], SELF, [], OTHER), "FORBIDDEN");
  });

  it("allows a manager to view a direct report's photo", () => {
    expect(resolveProfilePhotoReadScope(["manager"], SELF, [REPORT], REPORT)).toBe(REPORT);
  });

  it("allows a manager to view their own photo even when they have reports", () => {
    expect(resolveProfilePhotoReadScope(["manager"], SELF, [REPORT], SELF)).toBe(SELF);
  });

  it("rejects a manager viewing a non-report's photo (denied, not substituted)", () => {
    expectForbidden(() => resolveProfilePhotoReadScope(["manager"], SELF, [REPORT], OTHER), "FORBIDDEN");
  });

  it("allows hr_admin/super_admin/admin to view any employee's photo", () => {
    expect(resolveProfilePhotoReadScope(["hr_admin"], null, [], OTHER)).toBe(OTHER);
    expect(resolveProfilePhotoReadScope(["super_admin"], SELF, [], OTHER)).toBe(OTHER);
    expect(resolveProfilePhotoReadScope(["admin"], SELF, [], OTHER)).toBe(OTHER);
  });

  it("403s NO_EMPLOYEE_RECORD for a caller with no linked employee record and no privileged role", () => {
    expectForbidden(() => resolveProfilePhotoReadScope(["employee"], null, [], OTHER), "NO_EMPLOYEE_RECORD");
  });

  it("403s an unlinked manager (no employee record) requesting someone else's id, even with an empty directReportIds guard elsewhere", () => {
    expectForbidden(() => resolveProfilePhotoReadScope(["manager"], null, [], OTHER), "NO_EMPLOYEE_RECORD");
  });
});

describe("resolveVerifyFaceScope (POST .../attendance/verify-face)", () => {
  it("allows a caller to verify their own face", () => {
    expect(resolveVerifyFaceScope(SELF, SELF)).toBe(SELF);
  });

  it("rejects a caller verifying against a colleague's registered face (the IDOR) -- self-only, no manager/HR override exists for this route", () => {
    expectForbidden(() => resolveVerifyFaceScope(SELF, OTHER), "FORBIDDEN");
  });

  it("403s NO_EMPLOYEE_RECORD for a caller with no linked employee record at all", () => {
    expectForbidden(() => resolveVerifyFaceScope(null, OTHER), "NO_EMPLOYEE_RECORD");
  });
});

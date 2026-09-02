/**
 * SECURITY/COMPLIANCE — GET /v1/hrms/employees/:id must never return a raw
 * mobile number.
 *
 * Root cause: getEmployeeDetail (modules/employee/queries.ts) cherry-picked
 * `emp.mobile` straight into the response as `phone`, bypassing
 * shared/pii-mask.ts's written policy that PII columns (pan, aadhaarRef,
 * bankAccountNo, bankIfsc, mobile) must never be returned in full in any API
 * response. This endpoint is reachable by every READER_ROLES member
 * (hr_admin, hr_officer, super_admin, manager) for ANY employee in the
 * tenant, not just direct reports.
 *
 * This is a real end-to-end check: a live app instance, a real Postgres row
 * (mobile stored encrypted-at-rest via pii-crypto.ts's encryptedText column,
 * exactly like production), and a real signed JWT per role -- not a mock.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const RAW_MOBILE = "9876543210";

function tokenFor(roles: string[]): string {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s1" }, SECRET);
}

async function seedEmployeeWithMobile(): Promise<string> {
  const employeeId = randomUUID();
  const deptId = randomUUID();
  const designationId = randomUUID();
  const actor = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({
        id: deptId, tenantId: TENANT, code: `MPM-DEPT-${employeeId.slice(0, 8)}`, name: "Mobile Mask Test Dept",
        isActive: true, createdBy: actor, updatedBy: actor, version: 1,
      });
      await tx.insert(hrmsDesignations).values({
        id: designationId, tenantId: TENANT, code: `MPM-DESIG-${employeeId.slice(0, 8)}`, name: "Mobile Mask Test Officer",
        level: 5, payGrade: "Grade-A", createdBy: actor, updatedBy: actor, version: 1,
      });
      await tx.insert(hrmsEmployees).values({
        id: employeeId, tenantId: TENANT, employeeNo: `MPM-${employeeId.slice(0, 8)}`,
        fullName: "Mobile Mask Test Employee", departmentId: deptId, designationId,
        dateOfJoining: "2020-01-01", employeeType: "permanent", status: "confirmed",
        mobile: RAW_MOBILE, createdBy: actor, updatedBy: actor, version: 1,
      });
    }),
  );
  return employeeId;
}

afterAll(async () => {
  // Best-effort cleanup: this test uses a fresh randomUUID() tenant per run
  // (not a shared constant), so leaving rows behind on failure can't collide
  // with any other test or run -- but delete them when we can regardless.
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    }),
  ).catch(() => {});
  await sqlClient.end();
});

describe("GET /v1/hrms/employees/:id — mobile number masking (SECURITY)", () => {
  const readerRoles = ["hr_admin", "hr_officer", "super_admin", "manager"];

  it.each(readerRoles)("masks the mobile number for READER role '%s' -- never returns it in full", async (role) => {
    const employeeId = await seedEmployeeWithMobile();
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${employeeId}`,
      headers: { authorization: `Bearer ${tokenFor([role])}` },
    });
    await app.close();

    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.payload);
    expect(body.phone).toBeDefined();
    expect(body.phone).not.toBe(RAW_MOBILE);
    expect(body.phone).not.toContain(RAW_MOBILE.slice(0, 6));
    expect(body.phone).toBe("******3210");
  });

  it("returns 403 for a role outside READER_ROLES (e.g. plain 'employee')", async () => {
    const employeeId = await seedEmployeeWithMobile();
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${employeeId}`,
      headers: { authorization: `Bearer ${tokenFor(["employee"])}` },
    });
    await app.close();

    expect(r.statusCode).toBe(403);
  });
});

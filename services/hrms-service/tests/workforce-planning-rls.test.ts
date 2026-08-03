/**
 * hrms-service — workforce-planning routes RLS regression test.
 *
 * Regression for a silent-empty-result bug: workforce-planning/routes.ts
 * queries `sqlClient` (raw postgres.js client) directly against
 * `employee.hrms_employees`, `employee.hrms_departments` and
 * `employee.hrms_designations` — all RLS-ENABLEd AND FORCEd. The service
 * connects as `hrms_svc` (rolsuper=false, rolbypassrls=false). This module
 * has no Drizzle schema attached, so there is no `db.transaction()` — the
 * only place `wrapWithTenantGuc` sets `app.tenant_id` — anywhere in the call
 * path. Without it, RLS fails CLOSED: every raw query returns SUCCESS with
 * EMPTY rows for every tenant, silently. `headcount`, `vacancy-forecast` and
 * `retirement-forecast` therefore always returned zero/empty results
 * regardless of real headcount data.
 *
 * This test seeds a real department, designation and employee through the
 * tenant-scoped path (Drizzle `db.transaction()`, which DOES set the GUC)
 * and asserts all three routes can see them — mirroring
 * services/helpdesk-service/tests/sla-engine-routes.test.ts.
 *
 * (`budget` and `diversity` in this same module are NOT covered here: they
 * query `employee.position_budget` / `employee.employee_profiles`, tables
 * that do not exist in any hrms-service migration — a separate pre-existing
 * 500, not the RLS-GUC defect this test targets.)
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../src/modules/employee/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0a1a5e00-4000-4000-8000-000000000801";
const ACTOR = "0a1a5e00-5000-4000-8000-000000000801";
const DEPT = "0a1a5e00-6000-4000-8000-000000000801";
const DESIGNATION = "0a1a5e00-7000-4000-8000-000000000801";
const EMPLOYEE = "0a1a5e00-8000-4000-8000-000000000801";

function authHeader(roles = ["hr_officer", "super_admin"], tenantId = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-wfp-801" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    }),
  );
}

/**
 * A department, a graded designation, and an active employee who turns 60
 * (superannuation age) six months from today — inside every forecast's
 * lookahead window (retirement-forecast's default is 3 years, vacancy-
 * forecast's nearest bucket is 1 year) without yet being past it, so both
 * "retiring soon" queries pick the row up unambiguously.
 */
async function seedWorkforce(): Promise<void> {
  const almostSixty = new Date();
  almostSixty.setFullYear(almostSixty.getFullYear() - 60);
  almostSixty.setMonth(almostSixty.getMonth() + 6);
  const dob = almostSixty.toISOString().slice(0, 10);

  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({
        id: DEPT, tenantId: TENANT, code: "WFP", name: "Workforce Planning Test Dept",
        isActive: true, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(hrmsDesignations).values({
        id: DESIGNATION, tenantId: TENANT, code: "WFP-01", name: "Test Officer",
        level: 5, payGrade: "Grade-A", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(hrmsEmployees).values({
        id: EMPLOYEE, tenantId: TENANT, employeeNo: "WFP-E001", fullName: "Test Employee",
        departmentId: DEPT, designationId: DESIGNATION, dateOfJoining: "2000-01-01",
        dateOfBirth: dob, employeeType: "permanent", status: "confirmed",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }),
  );
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/hrms/workforce/headcount", () => {
  it("counts the seeded employee by department (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedWorkforce();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/headcount?groupBy=department",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json().data as { total: number; breakdown: Array<{ group_key: string; count: number }> };
    // Before the fix: total === 0 always (RLS fails closed with no GUC set).
    expect(body.total).toBe(1);
    expect(body.breakdown.some((r) => r.group_key === "Workforce Planning Test Dept" && r.count === 1)).toBe(true);
  });

  it("counts by grade", async () => {
    await seedWorkforce();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/headcount?groupBy=grade",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json().data as { total: number; breakdown: Array<{ group_key: string; count: number }> };
    expect(body.total).toBe(1);
    expect(body.breakdown.some((r) => r.group_key === "Grade-A")).toBe(true);
  });

  it("tenant isolation: another tenant sees zero headcount from this tenant's data", async () => {
    await seedWorkforce();
    const OTHER_TENANT = "0a1a5e00-9000-4000-8000-000000000802";

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/headcount",
      headers: authHeader(["hr_officer", "super_admin"], OTHER_TENANT),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(0);
  });

  it("returns 400 for an invalid groupBy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/headcount?groupBy=not_a_real_group",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/workforce/headcount" });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/headcount",
      headers: authHeader(["citizen"]),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/workforce/vacancy-forecast", () => {
  it("sees the seeded employee in the retirement horizon buckets (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedWorkforce();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/vacancy-forecast",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ horizon: string; count: number }>;
    // Before the fix: [] always. The seeded employee is already past
    // superannuation age, so they fall in the nearest ("1_year") bucket.
    const total = data.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(1);
    expect(data.some((r) => r.horizon === "1_year" && r.count === 1)).toBe(true);
  });
});

describe("GET /v1/hrms/workforce/retirement-forecast", () => {
  it("sees the seeded employee's retirement period (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedWorkforce();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/retirement-forecast?granularity=year&years=10",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ period: string; retiring_count: number }>;
    // Before the fix: [] always regardless of real retirement data.
    const total = data.reduce((s, r) => s + r.retiring_count, 0);
    expect(total).toBe(1);
  });

  it("returns 400 for an out-of-range years param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/retirement-forecast?years=99",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast" });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/workforce/retirement-forecast",
      headers: authHeader(["citizen"]),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

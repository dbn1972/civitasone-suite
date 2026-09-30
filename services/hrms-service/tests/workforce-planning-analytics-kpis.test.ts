/**
 * hrms-service — GAP-HR-WORKFORCE-ANALYTICS-01/06 regression tests.
 *
 * `GET /v1/hrms/workforce/analytics-kpis` used to not exist at all -- the web
 * called it, got a 404, and silently rendered a fabricated all-zero object
 * ("0.0%" turnover/absenteeism, "0.0" tenure, an empty trend) as if it were
 * real. This wires a real, narrow endpoint: only `avgTenureYears` (from
 * `date_of_joining`) and gender counts (from `gender`) are computed --
 * both live on this module's own `employee.hrms_employees` rows, no
 * cross-module join. `turnoverPct`/`absenteeismPct`/`monthlyTrend` are
 * deliberately never included (see `meta.unavailable`): they need
 * attendance/lifecycle history this module cannot honestly compute without
 * a cross-module join this repo's CLAUDE.md forbids.
 *
 * The gender suppression test is GAP-HR-WORKFORCE-ANALYTICS-06: per the
 * published HR decision packet ("Applying default": suppress any breakdown
 * where the underlying group is smaller than 10), gender counts must be
 * omitted entirely -- not just hidden client-side -- whenever the tenant's
 * total in-scope headcount is below the threshold.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsDepartments, hrmsDesignations, hrmsEmployees } from "../src/modules/employee/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "0a1a5e00-5000-4000-8000-000000000901";

const TENANT_SMALL = "0a1a5e00-4000-4000-8000-000000000901"; // 3 employees -- below suppression threshold
const TENANT_LARGE = "0a1a5e00-4000-4000-8000-000000000902"; // 10 employees -- at/above threshold
const TENANT_EMPTY = "0a1a5e00-4000-4000-8000-000000000903"; // 0 employees -- "no data available" path

function authHeader(tenantId: string, roles = ["hr_officer", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-wfp-kpi" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

function yearsAgoISODate(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

interface SeedEmployee {
  id: string;
  empNo: string;
  gender: "male" | "female";
  joinedYearsAgo: number;
}

async function seedEmployees(tenantId: string, deptId: string, designationId: string, employees: SeedEmployee[]): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({
        id: deptId, tenantId, code: "WFA", name: "Analytics KPI Test Dept",
        isActive: true, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(hrmsDesignations).values({
        id: designationId, tenantId, code: "WFA-01", name: "Test Officer",
        level: 5, payGrade: "Grade-A", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      for (const e of employees) {
        await tx.insert(hrmsEmployees).values({
          id: e.id, tenantId, employeeNo: e.empNo, fullName: `Test ${e.empNo}`,
          departmentId: deptId, designationId, dateOfJoining: yearsAgoISODate(e.joinedYearsAgo),
          gender: e.gender, employeeType: "permanent", status: "confirmed",
          createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        });
      }
    }),
  );
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, tenantId));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, tenantId));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, tenantId));
    }),
  );
}

async function cleanupAll(): Promise<void> {
  await cleanupTenant(TENANT_SMALL);
  await cleanupTenant(TENANT_LARGE);
  await cleanupTenant(TENANT_EMPTY);
}

beforeEach(cleanupAll);
afterAll(async () => {
  await cleanupAll();
  await sqlClient.end();
});

describe("GET /v1/hrms/workforce/analytics-kpis", () => {
  it("never returns turnoverPct/absenteeismPct/monthlyTrend -- lists them as unavailable instead of fabricating zeros", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_EMPTY),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Record<string, unknown>; meta: { unavailable: string[] } };
      expect(body.data.turnoverPct).toBeUndefined();
      expect(body.data.absenteeismPct).toBeUndefined();
      expect(body.data.monthlyTrend).toBeUndefined();
      expect(body.meta.unavailable.sort()).toEqual(["absenteeismPct", "monthlyTrend", "turnoverPct"].sort());
    } finally {
      await app.close();
    }
  });

  it("no data available: a tenant with zero employees gets avgTenureYears: null, not a fabricated 0", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_EMPTY),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { avgTenureYears: number | null }; meta: { genderSuppressed: boolean } };
      expect(body.data.avgTenureYears).toBeNull();
      // total=0 is also < the suppression threshold.
      expect(body.meta.genderSuppressed).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("computes avgTenureYears from date_of_joining for a real tenant (happy path)", async () => {
    await seedEmployees(TENANT_SMALL, "0a1a5e00-6000-4000-8000-000000000901", "0a1a5e00-7000-4000-8000-000000000901", [
      { id: "0a1a5e00-8000-4000-8000-000000000901", empNo: "WFA-E001", gender: "male", joinedYearsAgo: 2 },
      { id: "0a1a5e00-8000-4000-8000-000000000902", empNo: "WFA-E002", gender: "male", joinedYearsAgo: 3 },
      { id: "0a1a5e00-8000-4000-8000-000000000903", empNo: "WFA-E003", gender: "female", joinedYearsAgo: 4 },
    ]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_SMALL),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { avgTenureYears: number } };
      // Mean of 2/3/4 years ago = 3.0 years; tolerance absorbs the
      // calendar-days-vs-365.25 approximation.
      expect(body.data.avgTenureYears).toBeCloseTo(3.0, 1);
    } finally {
      await app.close();
    }
  });

  it("GAP-HR-WORKFORCE-ANALYTICS-06: suppresses gender counts entirely when the tenant's total is below 10", async () => {
    await seedEmployees(TENANT_SMALL, "0a1a5e00-6000-4000-8000-000000000904", "0a1a5e00-7000-4000-8000-000000000904", [
      { id: "0a1a5e00-8000-4000-8000-000000000904", empNo: "WFA-E010", gender: "male", joinedYearsAgo: 1 },
      { id: "0a1a5e00-8000-4000-8000-000000000905", empNo: "WFA-E011", gender: "male", joinedYearsAgo: 1 },
      { id: "0a1a5e00-8000-4000-8000-000000000906", empNo: "WFA-E012", gender: "female", joinedYearsAgo: 1 },
    ]);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_SMALL),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Record<string, unknown>; meta: { genderSuppressed: boolean; genderSuppressionThreshold: number } };
      expect(body.data.genderRatioF).toBeUndefined();
      expect(body.data.genderRatioM).toBeUndefined();
      expect(body.meta.genderSuppressed).toBe(true);
      expect(body.meta.genderSuppressionThreshold).toBe(10);
    } finally {
      await app.close();
    }
  });

  it("returns real gender counts once the tenant's total reaches the threshold (10)", async () => {
    const employees: SeedEmployee[] = Array.from({ length: 10 }, (_, i) => ({
      id: `0a1a5e00-8000-4000-8000-0000000009${10 + i}`,
      empNo: `WFA-E1${i}`,
      gender: i < 4 ? "female" : "male",
      joinedYearsAgo: 5,
    }));
    await seedEmployees(TENANT_LARGE, "0a1a5e00-6000-4000-8000-000000000902", "0a1a5e00-7000-4000-8000-000000000902", employees);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_LARGE),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { genderRatioF: number; genderRatioM: number }; meta: { genderSuppressed: boolean } };
      expect(body.meta.genderSuppressed).toBe(false);
      expect(body.data.genderRatioF).toBe(4);
      expect(body.data.genderRatioM).toBe(6);
    } finally {
      await app.close();
    }
  });

  it("tenant isolation: one tenant's headcount never leaks into another tenant's suppression decision", async () => {
    const employees: SeedEmployee[] = Array.from({ length: 10 }, (_, i) => ({
      id: `0a1a5e00-8000-4000-8000-0000000009${20 + i}`,
      empNo: `WFA-E2${i}`,
      gender: i < 4 ? "female" : "male",
      joinedYearsAgo: 5,
    }));
    await seedEmployees(TENANT_LARGE, "0a1a5e00-6000-4000-8000-000000000903", "0a1a5e00-7000-4000-8000-000000000903", employees);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_EMPTY),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { avgTenureYears: number | null }; meta: { genderSuppressed: boolean } };
      expect(body.data.avgTenureYears).toBeNull();
      expect(body.meta.genderSuppressed).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/hrms/workforce/analytics-kpis" });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/hrms/workforce/analytics-kpis",
        headers: authHeader(TENANT_EMPTY, ["citizen"]),
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
